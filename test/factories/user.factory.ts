import { User, UserRole } from '@prisma/client';
import { v4 as uuid } from 'uuid';

type UserOverrides = Partial<User>;

export function buildUser(overrides: UserOverrides = {}): User {
  const id = overrides.id ?? uuid();
  return {
    id,
    stellarAddress: overrides.stellarAddress ?? `G${id.replace(/-/g, '').toUpperCase().slice(0, 55)}`,
    email: overrides.email ?? `user-${id}@example.com`,
    passwordHash: overrides.passwordHash ?? null,
    name: overrides.name ?? 'Test User',
    company: overrides.company ?? null,
    companyOwnerId: overrides.companyOwnerId ?? null,
    role: overrides.role ?? UserRole.COMPANY,
    planId: overrides.planId ?? null,
    webhookUrl: overrides.webhookUrl ?? null,
    webhookSecret: overrides.webhookSecret ?? null,
    timezone: overrides.timezone ?? 'UTC',
    rateLimitOverride: overrides.rateLimitOverride ?? null,
    avatarUrl: overrides.avatarUrl ?? null,
    verifiedAt: overrides.verifiedAt ?? null,
    deactivatedAt: overrides.deactivatedAt ?? null,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockedUntil: overrides.lockedUntil ?? null,
    totpSecret: overrides.totpSecret ?? null,
    totpEnabled: overrides.totpEnabled ?? false,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as unknown as User;
}
