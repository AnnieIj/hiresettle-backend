import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";
import { PrismaService } from "../../common/prisma/prisma.service";
import { StellarService } from "../../common/stellar/stellar.service";
import { SecurityEventsService } from "../../common/security-events/security-events.service";
import { PasswordPolicyService } from "../../common/password/password-policy.service";
import { HibpService } from "../../common/hibp/hibp.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { TwoFactorService } from "./two-factor.service";
import { SessionService } from "./session.service";
import { WalletAuthService } from "./wallet-auth.service";
import { OAuthService } from "./oauth.service";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;
const IMPERSONATION_TOKEN_TTL_SECONDS = 5 * 60;

type AuthUser = Omit<User, "passwordHash" | "webhookSecret">;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

// String literals — SecurityEventAction enum may not resolve in Jest mock env
const ACTION_LOGIN_SUCCESS = "LOGIN_SUCCESS" as const;
const ACTION_LOGIN_FAILURE = "LOGIN_FAILURE" as const;
const ACTION_IMPERSONATION_ISSUED = "IMPERSONATION_ISSUED" as const;
const ACTION_LOGOUT = "LOGOUT" as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Rebind challenges keyed by userId (#357)
  private readonly rebindChallenges = new Map<string, { nonce: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly stellar: StellarService,
    private readonly securityEvents: SecurityEventsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly hibp: HibpService,
    private readonly twoFactor: TwoFactorService,
    private readonly sessionService: SessionService,
    private readonly walletAuth: WalletAuthService,
    private readonly oauthService: OAuthService,
  ) {}

  // ── Nonce (delegated to WalletAuthService) ────────────────────────────────

  generateNonce(stellarAddress: string): string {
    return this.walletAuth.generateNonce(stellarAddress);
  }

  consumeNonce(stellarAddress: string, nonce: string): boolean {
    return this.walletAuth.consumeNonce(stellarAddress, nonce);
  }

  // ── Rebind challenges (#357) ──────────────────────────────────────────────

  generateRebindChallenge(userId: string): string {
    const nonce = `hiresettle-rebind:${userId}:${Date.now()}:${randomBytes(16).toString("hex")}`;
    this.rebindChallenges.set(userId, { nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
    return nonce;
  }

  consumeRebindChallenge(userId: string, nonce: string): boolean {
    const entry = this.rebindChallenges.get(userId);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) { this.rebindChallenges.delete(userId); return false; }
    if (entry.nonce !== nonce) return false;
    this.rebindChallenges.delete(userId);
    return true;
  }

  // ── Registration ──────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    this.passwordPolicy.validate(dto.password);
    await this.checkHibp(dto.password);
    const email = dto.email.toLowerCase();
    const passwordHash = await this.hashPassword(dto.password);

    if (dto.stellarAddress) {
      const skipAccountValidation = this.config.get<boolean>("SKIP_ACCOUNT_VALIDATION");
      if (!skipAccountValidation) {
        const accountExists = await this.stellar.accountExists(dto.stellarAddress);
        if (!accountExists) {
          throw new BadRequestException("Stellar address does not exist or is not funded.");
        }
      }
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          stellarAddress: dto.stellarAddress,
          name: dto.name,
          company: dto.company,
          role: dto.role,
        },
      });

      this.logger.log(`User registered: ${email}`);
      return this.sessionService.issueTokenPair(user);
    } catch (error) {
      if (
        error?.code === "P2002" &&
        (error?.name === "PrismaClientKnownRequestError" ||
          (Prisma.PrismaClientKnownRequestError && error instanceof Prisma.PrismaClientKnownRequestError))
      ) {
        throw new ConflictException("Email or Stellar address is already registered");
      }
      throw error;
    }
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta = {}) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user?.passwordHash || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      await this.handleFailedLogin(user?.id, meta);
      throw new UnauthorizedException("Invalid email or password");
    }

    if (user.deactivatedAt) {
      await this.logSecurityEvent(ACTION_LOGIN_FAILURE, user.id, meta);
      throw new ForbiddenException("Your account has been deactivated. Please contact an administrator.");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.logSecurityEvent(ACTION_LOGIN_FAILURE, user.id, meta);
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new HttpException(
        { message: "Account temporarily locked due to repeated failed login attempts", retryAfter: retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (user.totpEnabled) {
      const trustedDeviceSkip =
        dto.trustedDeviceToken &&
        (await this.twoFactor.verifyTrustedDeviceToken(user.id, dto.trustedDeviceToken));

      if (!trustedDeviceSkip) {
        if (!dto.totpCode && !dto.recoveryCode) {
          throw new UnauthorizedException("TOTP code or recovery code required for 2FA-enabled account");
        }

        if (dto.recoveryCode) {
          const consumed = await this.twoFactor.consumeRecoveryCode(user.id, dto.recoveryCode);
          if (!consumed) {
            await this.handleFailedLogin(user.id, meta);
            throw new UnauthorizedException("Invalid or already-used recovery code");
          }
        } else {
          if (!this.twoFactor.verifyTotpCode(user.totpSecret!, dto.totpCode!)) {
            await this.handleFailedLogin(user.id, meta);
            throw new UnauthorizedException("Invalid TOTP code");
          }
        }
      }
    }

    await this.resetFailedAttempts(user.id);
    this.logger.log(`User logged in: ${email}`);
    await this.logSecurityEvent(ACTION_LOGIN_SUCCESS, user.id, meta);

    const tokenPair = await this.sessionService.issueTokenPair(user);

    if (user.totpEnabled && dto.trustDevice) {
      const trustedDeviceToken = await this.twoFactor.issueTrustedDeviceToken(user.id, meta.userAgent);
      return { ...tokenPair, trustedDeviceToken };
    }

    return tokenPair;
  }

  /** Backward-compatible alias kept for existing controller routes. */
  walletLogin(dto: LoginDto, meta: RequestMeta = {}) {
    return this.login(dto, meta);
  }

  // ── OAuth (delegated) ─────────────────────────────────────────────────────

  loginWithGoogle(profile: { googleId: string; email: string; name?: string | null }, meta: RequestMeta = {}) {
    return this.oauthService.loginWithGoogle(profile, meta);
  }

  getGoogleAuthUrl(state: string): string {
    return this.oauthService.getGoogleAuthUrl(state);
  }

  exchangeGoogleCode(code: string) {
    return this.oauthService.exchangeGoogleCode(code);
  }

  // ── Sessions (delegated) ──────────────────────────────────────────────────

  refresh(refreshToken: string) {
    return this.sessionService.refresh(refreshToken);
  }

  logout(refreshToken: string, meta: RequestMeta = {}) {
    return this.sessionService.logout(refreshToken, meta);
  }

  getSessions(userId: string) {
    return this.sessionService.getSessions(userId);
  }

  revokeSession(sessionId: string, userId: string, currentRefreshToken?: string) {
    return this.sessionService.revokeSession(sessionId, userId, currentRefreshToken);
  }

  // ── 2FA (delegated) ───────────────────────────────────────────────────────

  generateTotpSecret(userId: string) {
    return this.twoFactor.generateTotpSecret(userId);
  }

  enableTotp(userId: string, code: string) {
    return this.twoFactor.enableTotp(userId, code);
  }

  disableTotp(userId: string, code: string) {
    return this.twoFactor.disableTotp(userId, code);
  }

  regenerateRecoveryCodes(userId: string, totpCode: string) {
    return this.twoFactor.regenerateRecoveryCodes(userId, totpCode);
  }

  // ── Trusted devices (delegated) ───────────────────────────────────────────

  issueTrustedDeviceToken(userId: string, userAgent?: string) {
    return this.twoFactor.issueTrustedDeviceToken(userId, userAgent);
  }

  listTrustedDevices(userId: string) {
    return this.twoFactor.listTrustedDevices(userId);
  }

  revokeTrustedDevice(deviceId: string, userId: string) {
    return this.twoFactor.revokeTrustedDevice(deviceId, userId);
  }

  // ── Impersonation ─────────────────────────────────────────────────────────

  async issueImpersonationToken(adminId: string, targetUserId: string, meta: RequestMeta = {}) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });

    if (!target || target.deletedAt || target.deactivatedAt) {
      throw new ForbiddenException("User is not available for impersonation");
    }

    const accessToken = this.jwt.sign(
      {
        sub: target.id,
        email: target.email,
        stellarAddress: target.stellarAddress,
        role: target.role,
        type: "access",
        impersonated: true,
        impersonatorId: adminId,
      },
      { expiresIn: IMPERSONATION_TOKEN_TTL_SECONDS },
    );

    await this.securityEvents.log({
      userId: target.id,
      actorId: adminId,
      targetUserId: target.id,
      action: ACTION_IMPERSONATION_ISSUED,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { accessToken, expiresIn: IMPERSONATION_TOKEN_TTL_SECONDS, user: this.sanitizeUser(target) };
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: any): Promise<AuthUser & { webhookSecret?: string }> {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });

    const isNewWebhookSubscription = !!dto.webhookUrl && !existing?.webhookUrl;
    const webhookSecret = isNewWebhookSubscription ? randomBytes(32).toString("hex") : undefined;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      },
    });

    const safeUser = this.sanitizeUser(updated);
    return webhookSecret ? { ...safeUser, webhookSecret } : safeUser;
  }

  async resetPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new BadRequestException("User not found or password login not available");
    }

    const currentValid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!currentValid) throw new UnauthorizedException("Current password is incorrect");

    this.passwordPolicy.validate(newPassword);
    await this.checkHibp(newPassword);

    const newHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

    // Revoke all trusted devices after password change
    await this.prisma.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Password changed for user: ${userId}`);
    return { updated: true };
  }

  // ── Login history (#355) ──────────────────────────────────────────────────

  async getLoginHistory(userId: string, page: number = 1, limit: number = 20) {
    const HISTORY_WINDOW_DAYS = 90;
    const from = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.securityEvent.findMany({
        where: { userId, createdAt: { gte: from } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, action: true, ip: true, userAgent: true, createdAt: true },
      }),
      this.prisma.securityEvent.count({ where: { userId, createdAt: { gte: from } } }),
    ]);

    const events = data.map((e) => ({
      id: e.id,
      action: e.action,
      success: e.action !== ACTION_LOGIN_FAILURE,
      ip: e.ip ?? null,
      userAgent: e.userAgent ?? null,
      createdAt: e.createdAt,
    }));

    return { data: events, meta: { total, page, limit, windowDays: HISTORY_WINDOW_DAYS } };
  }

  // ── HIBP breach check ─────────────────────────────────────────────────────

  private async checkHibp(password: string): Promise<void> {
    const enabled = this.config.get<string>("HIBP_CHECK_ENABLED", "true");
    if (enabled === "false" || enabled === "0") return;

    let breached: boolean;
    try {
      breached = await this.hibp.isBreached(password);
    } catch (err: any) {
      this.logger.warn(`HIBP check failed unexpectedly: ${err?.message ?? err} — skipping`);
      return;
    }

    if (breached) {
      throw new BadRequestException(
        "This password has appeared in a known data breach. Please choose a different password.",
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  sanitizeUser(user: User): AuthUser {
    const { passwordHash, webhookSecret, ...safeUser } = user as any;
    return safeUser;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    return `scrypt:${salt}:${derivedKey.toString("hex")}`;
  }

  async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const [algorithm, salt, key] = passwordHash.split(":");
    if (algorithm !== "scrypt" || !salt || !key) return false;

    const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
    const storedKey = Buffer.from(key, "hex");

    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }

  private async logSecurityEvent(action: string, userId: string | null | undefined, meta: RequestMeta) {
    await this.securityEvents.log({ userId, action, ip: meta.ip, userAgent: meta.userAgent });
  }

  private async handleFailedLogin(userId: string | undefined, meta: RequestMeta) {
    if (!userId) { await this.logSecurityEvent(ACTION_LOGIN_FAILURE, null, meta); return; }

    await this.logSecurityEvent(ACTION_LOGIN_FAILURE, userId, meta);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;

    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
      await this.prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: newFailedAttempts, lockedUntil } });
      this.logger.warn(`Account locked: ${user.email} after ${newFailedAttempts} failed attempts`);
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: newFailedAttempts } });
    }
  }

  private async resetFailedAttempts(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }
}
