// customer-intelligence-center.controller.ts — Customer Intelligence guide (Nov 1 2026): `/pos/customer-intelligence/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.ai_customer_profile.view   summary (the six cards + their reconciliation) · scan (Refresh; rate-limited) · customers
//                                  (authorized list) · customers/:id (classification + evidence, audited) · scans · check
//   + pos.customers.export          full phone / email (otherwise masked)
// Identity, visits, bookings, duplicates and points stay in their owning modules; this only reads and classifies.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { CustomerIntelligenceCenter, CustomerIntelligenceError, CI_STATUS_FILTERS, CI_FLAGS, CI_DATE_FIELDS, CI_PRESETS } from './customer-intelligence-center';

export const CUSTOMER_INTELLIGENCE_CENTER = 'CustomerIntelligenceCenter';
export const CI_EMPTY_BODY: BodySchema = S.object({});
const VIEW = 'pos.ai_customer_profile.view';

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
    if (e instanceof CustomerIntelligenceError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: {
    status: { type: 'enum', values: CI_STATUS_FILTERS }, flag: { type: 'enum', values: CI_FLAGS }, dateField: { type: 'enum', values: CI_DATE_FIELDS },
    preset: { type: 'enum', values: CI_PRESETS }, branch: { type: 'text', maxLength: 40 },
  },
  sorts: { last_visit: null, recently_added: null, name: null, visits: null, days_since: null }, search: { maxLength: 100 }, dateRange: { maxDays: 7320 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;
const SCANS = { filters: { preset: { type: 'enum', values: CI_PRESETS } }, sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// the same AI subscription gate as the AI Customer Profile assistant (observe mode by default — see ai-entitlement.guard.ts)
@RequiresAiPackage('ai_customer_profile_assistant')
@Controller('pos/customer-intelligence')
export class CustomerIntelligenceCenterController {
  constructor(@Inject(CUSTOMER_INTELLIGENCE_CENTER) private readonly ci: CustomerIntelligenceCenter | null) {}
  private r(): CustomerIntelligenceCenter { if (!this.ci) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer Intelligence needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.ci; }

  /** the six cards from the latest completed scan + the reconciliation (every scanned profile is in exactly one state) */
  @Get('summary') @RequirePermission('pos.ai_customer_profile.view')
  summary(@Req() q: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().summary(c)); }

  /** Refresh: classify every live customer now (rate-limited; a scan inside 60 s is reused) */
  @Post('scan') @RequirePermission('pos.ai_customer_profile.view')
  scan(@Req() q: any, @Body(ValidatedBody(CI_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().scan(c, 'manual')); }

  /** authorized customers with their classification: q (name · phone · email · id · appointment id · technician · service) ·
   *  status · flag · date field + range · sort · pages 10/25/50/100 */
  @Get('customers') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(LIST)
  customers(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().customers(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** one customer's classification + evidence + open duplicate groups — audited, fail-closed */
  @Get('customers/:id') @RequirePermission('pos.ai_customer_profile.view')
  customer(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, VIEW);
    return run(() => this.r().customer(c, id, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'ai', action: 'customer_intelligence.customer_viewed', resourceType: 'customer', resourceId: id, summary: 'Customer intelligence opened', metadata: meta })));
  }

  /** scan history, newest first */
  @Get('scans') @RequirePermission('pos.ai_customer_profile.view')
  @ListQuery(SCANS)
  scans(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().scans(c, f ?? {})); }

  /** Check Customer Intelligence System — read-only; never merges, books, texts, edits profiles or changes points */
  @Post('check') @RequirePermission('pos.ai_customer_profile.view')
  check(@Req() q: any, @Body(ValidatedBody(CI_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, VIEW); return run(() => this.r().check(c)); }
}
