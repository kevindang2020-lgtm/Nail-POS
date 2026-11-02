// customer-invoices.controller.ts — customer-facing invoices (/customer). The customer is derived from
// the session (customers.user_id = ctx.userId). Mirrors the skip-line-checkout customer controller: a
// customer can list their own invoices and pay a 'sent' one in-app. No RequirePermission — access is
// gated by being a resolved customer (403 'Not a customer account' otherwise).
import { Controller, Get, Post, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { InvoicesService, InvoicesForbiddenError, InvoicesValidationError } from './invoices.service';
import type { InvoicesContext } from './invoices.dto';

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

@Controller('customer/invoices')
export class CustomerInvoicesController {
  constructor(private readonly svc: InvoicesService) {}
  @Get() list(@Req() r: any) { return run(() => this.svc.customerList(ctxFrom(r))); }
  @Get(':id') get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.customerGet(ctxFrom(r), id)); }
  @Post(':id/pay') pay(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.customerPay(ctxFrom(r), id)); }
}
