import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import {
  ADMIN_PERMISSION_KEY,
  ADMIN_PERMISSION_ROLES,
  AdminPermission,
} from '../decorators/admin-permission.decorator';

/**
 * AdminPermissionsGuard
 *
 * Enforces fine-grained AdminPermission restrictions on top of the coarse
 * ADMIN role check already performed by RolesGuard.
 *
 * Rules:
 *  - Non-admin requests are passed through (RolesGuard handles them).
 *  - Admin users with no adminSubRole (null) are treated as SUPER_ADMIN —
 *    full access, backward-compatible with existing admin accounts.
 *  - If the route carries no @RequiresAdminPermission decorator the guard
 *    passes (read-only / informational endpoints are accessible to all admins).
 */
@Injectable()
export class AdminPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      ADMIN_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission constraint on this route → all admins pass.
    if (!permission) return true;

    const { user } = context.switchToHttp().getRequest();

    // Not an admin — let RolesGuard / JwtGuard handle the rejection.
    if (!user || user.role !== UserRole.ADMIN) return true;

    // Null adminSubRole = legacy super-admin, always allowed.
    if (!user.adminSubRole) return true;

    const allowed = ADMIN_PERMISSION_ROLES[permission] ?? [];
    if (allowed.includes(user.adminSubRole)) return true;

    throw new ForbiddenException(
      `Admin sub-role '${user.adminSubRole}' does not have the '${permission}' permission.`,
    );
  }
}
