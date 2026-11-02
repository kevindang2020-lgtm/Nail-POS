// split-payments-screen.controller.ts — Split Payments mandate (Oct 29 2026): the READ side of POS Payments & Money →
// Split Payments (/tenant/payments/split-payments). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role
// from the session. A reporting and investigation module: it reflects Checkout's tender ledger and never moves money.
//   reads   pos.checkout.view    list · summary · registers · :ticketId/detail
//   export  pos.reports.export   export (CSV, one row per ticket, masked contact, audited)
// Refunds / reversals stay on their existing authorised Checkout routes (processor-backed; never a local status flip).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { SplitPaymentsScreenRepository } from './split-payments-screen.repository';
import { pageReq } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const SPLIT_PAYMENTS_SCREEN_REPOSITORY = 'SplitPaymentsScreenRepository';

const SP_LIST = {
  filters: {
    status: { type: 'enum', values: ['pending', 'partially_paid', 'completed', 'failed', 'partially_refunded', 'refunded', 'void'] },
    methods: { type: 'enum', values: ['card_cash', 'gift_card', 'cash_gift', 'card_card', 'three_plus', 'any_gift', 'any_cash'] },
    dateField: { type: 'enum', values: ['completed', 'created', 'tender', 'refund', 'activity'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    register: { type: 'text', maxLength: 64 }, minAmount: { type: 'text', maxLength: 12 }, maxAmount: { type: 'text', maxLength: 12 }, due: { type: 'enum', values: ['0', '1', 'true', 'false'] },
  },
  sorts: { created_desc: null, created_asc: null, completed_desc: null, total_desc: null, total_asc: null, tenders_desc: null, due_desc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/split-payments')
export class SplitPaymentsScreenController {
  constructor(@Inject(SPLIT_PAYMENTS_SCREEN_REPOSITORY) private readonly repo: SplitPaymentsScreenRepository | null) {}
  private r(): SplitPaymentsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Split payments need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('list') @RequirePermission('pos.checkout.view') @ListQuery(SP_LIST)
  list(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const period = await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }); const f = this.r().filters(period, q);
      return { ...(await this.r().list(c, f, pageReq({ page: q.page, pageSize: q.pageSize }))), period, dateBasis: f.basis, sort: f.sort };
    });
  }

  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(SP_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().summary(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get('registers') @RequirePermission('pos.checkout.view')
  registers(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().registers(c)); }

  @AsyncExport({ kind: 'pos.split-payments.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(SP_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="split-payments.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => this.r().exportCsv(c, this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q)));
  }

  @Get(':ticketId/detail') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('ticketId') id: string) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(() => this.r().detail(c, String(id))); }
}
