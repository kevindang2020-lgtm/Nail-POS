// money-overview-screen.controller.ts — Payments & Money mandate (Oct 29 2026): the READ side of POS Payments & Money →
// Overview (/tenant/payments/overview). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role from the
// session. A dashboard — rendering it never moves money; the eight Quick Actions open their own guarded workflows.
//   reads   pos.reports.view   overview · services (View All Services) · payouts (Payouts & Health history) · search
// The Transactions workspace reads /pos/payments/transactions/* (the one ledger view, with its six-filter `kind`).
// The old /pos/payments/overview stays for the dashboard tile.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { MoneyOverviewScreenRepository } from './money-overview-screen.repository';
import { pageReq } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const MONEY_OVERVIEW_SCREEN_REPOSITORY = 'MoneyOverviewScreenRepository';
const PERIOD = { preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } } as const;
const OVERVIEW_Q = { filters: { ...PERIOD, verify: { type: 'bool' } }, search: false, dateRange: { maxDays: 3700 } } as const;   // verify: extras PAYMENTS & MONEY 01
const SERVICES_LIST = { filters: PERIOD, search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PAYOUTS_LIST = { filters: { status: { type: 'enum', values: ['pending', 'paid', 'all'] } }, search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;
const SEARCH_LIST = { filters: PERIOD, search: { params: ['search'], maxLength: 100 }, maxLimit: 8, defaultLimit: 8, dateRange: { maxDays: 3700 } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/money')
export class MoneyOverviewScreenController {
  constructor(@Inject(MONEY_OVERVIEW_SCREEN_REPOSITORY) private readonly repo: MoneyOverviewScreenRepository | null) {}
  private r(): MoneyOverviewScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Payments & Money needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private p(c: ReturnType<typeof financeCtx>, q: Record<string, string>) { return this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); }

  @Get('overview') @RequirePermission('pos.reports.view') @ListQuery(OVERVIEW_Q)
  overview(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    // extras (PAYMENTS & MONEY 01): ?verify=true = One-Click Financial Accuracy — every KPI and total beside a second,
    // full-period read of the same figure (read-only; nothing is corrected)
    if (String(q.verify) === 'true' || String(q.verify) === '1') return runFinance(async () => this.r().accuracy(c, await this.p(c, q)));
    return runFinance(async () => this.r().overview(c, await this.p(c, q)));
  }

  @Get('services') @RequirePermission('pos.reports.view') @ListQuery(SERVICES_LIST)
  services(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => this.r().services(c, await this.p(c, q), pageReq({ page: q.page, pageSize: q.pageSize }), q.search ?? ''));
  }

  @Get('payouts') @RequirePermission('pos.reports.view') @ListQuery(PAYOUTS_LIST)
  payouts(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    const status = q.status === 'paid' || q.status === 'all' ? q.status : 'pending';
    return runFinance(() => this.r().payoutList(c, pageReq({ page: q.page, pageSize: q.pageSize }), { status }));
  }

  @Get('search') @RequirePermission('pos.reports.view') @ListQuery(SEARCH_LIST)
  search(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.view');
    return runFinance(async () => this.r().search(c, await this.p(c, q), String(q.search ?? '')));
  }
}
