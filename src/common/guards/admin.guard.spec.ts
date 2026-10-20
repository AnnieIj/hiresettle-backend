import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdminGuard } from './admin.guard';

const contextFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('allows admins', () => {
    expect(guard.canActivate(contextFor({ id: 'a', role: UserRole.ADMIN }))).toBe(true);
  });

  it.each([
    ['no user', undefined],
    ['a company user', { id: 'c', role: UserRole.COMPANY }],
    ['an impersonated admin token', { id: 'a', role: UserRole.ADMIN, impersonated: true }],
  ])('rejects %s', (_label, user) => {
    expect(() => guard.canActivate(contextFor(user))).toThrow(ForbiddenException);
  });
});
