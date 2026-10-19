import { User, UserRole } from '@prisma/client';
import { buildUser } from './user.factory';

type CompanyOverrides = Partial<User>;

/**
 * Builds a User record representing a Company account.
 */
export function buildCompany(overrides: CompanyOverrides = {}): User {
  return buildUser({
    role: UserRole.COMPANY,
    company: 'Acme Inc.',
    ...overrides,
  });
}
