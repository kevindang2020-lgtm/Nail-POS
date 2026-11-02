// transactions-screen.controller.ts — Transactions mandate (Oct 29 2026): the READ side of POS Payments & Money → Transactions
// (/tenant/payments/transactions). Guards: TenantAuthGuard + RolePermissionGuard; tenant / location / role from the session.
// A ledger view — it never charges, edits or reverses a payment.
//   reads   pos.checkout.view    list · summary · technicians · :id (the tender, its ticket, refunds, settlement when linked)
//   export  pos.reports.export   export (CSV, every matching tender, masked contact, audited)
// Refund / void / receipt resend stay on the authorised Checkout routes (claim-first, idempotent, step-up):
// POST /pos/checkout/payments/:id/refund · /payments/:id/void · /tickets/:id/receipt/{sms,email,send-all}.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { TransactionsScreenRepository } from './transactions-screen.repository';
import { pageReq } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';

export const TRANSACTIONS_SCREEN_REPOSITORY = 'TransactionsScreenRepository';

const TX_LIST = {
  filters: {
    status: { type: 'enum', values: ['completed', 'partially_refunded', 'refunded', 'voided', 'pending', 'failed'] },
    method: { type: 'enum', values: ['card', 'cash', 'gift_card', 'other'] },
    kind: { type: 'enum', values: ['payments', 'refunds', 'voids', 'pending', 'failed'] },
    dateField: { type: 'enum', values: ['paid', 'created', 'refunded'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    technician: { type: 'text', maxLength: 64 }, minAmount: { type: 'text', maxLength: 12 }, maxAmount: { type: 'text', maxLength: 12 },
  },
  sorts: { created_desc: null, paid_desc: null, created_asc: null, amount_desc: null, amount_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payments/transactions')
export class TransactionsScreenController {
  constructor(@Inject(TRANSACTIONS_SCREEN_REPOSITORY) private readonly repo: TransactionsScreenRepository | null) {}
  private r(): TransactionsScreenRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Transactions need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private async f(c: ReturnType<typeof financeCtx>, q: Record<string, string>) { return this.r().filters(await this.r().period(c, { preset: q.preset, from: q.from, to: q.to }), q); }

  @Get('list') @RequirePermission('pos.checkout.view') @ListQuery(TX_LIST)
  list(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => { const f = await this.f(c, q); return { ...(await this.r().list(c, f, pageReq({ page: q.page, pageSize: q.pageSize }))), period: f.period, dateBasis: f.basis, sort: f.sort }; });
  }

  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(TX_LIST)
  summary(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => this.r().summary(c, await this.f(c, q)));
  }

  @Get('technicians') @RequirePermission('pos.checkout.view')
  technicians(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'pos.checkout.view'); return runFinance(async () => ({ technicians: await this.r().technicians(c) })); }

  @AsyncExport({ kind: 'pos.transactions.export' }) @Get('export') @RequirePermission('pos.reports.export') @ListQuery(TX_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="transactions.csv"')
  exportCsv(@Req() req: any, @Query() q: Record<string, string>) {
    const c = financeCtx(req); needPermission(c, 'pos.reports.export');
    return runFinance(async () => this.r().exportCsv(c, await this.f(c, q)));
  }

  @Get(':paymentId') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('paymentId') paymentId: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(() => this.r().detail(c, String(paymentId)));
  }
}
