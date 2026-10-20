import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OAuthService } from './oauth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { SessionService } from './session.service';

const makeMockPrisma = () => ({
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
});

const makeMockConfig = () => ({
  get: jest.fn((key: string, def?: any) => {
    if (key === 'GOOGLE_CLIENT_ID') return 'client-id';
    if (key === 'GOOGLE_CLIENT_SECRET') return 'client-secret';
    if (key === 'GOOGLE_CALLBACK_URL') return 'http://localhost/callback';
    return def ?? null;
  }),
});

const makeMockSecurityEvents = () => ({ log: jest.fn().mockResolvedValue(undefined) });

const makeMockSessionService = () => ({
  issueTokenPair: jest.fn().mockResolvedValue({ accessToken: 'access_token', refreshToken: 'refresh_token' }),
});

const makeUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  email: 'alice@example.com',
  googleId: 'google-123',
  deactivatedAt: null,
  deletedAt: null,
  name: 'Alice',
  role: 'COMPANY',
  passwordHash: null,
  webhookSecret: null,
  ...overrides,
});

describe('OAuthService', () => {
  let service: OAuthService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: makeMockConfig() },
        { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
        { provide: SessionService, useValue: makeMockSessionService() },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    jest.clearAllMocks();
  });

  // ── getGoogleAuthUrl ───────────────────────────────────────────────────────

  describe('getGoogleAuthUrl()', () => {
    it('returns a Google authorization URL containing the state', () => {
      const url = service.getGoogleAuthUrl('test-state');
      expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('state=test-state');
      expect(url).toContain('client_id=client-id');
    });

    it('throws BadRequestException when OAuth is not configured', async () => {
      const module2 = await Test.createTestingModule({
        providers: [
          OAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
          { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
          { provide: SessionService, useValue: makeMockSessionService() },
        ],
      }).compile();
      const unconfiguredService = module2.get<OAuthService>(OAuthService);
      expect(() => unconfiguredService.getGoogleAuthUrl('state')).toThrow(BadRequestException);
    });
  });

  // ── loginWithGoogle ────────────────────────────────────────────────────────

  describe('loginWithGoogle()', () => {
    const profile = { googleId: 'google-123', email: 'alice@example.com', name: 'Alice' };

    it('returns token pair for an existing user', async () => {
      const user = makeUser();
      mockPrisma.user.findFirst.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      const result = await service.loginWithGoogle(profile);

      expect(result).toMatchObject({ accessToken: 'access_token', refreshToken: 'refresh_token' });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('creates a new user when none exists and returns tokens', async () => {
      const newUser = makeUser({ id: 'user-new' });
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockPrisma.user.update.mockResolvedValue(newUser);

      const result = await service.loginWithGoogle(profile);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'alice@example.com' }) }),
      );
      expect(result).toMatchObject({ accessToken: 'access_token' });
    });

    it('throws ForbiddenException for deactivated account', async () => {
      const deactivated = makeUser({ deactivatedAt: new Date() });
      mockPrisma.user.findFirst.mockResolvedValue(deactivated);

      await expect(service.loginWithGoogle(profile)).rejects.toThrow(ForbiddenException);
    });

    it('links googleId to an existing email-only account', async () => {
      const userWithoutGoogleId = makeUser({ googleId: null });
      mockPrisma.user.findFirst.mockResolvedValue(userWithoutGoogleId);
      mockPrisma.user.update.mockResolvedValue({ ...userWithoutGoogleId, googleId: 'google-123' });

      await service.loginWithGoogle(profile);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ googleId: 'google-123' }) }),
      );
    });
  });

  // ── exchangeGoogleCode ─────────────────────────────────────────────────────

  describe('exchangeGoogleCode()', () => {
    it('throws BadRequestException when OAuth is not configured', async () => {
      const module2 = await Test.createTestingModule({
        providers: [
          OAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
          { provide: SecurityEventsService, useValue: makeMockSecurityEvents() },
          { provide: SessionService, useValue: makeMockSessionService() },
        ],
      }).compile();
      const svc = module2.get<OAuthService>(OAuthService);
      await expect(svc.exchangeGoogleCode('code')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException on token exchange HTTP failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as any;
      await expect(service.exchangeGoogleCode('bad-code')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when access_token missing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: null }),
      }) as any;
      await expect(service.exchangeGoogleCode('code')).rejects.toThrow(UnauthorizedException);
    });
  });
});
