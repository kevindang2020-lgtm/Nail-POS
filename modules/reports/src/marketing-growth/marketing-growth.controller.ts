// marketing-growth.controller.ts — Marketing & Growth Complete Build Guide (Oct 30 2026): `/pos/marketing-growth/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the session (req.ctx), never the body or query.
//   pos.marketing.view    reconciliation (GATE 0) · search (gift-card and customer lookups audited) · activity
//   pos.marketing.view +  journey/:customerId (a customer's marketing history — masked contact, audited fail-closed)
//   pos.customers.view
//   pos.marketing.manage  economics (spend, discount and reward cost — confidential business economics)
// Read-only: nothing here writes a business record or sends anything.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '@aipowersalon/customers';
import { MarketingGrowthRepository, MarketingGrowthError, MG_SCOPES, MG_PRESETS } from './marketing-growth.repository';

export const MARKETING_GROWTH_REPOSITORY = 'MarketingGrowthRepository';

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof MarketingGrowthError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const PERIOD = { preset: { type: 'enum', values: MG_PRESETS }, branch: { type: 'text', maxLength: 40 } } as const;
const ACTIVITY_TYPES = { type: 'text', maxLength: 120 } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/marketing-growth')
export class MarketingGrowthController {
  constructor(@Inject(MARKETING_GROWTH_REPOSITORY) private readonly repo: MarketingGrowthRepository | null) {}
  private r(): MarketingGrowthRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Marketing & Growth needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  /** GATE 0 — every published KPI traced to its source rows, with defects (amount, source, owner, status) */
  @Get('reconciliation') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { preset: { type: 'enum', values: MG_PRESETS } }, search: false, dateRange: { maxDays: 1830 } })
  reconciliation(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().reconciliation(c, { preset: str(f?.preset), from: str(f?.from), to: str(f?.to) })); }

  /** one search box, grouped results; a gift-card or customer lookup is a sensitive read and is audited */
  @Get('search') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { scope: { type: 'enum', values: MG_SCOPES }, branch: { type: 'text', maxLength: 40 } }, sorts: { newest: null }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  search(@Req() q: any, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    return run(async () => {
      const out = await this.r().search(c, { q: f?.q, scope: str(f?.scope), page: f?.page, pageSize: f?.pageSize, branch: str(f?.branch) });
      const hits = out.groups.filter((g: any) => (g.scope === 'gift_cards' || g.scope === 'customers') && g.count > 0);
      if (hits.length) await recordAuditStrict(this.r().db, actor(c), { module: 'marketing', action: 'marketing.search.sensitive', resourceType: 'marketing_search', resourceId: null,
        summary: `Marketing search matched ${hits.map((g: any) => `${g.count} ${g.scope}`).join(', ')}`, after: { scope: out.scope, groups: hits.map((g: any) => g.scope) } });
      return out;
    });
  }

  /** the marketing activity history — newest first, numbered pages, salon-local dates */
  @Get('activity') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { ...PERIOD, type: ACTIVITY_TYPES }, sorts: { newest: null }, search: false, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] })
  activity(@Req() q: any, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    return run(() => this.r().activity(c, { type: f?.type, preset: str(f?.preset), from: str(f?.from), to: str(f?.to), branch: str(f?.branch), page: f?.page, pageSize: f?.pageSize }));
  }

  /** Customer Marketing Journey — one customer's timeline + consent; a sensitive read, audited fail-closed */
  @Get('journey/:customerId') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { ...PERIOD, type: ACTIVITY_TYPES }, sorts: { newest: null }, search: false, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] })
  journey(@Req() q: any, @Param('customerId') id: string, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view', 'pos.customers.view');
    return run(async () => {
      const out = await this.r().journey(c, id, { type: f?.type, preset: str(f?.preset), from: str(f?.from), to: str(f?.to), branch: str(f?.branch), page: f?.page, pageSize: f?.pageSize });
      await recordAuditStrict(this.r().db, actor(c), { module: 'marketing', action: 'marketing.journey.viewed', resourceType: 'customer', resourceId: id, summary: 'Customer Marketing Journey opened' });
      return out;
    });
  }

  /** Marketing Cost & Profit — campaign rows rolled up from Campaign Center; unknown cost is N/A, never 0 */
  @Get('economics') @RequirePermission('pos.marketing.manage')
  @ListQuery({ filters: { preset: { type: 'enum', values: MG_PRESETS }, basis: { type: 'enum', values: ['created', 'completed'] } }, search: false, dateRange: { maxDays: 1830 } })
  economics(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.manage'); return run(() => this.r().economics(c, { preset: str(f?.preset), from: str(f?.from), to: str(f?.to), basis: str(f?.basis) })); }
}
