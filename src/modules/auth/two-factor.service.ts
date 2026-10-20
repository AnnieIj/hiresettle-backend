import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOTP } from 'otpauth';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * TwoFactorService — manages TOTP 2FA, recovery codes, and trusted devices (#443 / #444).
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── TOTP enrollment ───────────────────────────────────────────────────────

  async generateTotpSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.totpEnabled) throw new BadRequestException('2FA is already enabled');

    const secretBytes = randomBytes(20);
    let secret = '';
    for (let i = 0; i < secretBytes.length; i += 5) {
      secret += this.base32Encode(secretBytes.slice(i, i + 5));
    }

    const totp = new TOTP({
      issuer: 'HireSettle',
      label: user.email || user.stellarAddress || userId,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return { secret, otpauthUrl: totp.toString() };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new BadRequestException('TOTP secret not found. Please generate a secret first.');
    }
    if (user.totpEnabled) throw new BadRequestException('2FA is already enabled');
    if (!this.verifyTotpCode(user.totpSecret, code)) throw new UnauthorizedException('Invalid TOTP code');

    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    const recoveryCodes = await this.createRecoveryCodes(userId);

    this.logger.log(`2FA enabled for user: ${user.email || userId}`);
    return { enabled: true, recoveryCodes };
  }

  async disableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.totpEnabled) throw new BadRequestException('2FA is not enabled');
    if (!this.verifyTotpCode(user.totpSecret!, code)) throw new UnauthorizedException('Invalid TOTP code');

    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabled: false } });
    this.logger.log(`2FA disabled for user: ${user.email || userId}`);
    return { disabled: true };
  }

  async regenerateRecoveryCodes(userId: string, totpCode: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.totpEnabled) throw new BadRequestException('2FA is not enabled');
    if (!this.verifyTotpCode(user.totpSecret!, totpCode)) throw new UnauthorizedException('Invalid TOTP code');

    const recoveryCodes = await this.createRecoveryCodes(userId);
    this.logger.log(`Recovery codes regenerated for user: ${user.email || userId}`);
    return { recoveryCodes };
  }

  verifyTotpCode(secret: string, code: string): boolean {
    const totp = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  // ── Recovery codes ────────────────────────────────────────────────────────

  async consumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
    const codeHash = createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex');
    const record = await this.prisma.recoveryCode.findFirst({ where: { userId, codeHash, usedAt: null } });
    if (!record) return false;
    await this.prisma.recoveryCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return true;
  }

  private async createRecoveryCodes(userId: string): Promise<string[]> {
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(
        randomBytes(5).toString('hex').toUpperCase() + '-' + randomBytes(5).toString('hex').toUpperCase(),
      );
    }

    const codeHashes = codes.map((c) => ({
      userId,
      codeHash: createHash('sha256').update(c).digest('hex'),
    }));

    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codeHashes }),
    ]);

    return codes;
  }

  // ── Trusted devices ───────────────────────────────────────────────────────

  async issueTrustedDeviceToken(userId: string, userAgent?: string): Promise<string> {
    const ttlDays = this.config.get<number>('TRUSTED_DEVICE_TTL_DAYS', 30);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const name = userAgent ? userAgent.slice(0, 120) : undefined;

    await this.prisma.trustedDevice.create({ data: { userId, tokenHash, name, expiresAt } });
    return rawToken;
  }

  async verifyTrustedDeviceToken(userId: string, rawToken: string): Promise<boolean> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const now = new Date();
    const device = await this.prisma.trustedDevice.findUnique({ where: { tokenHash } });

    if (!device || device.userId !== userId || device.revokedAt !== null || device.expiresAt <= now) {
      return false;
    }

    await this.prisma.trustedDevice
      .update({ where: { id: device.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);

    return true;
  }

  async listTrustedDevices(userId: string) {
    const now = new Date();
    return this.prisma.trustedDevice.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, name: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
  }

  async revokeTrustedDevice(deviceId: string, userId: string) {
    const device = await this.prisma.trustedDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new BadRequestException('Trusted device not found');
    if (device.userId !== userId) throw new ForbiddenException('You can only revoke your own trusted devices');
    if (device.revokedAt) throw new BadRequestException('Trusted device already revoked');

    await this.prisma.trustedDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    return { revoked: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private base32Encode(bytes: Buffer): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, value = 0, output = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) { output += chars[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) output += chars[(value << (5 - bits)) & 31];
    return output;
  }
}
