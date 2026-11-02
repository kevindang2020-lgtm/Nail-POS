// serving.controller.ts — tenant POS Serving HTTP surface (`/pos/serving/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal + /tickets routes are
// declared BEFORE the bare ':ticketId'; the nested services/:serviceLineId route is its own path.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CLEAR_DELAY_BODY, DELAY_BODY, NOTES_BODY, REOPEN_BODY, SV_ADD_RETAIL_BODY, SV_ADD_SERVICE_BODY, SV_DECISION_BODY, SV_EDIT_SERVICE_BODY, SV_REMOVE_SERVICE_BODY, TECH_ID_BODY, SV_NOTIFY_BODY, SV_STAFF_ALERT_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ServingService, ForbiddenError, ValidationError, ConflictError } from './serving.service';
import type { ServingContext } from './serving.repository';
import type { ServingFilters } from './serving.dto';
import { ListQueries } from '@aipowersalon/database';
import { ServingControllerListQueries } from './serving.list-queries';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5 (Oct 27 2026)

function ctxFrom(req: any): ServingContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): ServingFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, status: q.status, technicianId: q.technicianId, serviceCategory: q.serviceCategory, station: q.station, delayStatus: q.delayStatus, page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Serving mandate §101–§104: a conflict carries its registry code (TECHNICIAN_ALREADY_SERVING, TICKET_CHANGED_RELOAD, …)
    // so the POS words it in the cashier's language — it answered a bare English 409
    if (e instanceof ConflictError) { const code = e.code ?? (e as { apiCode?: string }).apiCode; throw new HttpException(code && isRegisteredCode(code) ? { message: e.message, code } : e.message, HttpStatus.CONFLICT); }
    // V-5: the code the POS words in the cashier's language. `apiCode` is where withCode() puts it — most serving refusals
    // carry it there, and run() read only `code`, so they answered a bare 400 (Serving mandate fix, as in Service Done)
    const coded = e as { apiCode?: string; apiParams?: Record<string, unknown> };
    const vcode = e instanceof ValidationError ? (e.code ?? coded.apiCode) : undefined;
    const details = e instanceof ValidationError ? (e.params ?? coded.apiParams) : undefined;
    if (e instanceof ValidationError && vcode && isRegisteredCode(vcode)) throw new HttpException({ message: e.message, code: vcode, ...(details ? { details } : {}) }, ERROR_REGISTRY[vcode as keyof typeof ERROR_REGISTRY].status);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(ServingControllerListQueries)
@Controller('pos/serving')
export class ServingController {
  constructor(private readonly svc: ServingService) {}

  @Get('change-requests/pending') @RequirePermission('pos.serving.edit_services') pendingChangeRequests(@Req() r: any) { return run(() => this.svc.pendingChangeRequests(ctxFrom(r))); }
  @Post('change-requests/:id/decision') @RequirePermission('pos.serving.edit_services') decideChangeRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SV_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.decideChangeRequest(ctxFrom(r), id, b?.decision === 'reject' ? 'reject' : 'approve')); }
  @Get('state') @RequirePermission('pos.serving.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.serving.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('services') @RequirePermission('pos.serving.view') services(@Req() r: any) { return run(() => this.svc.services(ctxFrom(r))); }
  @Get('technicians') @RequirePermission('pos.serving.view') technicians(@Req() r: any) { return run(() => this.svc.technicians(ctxFrom(r))); }
  @Get('tickets') @RequirePermission('pos.serving.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.tickets(ctxFrom(r), filtersFrom(q))); }
  // Serving mandate §56–§57: advisory balance recommendations (a person applies one through assign-technician)
  @Get('balance-suggestions') @RequirePermission('pos.serving.view') balance(@Req() r: any) { return run(() => this.svc.balanceSuggestions(ctxFrom(r))); }
  // §58: an internal notice to one technician of this salon (technician_notifications)
  @Post('staff-alert') @RequirePermission('pos.serving.assign_technician') staffAlert(@Req() r: any, @Body(ValidatedBody(SV_STAFF_ALERT_BODY, { strict: true })) b: any) { return run(() => this.svc.staffAlert(ctxFrom(r), b ?? {})); }
  @Get('tickets/:ticketId') @RequirePermission('pos.serving.view') detail(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Get('tickets/:ticketId/revisions') @RequirePermission('pos.serving.view') revisions(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.getRevisions(ctxFrom(r), id)); }

  @Post('tickets/:ticketId/start') @RequirePermission('pos.serving.start') start(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.start(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/pause') @RequirePermission('pos.serving.pause_resume') pause(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.pause(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/resume') @RequirePermission('pos.serving.pause_resume') resume(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.resume(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/update-notes') @RequirePermission('pos.serving.update_notes') notes(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(NOTES_BODY, { strict: true })) b: any) { return run(() => this.svc.updateNotes(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/add-service') @RequirePermission('pos.serving.edit_services') addService(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SV_ADD_SERVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.addService(ctxFrom(r), id, b)); }
  // Retail sale: same edit permission as adding a service — whoever may change what is on a ticket may sell a
  // product onto it. Price is resolved server-side from the catalog; the body only names product + quantity.
  @RequirePermission('serving.manage') @Get('retail-catalog') retailCatalog(@Req() r: any, @Query('search') search?: string) { return run(() => this.svc.retailCatalog(ctxFrom(r), search)); }
  @Post('tickets/:ticketId/add-retail') @RequirePermission('pos.serving.edit_services') addRetail(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SV_ADD_RETAIL_BODY, { strict: true })) b: any) { return run(() => this.svc.addRetail(ctxFrom(r), id, b)); }
  @Patch('tickets/:ticketId/services/:serviceLineId') @RequirePermission('pos.serving.edit_services') editService(@Req() r: any, @Param('ticketId') id: string, @Param('serviceLineId') lid: string, @Body(ValidatedBody(SV_EDIT_SERVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.editService(ctxFrom(r), id, lid, b)); }
  @Post('tickets/:ticketId/remove-service') @RequirePermission('pos.serving.edit_services') removeService(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SV_REMOVE_SERVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.removeService(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/assign-technician') @RequirePermission('pos.serving.assign_technician') assignTech(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TECH_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/assign-helper') @RequirePermission('pos.serving.assign_helper') assignHelper(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TECH_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.assignHelper(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/mark-service-done') @RequirePermission('pos.serving.mark_done') markDone(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.markDone(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/send-to-service-done') @RequirePermission('pos.serving.send_to_service_done') send(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.sendToServiceDone(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/reopen') @RequirePermission('pos.serving.send_to_service_done') reopen(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(REOPEN_BODY, { strict: true })) b: any) { return run(() => this.svc.reopenServiceDone(ctxFrom(r), id, b ?? {})); }
  // §72 Send Update: the guest's customer-app feed (SMS answers configured:false — no provider is called from Serving)
  @Post('tickets/:ticketId/notify-customer') @RequirePermission('pos.communications.send') notify(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SV_NOTIFY_BODY, { strict: true })) b: any) { return run(() => this.svc.notifyCustomer(ctxFrom(r), id, b ?? {})); }
  @Post('tickets/:ticketId/report-delay') @RequirePermission('pos.serving.report_delay') reportDelay(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(DELAY_BODY, { strict: true })) b: any) { return run(() => this.svc.reportDelay(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/clear-delay') @RequirePermission('pos.serving.report_delay') clearDelay(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(CLEAR_DELAY_BODY, { strict: true })) b: any) { return run(() => this.svc.clearDelay(ctxFrom(r), id, b)); }
}
