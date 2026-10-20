import { Test, TestingModule } from '@nestjs/testing';
import { WalletAuthService } from './wallet-auth.service';
import { AuthService } from './auth.service';

const makeMockAuthService = () => ({
  login: jest.fn(),
});

describe('WalletAuthService', () => {
  let service: WalletAuthService;
  let mockAuthService: ReturnType<typeof makeMockAuthService>;

  beforeEach(async () => {
    mockAuthService = makeMockAuthService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletAuthService,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<WalletAuthService>(WalletAuthService);
    jest.clearAllMocks();
  });

  // ── generateNonce ──────────────────────────────────────────────────────────

  describe('generateNonce()', () => {
    it('returns a nonce prefixed with hiresettle:<address>:', () => {
      const nonce = service.generateNonce('GABC');
      expect(nonce).toMatch(/^hiresettle:GABC:/);
    });

    it('each call returns a different nonce', () => {
      const n1 = service.generateNonce('GABC');
      const n2 = service.generateNonce('GABC');
      expect(n1).not.toBe(n2);
    });
  });

  // ── consumeNonce ───────────────────────────────────────────────────────────

  describe('consumeNonce()', () => {
    it('returns true for a valid unexpired nonce', () => {
      const nonce = service.generateNonce('GABC');
      expect(service.consumeNonce('GABC', nonce)).toBe(true);
    });

    it('returns false when nonce is consumed a second time', () => {
      const nonce = service.generateNonce('GABC');
      service.consumeNonce('GABC', nonce);
      expect(service.consumeNonce('GABC', nonce)).toBe(false);
    });

    it('returns false for an unknown address', () => {
      expect(service.consumeNonce('GOTHER', 'fake-nonce')).toBe(false);
    });

    it('returns false for a wrong nonce value', () => {
      service.generateNonce('GABC');
      expect(service.consumeNonce('GABC', 'wrong-nonce')).toBe(false);
    });
  });

  // ── walletLogin ────────────────────────────────────────────────────────────

  describe('walletLogin()', () => {
    it('delegates to AuthService.login()', async () => {
      const dto = { email: 'x@x.com', password: 'p' } as any;
      const meta = { ip: '1.2.3.4' };
      mockAuthService.login.mockResolvedValue({ accessToken: 'tok' });

      const result = await service.walletLogin(dto, meta);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto, meta);
      expect(result).toEqual({ accessToken: 'tok' });
    });
  });
});
