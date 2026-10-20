import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';

const makeMockPrisma = () => ({
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((fn: any) =>
    typeof fn === 'function' ? fn(makeTxMock()) : Promise.all(fn),
  ),
});

const makeTxMock = () => ({
  refreshToken: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({}),
  },
});

const makeMockJwt = () => ({
  sign: jest.fn().mockReturnValue('access_token'),
  signAsync: jest.fn().mockResolvedValue('refresh_token'),
});

const makeMockConfig = () => ({
  get: jest.fn((key: string, def?: any) => {
    if (key === 'JWT_ACCESS_EXPIRES_IN') return '15m';
    if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
    if (key === 'JWT_REFRESH_EXPIRES_DAYS') return 7;
    return def ?? null;
  }),
});

const makeMockSecurityEvents = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

const makeUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  email: 'alice@example.com',
  role: 'COMPANY',
  stellarAddress: 'GABC',
  ...overrides,
});

const makeRefreshToken = (overrides: Partial<any> = {}) => ({
  id: 'rt-1',
  userId: 'user-1',
  tokenHash: 'hashedtoken',
  familyId: 'family-1',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  consumedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('SessionService', () => {
  let service: SessionService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockJwt: ReturnType<typeof makeMockJwt>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    mockJwt = makeMockJwt();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: makeMockConfig() },
        { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    jest.clearAllMocks();
    mockJwt.sign.mockReturnValue('access_token');
    mockJwt.signAsync.mockResolvedValue('refresh_token');
  });

  // ── issueTokenPair ─────────────────────────────────────────────────────────

  describe('issueTokenPair()', () => {
    it('creates a refresh token record and returns access + refresh tokens', async () => {
      const user = makeUser();
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const result = await service.issueTokenPair(user as any);

      expect(result).toMatchObject({ accessToken: 'access_token', refreshToken: 'refresh_token' });
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: user.id }),
        }),
      );
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('throws UnauthorizedException when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh('bad_token')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes family and throws on reuse (consumedAt set)', async () => {
      const stored = makeRefreshToken({ consumedAt: new Date(), user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.refresh('any')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('throws for expired token', async () => {
      const stored = makeRefreshToken({ expiresAt: new Date(Date.now() - 1000), user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      await expect(service.refresh('any')).rejects.toThrow(UnauthorizedException);
    });

    it('throws for revoked token', async () => {
      const stored = makeRefreshToken({ revokedAt: new Date(), user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      await expect(service.refresh('any')).rejects.toThrow(UnauthorizedException);
    });

    it('issues new token pair for a valid token', async () => {
      const stored = makeRefreshToken({ user: makeUser() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      const tx = makeTxMock();
      mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      const result = await service.refresh('valid_token');
      expect(result).toMatchObject({ accessToken: 'access_token', refreshToken: 'refresh_token' });
    });
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('revokes the refresh token and returns { revoked: true }', async () => {
      const stored = makeRefreshToken();
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...stored, revokedAt: new Date() });

      const result = await service.logout('some_token');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      );
    });

    it('returns { revoked: true } even when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      const result = await service.logout('missing');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('does not update an already revoked token', async () => {
      const stored = makeRefreshToken({ revokedAt: new Date() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      const result = await service.logout('some_token');
      expect(result).toEqual({ revoked: true });
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  // ── getSessions ────────────────────────────────────────────────────────────

  describe('getSessions()', () => {
    it('returns mapped session objects', async () => {
      const sessions = [
        makeRefreshToken({ consumedAt: null }),
        makeRefreshToken({ consumedAt: new Date() }),
      ];
      mockPrisma.refreshToken.findMany.mockResolvedValue(sessions);

      const result = await service.getSessions('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].isCurrent).toBe(true);
      expect(result[1].isCurrent).toBe(false);
    });
  });

  // ── revokeSession ──────────────────────────────────────────────────────────

  describe('revokeSession()', () => {
    it('revokes a session and returns isCurrentSession=false when no token provided', async () => {
      const session = makeRefreshToken({ userId: 'user-1', revokedAt: null });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...session, revokedAt: new Date() });

      const result = await service.revokeSession('rt-1', 'user-1');
      expect(result).toEqual({ revoked: true, isCurrentSession: false });
    });

    it('detects current session when token hash matches', async () => {
      const session = makeRefreshToken({ userId: 'user-1', revokedAt: null });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(session);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...session, revokedAt: new Date() });
      // Hash the raw token so it matches session.tokenHash
      jest.spyOn(service, 'hashRefreshToken').mockReturnValue('hashedtoken');

      const result = await service.revokeSession('rt-1', 'user-1', 'raw-token');
      expect(result).toEqual({ revoked: true, isCurrentSession: true });
    });

    it('throws BadRequestException when session not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for another user\'s session', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(makeRefreshToken({ userId: 'user-2' }));
      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when already revoked', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(makeRefreshToken({ userId: 'user-1', revokedAt: new Date() }));
      await expect(service.revokeSession('rt-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── hashRefreshToken ───────────────────────────────────────────────────────

  describe('hashRefreshToken()', () => {
    it('returns a consistent sha256 hex string', () => {
      const hash1 = service.hashRefreshToken('my_token');
      const hash2 = service.hashRefreshToken('my_token');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('returns different hashes for different inputs', () => {
      expect(service.hashRefreshToken('token_a')).not.toBe(service.hashRefreshToken('token_b'));
    });
  });
});
