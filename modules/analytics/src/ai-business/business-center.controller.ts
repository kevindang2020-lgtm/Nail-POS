// business-center.controller.ts — AI Business Reports + AI Business Alerts guides (Nov 3 2026): `/pos/ai-business/center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard, pos.ai_business.view (the same gate as the AI Business pages); the money figures
// additionally need the Sales Report's own financial permission, checked by ReportsService. Tenant / branch from req.ctx.
// Nothing here edits a sale, an appointment, a customer, a price or a schedule, and nothing sends a message.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { AlertIncidentListResponse, AlertIncidentDetail, AlertIncidentActionRequest, AlertIncidentActionResponse, AlertIncidentNoteRequest, AlertDeliverySettings, AlertDeliverySettingsResponse, AlertDeliveryUpdateRequest,
  BranchScorecardResponse, BranchExplainResponse, BranchDataCheckResponse, BranchSnapshotDetail, BranchSnapshotListResponse, AssistantHistoryResponse, AssistantDataCheckResponse, AssistantHistoryDeleteResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { AlertIncidentError, BUSINESS_ALERT_INCIDENTS, INCIDENT_STATUSES, type BusinessAlertIncidents } from './business-alert-incidents';
import { BranchInsightsError, BRANCH_INSIGHTS, type BranchInsights } from './branch-insights';
import { AssistantExtrasError, ASSISTANT_EXTRAS, type AssistantExtrasRoutes } from './ai-business-assistant-extras';
import { BusinessCenter, BusinessCenterError, BC_TYPES, BC_STATUSES, BC_PRESETS, BC_EVENT_STATES, BC_RULE_STATUSES } from './business-center';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

export const BUSINESS_CENTER = 'BusinessCenter';
const str = (max: number): BodySchema => S.nullable(S.string({ maxLength: max }));
export const BC_EMPTY_BODY: BodySchema = S.object({});
export const BC_GENERATE_BODY: BodySchema = S.object({ reportType: str(40), preset: str(20) });
export const BC_ACK_BODY: BodySchema = S.object({ note: str(500) });
export const BC_INCIDENT_ACTION_BODY: BodySchema = S.object({ action: str(20), expectedVersion: S.nullable(S.number()), note: str(1000), assigneeUserId: str(40), snoozeMinutes: S.nullable(S.number()) });
export const BC_INCIDENT_NOTE_BODY: BodySchema = S.object({ note: str(1000) });
/** AI BRANCH COMPARISON 14: save a comparison (the period only — the figures are read by the server) / a sign-off note */
export const BC_BRANCH_SNAPSHOT_BODY: BodySchema = S.object({ preset: str(20), from: str(10), to: str(10), title: str(120) });
export const BC_BRANCH_SIGNOFF_BODY: BodySchema = S.object({ decision: str(20), note: str(1000) });
export const BC_DELIVERY_BODY: BodySchema = S.object({ severity: str(10), channels: S.nullable(S.array(S.string({ maxLength: 10 }), { maxItems: 3 })), recipientUserIds: S.nullable(S.array(S.string({ maxLength: 40 }), { maxItems: 20 })),
  quietHoursStart: S.nullable(S.number()), quietHoursEnd: S.nullable(S.number()), cooldownMinutes: S.nullable(S.number()) });
function ctxFrom(req: any): AiBusinessContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: AiBusinessContext) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof BusinessCenterError || e instanceof AlertIncidentError || e instanceof BranchInsightsError || e instanceof AssistantExtrasError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    if (e instanceof AiBusinessError) {
      const st = e.code === AiBusinessErrorCode.INSUFFICIENT_PERMISSION || e.code === AiBusinessErrorCode.BRANCH_NOT_AUTHORIZED ? HttpStatus.FORBIDDEN
        : e.code === AiBusinessErrorCode.METRIC_NOT_FOUND ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
      throw new HttpException({ code: e.code, message: e.message }, st);
    }
    throw e;
  }
}
const REPORTS = { filters: { type: { type: 'enum', values: BC_TYPES }, status: { type: 'enum', values: BC_STATUSES }, preset: { type: 'enum', values: BC_PRESETS } },
  search: { maxLength: 80 }, sorts: { newest: null, oldest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const RULES = { filters: { status: { type: 'enum', values: BC_RULE_STATUSES } }, search: { maxLength: 80 }, maxLimit: 100, defaultLimit: 25, params: ['page', 'metric'] } as const;
const HISTORY = { filters: { state: { type: 'enum', values: BC_EVENT_STATES }, preset: { type: 'enum', values: BC_PRESETS }, alertId: { type: 'uuid' } },
  search: { maxLength: 80 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

const HISTORY_Q = { search: { maxLength: 80 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const SNAPSHOTS_Q = { maxLimit: 10, defaultLimit: 10, params: ['page'] } as const;
const INCIDENTS = { filters: { status: { type: 'enum', values: INCIDENT_STATUSES } }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-business/center')
export class BusinessCenterController {
  constructor(@Inject(BUSINESS_CENTER) private readonly bc: BusinessCenter | null, @Optional() @Inject(BUSINESS_ALERT_INCIDENTS) private readonly inc: BusinessAlertIncidents | null = null,
    @Optional() @Inject(BRANCH_INSIGHTS) private readonly insights: BranchInsights | null = null,
    @Optional() @Inject(ASSISTANT_EXTRAS) private readonly extras: AssistantExtrasRoutes | null = null) {}
  private ax(): AssistantExtrasRoutes { if (!this.extras) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Business needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.extras; }
  private bi(): BranchInsights { if (!this.insights) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Business needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.insights; }
  private i(): BusinessAlertIncidents { if (!this.inc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Business needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.inc; }
  private c(): BusinessCenter { if (!this.bc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'AI Business needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.bc; }

  // ── reports ──
  @Get('reports/summary') @RequirePermission('pos.ai_business.view')
  reportSummary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportSummary(c)); }
  @Get('reports') @RequirePermission('pos.ai_business.view') @ListQuery(REPORTS)
  reports(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportList(c, f ?? {})); }
  @Get('reports/:id') @RequirePermission('pos.ai_business.view')
  report(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportDetail(c, id)); }
  @Post('reports/generate') @RequirePermission('pos.ai_business.view')
  generate(@Req() q: any, @Body(ValidatedBody(BC_GENERATE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportGenerate(c, b ?? {})); }
  @Post('reports/:id/regenerate') @RequirePermission('pos.ai_business.view')
  regenerate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportRegenerate(c, id)); }
  @Post('reports/:id/verify') @RequirePermission('pos.ai_business.view')
  verify(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().reportVerify(c, id)); }
  @Post('reports/check') @RequirePermission('pos.ai_business.view')
  reportCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c, 'reports')); }

  // ── alerts ──
  @Get('alerts/summary') @RequirePermission('pos.ai_business.view')
  alertSummary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertSummary(c)); }
  @Get('alerts/rules') @RequirePermission('pos.ai_business.view') @ListQuery(RULES)
  rules(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertRules(c, f ?? {})); }
  @Get('alerts/history') @RequirePermission('pos.ai_business.view') @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertHistory(c, f ?? {})); }
  @Post('alerts/:id/evaluate') @RequirePermission('pos.ai_business.view')
  evaluate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertEvaluate(c, id)); }
  @Post('alerts/events/:id/acknowledge') @RequirePermission('pos.ai_business.view')
  acknowledge(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_ACK_BODY, { strict: true })) b: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertAcknowledge(c, id, b ?? {})); }
  @Get('alerts/events/:id/explain') @RequirePermission('pos.ai_business.view')
  explain(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertExplain(c, id)); }
  @Get('alerts/anomaly') @RequirePermission('pos.ai_business.view')
  anomaly(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().alertAnomaly(c)); }
  // ── A2 incidents + delivery (Nov 6 2026; business-alert-incidents.ts) ──
  @Get('alerts/incidents') @RequirePermission('pos.ai_business.view') @ListQuery(INCIDENTS)
  incidents(@Req() q: any, @Query() f: any): Promise<AlertIncidentListResponse> { const c = ctxFrom(q); authed(c); return run(() => this.i().list(c, f ?? {}) as Promise<AlertIncidentListResponse>); }
  @Get('alerts/incidents/:id') @RequirePermission('pos.ai_business.view')
  incident(@Req() q: any, @Param('id') id: string): Promise<AlertIncidentDetail> { const c = ctxFrom(q); authed(c); return run(() => this.i().detail(c, id) as Promise<AlertIncidentDetail>); }
  @Post('alerts/incidents/:id/action') @RequirePermission('pos.ai_business.view')
  incidentAction(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_INCIDENT_ACTION_BODY, { strict: true })) b: AlertIncidentActionRequest): Promise<AlertIncidentActionResponse> { const c = ctxFrom(q); authed(c); return run(() => this.i().act(c, id, (b ?? {}) as Record<string, any>) as Promise<AlertIncidentActionResponse>); }
  @Post('alerts/incidents/:id/notes') @RequirePermission('pos.ai_business.view')
  incidentNote(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_INCIDENT_NOTE_BODY, { strict: true })) b: AlertIncidentNoteRequest): Promise<{ ok: boolean }> { const c = ctxFrom(q); authed(c); return run(() => this.i().addNote(c, id, (b ?? {}) as Record<string, any>)); }
  @Get('alerts/:id/delivery') @RequirePermission('pos.ai_business.view')
  delivery(@Req() q: any, @Param('id') id: string): Promise<AlertDeliverySettingsResponse> { const c = ctxFrom(q); authed(c); return run(() => this.i().delivery(c, id) as Promise<AlertDeliverySettingsResponse>); }
  @Post('alerts/:id/delivery') @RequirePermission('pos.ai_business.view')
  setDelivery(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_DELIVERY_BODY, { strict: true })) b: AlertDeliveryUpdateRequest): Promise<AlertDeliverySettings> { const c = ctxFrom(q); authed(c); return run(() => this.i().setDelivery(c, id, (b ?? {}) as Record<string, any>) as Promise<AlertDeliverySettings>); }
  // ── A3 branch scorecard / explanation / advisor / data check (Nov 6 2026; branch-insights.ts) ──
  @Get('branches/scorecard') @RequirePermission('pos.ai_business.view')
  scorecard(@Req() q: any, @Query() f: any): Promise<BranchScorecardResponse> { const c = ctxFrom(q); authed(c); return run(() => this.bi().scorecard(c, f ?? {}) as Promise<BranchScorecardResponse>); }
  @Get('branches/explain') @RequirePermission('pos.ai_business.view')
  branchExplain(@Req() q: any, @Query() f: any): Promise<BranchExplainResponse> { const c = ctxFrom(q); authed(c); return run(() => this.bi().explain(c, f ?? {}) as Promise<BranchExplainResponse>); }
  // AI BRANCH COMPARISON 14 (Nov 12 2026): saved comparisons (immutable) + manager sign-off notes (append-only); money masked without financial view
  @Post('branches/snapshots') @RequirePermission('pos.ai_business.view')
  saveBranchSnapshot(@Req() q: any, @Body(ValidatedBody(BC_BRANCH_SNAPSHOT_BODY, { strict: true })) b: any): Promise<BranchSnapshotDetail> { const c = ctxFrom(q); authed(c); return run(() => this.bi().saveSnapshot(c, b ?? {}) as Promise<BranchSnapshotDetail>); }
  @Get('branches/snapshots') @RequirePermission('pos.ai_business.view') @ListQuery(SNAPSHOTS_Q)
  branchSnapshots(@Req() q: any, @Query() f: any): Promise<BranchSnapshotListResponse> { const c = ctxFrom(q); authed(c); return run(() => this.bi().listSnapshots(c, f ?? {}) as Promise<BranchSnapshotListResponse>); }
  @Get('branches/snapshots/:id') @RequirePermission('pos.ai_business.view')
  branchSnapshot(@Req() q: any, @Param('id') id: string): Promise<BranchSnapshotDetail> { const c = ctxFrom(q); authed(c); return run(() => this.bi().snapshot(c, id) as Promise<BranchSnapshotDetail>); }
  @Post('branches/snapshots/:id/signoffs') @RequirePermission('pos.ai_business.view')
  branchSignOff(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(BC_BRANCH_SIGNOFF_BODY, { strict: true })) b: any): Promise<BranchSnapshotDetail> { const c = ctxFrom(q); authed(c); return run(() => this.bi().signOff(c, id, b ?? {}) as Promise<BranchSnapshotDetail>); }
  @Post('branches/check') @RequirePermission('pos.ai_business.view')
  branchCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown): Promise<BranchDataCheckResponse> { const c = ctxFrom(q); authed(c); return run(() => this.bi().check(c) as Promise<BranchDataCheckResponse>); }
  // ── A4 assistant history + Check Business Data (Nov 6 2026; ai-business-assistant-extras.ts) ──
  @Get('assistant/history') @RequirePermission('pos.ai_business.view') @ListQuery(HISTORY_Q)
  assistantHistory(@Req() q: any, @Query() f: any): Promise<AssistantHistoryResponse> { const c = ctxFrom(q); authed(c); return run(() => this.ax().history.list(c, f ?? {}) as Promise<AssistantHistoryResponse>); }
  @Delete('assistant/history/:id') @RequirePermission('pos.ai_business.view')
  assistantHistoryDelete(@Req() q: any, @Param('id') id: string): Promise<AssistantHistoryDeleteResponse> { const c = ctxFrom(q); authed(c); return run(() => this.ax().history.remove(c, id)); }
  @Post('assistant/check') @RequirePermission('pos.ai_business.view')
  assistantCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown): Promise<AssistantDataCheckResponse> { const c = ctxFrom(q); authed(c); return run(() => this.ax().check(c) as Promise<AssistantDataCheckResponse>); }
  @Post('alerts/check') @RequirePermission('pos.ai_business.view')
  alertCheck(@Req() q: any, @Body(ValidatedBody(BC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); authed(c); return run(() => this.c().check(c, 'alerts')); }
}
