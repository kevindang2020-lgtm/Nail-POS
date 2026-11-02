// service-recommendations-center.controller.ts — Service Recommendations guide (Nov 1 2026): `/pos/service-recommendations/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_customer_profile.view    summary · list · recommendations/:id (360° overlay, audited) · recommendations/:id/review ·
//                                   history · scans · scan (Refresh) · check
//   + pos.booking.create            recommendations/:id/handoff (prepare the Booking Assistant prefill; writes no appointment)
//   + pos.customers.export          full phone / email (otherwise masked)
// The existing per-customer route (GET /pos/ai-customer-profile/customers/:id/recommendations) is kept for the AI profile panel.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { ServiceRecommendationsCenter, ServiceRecommendationsError, SR_TABS, SR_TYPES, SR_DATE_FIELDS, SR_PRESETS, SR_ACTIONS } from './service-recommendations-center';

export const SERVICE_RECOMMENDATIONS_CENTER = 'ServiceRecommendationsCenter';
export const SR_EMPTY_BODY: BodySchema = S.object({});
export const SR_REVIEW_BODY: BodySchema = S.object({ action: S.enumOf(SR_ACTIONS), note: S.text(1000), dueOn: S.date(), expectedVersion: S.integer({ minimum: 0 }) }, ['action']);
export const SR_HANDOFF_BODY: BodySchema = S.object({ technicianId: S.uuid() });
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
    if (e instanceof ServiceRecommendationsError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: { tab: { type: 'enum', values: SR_TABS }, type: { type: 'enum', values: SR_TYPES }, dateField: { type: 'enum', values: SR_DATE_FIELDS }, preset: { type: 'enum', values: SR_PRESETS },
    serviceId: { type: 'uuid' }, technicianId: { type: 'uuid' }, branch: { type: 'text', maxLength: 40 } },
  sorts: { newest: null, oldest: null, recently_reviewed: null, name: null, last_completed: null, service: null }, search: { maxLength: 100 }, dateRange: { maxDays: 7320 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;
const HISTORY = { filters: { preset: { type: 'enum', values: SR_PRESETS }, type: { type: 'enum', values: [...SR_ACTIONS, 'booking_started'] } },
  sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const SCANS = { filters: {}, sorts: { newest: null }, maxLimit: 100, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// the same AI subscription gate as the AI Customer Profile assistant (observe mode by default — see ai-entitlement.guard.ts)
@RequiresAiPackage('ai_customer_profile_assistant')
@Controller('pos/service-recommendations')
export class ServiceRecommendationsCenterController {
  constructor(@Inject(SERVICE_RECOMMENDATIONS_CENTER) private readonly sr: ServiceRecommendationsCenter | null) {}
  private r(): ServiceRecommendationsCenter { if (!this.sr) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Service Recommendations needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.sr; }
  private audit(c: RetentionContext, action: string, id: string, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'ai', action, resourceType: 'service_recommendation', resourceId: id, summary, metadata: meta });
  }

  /** the cards from the latest evaluation (Data Unavailable when there is none) */
  @Get('summary') @RequirePermission('pos.ai_customer_profile.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().summary(c)); }

  /** the queue: tab · type · q · service · technician · date dimension + range · sort · pages 10/25/50/100 (newest first) */
  @Get('recommendations') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().list(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** the 360° overlay — audited, fail-closed */
  @Get('recommendations/:id') @RequirePermission('pos.ai_customer_profile.view')
  detail(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, VIEW);
    return run(() => this.r().detail(c, id, { fullContact: can(c, 'pos.customers.export') }, this.audit(c, 'service_recommendation.viewed', id, 'Service recommendation opened')));
  }

  /** Mark reviewed · Defer · Not applicable · Reopen · Note */
  @Post('recommendations/:id/review') @RequirePermission('pos.ai_customer_profile.view')
  review(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(SR_REVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW);
    return run(() => this.r().review(c, id, b ?? {}, this.audit(c, 'service_recommendation.reviewed', id, `Service recommendation review: ${String(b?.action)}`)));
  }

  /** Open AI Booking Assistant — re-checks catalog, qualification and the live calendar; never writes an appointment */
  @Post('recommendations/:id/handoff') @RequirePermission('pos.booking.create')
  handoff(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(SR_HANDOFF_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, VIEW, BOOK);
    return run(() => this.r().handoff(c, id, b ?? {}, { fullContact: can(c, 'pos.customers.export') }, this.audit(c, 'service_recommendation.booking_started', id, 'Service recommendation: Booking Assistant opened')));
  }

  /** review + handoff activity, newest first */
  @Get('history') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().history(c, f ?? {})); }

  /** evaluation (processing) history, newest first */
  @Get('scans') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(SCANS)
  scans(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().scans(c, f ?? {})); }

  /** Refresh — one bounded evaluation per salon (a run inside 60 s is reused) */
  @Post('scan') @RequirePermission('pos.ai_customer_profile.view')
  scan(@Req() q: any, @Body(ValidatedBody(SR_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().scan(c)); }

  /** Check Service Recommendations System — read-only */
  @Post('check') @RequirePermission('pos.ai_customer_profile.view')
  check(@Req() q: any, @Body(ValidatedBody(SR_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
