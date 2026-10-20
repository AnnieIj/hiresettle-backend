import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SecurityEventAction, UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminPermissionsGuard } from '../../common/guards/admin-permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AdminPermission,
  RequiresAdminPermission,
} from '../../common/decorators/admin-permission.decorator';
import { AdminUsersService } from './admin-users.service';
import { AdminDeadLetterService } from './admin-dead-letter.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminDisputeStatsService } from './admin-dispute-stats.service';
import { StellarMergeDetectorService } from './stellar-merge-detector.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { AdminWebhooksService } from './admin-webhooks.service';
import { ListUsersDto } from './dto/list-users.dto';
import { AssignArbiterDto } from './dto/assign-arbiter.dto';
import { AuditLogsQueryDto } from './dto/audit-logs.dto';
import { SetRateLimitOverrideDto } from './dto/set-rate-limit-override.dto';
import { SetAdminSubRoleDto } from './dto/set-admin-sub-role.dto';
import { SetCompanyPlanDto } from './dto/set-company-plan.dto';
import { CacheService } from '../../common/cache/cache.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { ListSecurityEventsDto } from '../../common/security-events/dto/list-security-events.dto';
import { GdprService } from '../users/gdpr.service';
import { AuthService, RequestMeta } from '../auth/auth.service';
import { ApiKeysService } from '../auth/api-keys.service';
import { CreateApiKeyDto } from '../auth/dto/create-api-key.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ArbiterAssignmentService } from '../disputes/arbiter-assignment.service';
import { ReconciliationService } from './reconciliation.service';
import { UnmatchedPaymentsService } from './unmatched-payments.service';
import { IncomingPaymentPollerService } from './incoming-payment-poller.service';
import { MatchPaymentDto, RefundPaymentDto, IgnorePaymentDto } from './unmatched-payments.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RolesGuard, AdminPermissionsGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly deadLetter: AdminDeadLetterService,
    private readonly cacheService: CacheService,
    private readonly reports: AdminReportsService,
    private readonly mergeDetector: StellarMergeDetectorService,
    private readonly securityEvents: SecurityEventsService,
    private readonly auditLogs: AdminAuditLogsService,
    private readonly gdpr: GdprService,
    private readonly adminWebhooks: AdminWebhooksService,
    private readonly authService: AuthService,
    private readonly apiKeys: ApiKeysService,
    private readonly prisma: PrismaService,
    private readonly disputeStats: AdminDisputeStatsService,
    private readonly arbiterAssignment: ArbiterAssignmentService,
    private readonly reconciliation: ReconciliationService,
    private readonly unmatchedPayments: UnmatchedPaymentsService,
    private readonly paymentPoller: IncomingPaymentPollerService,
  ) {}

  // ── Read-only / informational (all admins) ───────────────────────────────

  @Get('disputes/stats')
  @ApiOperation({ summary: 'Dispute statistics (admin only)' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getDisputeStats(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const parse = (v?: string) => {
      if (!v) return undefined;
      const d = new Date(v);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${v}`);
      return d;
    };
    return this.disputeStats.getStats(parse(startDate), parse(endDate));
  }

  @Get('users')
  @ApiOperation({ summary: 'List / search users (admin only)' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminUsers.listUsers(dto);
  }

  @Get('arbiters')
  @ApiOperation({ summary: 'List all active arbiters' })
  listArbiters() {
    return this.adminUsers.listArbiters();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get admin metrics including arbiter workload' })
  getMetrics() {
    return this.adminUsers.getAdminMetrics();
  }

  @Get('merged-accounts')
  @ApiOperation({ summary: 'List engagements flagged as ACCOUNT_MERGED (admin only)' })
  listMergedAccounts() {
    return this.mergeDetector.listMergedEngagements();
  }

  @Get('security-events')
  @ApiOperation({ summary: 'List security audit events (admin only)' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listSecurityEvents(@Query() dto: ListSecurityEventsDto) {
    return this.securityEvents.list(dto);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'List unified audit logs (admin only)' })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listAuditLogs(@Query() dto: AuditLogsQueryDto) {
    return this.auditLogs.queryAuditLogs(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List all subscription plans (admin only)' })
  listPlans() {
    return this.adminUsers.listPlans();
  }

  @Get('refunds')
  @ApiOperation({ summary: 'List refund records (admin only)' })
  async listRefunds(@Query('status') status?: string) {
    const where = status ? { status: status.toUpperCase() as any } : {};
    return this.prisma.refund.findMany({
      where,
      include: { milestone: { select: { id: true, engagementId: true, milestoneIndex: true, amount: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('dead-letter-events')
  @ApiOperation({ summary: 'List dead-letter events (admin only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listDeadLetterEvents(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.deadLetter.list(Number(page) || 1, Number(limit) || 20);
  }

  @Get('unmatched-payments')
  @ApiOperation({ summary: 'List unmatched Stellar payments (admin only)' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'MATCHED', 'REFUNDED', 'IGNORED'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listUnmatchedPayments(
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.unmatchedPayments.list(status as any, Number(page) || 1, Number(limit) || 20);
  }

  @Get('unmatched-payments/:id')
  @ApiOperation({ summary: 'Get a single unmatched payment record (admin only)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getUnmatchedPayment(@Param('id') id: string) {
    return this.unmatchedPayments.findOne(id);
  }

  @Get('reconciliation/report')
  @ApiOperation({ summary: 'Get the latest reconciliation report (read-only, admin only)' })
  getReconciliationReport() {
    const report = this.reconciliation.getLastReport();
    if (!report) {
      return { message: 'No reconciliation report available yet. Run POST /admin/reconciliation/run to generate one.' };
    }
    return report;
  }

  // ── Impersonation — SUPER_ADMIN, OPS ────────────────────────────────────

  @Post('users/:id/impersonate')
  @RequiresAdminPermission(AdminPermission.IMPERSONATE_USERS)
  @ApiOperation({ summary: 'Issue a short-lived impersonation token (SUPER_ADMIN, OPS)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'Impersonation token issued' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  issueImpersonationToken(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req.user as any)?.id;
    const meta: RequestMeta = { ip: req.ip, userAgent: req.headers['user-agent'] };
    return this.authService.issueImpersonationToken(adminId, id, meta);
  }

  // ── User management — SUPER_ADMIN, OPS, SUPPORT ──────────────────────────

  @Delete('users/:id')
  @RequiresAdminPermission(AdminPermission.MANAGE_USERS)
  @ApiOperation({ summary: 'Deactivate a user (SUPER_ADMIN, OPS, SUPPORT)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivateUser(@Param('id') id: string, @Req() req: Request) {
    const result = await this.adminUsers.deactivateUser(id);
    await this.securityEvents.log({
      userId: (req.user as any)?.id,
      action: SecurityEventAction.ADMIN_OVERRIDE,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Post('users/:id/reactivate')
  @RequiresAdminPermission(AdminPermission.MANAGE_USERS)
  @ApiOperation({ summary: 'Reactivate a deactivated user (SUPER_ADMIN, OPS, SUPPORT)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 409, description: 'User already active' })
  async reactivateUser(@Param('id') id: string, @Req() req: Request) {
    const result = await this.adminUsers.reactivateUser(id);
    await this.securityEvents.log({
      userId: (req.user as any)?.id,
      action: SecurityEventAction.ADMIN_OVERRIDE,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return result;
  }

  @Put('users/:id/rate-limit-override')
  @RequiresAdminPermission(AdminPermission.MANAGE_COMPANY_SETTINGS)
  @ApiOperation({ summary: 'Set a custom rate-limit override for a user (SUPER_ADMIN, OPS, SUPPORT)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  setRateLimitOverride(@Param('id') id: string, @Body() dto: SetRateLimitOverrideDto) {
    return this.adminUsers.setRateLimitOverride(id, dto.limit);
  }

  @Delete('users/:id/rate-limit-override')
  @RequiresAdminPermission(AdminPermission.MANAGE_COMPANY_SETTINGS)
  @ApiOperation({ summary: "Clear a user's rate-limit override (SUPER_ADMIN, OPS, SUPPORT)" })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  clearRateLimitOverride(@Param('id') id: string) {
    return this.adminUsers.clearRateLimitOverride(id);
  }

  // ── Admin sub-role management — SUPER_ADMIN only (via MANAGE_SYSTEM) ────

  @Put('users/:id/admin-sub-role')
  @RequiresAdminPermission(AdminPermission.MANAGE_SYSTEM)
  @ApiOperation({
    summary:
      'Set or clear the admin sub-role for an ADMIN user (SUPER_ADMIN only). ' +
      'Omit subRole or pass null to restore full SUPER_ADMIN access. ' +
      'FINANCE cannot impersonate users. SUPPORT cannot process refunds.',
  })
  @ApiParam({ name: 'id', description: 'Admin user ID' })
  @ApiResponse({ status: 200, description: 'Sub-role updated' })
  @ApiResponse({ status: 400, description: 'Target user is not an ADMIN' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'User not found' })
  setAdminSubRole(@Param('id') id: string, @Body() dto: SetAdminSubRoleDto) {
    return this.adminUsers.setAdminSubRole(id, dto.subRole ?? null);
  }

  // ── Arbiter assignment — SUPER_ADMIN, OPS ────────────────────────────────

  @Patch('engagements/:id/arbiter')
  @RequiresAdminPermission(AdminPermission.ASSIGN_ARBITER)
  @ApiOperation({ summary: 'Assign or reassign an arbiter to an engagement (SUPER_ADMIN, OPS)' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  async assignArbiter(@Param('id') id: string, @Body() dto: AssignArbiterDto) {
    const updated = await this.adminUsers.assignArbiter(id, dto.arbiterId);
    await this.arbiterAssignment.applyManualOverride(id, dto.arbiterId);
    return updated;
  }

  // ── System operations — SUPER_ADMIN, OPS ────────────────────────────────

  @Post('cache/flush')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_SYSTEM)
  @ApiOperation({ summary: 'Flush all cache keys (SUPER_ADMIN, OPS)' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  async flushCache() {
    await this.cacheService.flush();
    return { message: 'Cache flushed successfully' };
  }

  @Post('dead-letter-events/:id/requeue')
  @RequiresAdminPermission(AdminPermission.MANAGE_SYSTEM)
  @ApiOperation({ summary: 'Requeue a dead-letter event for retry (SUPER_ADMIN, OPS)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, description: 'Event requeued' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'Dead-letter event not found' })
  requeueDeadLetterEvent(@Param('id') id: string) {
    return this.deadLetter.requeue(id);
  }

  @Post('reconciliation/run')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_SYSTEM)
  @ApiOperation({ summary: 'Trigger an on-demand reconciliation run (SUPER_ADMIN, OPS)' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  triggerReconciliation() {
    return this.reconciliation.runReconciliation();
  }

  @Post('unmatched-payments/poll')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_OPERATIONS)
  @ApiOperation({ summary: 'Trigger an on-demand Horizon payment poll (SUPER_ADMIN, OPS)' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  triggerPaymentPoll() {
    return this.paymentPoller.poll();
  }

  @Post('webhooks/deliveries/:id/resend')
  @RequiresAdminPermission(AdminPermission.MANAGE_SYSTEM)
  @ApiOperation({ summary: 'Manually resend a failed webhook delivery (SUPER_ADMIN, OPS)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 201, description: 'Resend triggered' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'Webhook delivery not found' })
  resendWebhookDelivery(@Param('id') id: string, @Req() req: Request) {
    return this.adminWebhooks.resendDelivery(id, (req.user as any)?.id);
  }

  // ── API keys — SUPER_ADMIN, OPS ──────────────────────────────────────────

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @RequiresAdminPermission(AdminPermission.MANAGE_API_KEYS)
  @ApiOperation({ summary: 'Create an API key for a user (SUPER_ADMIN, OPS). Raw key returned once.' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(dto);
  }

  @Get('api-keys')
  @RequiresAdminPermission(AdminPermission.MANAGE_API_KEYS)
  @ApiOperation({ summary: 'List API keys (SUPER_ADMIN, OPS)' })
  @ApiQuery({ name: 'userId', required: false })
  listApiKeys(@Query('userId') userId?: string) {
    return this.apiKeys.list(userId);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_API_KEYS)
  @ApiOperation({ summary: 'Revoke an API key (SUPER_ADMIN, OPS)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  revokeApiKey(@Param('id') id: string) {
    return this.apiKeys.revoke(id);
  }

  // ── Plans — SUPER_ADMIN, OPS ─────────────────────────────────────────────

  @Put('users/:id/plan')
  @RequiresAdminPermission(AdminPermission.MANAGE_PLANS)
  @ApiOperation({ summary: "Set or clear a company's subscription plan (SUPER_ADMIN, OPS)" })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  setCompanyPlan(@Param('id') id: string, @Body() dto: SetCompanyPlanDto) {
    return this.adminUsers.setCompanyPlan(id, dto.planId ?? null);
  }

  // ── Refunds — SUPER_ADMIN, OPS, FINANCE ─────────────────────────────────

  @Post('refunds/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.PROCESS_REFUNDS)
  @ApiOperation({ summary: 'Mark a refund as completed (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'Refund not found' })
  completeRefund(@Param('id') id: string) {
    return this.prisma.refund.update({ where: { id }, data: { status: 'COMPLETED' } });
  }

  @Post('disputes/:id/refund')
  @HttpCode(HttpStatus.CREATED)
  @RequiresAdminPermission(AdminPermission.PROCESS_REFUNDS)
  @ApiOperation({ summary: 'Record a refund for a company-favoring dispute (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiParam({ name: 'id', description: 'Milestone ID' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  async createDisputeRefund(
    @Param('id') id: string,
    @Body() dto?: { amount?: number | string; reason?: string },
  ) {
    const milestone = await this.prisma.milestone.findUnique({ where: { id } });
    if (!milestone) throw new BadRequestException('Milestone not found');
    return this.prisma.refund.upsert({
      where: { milestoneId: milestone.id },
      update: {
        amount: BigInt(dto?.amount ?? milestone.amount ?? 0),
        status: 'PENDING',
        reason: dto?.reason ?? 'Dispute resolved in favor of the company',
      },
      create: {
        milestoneId: milestone.id,
        amount: BigInt(dto?.amount ?? milestone.amount ?? 0),
        status: 'PENDING',
        reason: dto?.reason ?? 'Dispute resolved in favor of the company',
      },
    });
  }

  // ── Payments — SUPER_ADMIN, OPS, FINANCE ────────────────────────────────

  @Post('unmatched-payments/:id/match')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_PAYMENTS)
  @ApiOperation({ summary: 'Manually match an unmatched payment to an engagement (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 409, description: 'Payment is not PENDING' })
  matchUnmatchedPayment(@Param('id') id: string, @Body() dto: MatchPaymentDto, @Req() req: Request) {
    return this.unmatchedPayments.match(id, (req as any).user?.id, dto);
  }

  @Post('unmatched-payments/:id/refund')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_PAYMENTS)
  @ApiOperation({ summary: 'Mark an unmatched payment as refunded (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  refundUnmatchedPayment(@Param('id') id: string, @Body() dto: RefundPaymentDto, @Req() req: Request) {
    return this.unmatchedPayments.refund(id, (req as any).user?.id, dto);
  }

  @Post('unmatched-payments/:id/ignore')
  @HttpCode(HttpStatus.OK)
  @RequiresAdminPermission(AdminPermission.MANAGE_PAYMENTS)
  @ApiOperation({ summary: 'Dismiss an unmatched payment (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  ignoreUnmatchedPayment(@Param('id') id: string, @Body() dto: IgnorePaymentDto, @Req() req: Request) {
    return this.unmatchedPayments.ignore(id, (req as any).user?.id, dto);
  }

  // ── Reports / exports — SUPER_ADMIN, OPS, FINANCE ───────────────────────

  @Get('dashboard/revenue')
  @RequiresAdminPermission(AdminPermission.EXPORT_REPORTS)
  @ApiOperation({ summary: 'Platform revenue trends (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'granularity', required: false, enum: ['daily', 'monthly'] })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  getRevenueDashboard(@Query('from') from: string, @Query('to') to: string, @Query('granularity') granularity?: string) {
    return this.reports.getRevenueDashboard(from, to, granularity as any);
  }

  @Get('reports/engagements.csv')
  @RequiresAdminPermission(AdminPermission.EXPORT_REPORTS)
  @ApiOperation({ summary: 'Export engagements as CSV (SUPER_ADMIN, OPS, FINANCE, max 90 days)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  streamEngagementsCsv(@Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    return this.reports.streamEngagementsCsv(from, to, res);
  }

  @Get('reports/payments.csv')
  @RequiresAdminPermission(AdminPermission.EXPORT_REPORTS)
  @ApiOperation({ summary: 'Export released payments as CSV (SUPER_ADMIN, OPS, FINANCE, max 90 days)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  streamPaymentsCsv(@Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    return this.reports.streamPaymentsCsv(from, to, res);
  }

  @Get('reports/disputes.csv')
  @RequiresAdminPermission(AdminPermission.EXPORT_REPORTS)
  @ApiOperation({ summary: 'Export dispute log as CSV (SUPER_ADMIN, OPS, FINANCE, max 90 days)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  streamDisputesCsv(@Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    return this.reports.streamDisputesCsv(from, to, res);
  }

  @Get('audit-log/export')
  @RequiresAdminPermission(AdminPermission.EXPORT_REPORTS)
  @ApiOperation({ summary: 'Export the full audit trail as CSV (SUPER_ADMIN, OPS, FINANCE)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  streamAuditLogExport(@Query('from') from: string, @Query('to') to: string, @Res() res: Response) {
    return this.auditLogs.streamAuditLogCsv(from, to, res);
  }

  // ── GDPR — SUPER_ADMIN, OPS, SUPPORT ────────────────────────────────────

  @Get('data-deletion-requests')
  @RequiresAdminPermission(AdminPermission.PROCESS_GDPR)
  @ApiOperation({ summary: 'List GDPR data deletion requests (SUPER_ADMIN, OPS, SUPPORT)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  listDeletionRequests(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.gdpr.listRequests(Number(page) || 1, Number(limit) || 20);
  }

  @Post('data-deletion-requests/:id/process')
  @RequiresAdminPermission(AdminPermission.PROCESS_GDPR)
  @ApiOperation({ summary: 'Mark a GDPR deletion request as processed (SUPER_ADMIN, OPS, SUPPORT)' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 403, description: 'Insufficient admin permission' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  processDeletionRequest(@Param('id') id: string, @Req() req: Request) {
    return this.gdpr.processRequest(id, (req.user as any)?.id);
  }
}
