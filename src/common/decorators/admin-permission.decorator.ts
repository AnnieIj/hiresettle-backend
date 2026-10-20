import { SetMetadata } from '@nestjs/common';
import { AdminSubRole } from '@prisma/client';

/**
 * Fine-grained admin permissions, independent of the coarser AdminSubRole values
 * so individual actions can be mapped without repetitive role lists throughout
 * the codebase.
 *
 * Permission → minimum sub-roles that may call the endpoint
 * (SUPER_ADMIN / null always passes — backward-compatible default).
 */
export enum AdminPermission {
  /** Issue a short-lived impersonation token for a user. */
  IMPERSONATE_USERS = 'IMPERSONATE_USERS',

  /** Deactivate or reactivate user accounts. */
  MANAGE_USERS = 'MANAGE_USERS',

  /** Assign / reassign arbiters on engagements. */
  ASSIGN_ARBITER = 'ASSIGN_ARBITER',

  /** Access / requeue dead-letter events; flush cache; run reconciliation. */
  MANAGE_SYSTEM = 'MANAGE_SYSTEM',

  /** Create, list, or revoke API keys. */
  MANAGE_API_KEYS = 'MANAGE_API_KEYS',

  /** List / complete refund records; record dispute refunds. */
  PROCESS_REFUNDS = 'PROCESS_REFUNDS',

  /** Match, refund, or ignore unmatched Stellar payments. */
  MANAGE_PAYMENTS = 'MANAGE_PAYMENTS',

  /** Stream CSV reports and export audit logs. */
  EXPORT_REPORTS = 'EXPORT_REPORTS',

  /** Process GDPR data-deletion requests. */
  PROCESS_GDPR = 'PROCESS_GDPR',

  /** Set per-user subscription plans. */
  MANAGE_PLANS = 'MANAGE_PLANS',

  /** Set company verification status and rate-limit overrides. */
  MANAGE_COMPANY_SETTINGS = 'MANAGE_COMPANY_SETTINGS',

  /** Trigger payment poller or set maintenance mode. */
  MANAGE_OPERATIONS = 'MANAGE_OPERATIONS',
}

/**
 * Maps each AdminPermission to the set of AdminSubRoles that hold it.
 * A null/undefined adminSubRole is treated as SUPER_ADMIN and always passes.
 * SUPER_ADMIN is always included for every permission.
 */
export const ADMIN_PERMISSION_ROLES: Record<AdminPermission, AdminSubRole[]> = {
  [AdminPermission.IMPERSONATE_USERS]:      [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
  [AdminPermission.MANAGE_USERS]:           [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.SUPPORT],
  [AdminPermission.ASSIGN_ARBITER]:         [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
  [AdminPermission.MANAGE_SYSTEM]:          [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
  [AdminPermission.MANAGE_API_KEYS]:        [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
  [AdminPermission.PROCESS_REFUNDS]:        [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.FINANCE],
  [AdminPermission.MANAGE_PAYMENTS]:        [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.FINANCE],
  [AdminPermission.EXPORT_REPORTS]:         [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.FINANCE],
  [AdminPermission.PROCESS_GDPR]:           [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.SUPPORT],
  [AdminPermission.MANAGE_PLANS]:           [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
  [AdminPermission.MANAGE_COMPANY_SETTINGS]:[AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS, AdminSubRole.SUPPORT],
  [AdminPermission.MANAGE_OPERATIONS]:      [AdminSubRole.SUPER_ADMIN, AdminSubRole.OPS],
};

export const ADMIN_PERMISSION_KEY = 'adminPermission';

/** Attach a required AdminPermission to a route handler. */
export const RequiresAdminPermission = (permission: AdminPermission) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permission);
