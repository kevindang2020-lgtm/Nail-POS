// reviews-center.controller.ts — Reviews & Reputation guide (Oct 30 2026): `/pos/reviews-center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the body.
//   pos.marketing.view     summary · reviews · options · reviews/:id · insights · check (all read-only)
//   + pos.customers.view   the overlay shows the linked customer's full phone / email (otherwise masked); every open of a linked
//                          customer is audited (fail-closed, same transaction)
//   pos.marketing.manage   reviews/:id/moderate (Hide / Unhide: reason-coded, version-checked, idempotent, audited)
// Reply drafting / approval / publishing stays in the existing approval-gated `pos/ai-review-reputation/*` workflow.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { ReviewsCenter, ReviewsCenterError, RV_ACTIONS, RV_HIDE_REASONS, RV_BASES, RV_PRESETS, RV_COMMENT, RV_VISIBILITY, RV_FOLLOWUP, RV_SOURCES } from './reviews-center';

export const REVIEWS_CENTER = 'ReviewsCenter';

export const RV_MODERATE_BODY: BodySchema = S.object({
  action: S.enumOf([...RV_ACTIONS]), reasonCode: S.nullable(S.enumOf([...RV_HIDE_REASONS])), reasonText: S.nullable(S.text(500)), evidence: S.nullable(S.text(500)),
  expectedVersion: S.integer(), idempotencyKey: S.text(120),
}, ['action', 'expectedVersion', 'idempotencyKey']);

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
    if (e instanceof ReviewsCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: {
    comment: { type: 'enum', values: RV_COMMENT }, visibility: { type: 'enum', values: RV_VISIBILITY }, followup: { type: 'enum', values: RV_FOLLOWUP },
    source: { type: 'enum', values: RV_SOURCES }, basis: { type: 'enum', values: RV_BASES }, preset: { type: 'enum', values: RV_PRESETS },
    rating: { type: 'int', min: 1, max: 5 }, technician: { type: 'text' }, service: { type: 'uuid' },
  },
  sorts: { newest: null, oldest: null, lowest: null, highest: null, moderated: null, attention: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 },
  maxLimit: 50, defaultLimit: 20, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/reviews-center')
export class ReviewsCenterController {
  constructor(@Inject(REVIEWS_CENTER) private readonly rc: ReviewsCenter | null) {}
  private r(): ReviewsCenter { if (!this.rc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Reviews need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rc; }

  /** KPI row + rating distribution — every number states its scope (verified / all received / public) */
  @Get('summary') @RequirePermission('pos.marketing.view')
  summary(@Req() q: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('technician') technician?: string, @Query('source') source?: string) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().summary(c, { preset, from, to, technician, source })); }

  /** the Review Feed: server search · rating / comment / visibility / follow-up / technician / service / source · date basis + range · sort · pages 10/20/50 */
  @Get('reviews') @RequirePermission('pos.marketing.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().list(c, f ?? {})); }

  /** filter options built from real rows only */
  @Get('options') @RequirePermission('pos.marketing.view')
  options(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().options(c)); }

  /** the assistant's facts — written comments only; "insufficient written feedback" below the minimum; never sends or hides */
  @Get('insights') @RequirePermission('pos.marketing.view')
  insights(@Req() q: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().insights(c, { preset, from, to })); }

  /** Check Review System — read-only diagnostics */
  @Get('check') @RequirePermission('pos.marketing.view')
  check(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().check(c)); }

  /** the overlay — full customer contact only with pos.customers.view; opening a linked customer is audited (fail-closed) */
  @Get('reviews/:id') @RequirePermission('pos.marketing.view')
  detail(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    const fullContact = can(c, 'pos.customers.view');
    return run(() => this.r().detail(c, id, { fullContact, audit: (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'marketing', action: 'review.customer_viewed', resourceType: 'review', resourceId: id, summary: 'Review overlay opened with the linked customer', metadata: meta }) }));
  }

  /** Hide / Unhide — reason-coded, version-checked, idempotent; the original review text is never changed */
  @Post('reviews/:id/moderate') @RequirePermission('pos.marketing.manage')
  moderate(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RV_MODERATE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().moderate(c, id, b ?? {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'marketing', action: `review.${String(b?.action) === 'hide' ? 'hidden' : 'unhidden'}`, resourceType: 'review', resourceId: id, summary: `Review ${String(b?.action) === 'hide' ? 'hidden' : 'made visible again'}`, metadata: meta })));
  }
}
