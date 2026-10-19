import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * Allows only platform admins. Apply after JwtAuthGuard / JwtOrApiKeyGuard so
 * `request.user` is populated, e.g. `@UseGuards(JwtOrApiKeyGuard, AdminGuard)`.
 * Impersonated sessions are rejected: an admin acting as another user must
 * not reach admin endpoints with that token.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    if (user.impersonated) {
      throw new ForbiddenException('Admin endpoints are not available while impersonating');
    }
    return true;
  }
}
