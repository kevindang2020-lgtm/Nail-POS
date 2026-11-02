// rebooking-center.controller.ts — Rebooking Opportunities guide (Nov 1 2026): `/pos/rebooking/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_customer_profile.view    summary · list · customers/:id (360° overlay, audited) · customers/:id/review · history · check
//   + pos.booking.create            customers/:id/handoff (prepare the Booking Assistant prefill; writes no appointment)
//   + pos.customers.export          full phone / email (otherwise masked)
// The existing per-customer rebooking route (GET /pos/ai-customer-profile/customers/:id/rebooking) keeps the same view
// permission. Refresh is the shared Customer Intelligence scan (POST /pos/customer-intelligence/scan).
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { RebookingCenter, RebookingError, RB_TABS, RB_DATE_FIELDS, RB_PRESETS, RB_ACTIONS } from './rebooking-center';

export const REBOOKING_CENTER = 'RebookingCenter';
export const RB_EMPTY_BODY: BodySchema = S.object({});
export const RB_REVIEW_BODY: BodySchema = S.object({ action: S.enumOf(RB_ACTIONS), note: S.text(1000), dueOn: S.date(), expectedVersion: S.integer({ minimum: 0 }) }, ['action']);
export const RB_HANDOFF_BODY: BodySchema = S.object({ serviceId: S.uuid(), technicianId: S.uuid() });
const VIEW = 'pos.ai_customer_profile.view';
const BOOK = 'pos.booking.create';
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
    if (e instanceof RebookingError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: { tab: { type: 'enum', values: RB_TABS }, dateField: { type: 'enum', values: RB_DATE_FIELDS }, preset: { type: 'enum', values: RB_PRESETS },
    serviceId: { type: 'uuid' }, technicianId: { type: 'uuid' }, branch: { type: 'text', maxLength: 40 } },
  sorts: { newest: null, most_overdue: null, last_visit: null, name: null }, search: { maxLength: 100 }, dateRange: { maxDays: 7320 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;
const HISTORY = { filters: { preset: { type: 'enum', values: RB_PRESETS }, customerId: { type: 'uuid' }, type: { type: 'enum', values: [...RB_ACTIONS, 'booking_started'] } },
  sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// the same AI subscription gate as the AI Customer Profile assistant (observe mode by default — see ai-entitlement.guard.ts)
@RequiresAiPackage('ai_customer_profile_assistant')
@Controller('pos/rebooking')
export class RebookingCenterController {
  constructor(@Inject(REBOOKING_CENTER) private readonly rb: RebookingCenter | null) {}
  private r(): RebookingCenter { if (!this.rb) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Rebooking needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rb; }
  private audit(c: RetentionContext, action: string, id: string, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'ai', action, resourceType: 'customer', resourceId: id, summary, metadata: meta });
  }

  /** the cards from the latest evaluation (Data Unavailable when there is none) */
  @Get('summary') @RequirePermission('pos.ai_customer_profile.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().summary(c)); }

  /** the review queue: tab · q · service · technician · date dimension + range · sort · pages 10/25/50/100 (newest first) */
  @Get('customers') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().list(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** the 360° review overlay — audited, fail-closed */
  @Get('customers/:id') @RequirePermission('pos.ai_customer_profile.view')
  customer(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, VIEW);
    return run(() => this.r().customer(c, id, { fullContact: can(c, 'pos.customers.export') }, this.audit(c, 'rebooking.evidence_viewed', id, 'Rebooking evidence opened')));
  }

  /** Mark reviewed · Defer · Reopen · Note — the internal review workflow only */
  @Post('customers/:id/review') @RequirePermission('pos.ai_customer_profile.view')
  review(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RB_REVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW);
    return run(() => this.r().review(c, id, b ?? {}, this.audit(c, 'rebooking.reviewed', id, `Rebooking review: ${String(b?.action)}`)));
  }

  /** Open AI Booking Assistant — re-checks the live calendar and returns the prefill; never writes an appointment */
  @Post('customers/:id/handoff') @RequirePermission('pos.booking.create')
  handoff(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(RB_HANDOFF_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW, BOOK);
    return run(() => this.r().handoff(c, id, b ?? {}, { fullContact: can(c, 'pos.customers.export') }, this.audit(c, 'rebooking.booking_started', id, 'Rebooking: Booking Assistant opened')));
  }

  /** review + handoff history, newest first */
  @Get('history') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().history(c, f ?? {})); }

  /** Check Rebooking System — read-only */
  @Post('check') @RequirePermission('pos.ai_customer_profile.view')
  check(@Req() q: any, @Body(ValidatedBody(RB_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
