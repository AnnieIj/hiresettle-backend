/**
 * E2E: milestone partial-release workflow (#462).
 *
 * Boots the real MilestonesController + PartialReleaseService over HTTP
 * (supertest) against the test Postgres database (DATABASE_URL, migrated with
 * `prisma migrate deploy`). Only the edges are replaced:
 *   - StellarService       → mock, so no transaction is ever submitted on-chain
 *   - NotificationsService → mock, so no queues/Redis are needed
 *   - JwtAuthGuard         → resolves the caller from the `x-test-user` header
 *
 * Run with: npm run test:e2e
 */
import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MilestoneKind, MilestoneStatus, PartialReleaseStatus, PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { MilestonesController } from '../../src/modules/milestones/milestones.controller';
import { PartialReleaseService } from '../../src/modules/milestones/partial-release.service';
import { MilestonesService } from '../../src/modules/milestones/milestones.service';
import { ProofVersionsService } from '../../src/modules/milestones/proof-versions.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StellarService } from '../../src/common/stellar/stellar.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { UserJwtSubThrottlerGuard } from '../../src/common/guards/user-jwt-sub-throttler.guard';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';

const MILESTONE_AMOUNT = 1_000_000n;
const TX_HASH = 'e2e-mock-tx-hash';

interface Fixture {
  engagementId: string;
  milestoneId: string;
  company: { id: string; stellarAddress: string; role: UserRole };
  recruiter: { id: string; stellarAddress: string; role: UserRole };
  arbiter: { id: string; stellarAddress: string; role: UserRole };
}

/** Test auth: `x-test-user: <userId>` → request.user from the seeded fixture. */
class HeaderAuthGuard implements CanActivate {
  users = new Map<string, Fixture['company']>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = this.users.get(req.headers['x-test-user']);
    if (!user) throw new UnauthorizedException();
    req.user = user;
    return true;
  }
}

describe('Milestone partial release (e2e, #462)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: Fixture;
  const auth = new HeaderAuthGuard();
  const stellar = { releasePartialMilestonePayment: jest.fn() };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };

  const base = () => `/engagements/${fixture.engagementId}/milestones/0/partial-releases`;
  const as = (user: { id: string }) => ({ 'x-test-user': user.id });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [MilestonesController],
      providers: [
        PrismaService,
        PartialReleaseService,
        { provide: StellarService, useValue: stellar },
        { provide: NotificationsService, useValue: notifications },
        // Not exercised by these routes.
        { provide: MilestonesService, useValue: {} },
        { provide: ProofVersionsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(auth)
      .overrideGuard(UserJwtSubThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(IdempotencyInterceptor)
      .useValue({ intercept: (_ctx: ExecutionContext, next: { handle: () => unknown }) => next.handle() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    stellar.releasePartialMilestonePayment.mockResolvedValue(TX_HASH);
    fixture = await seed(prisma);
    auth.users = new Map([fixture.company, fixture.recruiter, fixture.arbiter].map((u) => [u.id, u]));
  });

  afterEach(async () => {
    await cleanup(prisma, fixture);
  });

  async function loadState() {
    const milestone = await prisma.milestone.findUniqueOrThrow({ where: { id: fixture.milestoneId } });
    const engagement = await prisma.engagement.findUniqueOrThrow({ where: { id: fixture.engagementId } });
    const refund = await prisma.refund.findUnique({ where: { milestoneId: fixture.milestoneId } });
    const audit = await prisma.milestoneAuditLog.findMany({
      where: { milestoneId: fixture.milestoneId },
      orderBy: { createdAt: 'asc' },
    });
    return { milestone, engagement, refund, actions: audit.map((a) => a.action) };
  }

  describe('propose → approve (happy path)', () => {
    it('releases the agreed share, keeps the remainder in escrow and updates totals', async () => {
      const proposed = await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releasePercent: 40, remainderAction: 'RETAIN', reason: 'Candidate started part-time' })
        .expect(201);

      expect(proposed.body).toMatchObject({
        status: PartialReleaseStatus.PROPOSED,
        releaseAmount: '400000',
        remainderAmount: '600000',
        remainderAction: 'RETAIN',
        companyApproverId: fixture.company.id,
        recruiterApproverId: null,
      });
      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        fixture.recruiter.stellarAddress,
        expect.anything(),
        'Partial release proposed',
        expect.any(String),
        expect.objectContaining({ releaseId: proposed.body.id }),
      );

      const approved = await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.recruiter))
        .expect(200);

      expect(approved.body).toMatchObject({
        id: proposed.body.id,
        status: PartialReleaseStatus.EXECUTED,
        txHash: TX_HASH,
        recruiterApproverId: fixture.recruiter.id,
      });
      expect(stellar.releasePartialMilestonePayment).toHaveBeenCalledTimes(1);
      expect(stellar.releasePartialMilestonePayment).toHaveBeenCalledWith(
        fixture.engagementId,
        0,
        400_000n,
        false,
      );

      const state = await loadState();
      expect(state.milestone.paymentReleased).toBe(400_000n);
      expect(state.milestone.status).toBe(MilestoneStatus.PROOF_SUBMITTED);
      expect(state.engagement.releasedAmount).toBe(400_000n);
      expect(state.refund).toBeNull();
      expect(state.actions).toEqual(['PARTIAL_RELEASE_PROPOSED', 'PARTIAL_RELEASE_EXECUTED']);

      const listed = await request(app.getHttpServer()).get(base()).set(as(fixture.company)).expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0]).toMatchObject({ status: PartialReleaseStatus.EXECUTED });
    });

    it('refunds the remainder and confirms the milestone when remainderAction is REFUND', async () => {
      const proposed = await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.recruiter))
        .send({ releaseAmount: '250000', remainderAction: 'REFUND' })
        .expect(201);
      expect(proposed.body.recruiterApproverId).toBe(fixture.recruiter.id);

      await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.company))
        .expect(200)
        .expect((res) => expect(res.body.status).toBe(PartialReleaseStatus.EXECUTED));

      expect(stellar.releasePartialMilestonePayment).toHaveBeenCalledWith(fixture.engagementId, 0, 250_000n, true);

      const state = await loadState();
      expect(state.milestone.paymentReleased).toBe(250_000n);
      expect(state.milestone.status).toBe(MilestoneStatus.CONFIRMED);
      expect(state.milestone.confirmedAt).not.toBeNull();
      expect(state.engagement.releasedAmount).toBe(250_000n);
      expect(state.refund).toMatchObject({ amount: 750_000n, status: 'COMPLETED' });
    });
  });

  describe('propose → reject', () => {
    it('leaves the milestone, totals and escrow untouched', async () => {
      const before = await loadState();

      const proposed = await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.recruiter))
        .send({ releaseAmount: '300000', remainderAction: 'REFUND' })
        .expect(201);

      const rejected = await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/reject`)
        .set(as(fixture.company))
        .expect(200);

      expect(rejected.body).toMatchObject({ id: proposed.body.id, status: PartialReleaseStatus.REJECTED });
      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();

      const after = await loadState();
      expect(after.milestone.status).toBe(before.milestone.status);
      expect(after.milestone.paymentReleased).toBe(before.milestone.paymentReleased);
      expect(after.milestone.amount).toBe(MILESTONE_AMOUNT);
      expect(after.engagement.releasedAmount).toBe(0n);
      expect(after.refund).toBeNull();
      expect(after.actions).toEqual(['PARTIAL_RELEASE_PROPOSED', 'PARTIAL_RELEASE_REJECTED']);

      // A rejected proposal can no longer be approved…
      await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.company))
        .expect(409);

      // …and it no longer blocks a fresh proposal.
      await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releasePercent: 10, remainderAction: 'RETAIN' })
        .expect(201);
    });
  });

  describe('guard rails', () => {
    it('rejects a second open proposal, self-approval and non-parties', async () => {
      const proposed = await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releasePercent: 50, remainderAction: 'RETAIN' })
        .expect(201);

      await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.recruiter))
        .send({ releasePercent: 20, remainderAction: 'RETAIN' })
        .expect(409);

      await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.company))
        .expect(409);

      await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.arbiter))
        .expect(403);

      expect(stellar.releasePartialMilestonePayment).not.toHaveBeenCalled();
    });

    it('validates the split', async () => {
      await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releaseAmount: String(MILESTONE_AMOUNT), remainderAction: 'RETAIN' })
        .expect(400);

      await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releaseAmount: '1000', releasePercent: 10, remainderAction: 'RETAIN' })
        .expect(400);

      await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releasePercent: 100, remainderAction: 'RETAIN' })
        .expect(400);
    });

    it('marks the release FAILED and keeps totals when the on-chain call fails', async () => {
      stellar.releasePartialMilestonePayment.mockRejectedValueOnce(new Error('Soroban simulation failed'));

      const proposed = await request(app.getHttpServer())
        .post(base())
        .set(as(fixture.company))
        .send({ releasePercent: 30, remainderAction: 'RETAIN' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${base()}/${proposed.body.id}/approve`)
        .set(as(fixture.recruiter))
        .expect(500);

      const release = await prisma.milestonePartialRelease.findUniqueOrThrow({ where: { id: proposed.body.id } });
      expect(release).toMatchObject({ status: PartialReleaseStatus.FAILED, failureReason: 'Soroban simulation failed' });

      const state = await loadState();
      expect(state.milestone.paymentReleased).toBeNull();
      expect(state.engagement.releasedAmount).toBe(0n);
      expect(state.actions).toEqual(['PARTIAL_RELEASE_PROPOSED', 'PARTIAL_RELEASE_FAILED']);
    });
  });
});

async function seed(prisma: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const makeUser = (role: UserRole, prefix: string) =>
    prisma.user.create({
      data: {
        role,
        stellarAddress: `G${prefix}E2E${suffix}`,
        email: `${prefix.toLowerCase()}-${suffix.toLowerCase()}@e2e.test`,
        name: `${prefix} ${suffix}`,
      },
      select: { id: true, stellarAddress: true, role: true },
    });

  const [company, recruiter, arbiter] = await Promise.all([
    makeUser(UserRole.COMPANY, 'COMPANY'),
    makeUser(UserRole.RECRUITER, 'RECRUITER'),
    makeUser(UserRole.ARBITER, 'ARBITER'),
  ]);

  const engagementId = `e2e-partial-${suffix.toLowerCase()}`;
  await prisma.engagement.create({
    data: {
      id: engagementId,
      companyAddress: company.stellarAddress,
      recruiterAddress: recruiter.stellarAddress,
      arbiterAddress: arbiter.stellarAddress,
      companyId: company.id,
      recruiterId: recruiter.id,
      arbiterId: arbiter.id,
      tokenAddress: 'CUSDCE2E',
      totalAmount: MILESTONE_AMOUNT,
      jobTitle: 'E2E Senior Engineer',
    },
  });
  const milestone = await prisma.milestone.create({
    data: {
      engagementId,
      milestoneIndex: 0,
      name: 'Placement',
      kind: MilestoneKind.PLACEMENT,
      paymentPercent: 100,
      amount: MILESTONE_AMOUNT,
      status: MilestoneStatus.PROOF_SUBMITTED,
    },
  });

  return { engagementId, milestoneId: milestone.id, company, recruiter, arbiter };
}

async function cleanup(prisma: PrismaClient, fixture?: Fixture) {
  if (!fixture) return;
  const userIds = [fixture.company.id, fixture.recruiter.id, fixture.arbiter.id];
  await prisma.milestoneAuditLog.deleteMany({ where: { milestoneId: fixture.milestoneId } });
  // Partial releases and refunds cascade with the milestone.
  await prisma.milestone.deleteMany({ where: { engagementId: fixture.engagementId } });
  await prisma.engagement.deleteMany({ where: { id: fixture.engagementId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
