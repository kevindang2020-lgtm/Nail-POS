import { recordConflict } from '@aipowersalon/observability';
// check-in.controller.ts — tenant POS Check-In HTTP surface (`/pos/check-in/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/recent/
// appointments-ready/customers/search/appointments/search/walk-in/appointment/create-customer/wait-estimate) are
// declared before the bare `:checkInId`.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CI_ASSIGN_BODY, CI_CANCEL_BODY, CI_CREATE_CUSTOMER_BODY, CI_UPDATE_SERVICES_BODY, CI_WAIT_BODY, CI_WALK_IN_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CheckInService, ForbiddenError, ValidationError, DuplicateCustomerError, CheckInAlreadyExistsError } from './check-in.service';
import type { CheckInContext } from './check-in.repository';
import type { CheckInFilters } from './check-in.dto';
import { mapToCheckInState } from './check-in.dto';
import { ListQueries } from '@aipowersalon/database';
import { CheckInControllerListQueries } from './check-in.list-queries';

function ctxFrom(req: any): CheckInContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): CheckInFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, source: q.source, status: q.status, technicianId: q.technicianId, branchId: q.branchId, page: n(q.page), pageSize: n(q.pageSize) }; }
function ids(v: any): string[] { if (!v) return []; return Array.isArray(v) ? v : String(v).split(',').filter(Boolean); }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DuplicateCustomerError) throw new HttpException({ message: e.message, existingCustomerId: e.existingCustomerId }, HttpStatus.CONFLICT);
    if (e instanceof CheckInAlreadyExistsError) { recordConflict('check_in', e.code); throw new HttpException({ message: e.message, code: e.code }, HttpStatus.CONFLICT); }   // Dual-Screen §104
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CheckInControllerListQueries)
@Controller('pos/check-in')
export class CheckInController {
  constructor(private readonly svc: CheckInService) {}

  @Get('state') @RequirePermission('pos.check_in.view') state(@Req() r: any, @Query() q: any) { return run(async () => mapToCheckInState(await this.svc.getState(ctxFrom(r), filtersFrom(q)))); }
  @Get('kpis') @RequirePermission('pos.check_in.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('recent') @RequirePermission('pos.check_in.view') recent(@Req() r: any, @Query() q: any) { return run(() => this.svc.recent(ctxFrom(r), filtersFrom(q))); }
  @Get('appointments-ready') @RequirePermission('pos.check_in.view') ready(@Req() r: any) { return run(() => this.svc.appointmentsReady(ctxFrom(r))); }
  @Get('customers/search') @RequirePermission('pos.customers.view') customerSearch(@Req() r: any, @Query('query') q: string) { return run(() => this.svc.searchCustomers(ctxFrom(r), q || '')); }
  @Get('appointments/search') @RequirePermission('pos.check_in.view') appointmentSearch(@Req() r: any, @Query('query') q: string, @Query('date') date: string) { return run(() => this.svc.searchAppointments(ctxFrom(r), q || '', date)); }
  @Get('wait-estimate') @RequirePermission('pos.check_in.view') waitEstimate(@Req() r: any, @Query('serviceIds') s: any, @Query('technicianId') t: string) { return run(() => this.svc.waitEstimate(ctxFrom(r), ids(s), t)); }

  @Post('walk-in') @RequirePermission('pos.check_in.walk_in') walkIn(@Req() r: any, @Body(ValidatedBody(CI_WALK_IN_BODY)) b: any) { return run(() => this.svc.walkIn(ctxFrom(r), b)); }
  @Post('appointment/:appointmentId') @RequirePermission('pos.check_in.appointment') apptCheckIn(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.appointmentCheckIn(ctxFrom(r), id)); }
  @Post('create-customer') @RequirePermission('pos.customers.create') createCustomer(@Req() r: any, @Body(ValidatedBody(CI_CREATE_CUSTOMER_BODY)) b: any) { return run(() => this.svc.createCustomer(ctxFrom(r), b)); }

  @Get(':checkInId') @RequirePermission('pos.check_in.view') detail(@Req() r: any, @Param('checkInId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Post(':checkInId/update-services') @RequirePermission('pos.check_in.edit') updateServices(@Req() r: any, @Param('checkInId') id: string, @Body(ValidatedBody(CI_UPDATE_SERVICES_BODY)) b: any) { return run(() => this.svc.updateServices(ctxFrom(r), id, b)); }
  @Post(':checkInId/assign-technician') @RequirePermission('pos.check_in.assign_technician') assign(@Req() r: any, @Param('checkInId') id: string, @Body(ValidatedBody(CI_ASSIGN_BODY)) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post(':checkInId/update-wait-estimate') @RequirePermission('pos.check_in.edit') updateWait(@Req() r: any, @Param('checkInId') id: string, @Body(ValidatedBody(CI_WAIT_BODY)) b: any) { return run(() => this.svc.updateWaitEstimate(ctxFrom(r), id, b)); }
  @Post(':checkInId/move-to-queue') @RequirePermission('pos.check_in.move_to_queue') moveQueue(@Req() r: any, @Param('checkInId') id: string) { return run(() => this.svc.moveToQueue(ctxFrom(r), id)); }
  @Post(':checkInId/move-to-tech-queue') @RequirePermission('pos.check_in.move_to_tech_queue') moveTechQueue(@Req() r: any, @Param('checkInId') id: string) { return run(() => this.svc.moveToTechQueue(ctxFrom(r), id)); }
  @Post(':checkInId/start-service') @RequirePermission('pos.check_in.start_service') startService(@Req() r: any, @Param('checkInId') id: string) { return run(() => this.svc.startService(ctxFrom(r), id)); }
  @Post(':checkInId/cancel') @RequirePermission('pos.check_in.cancel') cancel(@Req() r: any, @Param('checkInId') id: string, @Body(ValidatedBody(CI_CANCEL_BODY)) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
}
