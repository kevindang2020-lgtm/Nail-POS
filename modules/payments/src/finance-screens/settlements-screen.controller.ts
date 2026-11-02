// settlements-screen.controller.ts — Deposits & Settlements mandate (Oct 29 2026): `/pos/payments/settlements*`, the server
// side of POS Payments & Money → Deposits & Settlements. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role
// come from the session (req.ctx), never the query. Every route here is READ-ONLY (browsing never moves money, spec §17).
//   reads   pos.reports.view    list (?tab=settlements|refunds) · summary · :id · :id/transactions   (owners / managers —
//                               processor and bank detail is not front-desk information, spec §17)
//   export  pos.reports.export  export (CSV; audited; totals over every filtered record)
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { SettlementsScreenRepository, assertTab, settlementDetailCsv } from './settlements-screen.repository';
import { FinanceError, pageReq, type FinanceCtx } from './finance-scope';

export const SETTLEMENTS_SCREEN_REPOSITORY = 'SettlementsScreenRepository';

export function financeCtx(req: any): FinanceCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
export function needPermission(ctx: FinanceCtx, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
export async function runFinance<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof FinanceError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    throw e;
  }
}

const SETTLEMENT_LIST = {
  filters: {
    tab: { type: 'enum', values: ['settlements', 'refunds'] },
    dateField: { type: 'enum', values: ['settlement_date', 'expected_payout', 'created', 'refund_date'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom'] },
    processor: { type: 'text', maxLength: 40 },
    status: { type: 'enum', values: ['pending', 'settled', 'posted', 'needs_review', 'failed', 'returned', 'requested', 'processing', 'completed', 'reversed', 'all'] },
    bank: { type: 'enum', values: ['unverified', 'partial', 'matched', 'all'] },
  },
  sorts: { created_desc: null, created_asc: null, settled_desc: null, settled_asc: null, gross_desc: null, gross_asc: null, net_desc: null, net_asc: null, amount_desc: null, amount_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const TXN_LIST = { search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/settlements')
export class SettlementsScreenController {
  constructor(@Inject(SETTLEMENTS_SCREEN_REPOSITORY) private readonly repo: SettlementsScreenRepository | null) {}
  private r(): SettlementsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Settlements need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get() @RequirePermission('pos.reports.view') @ListQuery(SETTLEMENT_LIST)
  list(@Req() req: any, @Query('tab') tab?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string,
    @Query('search') search?: string, @Query('processor') processor?: string, @Query('status') status?: string, @Query('bank') bank?: string, @Query('sort') sort?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const t = assertTab(tab); const period = await this.r().period(c, { preset, from, to });
      const q = { dateField: t === 'refunds' ? undefined : dateField, search, processor, status, bank, sort };
      const pr = pageReq({ page, pageSize });
      const items = t === 'refunds' ? await this.r().listRefunds(c, this.r().refundFilters(period, q), pr) : await this.r().listSettlements(c, this.r().settlementFilters(period, q), pr);
      return { tab: t, ...items, period, dateBasis: t === 'refunds' ? 'refund_date' : (this.r().settlementFilters(period, q).basis), dataAsOf: new Date().toISOString() };
    });
  }

  @Get('summary') @RequirePermission('pos.reports.view') @ListQuery(SETTLEMENT_LIST)
  summary(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string,
    @Query('search') search?: string, @Query('processor') processor?: string, @Query('status') status?: string, @Query('bank') bank?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset, from, to });
      // the KPIs follow the toolbar: search and processor apply to both datasets; status / bank apply to settlements only
      const sf = this.r().settlementFilters(period, { dateField, search, processor, status: ['pending', 'settled', 'posted', 'needs_review', 'failed', 'returned'].includes(String(status)) ? status : undefined, bank });
      const rf = this.r().refundFilters(period, { search, processor, status: ['requested', 'processing', 'completed', 'failed', 'reversed'].includes(String(status)) ? status : undefined });
      const [sum, options] = await Promise.all([this.r().summary(c, sf, rf), this.r().options(c)]);
      return { ...sum, options, canExport: hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.reports.export') };
    });
  }

  @AsyncExport({ kind: 'pos.payments.settlements.export' })
  @Get('export') @RequirePermission('pos.reports.export') @ListQuery(SETTLEMENT_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="settlements.csv"')
  exportCsv(@Req() req: any, @Query('tab') tab?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string,
    @Query('search') search?: string, @Query('processor') processor?: string, @Query('status') status?: string, @Query('bank') bank?: string, @Query('sort') sort?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => {
      const t = assertTab(tab); const period = await this.r().period(c, { preset, from, to });
      const sf = this.r().settlementFilters(period, { dateField: t === 'refunds' ? undefined : dateField, search, processor, status: t === 'refunds' ? undefined : status, bank, sort: t === 'refunds' ? undefined : sort });
      const rf = this.r().refundFilters(period, { search, processor, status: t === 'refunds' ? status : undefined, sort: t === 'refunds' ? sort : undefined });
      return this.r().exportCsv(c, t, sf, rf);
    });
  }

  @Get(':settlementId') @RequirePermission('pos.reports.view')
  detail(@Req() req: any, @Param('settlementId') id: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => { const d = await this.r().detail(c, id); if (!d) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404); return d; });
  }

  @AsyncExport({ kind: 'pos.payments.settlement-detail.export' })
  @Get(':settlementId/export') @RequirePermission('pos.reports.export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="settlement-detail.csv"')
  exportDetail(@Req() req: any, @Param('settlementId') id: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => { const d = await settlementDetailCsv(this.r(), c, id); if (d == null) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404); return d; });
  }

  @Get(':settlementId/transactions') @RequirePermission('pos.reports.view') @ListQuery(TXN_LIST)
  transactions(@Req() req: any, @Param('settlementId') id: string, @Query('search') search?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => { const d = await this.r().transactions(c, id, { search, page, pageSize }); if (!d) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404); return d; });
  }
}
