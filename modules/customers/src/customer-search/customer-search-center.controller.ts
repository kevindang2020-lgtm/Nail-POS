// customer-search-center.controller.ts — Customer Search Complete Build Guide (Nov 1 2026): `/pos/customer-search/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the query.
//   pos.customers.view     summary · customers · options · customers/:id (the 360° overlay, audited fail-closed) ·
//                          check (read-only diagnostics; records its evidence, one run per salon per 30 s)
//   + pos.customers.export the full phone / email (otherwise masked to the last 4 digits / first letter + domain)
// Basic search follows the core POS customer permission, never the AI package (guide §14): an expired AI Customer
// Profile package hides only the AI panel, not the directory.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { CustomerSearchCenter, CustomerSearchError, CS_STATUSES, CS_BOOKING, CS_DATE_FIELDS, CS_PRESETS } from './customer-search-center';

export const CUSTOMER_SEARCH_CENTER = 'CustomerSearchCenter';
/** POST check — no body */
export const CS_CHECK_BODY: BodySchema = S.object({});

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
    if (e instanceof CustomerSearchError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: {
    status: { type: 'enum', values: CS_STATUSES }, booking: { type: 'enum', values: CS_BOOKING }, dateField: { type: 'enum', values: CS_DATE_FIELDS },
    preset: { type: 'enum', values: CS_PRESETS }, technician: { type: 'uuid' }, service: { type: 'uuid' }, branch: { type: 'text', maxLength: 40 },
  },
  sorts: { relevance: null, newest: null, oldest: null, name: null, last_visit: null, visits: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-search')
export class CustomerSearchCenterController {
  constructor(@Inject(CUSTOMER_SEARCH_CENTER) private readonly cs: CustomerSearchCenter | null) {}
  private r(): CustomerSearchCenter { if (!this.cs) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer Search needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cs; }

  /** the KPI row — every number states its definition; customers are tenant-wide, activity is scoped to the branches */
  @Get('summary') @RequirePermission('pos.customers.view')
  summary(@Req() q: any, @Query('branch') branch?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().summary(c, { branch, preset, from, to }));
  }

  /** search + directory: q (name · phone · email · customer / appointment / ticket id) · status · booking · technician · service ·
   *  branch · date field + range · sort · pages 10/25/50/100 */
  @Get('customers') @RequirePermission('pos.customers.view')
  @ListQuery(LIST)
  search(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().search(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** filter options from real rows only */
  @Get('options') @RequirePermission('pos.customers.view')
  options(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().options(c)); }

  /** Check Customer Search System — read-only; records what it observed; never merges, books or sends */
  @Post('check') @RequirePermission('pos.customers.view')
  check(@Req() q: any, @Body(ValidatedBody(CS_CHECK_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().check(c)); }

  /** the Customer 360° overlay — read-only; every open is audited (fail-closed) */
  @Get('customers/:id') @RequirePermission('pos.customers.view')
  profile(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    const fullContact = can(c, 'pos.customers.export');
    return run(() => this.r().profile(c, id, { fullContact, audit: (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'customer_search.profile_viewed', resourceType: 'customer', resourceId: id, summary: 'Customer 360° opened from Customer Search', metadata: meta }) }));
  }
}
