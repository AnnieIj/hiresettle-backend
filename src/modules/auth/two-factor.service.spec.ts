import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwoFactorService } from './two-factor.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const makeMockPrisma = () => ({
  user: { findUnique: jest.fn(), update: jest.fn() },
  recoveryCode: {
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 10 }),
  },
  trustedDevice: {
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((arr: any) => Promise.all(arr)),
});

const makeMockConfig = () => ({
  get: jest.fn((key: string, def?: any) => {
    if (key === 'TRUSTED_DEVICE_TTL_DAYS') return 30;
    return def ?? null;
  }),
});

const makeUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  email: 'alice@example.com',
  totpEnabled: false,
  totpSecret: null,
  stellarAddress: null,
  ...overrides,
});

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: makeMockConfig() },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
    jest.clearAllMocks();
  });

  // ── generateTotpSecret ─────────────────────────────────────────────────────

  describe('generateTotpSecret()', () => {
    it('generates a valid base32 secret and otpauth URL', async () => {
      const user = makeUser({ totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);

      const result = await service.generateTotpSecret('user-1');

      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('otpauthUrl');
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUrl).toContain('otpauth://totp/');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpSecret: expect.any(String) },
      });
    });

    it('throws BadRequestException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.generateTotpSecret('user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when 2FA already enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpEnabled: true }));
      await expect(service.generateTotpSecret('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── enableTotp ─────────────────────────────────────────────────────────────

  describe('enableTotp()', () => {
    it('enables 2FA when code is valid', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: false });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, totpEnabled: true });
      jest.spyOn(service, 'verifyTotpCode').mockReturnValue(true);

      const result = await service.enableTotp('user-1', '123456');

      expect(result.enabled).toBe(true);
      expect(Array.isArray(result.recoveryCodes)).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpEnabled: true },
      });
    });

    it('throws BadRequestException when TOTP secret not set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpSecret: null }));
      await expect(service.enableTotp('user-1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when 2FA already enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpSecret: 'X', totpEnabled: true }));
      await expect(service.enableTotp('user-1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when code is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP' }));
      jest.spyOn(service, 'verifyTotpCode').mockReturnValue(false);
      await expect(service.enableTotp('user-1', '000000')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── disableTotp ─────────────────────────────────────────────────────────────

  describe('disableTotp()', () => {
    it('disables 2FA when code is valid', async () => {
      const user = makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: true });
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue({ ...user, totpEnabled: false, totpSecret: null });
      jest.spyOn(service, 'verifyTotpCode').mockReturnValue(true);

      const result = await service.disableTotp('user-1', '123456');

      expect(result).toEqual({ disabled: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpSecret: null, totpEnabled: false },
      });
    });

    it('throws BadRequestException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.disableTotp('user-1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when 2FA not enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpEnabled: false }));
      await expect(service.disableTotp('user-1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('throws UnauthorizedException when code is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser({ totpSecret: 'JBSWY3DPEHPK3PXP', totpEnabled: true }));
      jest.spyOn(service, 'verifyTotpCode').mockReturnValue(false);
      await expect(service.disableTotp('user-1', '000000')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── verifyTotpCode ──────────────────────────────────────────────────────────

  describe('verifyTotpCode()', () => {
    it('returns false for a clearly wrong code', () => {
      // Use a real but unknown secret — code '000000' is astronomically unlikely to match
      expect(service.verifyTotpCode('JBSWY3DPEHPK3PXP', '000000')).toBe(false);
    });

    it('returns a boolean', () => {
      const result = service.verifyTotpCode('JBSWY3DPEHPK3PXP', '123456');
      expect(typeof result).toBe('boolean');
    });
  });
});
