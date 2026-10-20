import { Injectable } from '@nestjs/common';
import { AuthService, RequestMeta } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * WalletAuthService — Sign-In With Stellar nonce flow (#444).
 *
 * Manages in-memory nonces and delegates login to AuthService.
 * Kept deliberately thin: nonce generation/consumption lives here;
 * the actual credential check lives in AuthService.login().
 */
@Injectable()
export class WalletAuthService {
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();

  constructor(
    // AuthService is injected to reuse login() without duplicating credential logic.
    private readonly authService: AuthService,
  ) {}

  /** Generate and store a 5-minute challenge nonce for a Stellar address. */
  generateNonce(stellarAddress: string): string {
    const nonce = `hiresettle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.nonces.set(stellarAddress, { nonce, expiresAt: Date.now() + 5 * 60 * 1000 });
    return nonce;
  }

  /** Validate and consume a nonce. Returns true if valid, false otherwise. */
  consumeNonce(stellarAddress: string, nonce: string): boolean {
    const entry = this.nonces.get(stellarAddress);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
      this.nonces.delete(stellarAddress);
      return false;
    }
    if (entry.nonce !== nonce) return false;
    this.nonces.delete(stellarAddress);
    return true;
  }

  /**
   * Backward-compatible alias for AuthService.login().
   * The controller routes /wallet-login and /login both call this.
   */
  walletLogin(dto: LoginDto, meta: RequestMeta = {}) {
    return this.authService.login(dto, meta);
  }
}
