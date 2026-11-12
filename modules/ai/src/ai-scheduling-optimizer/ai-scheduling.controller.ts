// ai-scheduling.controller.ts — the tenant API of the AI Scheduling Optimizer (BUILD_PLAN Phase 7). TenantAuthGuard +
// RolePermissionGuard with the optimizer's own ai_scheduling.* keys (no more mapping onto booking.*); the service
// re-checks every permission so non-HTTP callers are gated the same way. Tenant / branch / user come from req.ctx only.
// Response bodies are exactly the @aipowersalon/api-contracts/tenant Sched* shapes. SchedError → HTTP via run().
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SCHED_APPLY_BODY, SCHED_CUSTOMER_DECISION_BODY, SCHED_DECISION_BODY, SCHED_GENERATE_BODY, SCHED_LOCK_BODY, SCHED_OPTIONS_BODY, SCHED_RUN_BODY, SCHED_SERVICE_PROFILE_BODY, SCHED_SETTINGS_BODY, SCHED_TIME_OFF_BODY } from '../request-schemas';
import { Body, Controller, Delete, Get, HttpException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type {
  SchedOptionsRequest, SchedGenerateRequest, SchedDecisionRequest, SchedApplyRequest, SchedRunRequest, SchedSettingsUpdate, SchedTimeOffCreate,
  SchedOptionsResponse, SchedGenerateResponse, SchedRecommendationResponse, SchedDayContextResponse, SchedApplyResponse, SchedRecommendationList, SchedRunDetail, SchedRun,
  SchedSettingsView, SchedRuleVersion, SchedCalendarIndicators, SchedTimeOff, SchedLock, SchedServiceProfile, SchedProposalSummary,
} from '@aipowersalon/api-contracts/tenant';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AiSchedulingService, type SchedCtx } from './ai-scheduling.service';
import { SchedError } from './ai-scheduling-errors';
import { ListQueries } from '@aipowersalon/database';
import { AiSchedulingControllerListQueries } from './ai-scheduling.list-queries';

export function schedCtx(req: any): SchedCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId, role: c.role, permissions: c.permissions || [], actor: 'user',
    technicianId: c.technicianId ?? null, requestId: c.requestId ?? null, correlationId: c.correlationId ?? null };
}
export async function schedRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof SchedError) throw new HttpException({ ok: false, code: e.code, message: e.message, ...(e.extra || {}) }, e.status); throw e; }
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_scheduling_optimizer')
@ListQueries(AiSchedulingControllerListQueries)
@Controller('pos/ai-scheduling-optimizer')
export class AiSchedulingController {
  constructor(private readonly svc: AiSchedulingService) {}

  // ── settings ──
  @Get('settings') @RequirePermission('ai_scheduling.view')
  getSettings(@Req() r: any): Promise<SchedSettingsView> { return schedRun(() => this.svc.getSettings(schedCtx(r))); }
  @Put('settings') @RequirePermission('ai_scheduling.configure')
  saveSettings(@Req() r: any, @Body(ValidatedBody(SCHED_SETTINGS_BODY, { strict: true })) b: SchedSettingsUpdate): Promise<SchedSettingsView> { return schedRun(() => this.svc.updateSettings(schedCtx(r), b)); }
  @Get('settings/versions') @RequirePermission('ai_scheduling.view')
  settingsVersions(@Req() r: any): Promise<SchedRuleVersion[]> { return schedRun(() => this.svc.settingsVersions(schedCtx(r))); }

  // ── options + holds (never books) ──
  @Post('options') @RequirePermission('ai_scheduling.view')
  options(@Req() r: any, @Body(ValidatedBody(SCHED_OPTIONS_BODY, { strict: true })) b: SchedOptionsRequest): Promise<SchedOptionsResponse> { return schedRun(() => this.svc.findOptions(schedCtx(r), b)); }
  @Post('holds/:holdId/release') @RequirePermission('ai_scheduling.generate')
  releaseHold(@Req() r: any, @Param('holdId') holdId: string): Promise<{ released: true }> { return schedRun(() => this.svc.releaseHold(schedCtx(r), holdId)); }

  // ── recommendations ──
  @Get('recommendations') @RequirePermission('ai_scheduling.view')
  list(@Req() r: any, @Query() q: any): Promise<SchedRecommendationList> {
    return schedRun(() => this.svc.list(schedCtx(r), { status: str(q?.status) as any, type: str(q?.type) as any, runId: str(q?.runId), technicianId: str(q?.technicianId), date: str(q?.date), limit: q?.limit ? Number(q.limit) : null }));
  }
  /** A technician's own view (view_own): only recommendations that touch them. */
  @Get('recommendations/own') @RequirePermission('ai_scheduling.view_own')
  listOwn(@Req() r: any, @Query() q: any): Promise<SchedRecommendationList> {
    const c = schedCtx(r); c.permissions = c.permissions.filter((p) => p !== 'ai_scheduling.view');
    return schedRun(() => this.svc.list(c, { status: str(q?.status) as any, date: str(q?.date), limit: q?.limit ? Number(q.limit) : null }));
  }
  @Post('recommendations/generate') @RequirePermission('ai_scheduling.generate')
  async generate(@Req() r: any, @Body(ValidatedBody(SCHED_GENERATE_BODY, { strict: true })) b: SchedGenerateRequest): Promise<SchedGenerateResponse> { return { recommendation: await schedRun(() => this.svc.generate(schedCtx(r), b)) }; }
  @Get('recommendations/:id') @RequirePermission('ai_scheduling.view')
  async get(@Req() r: any, @Param('id') id: string): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.get(schedCtx(r), id)) }; }
  @Get('recommendations/:id/day') @RequirePermission('ai_scheduling.view')
  async day(@Req() r: any, @Param('id') id: string): Promise<SchedDayContextResponse> { return schedRun(() => this.svc.dayContext(schedCtx(r), id)); }
  @Post('recommendations/:id/accept') @RequirePermission('ai_scheduling.review')
  async accept(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_DECISION_BODY, { strict: true })) b: SchedDecisionRequest): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.decide(schedCtx(r), id, 'accept', b)) }; }
  @Post('recommendations/:id/reject') @RequirePermission('ai_scheduling.review')
  async reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_DECISION_BODY, { strict: true })) b: SchedDecisionRequest): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.decide(schedCtx(r), id, 'reject', b)) }; }
  @Post('recommendations/:id/return') @RequirePermission('ai_scheduling.review')
  async returnRec(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_DECISION_BODY, { strict: true })) b: SchedDecisionRequest): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.decide(schedCtx(r), id, 'return', b)) }; }
  // apply THROUGH the booking service — the stored proposed change only; the body carries nothing but expectedVersion
  @Post('recommendations/:id/apply') @RequirePermission('ai_scheduling.apply')
  apply(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_APPLY_BODY, { strict: true })) b: SchedApplyRequest): Promise<SchedApplyResponse> { return schedRun(() => this.svc.apply(schedCtx(r), id, b)); }
  @Post('recommendations/:id/retry') @RequirePermission('ai_scheduling.apply')
  retry(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_APPLY_BODY, { strict: true })) b: SchedApplyRequest): Promise<SchedApplyResponse> { return schedRun(() => this.svc.retry(schedCtx(r), id, b)); }
  @Post('recommendations/:id/rollback') @RequirePermission('ai_scheduling.apply')
  rollback(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_APPLY_BODY, { strict: true })) b: SchedApplyRequest): Promise<SchedRecommendationResponse> { return schedRun(() => this.svc.rollback(schedCtx(r), id, b)); }
  @Post('recommendations/:id/explain') @RequirePermission('ai_scheduling.view')
  async explain(@Req() r: any, @Param('id') id: string): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.explain(schedCtx(r), id)) }; }
  @Post('recommendations/:id/proposal/resend') @RequirePermission('ai_scheduling.review')
  resend(@Req() r: any, @Param('id') id: string): Promise<SchedProposalSummary> { return schedRun(() => this.svc.resendProposal(schedCtx(r), id)); }
  @Post('recommendations/:id/customer-decision') @RequirePermission('ai_scheduling.review')
  async customerDecision(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SCHED_CUSTOMER_DECISION_BODY, { strict: true })) b: { approved: boolean; expectedVersion: number }): Promise<SchedRecommendationResponse> { return { recommendation: await schedRun(() => this.svc.recordCustomerDecision(schedCtx(r), id, b)) }; }

  // ── runs ──
  @Post('runs') @RequirePermission('ai_scheduling.generate')
  runDay(@Req() r: any, @Body(ValidatedBody(SCHED_RUN_BODY, { strict: true })) b: SchedRunRequest): Promise<SchedRunDetail> { return schedRun(() => this.svc.runDay(schedCtx(r), b, 'manual')); }
  @Get('runs') @RequirePermission('ai_scheduling.view')
  runs(@Req() r: any, @Query() q: any): Promise<SchedRun[]> { return schedRun(() => this.svc.listRuns(schedCtx(r), { date: str(q?.date), limit: q?.limit ? Number(q.limit) : null })); }
  @Get('runs/:id') @RequirePermission('ai_scheduling.view')
  run(@Req() r: any, @Param('id') id: string): Promise<SchedRunDetail> { return schedRun(() => this.svc.getRun(schedCtx(r), id)); }

  // ── booking-calendar overlay ──
  @Get('calendar') @RequirePermission('ai_scheduling.view')
  calendar(@Req() r: any, @Query('date') date: string, @Query('capacity') capacity?: string): Promise<SchedCalendarIndicators> { return schedRun(() => this.svc.calendar(schedCtx(r), date, { capacity: capacity === '1' || capacity === 'true' })); }

  // ── gate inputs ──
  @Get('time-off') @RequirePermission('ai_scheduling.view')
  timeOff(@Req() r: any, @Query() q: any): Promise<SchedTimeOff[]> { return schedRun(() => this.svc.listTimeOff(schedCtx(r), { technicianId: str(q?.technicianId), from: str(q?.from), to: str(q?.to) })); }
  @Post('time-off') @RequirePermission('technicians.edit')
  addTimeOff(@Req() r: any, @Body(ValidatedBody(SCHED_TIME_OFF_BODY, { strict: true })) b: SchedTimeOffCreate): Promise<SchedTimeOff> { return schedRun(() => this.svc.createTimeOff(schedCtx(r), b)); }
  @Delete('time-off/:id') @RequirePermission('technicians.edit')
  removeTimeOff(@Req() r: any, @Param('id') id: string): Promise<{ cancelled: true }> { return schedRun(() => this.svc.deleteTimeOff(schedCtx(r), id)); }
  @Get('locks') @RequirePermission('ai_scheduling.view')
  locks(@Req() r: any): Promise<SchedLock[]> { return schedRun(() => this.svc.listLocks(schedCtx(r))); }
  @Put('locks/:appointmentId') @RequirePermission('ai_scheduling.review')
  lock(@Req() r: any, @Param('appointmentId') appointmentId: string, @Body(ValidatedBody(SCHED_LOCK_BODY, { strict: true })) b: { reason?: string | null }): Promise<SchedLock> { return schedRun(() => this.svc.putLock(schedCtx(r), appointmentId, b ?? {})); }
  @Delete('locks/:appointmentId') @RequirePermission('ai_scheduling.review')
  unlock(@Req() r: any, @Param('appointmentId') appointmentId: string): Promise<{ removed: true }> { return schedRun(() => this.svc.deleteLock(schedCtx(r), appointmentId)); }
  @Get('service-profiles') @RequirePermission('ai_scheduling.view')
  profiles(@Req() r: any): Promise<SchedServiceProfile[]> { return schedRun(() => this.svc.listServiceProfiles(schedCtx(r))); }
  @Put('service-profiles/:serviceId') @RequirePermission('ai_scheduling.configure')
  putProfile(@Req() r: any, @Param('serviceId') serviceId: string, @Body(ValidatedBody(SCHED_SERVICE_PROFILE_BODY, { strict: true })) b: Partial<SchedServiceProfile>): Promise<SchedServiceProfile> { return schedRun(() => this.svc.putServiceProfile(schedCtx(r), serviceId, b ?? {})); }
}
