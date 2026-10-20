import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DisputeOutcome, DisputeStage, DisputeStatus, MilestoneStatus } from '@prisma/client';
import { DisputesService } from './disputes.service';
import { ArbiterAssignmentService } from './arbiter-assignment.service';
import { DisputeSlaService } from './dispute-sla.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';

const HOUR = 60 * 60 * 1000;

const engagement = {
  id: 'ENG-001',
  jobTitle: 'Senior Engineer',
  status: 'ACTIVE',
  companyId: 'company-1',
  recruiterId: 'recruiter-1',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
  arbiterAddress: 'GARBITER',
};

const reviewDispute = () => ({
  id: 'dispute-1',
  engagementId: 'ENG-001',
  milestoneId: 'ms-0',
  status: DisputeStatus.UNDER_REVIEW,
  stage: DisputeStage.ARBITER_REVIEW,
  arbiterId: 'arb-1',
  responseDeadline: new Date(Date.now() + 10 * HOUR),
  slaStatus: 'ON_TRACK',
  outcome: null,
  appealDeadline: null,
  isFinal: false,
});

const makePrisma = () => ({
  dispute: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  milestone: { findUnique: jest.fn(), update: jest.fn() },
  engagement: { findUnique: jest.fn().mockResolvedValue(engagement) },
  refund: { upsert: jest.fn() },
  arbiterPayout: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
});

async function build(appealWindowHours = 72) {
  const prisma = makePrisma();
  const stellar = { resolveMilestoneDispute: jest.fn().mockResolvedValue('tx') };
  const notifications = { notifyUserById: jest.fn().mockResolvedValue(undefined) };
  const arbiters = { autoAssign: jest.fn() };
  const sla = {
    stageFields: jest.fn((stage) => ({ stage, responseDeadline: new Date('2026-09-28'), slaStatus: 'ON_TRACK', slaEscalatedAt: null })),
    completionStatus: jest.fn().mockReturnValue('MET'),
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) => (key === 'DISPUTE_APPEAL_WINDOW_HOURS' ? appealWindowHours : fallback)),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DisputesService,
      { provide: PrismaService, useValue: prisma },
      { provide: StellarService, useValue: stellar },
      { provide: NotificationsService, useValue: notifications },
      { provide: ConfigService, useValue: config },
      { provide: ArbiterAssignmentService, useValue: arbiters },
      { provide: DisputeSlaService, useValue: sla },
    ],
  }).compile();

  return { service: module.get(DisputesService), prisma, stellar, notifications, arbiters, sla };
}

describe('DisputesService', () => {
  describe('openForMilestone()', () => {
    it('creates a dispute in the ASSIGNMENT stage and triggers auto-assignment', async () => {
      const { service, prisma, arbiters, sla } = await build();
      prisma.dispute.findFirst.mockResolvedValue(null);
      prisma.milestone.findUnique.mockResolvedValue({ engagementId: 'ENG-001', disputeReason: 'No show' });
      prisma.dispute.create.mockResolvedValue({ id: 'dispute-1' });
      arbiters.autoAssign.mockResolvedValue({ id: 'dispute-1', arbiterId: 'arb-1' });

      const result = await service.openForMilestone('ms-0');

      expect(sla.stageFields).toHaveBeenCalledWith(DisputeStage.ASSIGNMENT, expect.any(Date));
      expect(prisma.dispute.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          engagementId: 'ENG-001',
          milestoneId: 'ms-0',
          reason: 'No show',
          status: DisputeStatus.OPEN,
          fundsLocked: true,
          stage: DisputeStage.ASSIGNMENT,
        }),
      });
      expect(arbiters.autoAssign).toHaveBeenCalledWith('dispute-1');
      expect(result).toEqual({ id: 'dispute-1', arbiterId: 'arb-1' });
    });

    it('is idempotent for replayed dispute events', async () => {
      const { service, prisma, arbiters } = await build();
      prisma.dispute.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.openForMilestone('ms-0')).resolves.toEqual({ id: 'existing' });
      expect(prisma.dispute.create).not.toHaveBeenCalled();
      expect(arbiters.autoAssign).not.toHaveBeenCalled();
    });
  });

  describe('findOneForUser() — deadline exposure', () => {
    const detail = () => ({
      ...reviewDispute(),
      responseDeadline: new Date('2026-09-28T00:00:00.000Z'),
      appeal: null,
      engagement,
      milestone: { id: 'ms-0', milestoneIndex: 0, name: 'Placement', status: MilestoneStatus.DISPUTED, amount: 1500n },
    });

    it('returns the stage deadline and SLA status', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findUnique.mockResolvedValue(detail());

      const result = await service.findOneForUser('dispute-1', { id: 'company-1', role: 'COMPANY' }, new Date('2026-09-29'));

      expect(result.sla).toEqual({
        stage: DisputeStage.ARBITER_REVIEW,
        responseDeadline: new Date('2026-09-28T00:00:00.000Z'),
        slaStatus: 'ON_TRACK',
        isOverdue: true,
      });
      expect(result.milestone.amount).toBe('1500');
      expect(result.appealWindow).toEqual({ deadline: null, isOpen: false });
    });

    it('lets the assigned arbiter view the dispute', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findUnique.mockResolvedValue(detail());
      await expect(service.findOneForUser('dispute-1', { id: 'arb-1', role: 'ARBITER' })).resolves.toBeDefined();
    });

    it('hides the dispute from unrelated users', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findUnique.mockResolvedValue(detail());
      await expect(service.findOneForUser('dispute-1', { id: 'someone', role: 'ARBITER' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s on unknown disputes', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findUnique.mockResolvedValue(null);
      await expect(service.findOneForUser('nope', { id: 'x', role: 'ADMIN' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('decide() — first-tier decision', () => {
    it('opens a 72h appeal window and keeps funds locked instead of settling', async () => {
      const { service, prisma, stellar, notifications } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue({ ...reviewDispute(), status: DisputeStatus.RESOLVED });
      const before = Date.now();

      await service.decide(reviewDispute() as any, DisputeOutcome.RELEASE, { id: 'arb-1', role: 'ARBITER' });

      const { where, data } = prisma.dispute.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 'dispute-1', status: { in: ['OPEN', 'UNDER_REVIEW'] } });
      expect(data).toMatchObject({ status: DisputeStatus.RESOLVED, outcome: DisputeOutcome.RELEASE, fundsLocked: true, isFinal: false, slaStatus: 'MET' });
      const windowMs = data.appealDeadline.getTime() - data.resolvedAt.getTime();
      expect(windowMs).toBe(72 * HOUR);
      expect(data.resolvedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stellar.resolveMilestoneDispute).not.toHaveBeenCalled();
      expect(notifications.notifyUserById).toHaveBeenCalledTimes(2);
    });

    it('settles immediately when the appeal window is disabled', async () => {
      const { service, prisma, stellar } = await build(0);
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue({
        ...reviewDispute(),
        status: DisputeStatus.CLOSED,
        outcome: DisputeOutcome.RELEASE,
        milestone: { id: 'ms-0', milestoneIndex: 0, amount: 1500n },
      });

      await service.decide(reviewDispute() as any, DisputeOutcome.RELEASE);

      expect(prisma.dispute.updateMany.mock.calls[0][0].data.isFinal).toBe(true);
      expect(stellar.resolveMilestoneDispute).toHaveBeenCalledWith('ENG-001', 0, true);
    });

    it('only the assigned arbiter may decide', async () => {
      const { service, prisma } = await build();
      await expect(
        service.decide(reviewDispute() as any, DisputeOutcome.RELEASE, { id: 'arb-other', role: 'ARBITER' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a second decision while the appeal window runs', async () => {
      const { service } = await build();
      await expect(
        service.decide({ ...reviewDispute(), status: DisputeStatus.RESOLVED } as any, DisputeOutcome.REFUND),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to decide an appeal through the first-tier path', async () => {
      const { service } = await build();
      await expect(
        service.decide({ ...reviewDispute(), stage: DisputeStage.APPEAL_REVIEW } as any, DisputeOutcome.REFUND),
      ).rejects.toThrow(ConflictException);
    });

    it('returns null for legacy milestones without a dispute record', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findFirst.mockResolvedValue(null);
      await expect(service.recordDecision('ms-0', DisputeOutcome.RELEASE)).resolves.toBeNull();
    });
  });

  describe('settle()', () => {
    const finalDispute = (outcome: DisputeOutcome) => ({
      ...reviewDispute(),
      status: DisputeStatus.CLOSED,
      outcome,
      isFinal: true,
      milestone: { id: 'ms-0', milestoneIndex: 0, amount: 1500n },
    });

    it('claims the dispute before paying out so it can only settle once', async () => {
      const { service, prisma, stellar } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 0 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue(finalDispute(DisputeOutcome.RELEASE));

      await service.settle('dispute-1');

      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', status: DisputeStatus.RESOLVED, isFinal: true, fundsReleasedAt: null },
        data: { status: DisputeStatus.CLOSED },
      });
      expect(stellar.resolveMilestoneDispute).not.toHaveBeenCalled();
    });

    it('releases funds and unlocks the dispute for RELEASE', async () => {
      const { service, prisma, stellar } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue(finalDispute(DisputeOutcome.RELEASE));

      await service.settle('dispute-1');

      expect(stellar.resolveMilestoneDispute).toHaveBeenCalledWith('ENG-001', 0, true);
      expect(prisma.refund.upsert).not.toHaveBeenCalled();
      expect(prisma.milestone.update).toHaveBeenCalledWith({
        where: { id: 'ms-0' },
        data: expect.objectContaining({ status: MilestoneStatus.RESOLVED, paymentReleased: 1500n }),
      });
      expect(prisma.dispute.update).toHaveBeenCalledWith({
        where: { id: 'dispute-1' },
        data: { fundsLocked: false, fundsReleasedAt: expect.any(Date) },
      });
    });

    it('records a refund for REFUND', async () => {
      const { service, prisma, stellar } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue(finalDispute(DisputeOutcome.REFUND));

      await service.settle('dispute-1');

      expect(prisma.refund.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { milestoneId: 'ms-0' } }));
      expect(stellar.resolveMilestoneDispute).toHaveBeenCalledWith('ENG-001', 0, false);
      expect(prisma.milestone.update.mock.calls[0][0].data.status).toBe(MilestoneStatus.PENDING);
    });

    it('rolls the claim back when the on-chain call fails so the job retries', async () => {
      const { service, prisma, stellar } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue(finalDispute(DisputeOutcome.RELEASE));
      stellar.resolveMilestoneDispute.mockRejectedValue(new Error('tx rejected'));

      await expect(service.settle('dispute-1')).rejects.toThrow('tx rejected');

      expect(prisma.dispute.update).toHaveBeenCalledWith({ where: { id: 'dispute-1' }, data: { status: DisputeStatus.RESOLVED } });
      expect(prisma.milestone.update).not.toHaveBeenCalled();
    });
  });

  describe('evidence window (#499)', () => {
    it('is open for an active dispute with no deadline set', async () => {
      const { service } = await build();
      expect(service.isEvidenceWindowOpen({ status: DisputeStatus.OPEN, evidenceDeadline: null })).toBe(true);
    });

    it('is open for an active dispute before its evidence deadline', async () => {
      const { service } = await build();
      const now = new Date('2026-10-01T00:00:00.000Z');
      expect(
        service.isEvidenceWindowOpen(
          { status: DisputeStatus.OPEN, evidenceDeadline: new Date(now.getTime() + HOUR) },
          now,
        ),
      ).toBe(true);
    });

    it('is closed once the evidence deadline has passed', async () => {
      const { service } = await build();
      const now = new Date('2026-10-01T00:00:00.000Z');
      expect(
        service.isEvidenceWindowOpen(
          { status: DisputeStatus.OPEN, evidenceDeadline: new Date(now.getTime() - HOUR) },
          now,
        ),
      ).toBe(false);
    });

    it('is closed once the dispute is no longer active', async () => {
      const { service } = await build();
      expect(
        service.isEvidenceWindowOpen({ status: DisputeStatus.CLOSED, evidenceDeadline: new Date(Date.now() + HOUR) }),
      ).toBe(false);
    });

    it('openForMilestone sets the evidence deadline from config', async () => {
      const { service, prisma, arbiters } = await build();
      prisma.dispute.findFirst.mockResolvedValue(null);
      prisma.milestone.findUnique.mockResolvedValue({ engagementId: 'ENG-001', disputeReason: 'No show' });
      prisma.dispute.create.mockResolvedValue({ id: 'dispute-1' });
      arbiters.autoAssign.mockResolvedValue(null);

      await service.openForMilestone('ms-0');

      const { evidenceDeadline } = prisma.dispute.create.mock.calls[0][0].data;
      expect(evidenceDeadline).toBeInstanceOf(Date);
      expect(evidenceDeadline.getTime()).toBeGreaterThan(Date.now());
    });

    it('findActiveForMilestone returns the latest non-closed dispute', async () => {
      const { service, prisma } = await build();
      prisma.dispute.findFirst.mockResolvedValue({ id: 'dispute-1' });

      const result = await service.findActiveForMilestone('ms-0');

      expect(prisma.dispute.findFirst).toHaveBeenCalledWith({
        where: { milestoneId: 'ms-0', status: { not: DisputeStatus.CLOSED } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({ id: 'dispute-1' });
    });
  });

  describe('arbiter fee and payout (#500)', () => {
    it('computes a PERCENT fee (the default) from the milestone amount', async () => {
      const { service } = await build();
      // Default config: ARBITER_FEE_TYPE=PERCENT, ARBITER_FEE_VALUE=5
      expect(service.computeArbiterFee(1000n)).toBe(50n);
    });

    it('computes a FLAT fee when configured', async () => {
      const prisma = makePrisma();
      const stellar = { resolveMilestoneDispute: jest.fn() };
      const notifications = { notifyUserById: jest.fn() };
      const arbiters = { autoAssign: jest.fn() };
      const sla = { stageFields: jest.fn(), completionStatus: jest.fn() };
      const config = {
        get: jest.fn((key: string, fallback: unknown) => {
          if (key === 'ARBITER_FEE_TYPE') return 'FLAT';
          if (key === 'ARBITER_FEE_VALUE') return 25;
          return fallback;
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DisputesService,
          { provide: PrismaService, useValue: prisma },
          { provide: StellarService, useValue: stellar },
          { provide: NotificationsService, useValue: notifications },
          { provide: ConfigService, useValue: config },
          { provide: ArbiterAssignmentService, useValue: arbiters },
          { provide: DisputeSlaService, useValue: sla },
        ],
      }).compile();
      const service = module.get(DisputesService);

      // A flat fee doesn't scale with the milestone amount.
      expect(service.computeArbiterFee(1_000_000n)).toBe(25n);
      expect(service.computeArbiterFee(1n)).toBe(25n);
    });

    it('records a payout for the assigned arbiter and does not double-record it', async () => {
      const { service, prisma } = await build();
      prisma.arbiterPayout.findUnique.mockResolvedValueOnce(null);
      prisma.arbiterPayout.create.mockResolvedValue({ id: 'payout-1' });

      const first = await service.recordArbiterPayout({ id: 'dispute-1', arbiterId: 'arb-1' }, 1000n);
      expect(prisma.arbiterPayout.create).toHaveBeenCalledWith({
        data: { disputeId: 'dispute-1', arbiterId: 'arb-1', feeType: 'PERCENT', feeValue: 5, amount: 50n },
      });
      expect(first).toEqual({ id: 'payout-1' });

      prisma.arbiterPayout.findUnique.mockResolvedValueOnce({ id: 'payout-1' });
      const second = await service.recordArbiterPayout({ id: 'dispute-1', arbiterId: 'arb-1' }, 1000n);
      expect(prisma.arbiterPayout.create).toHaveBeenCalledTimes(1);
      expect(second).toEqual({ id: 'payout-1' });
    });

    it('does not record a payout when no arbiter was assigned', async () => {
      const { service, prisma } = await build();
      await service.recordArbiterPayout({ id: 'dispute-1', arbiterId: null }, 1000n);
      expect(prisma.arbiterPayout.create).not.toHaveBeenCalled();
    });

    it('settle() records the arbiter payout for the dispute', async () => {
      const { service, prisma } = await build();
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      prisma.dispute.findUniqueOrThrow.mockResolvedValue({
        ...reviewDispute(),
        status: DisputeStatus.CLOSED,
        outcome: DisputeOutcome.RELEASE,
        isFinal: true,
        milestone: { id: 'ms-0', milestoneIndex: 0, amount: 1000n },
      });
      prisma.arbiterPayout.findUnique.mockResolvedValue(null);

      await service.settle('dispute-1');

      expect(prisma.arbiterPayout.create).toHaveBeenCalledWith({
        data: { disputeId: 'dispute-1', arbiterId: 'arb-1', feeType: 'PERCENT', feeValue: 5, amount: 50n },
      });
    });
  });
});
