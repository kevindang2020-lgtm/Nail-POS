// invoices.controller.ts — GET /pos/invoices/state, GET /:id, POST (create), POST /:id/status.
// Read: pos.checkout.view. Write: pos.checkout.process_payment (payments-domain manage cap).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { InvoicesService, InvoicesForbiddenError, InvoicesValidationError } from './invoices.service';
import type { InvoicesContext } from './invoices.dto';

import { CREATE_INVOICE_BODY, INVOICE_STATUS_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
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

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/invoices')
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}
  @Get('state') @RequirePermission('pos.checkout.view') state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }
  @Get(':id') @RequirePermission('pos.checkout.view') get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.get(ctxFrom(r), id)); }
  @Post() @RequirePermission('pos.checkout.process_payment') create(@Req() r: any, @Body(ValidatedBody(CREATE_INVOICE_BODY)) b: any) { return run(() => this.svc.create(ctxFrom(r), b || {})); }
  @Post(':id/status') @RequirePermission('pos.checkout.process_payment') setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INVOICE_STATUS_BODY)) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, String(b?.status || ''))); }
}
