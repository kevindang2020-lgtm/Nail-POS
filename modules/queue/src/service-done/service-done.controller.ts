// service-done.controller.ts — tenant POS Service Done HTTP surface (`/pos/service-done/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal + /tickets routes are
// declared BEFORE the bare ':ticketId' so it never shadows them.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { NOTES_BODY, NOTIFY_BODY, REOPEN_BODY, SD_QUALITY_BODY, TECH_ID_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ServiceDoneService, ForbiddenError, ValidationError } from './service-done.service';
import type { ServiceDoneContext } from './service-done.repository';
import type { ServiceDoneFilters } from './service-done.dto';
import { ListQueries } from '@aipowersalon/database';
import { ServiceDoneControllerListQueries } from './service-done.list-queries';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5 (Oct 27 2026)

function ctxFrom(req: any): ServiceDoneContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): ServiceDoneFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, status: q.status, qualityStatus: q.qualityStatus, checkoutStatus: q.checkoutStatus, technicianId: q.technicianId, serviceCategory: q.serviceCategory, station: q.station, page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Service Done mandate (Oct 28 2026): a refusal coded with withCode() carries apiCode, not code — it used to fall through
    // to a bare 400 without its code (the POS could not word it, a 409 conflict looked like a bad request)
    const code = e instanceof ValidationError ? (e.code ?? (e as { apiCode?: string }).apiCode) : undefined;
    if (e instanceof ValidationError && code && isRegisteredCode(code)) throw new HttpException({ message: e.message, code, ...(e.params ? { details: e.params } : {}) }, ERROR_REGISTRY[code].status);   // V-5: the code the POS words in the cashier's language
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(ServiceDoneControllerListQueries)
@Controller('pos/service-done')
export class ServiceDoneController {
  constructor(private readonly svc: ServiceDoneService) {}

  @Get('state') @RequirePermission('pos.service_done.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.service_done.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('technicians') @RequirePermission('pos.service_done.view') techs(@Req() r: any) { return run(() => this.svc.technicians(ctxFrom(r))); }
  @Get('tickets') @RequirePermission('pos.service_done.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.tickets(ctxFrom(r), filtersFrom(q))); }
  @Get('tickets/:ticketId') @RequirePermission('pos.service_done.view') detail(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }

  @Post('tickets/:ticketId/quality-check') @RequirePermission('pos.service_done.quality_check') quality(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SD_QUALITY_BODY, { strict: true })) b: any) { return run(() => this.svc.qualityCheck(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/update-notes') @RequirePermission('pos.service_done.update_notes') notes(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(NOTES_BODY, { strict: true })) b: any) { return run(() => this.svc.updateNotes(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/assign-technician') @RequirePermission('pos.service_done.assign_technician') assignTech(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TECH_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/assign-helper') @RequirePermission('pos.service_done.assign_technician') assignHelper(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TECH_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.assignHelper(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/mark-ready-for-checkout') @RequirePermission('pos.service_done.send_to_checkout') markReady(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.markReady(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/send-to-checkout') @RequirePermission('pos.service_done.send_to_checkout') send(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.sendToCheckout(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/notify-customer') @RequirePermission('pos.service_done.notify_customer') notify(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(NOTIFY_BODY, { strict: true })) b: any) { return run(() => this.svc.notifyCustomer(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/reopen-service') @RequirePermission('pos.service_done.reopen') reopen(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(REOPEN_BODY, { strict: true })) b: any) { return run(() => this.svc.reopen(ctxFrom(r), id, b)); }
}
