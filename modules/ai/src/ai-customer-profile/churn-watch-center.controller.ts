// churn-watch-center.controller.ts — Churn Watch guide (Nov 1 2026): `/pos/churn-watch/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_customer_profile.churn   summary · list · customers/:id (evidence, audited) · customers/:id/review · history · check
//   + pos.customers.export          full phone / email (otherwise masked)
// Churn is the existing manage-gated permission (§49): an internal operational signal, never shown to customers. Refresh
// is the shared Customer Intelligence scan (POST /pos/customer-intelligence/scan) — one evaluation for both screens.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { ChurnWatchCenter, ChurnWatchError, CW_TABS, CW_PRIORITIES, CW_DATE_FIELDS, CW_PRESETS, CW_ACTIONS } from './churn-watch-center';

export const CHURN_WATCH_CENTER = 'ChurnWatchCenter';
export const CW_EMPTY_BODY: BodySchema = S.object({});
export const CW_REVIEW_BODY: BodySchema = S.object({ action: S.enumOf(CW_ACTIONS), note: S.text(1000), dueOn: S.date(), expectedVersion: S.integer({ minimum: 0 }) }, ['action']);
const CHURN = 'pos.ai_customer_profile.churn';

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
const can = (ctx: RetentionContext, perm: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], perm);
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ChurnWatchError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: { tab: { type: 'enum', values: CW_TABS }, priority: { type: 'enum', values: CW_PRIORITIES }, dateField: { type: 'enum', values: CW_DATE_FIELDS },
    preset: { type: 'enum', values: CW_PRESETS }, branch: { type: 'text', maxLength: 40 } },
  sorts: { signal_newest: null, priority: null, last_visit: null, days_since: null, name: null }, search: { maxLength: 100 }, dateRange: { maxDays: 7320 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;
const HISTORY = { filters: { preset: { type: 'enum', values: CW_PRESETS }, customerId: { type: 'uuid' } }, sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/churn-watch')
export class ChurnWatchCenterController {
  constructor(@Inject(CHURN_WATCH_CENTER) private readonly cw: ChurnWatchCenter | null) {}
  private r(): ChurnWatchCenter { if (!this.cw) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Churn Watch needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cw; }
  private audit(c: RetentionContext, action: string, id: string, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'ai', action, resourceType: 'customer', resourceId: id, summary, metadata: meta });
  }

  /** the six metrics from the latest evaluation (Data Unavailable when there is none) */
  @Get('summary') @RequirePermission('pos.ai_customer_profile.churn')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, CHURN); return run(() => this.r().summary(c)); }

  /** the review queue: tab · priority · q · date field + range · sort · pages 10/25/50/100 */
  @Get('customers') @RequirePermission('pos.ai_customer_profile.churn')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, CHURN); return run(() => this.r().list(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** the Retention Evidence overlay — audited, fail-closed */
  @Get('customers/:id') @RequirePermission('pos.ai_customer_profile.churn')
  customer(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, CHURN); return run(() => this.r().customer(c, id, this.audit(c, 'churn_watch.evidence_viewed', id, 'Churn Watch evidence opened'))); }

  /** Mark reviewed · Defer · Reopen · Note — the internal review workflow only */
  @Post('customers/:id/review') @RequirePermission('pos.ai_customer_profile.churn')
  review(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(CW_REVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, CHURN);
    return run(() => this.r().review(c, id, b ?? {}, this.audit(c, 'churn_watch.reviewed', id, `Churn Watch review: ${String(b?.action)}`)));
  }

  /** review history, newest first */
  @Get('history') @RequirePermission('pos.ai_customer_profile.churn')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, CHURN); return run(() => this.r().history(c, f ?? {})); }

  /** Check Churn Watch System — read-only */
  @Post('check') @RequirePermission('pos.ai_customer_profile.churn')
  check(@Req() q: any, @Body(ValidatedBody(CW_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, CHURN); return run(() => this.r().check(c)); }
}
