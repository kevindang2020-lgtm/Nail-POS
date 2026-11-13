// ai-booking-center.controller.ts — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center for the add-on
// under pos/ai-booking. Reads only (overview · activity · detail · recovery · health); the two writes are Check AI Booking
// System (records a read-only run) and Dismiss a recovery case (reason required, audited). Tenant / location / role from
// the session; every route names its permission and the service checks it again.
import { Body, Controller, Get, HttpException, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AuditService } from '@aipowersalon/audit';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { branchOrNull } from '@aipowersalon/tenant-context';
import type { AibActivityPage, AibOverview, AibRequestDetail, AibRecoveryList, AibHealthRun, AibLastHealth, AibDismissResult, AibAlternatives } from '@aipowersalon/api-contracts/tenant';
import { AiBookingCenter, AiBookingCenterError, type BkCtx, type BkApprovalsPort } from './ai-booking-center';
import { BookingService } from '@aipowersalon/booking';
import { AIB_RECOVERY_DISMISS_BODY, AIB_RECOVERY_APPROVAL_BODY } from './request-schemas';
import { ListQueries } from '@aipowersalon/database';
import { AiBookingCenterControllerListQueries } from './ai-booking-center.list-queries';

const ctxOf = (r: any): BkCtx => { const c = r?.ctx || {}; return { tenantId: c.tenantId, branchId: branchOrNull(c.branchId), userId: c.userId, role: c.role, permissions: c.permissions || [] }; };
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof AiBookingCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}

@ListQueries(AiBookingCenterControllerListQueries)
@Controller('pos/ai-booking')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class AiBookingCenterController {
  private readonly center: AiBookingCenter;
  constructor(@Inject(DATABASE) db: AppDatabase, @Optional() audit?: AuditService, @Optional() booking?: BookingService, @Optional() @Inject('TENANT_APPROVALS') approvals?: BkApprovalsPort) {
    this.center = new AiBookingCenter(db as unknown as Kysely<any>, process.env, Date.now, audit ? (c, i) => audit.record(c, i) : undefined);
    // guide §10: alternatives come from POS Booking's own availability engine; manager approval from the salon's approvals engine
    if (booking) this.center.availability = (c, q) => booking.availability({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions }, q);
    if (approvals) this.center.approvals = approvals;
  }

  @Get('overview') @RequirePermission('ai_booking.view')
  overview(@Req() r: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string): Promise<AibOverview> { return run(() => this.center.overview(ctxOf(r), { preset, from, to })); }

  @Get('activity') @RequirePermission('ai_booking.view')
  activity(@Req() r: any, @Query('q') q?: string, @Query('status') status?: string, @Query('source') source?: string, @Query('technicianId') technicianId?: string, @Query('basis') basis?: string,
    @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string): Promise<AibActivityPage> {
    return run(() => this.center.activity(ctxOf(r), { q, status, source, technicianId, basis, preset, from, to, page, pageSize }));
  }

  @Get('requests/:requestId') @RequirePermission('ai_booking.view')
  detail(@Req() r: any, @Param('requestId') id: string): Promise<AibRequestDetail> { return run(() => this.center.detail(ctxOf(r), id)); }

  /** round 10 (AI Booking 14): audit the Support report download (the POS downloads only after this answers) */
  @Idempotent() @Post('requests/:requestId/support-report') @RequirePermission('ai_booking.view')
  recordSupportReport(@Req() r: any, @Param('requestId') id: string): Promise<{ recorded: boolean; at: string } & Pick<AibRequestDetail, 'requestId'>> { return run(() => this.center.recordSupportReport(ctxOf(r), id)); }

  @Get('recovery') @RequirePermission('ai_booking.view')
  recovery(@Req() r: any): Promise<AibRecoveryList> { return run(() => this.center.recovery(ctxOf(r))); }

  @Idempotent() @Post('recovery/:caseKey/dismiss') @RequirePermission('ai_booking.view')
  dismiss(@Req() r: any, @Param('caseKey') key: string, @Body(ValidatedBody(AIB_RECOVERY_DISMISS_BODY, { strict: true })) b: any): Promise<AibDismissResult> { return run(() => this.center.dismissRecovery(ctxOf(r), key, b?.reason)); }

  /** §10 Review Alternative: real open times from POS Booking's availability — a suggestion; nothing is held or booked */
  @Get('recovery/:caseKey/alternatives') @RequirePermission('ai_booking.view')
  alternatives(@Req() r: any, @Param('caseKey') key: string): Promise<AibAlternatives> { return run(() => this.center.alternatives(ctxOf(r), key)); }

  /** §10 Request Manager Approval: one live request per case in the salon's approvals (POS Approvals) */
  @Idempotent() @Post('recovery/:caseKey/request-approval') @RequirePermission('ai_booking.view')
  requestApproval(@Req() r: any, @Param('caseKey') key: string, @Body(ValidatedBody(AIB_RECOVERY_APPROVAL_BODY, { strict: true })) b: any) { return run(() => this.center.requestApproval(ctxOf(r), key, b?.reason)); }

  @Get('health') @RequirePermission('ai_booking.view')
  lastHealth(@Req() r: any): Promise<AibLastHealth> { return run(() => this.center.lastHealth(ctxOf(r))); }

  /** read-only: no appointment, no text, no AI call; the run is recorded */
  @Post('health/run') @RequirePermission('ai_booking.view')
  health(@Req() r: any): Promise<AibHealthRun> { return run(() => this.center.health(ctxOf(r))); }
}
