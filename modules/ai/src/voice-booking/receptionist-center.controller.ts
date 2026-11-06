// receptionist-center.controller.ts — AI Receptionist guide (Oct 31 2026): `/pos/ai/receptionist-center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   ai.use     readiness · health (read-only check, recorded) · kpis · calls · search · calls/:ref · priority · control/history
//              · actions (PREPARE a staff follow-up task — awaiting confirmation, nothing executed)
//   ai.manage  actions/:id/decision (confirm / cancel) · control (arm / disarm booking, verify / clear test call,
//              activate / deactivate — every gate re-checked server-side, version-checked, idempotent, append-only + audited)
// Transcript records are only linked (never returned) and only to ai.manage holders; the access is audited.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ReceptionistCenter, ReceptionistCenterError, RC_CONTROL_ACTIONS, RC_ACTION_DECISIONS, RC_CALL_STATUSES, RC_OUTCOMES, RC_DATE_BASES, RC_DIRECTIONS, RC_PERIODS, RC_SCOPES, type RcCtx } from './receptionist-center';

export { RECEPTIONIST_CENTER } from './receptionist-center';
import { RECEPTIONIST_CENTER } from './receptionist-center';

export const RC_CONTROL_BODY: BodySchema = S.object({
  action: S.enumOf([...RC_CONTROL_ACTIONS]), expectedVersion: S.integer(), reason: S.nullable(S.text(500)), providerCallRef: S.nullable(S.text(128)), idempotencyKey: S.text(120),
}, ['action', 'expectedVersion', 'idempotencyKey']);
export const RC_PREPARE_BODY: BodySchema = S.object({
  sourceType: S.enumOf(['call', 'handoff']), sourceRef: S.text(128), kind: S.text(40), reason: S.nullable(S.text(500)), idempotencyKey: S.text(120),
}, ['sourceType', 'sourceRef', 'kind', 'idempotencyKey']);
export const RC_DECISION_BODY: BodySchema = S.object({
  decision: S.enumOf([...RC_ACTION_DECISIONS]), expectedVersion: S.integer(), reason: S.nullable(S.text(500)),
}, ['decision', 'expectedVersion']);

function ctxFrom(req: any): RcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: RcCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ReceptionistCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const CALLS_LIST = {
  filters: { status: { type: 'enum', values: RC_CALL_STATUSES }, outcome: { type: 'enum', values: RC_OUTCOMES }, dateBasis: { type: 'enum', values: RC_DATE_BASES }, period: { type: 'enum', values: RC_PERIODS },
    agent: { type: 'text', maxLength: 120 }, service: { type: 'text', maxLength: 100 }, direction: { type: 'enum', values: RC_DIRECTIONS }, minSeconds: { type: 'int', min: 0, max: 86400 }, maxSeconds: { type: 'int', min: 0, max: 86400 } },
  sorts: { newest: null, oldest: null, longest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;
const SEARCH_LIST = { filters: { scope: { type: 'enum', values: RC_SCOPES } }, sorts: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;
const PAGED_LIST = { filters: {}, sorts: {}, maxLimit: 50, defaultLimit: 20, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai/receptionist-center')
export class ReceptionistCenterController {
  constructor(@Inject(RECEPTIONIST_CENTER) private readonly rc: ReceptionistCenter | null) {}
  private r(): ReceptionistCenter { if (!this.rc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The AI Receptionist center needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rc; }

  /** readiness stage + the 8 original setup steps computed from evidence + per-dependency checks */
  @Get('readiness') @RequirePermission('ai.use')
  readiness(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().readiness(c)); }

  /** Check AI Receptionist System — read-only; changes no routing, provider, subscription or customer record */
  @Post('health') @RequirePermission('ai.use')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().health(c)); }

  @Get('health/last') @RequirePermission('ai.use')
  lastHealth(@Req() q: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().lastHealth(c)); }

  /** the five original cards with a selectable period (salon-local whole days) */
  @Get('kpis') @RequirePermission('ai.use')
  kpis(@Req() q: any, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().kpis(c, { period, from, to }));
  }

  @Get('calls') @RequirePermission('ai.use') @ListQuery(CALLS_LIST)
  calls(@Req() q: any, @Query() p: any) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.r().calls(c, { q: p?.q, status: p?.status, outcome: p?.outcome, dateBasis: p?.dateBasis, period: p?.period, from: p?.from, to: p?.to, sort: p?.sort, page: p?.page, pageSize: p?.pageSize,
      agent: p?.agent, service: p?.service, direction: p?.direction, minSeconds: p?.minSeconds, maxSeconds: p?.maxSeconds }));
  }

  @Get('search') @RequirePermission('ai.use') @ListQuery(SEARCH_LIST)
  search(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().search(c, { scope: p?.scope, q: p?.q, page: p?.page, pageSize: p?.pageSize })); }

  @Get('calls/:ref') @RequirePermission('ai.use')
  call(@Req() q: any, @Param('ref') ref: string) {
    const c = ctxFrom(q); need(c, 'ai.use');
    return run(() => this.r().callDetail(c, String(ref).slice(0, 128), hasPermission(c as Parameters<typeof hasPermission>[0], 'ai.manage')));
  }

  @Get('priority') @RequirePermission('ai.use') @ListQuery(PAGED_LIST)
  priority(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().priority(c, { page: p?.page, pageSize: p?.pageSize })); }

  /** prepare a staff follow-up task for a worklist item — it waits for an owner/manager; nothing is executed */
  @Post('actions') @RequirePermission('ai.use')
  prepare(@Req() q: any, @Body(ValidatedBody(RC_PREPARE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().prepareAction(c, b ?? {})); }

  @Post('actions/:id/decision') @RequirePermission('ai.manage')
  decide(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RC_DECISION_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.r().decideAction(c, id, b ?? {})); }

  /** arm / disarm booking actions, verify / clear the test call, activate / deactivate — gated, audited, append-only */
  @Post('control') @RequirePermission('ai.manage')
  control(@Req() q: any, @Body(ValidatedBody(RC_CONTROL_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'ai.manage'); return run(() => this.r().controlAction(c, b ?? {})); }

  @Get('control/history') @RequirePermission('ai.use') @ListQuery(PAGED_LIST)
  controlHistory(@Req() q: any, @Query() p: any) { const c = ctxFrom(q); need(c, 'ai.use'); return run(() => this.r().controlHistory(c, { page: p?.page, pageSize: p?.pageSize })); }
}
