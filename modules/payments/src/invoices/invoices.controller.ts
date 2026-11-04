// invoices.controller.ts — /pos/invoices. Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the
// session (req.ctx), never the body.
//
// Invoices mandate (Oct 29 2026) — the one-screen POS page (InvoicesLedgerRepository). Least privilege (spec §14
// "Role-aware access"):
//   pos.checkout.view             list · summary · detail · customer lookup · PDF (preview / print / download)
//   pos.checkout.process_payment  New Invoice (save draft / send) · Send · Record Payment   (front desk included)
//   pos.checkout.void             Edit a draft · Void (reason) · Credit note / refund · Link an unlinked customer · Export   (managers / owners)
// The older routes (GET state, GET :id, POST, POST :id/status) stay for their callers; :id/status can no longer mark an
// invoice paid (money is recorded through payments) or void it without a reason.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, Res, Header, UseGuards, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { InvoicesService, InvoicesForbiddenError, InvoicesValidationError } from './invoices.service';
import { InvoicesLedgerRepository } from './invoices-ledger.repository';
import { renderInvoicePdf } from './invoice-pdf';
import type { InvoicesContext } from './invoices.dto';
import { FinanceError, pageReq, type FinanceCtx } from '../finance-screens/finance-scope';
import { financeCtx, needPermission, runFinance } from '../finance-screens/settlements-screen.controller';

import { CREATE_INVOICE_BODY, INVOICE_STATUS_BODY, INVOICE_DRAFT_BODY, INVOICE_PAYMENT_BODY, INVOICE_VOID_BODY, INVOICE_SEND_BODY, INVOICE_LINK_CUSTOMER_BODY, INVOICE_CREDIT_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
export const INVOICES_LEDGER_REPOSITORY = 'InvoicesLedgerRepository';
function ctxFrom(req: any): InvoicesContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof InvoicesForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof InvoicesValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}
const can = (c: FinanceCtx, p: string) => hasPermission(c as Parameters<typeof hasPermission>[0], p);
const INVOICE_LIST = {
  filters: {
    status: { type: 'enum', values: ['draft', 'sent', 'overdue', 'partially_paid', 'paid', 'credited', 'void', 'all'] },
    preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] },
    dateField: { type: 'enum', values: ['issued', 'due', 'created', 'paid'] },
    amountMin: { type: 'int', min: 0, max: 100_000_000 }, amountMax: { type: 'int', min: 0, max: 100_000_000 }, customerId: { type: 'text', maxLength: 64 },
  },
  sorts: { created_desc: null, created_asc: null, issue_desc: null, issue_asc: null, due_asc: null, due_desc: null, amount_desc: null, amount_asc: null, customer_asc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 12, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService, @Optional() @Inject(INVOICES_LEDGER_REPOSITORY) private readonly ledger?: InvoicesLedgerRepository | null) {}
  private l(): InvoicesLedgerRepository { if (!this.ledger) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Invoices need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.ledger; }
  private async filters(c: FinanceCtx, q: Record<string, unknown>) { return this.l().filters(await this.l().period(c, q), q); }

  // ── the one-screen page ──
  @Get() @RequirePermission('pos.checkout.view') @ListQuery(INVOICE_LIST)
  list(@Req() req: any, @Query('search') search?: string, @Query('status') status?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('dateField') dateField?: string, @Query('amountMin') amountMin?: string, @Query('amountMax') amountMax?: string, @Query('customerId') customerId?: string, @Query('sort') sort?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const f = await this.filters(c, { search, status, preset, from, to, dateField, amountMin, amountMax, customerId, sort });
      return { ...(await this.l().list(c, f, pageReq({ page, pageSize }))), period: f.period, dateBasis: f.basis, sort: f.sort };
    });
  }
  @Get('summary') @RequirePermission('pos.checkout.view') @ListQuery(INVOICE_LIST)
  summary(@Req() req: any, @Query('search') search?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('dateField') dateField?: string, @Query('amountMin') amountMin?: string, @Query('amountMax') amountMax?: string, @Query('customerId') customerId?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const f = await this.filters(c, { search, preset, from, to, dateField, amountMin, amountMax, customerId });
      return { ...(await this.l().summary(c, f)), permissions: { create: can(c, 'pos.checkout.process_payment'), recordPayment: can(c, 'pos.checkout.process_payment'), manage: can(c, 'pos.checkout.void') } };
    });
  }
  @AsyncExport({ kind: 'pos.invoices.export' })
  @Get('export') @RequirePermission('pos.checkout.void') @ListQuery(INVOICE_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="invoices.csv"')
  exportCsv(@Req() req: any, @Query('search') search?: string, @Query('status') status?: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('dateField') dateField?: string, @Query('amountMin') amountMin?: string, @Query('amountMax') amountMax?: string, @Query('customerId') customerId?: string, @Query('sort') sort?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.void');
    return runFinance(async () => this.l().exportCsv(c, await this.filters(c, { search, status, preset, from, to, dateField, amountMin, amountMax, customerId, sort })));
  }
  @Get('customers/lookup') @RequirePermission('pos.checkout.view') @ListQuery({ search: { params: ['search'], maxLength: 100 } })
  lookup(@Req() req: any, @Query('search') search?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(() => this.l().customerLookup(c, search));
  }
  @Get('catalog') @RequirePermission('pos.checkout.process_payment') @ListQuery({ search: { params: ['search'], maxLength: 100 } })
  catalog(@Req() req: any, @Query('search') search?: string) { const c = financeCtx(req); needPermission(c, 'pos.checkout.process_payment'); return runFinance(() => this.l().catalogLookup(c, search)); }

  @Post('new') @RequirePermission('pos.checkout.process_payment')
  createInvoice(@Req() req: any, @Body(ValidatedBody(INVOICE_DRAFT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.process_payment');
    return runFinance(() => this.l().create(c, b ?? {}));
  }
  @Get(':id/detail') @RequirePermission('pos.checkout.view')
  detail(@Req() req: any, @Param('id') id: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const d = await this.l().detail(c, id); if (!d) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      return { ...d, permissions: { recordPayment: can(c, 'pos.checkout.process_payment'), send: can(c, 'pos.checkout.process_payment'), manage: can(c, 'pos.checkout.void') } };
    });
  }
  @Get(':id/pdf') @RequirePermission('pos.checkout.view') @ListQuery({ filters: { disposition: { type: 'enum', values: ['inline', 'attachment'] } } })
  async pdf(@Req() req: any, @Res({ passthrough: true }) res: any, @Param('id') id: string, @Query('disposition') disposition?: string) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.view');
    return runFinance(async () => {
      const d = await this.l().detail(c, id); if (!d) throw new FinanceError('That invoice could not be found.', 'INVOICE_NOT_FOUND', 404);
      const salon = await this.l().salonIdentity(c);
      const buf = renderInvoicePdf({ salon, invoice: { ...d.invoice, customer: d.invoice.customer }, lines: d.lines, payments: d.payments, generatedAt: new Date().toISOString() });
      await this.l().auditDocument(c, id, disposition === 'attachment' ? 'attachment' : 'inline');
      res?.setHeader?.('Content-Type', 'application/pdf');
      res?.setHeader?.('Content-Disposition', `${disposition === 'attachment' ? 'attachment' : 'inline'}; filename="${d.invoice.invoiceNumber}.pdf"`);
      res?.setHeader?.('Cache-Control', 'private, no-store');
      return buf;
    });
  }
  @Post(':id/edit') @RequirePermission('pos.checkout.void')
  edit(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_DRAFT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.void');
    return runFinance(() => this.l().edit(c, id, b ?? {}));
  }
  @Post(':id/send') @RequirePermission('pos.checkout.process_payment')
  send(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_SEND_BODY, { strict: true })) _b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.process_payment');
    return runFinance(() => this.l().send(c, id));
  }
  @Post(':id/payments') @RequirePermission('pos.checkout.process_payment')
  recordPayment(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_PAYMENT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.process_payment');
    return runFinance(() => this.l().recordPayment(c, id, b ?? {}));
  }
  // Invoices guide (Nov 4 2026) §13: a credit note (and the refund of any overpaid part) — managers / owners, like Void
  @Post(':id/credit') @RequirePermission('pos.checkout.void')
  credit(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_CREDIT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.void');
    return runFinance(() => this.l().issueCredit(c, id, b ?? {}));
  }

  @Post(':id/void') @RequirePermission('pos.checkout.void')
  voidInvoice(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_VOID_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.void');
    return runFinance(() => this.l().void(c, id, b?.reason));
  }
  @Post(':id/link-customer') @RequirePermission('pos.checkout.void')
  linkCustomer(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_LINK_CUSTOMER_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'pos.checkout.void');
    return runFinance(() => this.l().linkCustomer(c, id, { customerId: b?.customerId, updateBillTo: b?.updateBillTo === true }));
  }

  // ── older routes (kept for their callers) ──
  @Get('state') @RequirePermission('pos.checkout.view') state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }
  @Get(':id') @RequirePermission('pos.checkout.view') get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.get(ctxFrom(r), id)); }
  @Post() @RequirePermission('pos.checkout.process_payment') create(@Req() r: any, @Body(ValidatedBody(CREATE_INVOICE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), b || {})); }
  @Post(':id/status') @RequirePermission('pos.checkout.process_payment') setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, String(b?.status || ''))); }
}
