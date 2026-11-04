// ai-booking-center.controller.ts — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center for the add-on
// under pos/ai-booking. Reads only (overview · activity · detail · recovery · health); the two writes are Check AI Booking
// System (records a read-only run) and Dismiss a recovery case (reason required, audited). Tenant / location / role from
// the session; every route names its permission and the service checks it again.
import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { branchOrNull } from '@aipowersalon/tenant-context';
import type { AibActivityPage, AibOverview, AibRequestDetail, AibRecoveryList, AibHealthRun, AibLastHealth, AibDismissResult } from '@aipowersalon/api-contracts/tenant';
import { AiBookingCenter, AiBookingCenterError, type BkCtx } from './ai-booking-center';
import { AIB_RECOVERY_DISMISS_BODY } from './request-schemas';
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
  constructor(@Inject(DATABASE) db: AppDatabase) { this.center = new AiBookingCenter(db as any); }

  @Get('overview') @RequirePermission('ai_booking.view')
  overview(@Req() r: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string): Promise<AibOverview> { return run(() => this.center.overview(ctxOf(r), { preset, from, to })); }

  @Get('activity') @RequirePermission('ai_booking.view')
  activity(@Req() r: any, @Query('q') q?: string, @Query('status') status?: string, @Query('source') source?: string, @Query('technicianId') technicianId?: string, @Query('basis') basis?: string,
    @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string): Promise<AibActivityPage> {
    return run(() => this.center.activity(ctxOf(r), { q, status, source, technicianId, basis, preset, from, to, page, pageSize }));
  }

  @Get('requests/:requestId') @RequirePermission('ai_booking.view')
  detail(@Req() r: any, @Param('requestId') id: string): Promise<AibRequestDetail> { return run(() => this.center.detail(ctxOf(r), id)); }

  @Get('recovery') @RequirePermission('ai_booking.view')
  recovery(@Req() r: any): Promise<AibRecoveryList> { return run(() => this.center.recovery(ctxOf(r))); }

  @Idempotent() @Post('recovery/:caseKey/dismiss') @RequirePermission('ai_booking.view')
  dismiss(@Req() r: any, @Param('caseKey') key: string, @Body(ValidatedBody(AIB_RECOVERY_DISMISS_BODY, { strict: true })) b: any): Promise<AibDismissResult> { return run(() => this.center.dismissRecovery(ctxOf(r), key, b?.reason)); }

  @Get('health') @RequirePermission('ai_booking.view')
  lastHealth(@Req() r: any): Promise<AibLastHealth> { return run(() => this.center.lastHealth(ctxOf(r))); }

  /** read-only: no appointment, no text, no AI call; the run is recorded */
  @Post('health/run') @RequirePermission('ai_booking.view')
  health(@Req() r: any): Promise<AibHealthRun> { return run(() => this.center.health(ctxOf(r))); }
}
