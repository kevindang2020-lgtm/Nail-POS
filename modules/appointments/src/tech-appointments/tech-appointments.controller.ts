// tech-appointments.controller.ts — tenant POS Tech Appointments HTTP surface (`/pos/tech-appointments/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/
// technicians/appointments/conflicts) are declared before the bare `:appointmentId`.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TA_ASSIGN_BODY, TA_CANCEL_BODY, TA_CONFLICT_BODY, TA_CREATE_BODY, TA_RESCHEDULE_BODY, TA_UPDATE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TechAppointmentsService, ForbiddenError, ValidationError, ConflictError } from './tech-appointments.service';
import type { TechApptContext } from './tech-appointments.repository';
import type { TechApptFilters } from './tech-appointments.dto';
import { ListQueries } from '@aipowersalon/database';
import { TechAppointmentsControllerListQueries } from './tech-appointments.list-queries';

function ctxFrom(req: any): TechApptContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): TechApptFilters { const b = (v: any) => (v === undefined || v === '' ? undefined : v === 'true' || v === true); return { date: q.date, search: q.search, technicianId: q.technicianId, status: q.status, source: q.source, serviceCategory: q.serviceCategory, conflictOnly: b(q.conflictOnly), depositStatus: q.depositStatus, branchId: q.branchId }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Smooth Refresh §12/§14 (merge Oct 12 2026): a stable machine `code` on every 409 — APPOINTMENT_CONFLICT / VERSION_CONFLICT (+ the current version)
    if (e instanceof ConflictError) throw new HttpException({ message: e.message, code: e.code, conflictingAppointmentId: e.conflictingAppointmentId, currentVersion: e.currentVersion ?? undefined }, HttpStatus.CONFLICT);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechAppointmentsControllerListQueries)
@Controller('pos/tech-appointments')
export class TechAppointmentsController {
  constructor(private readonly svc: TechAppointmentsService) {}

  @Get('state') @RequirePermission('pos.tech_appointments.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.tech_appointments.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('technicians') @RequirePermission('pos.tech_appointments.view') technicians(@Req() r: any) { return run(() => this.svc.technicians(ctxFrom(r))); }
  @Get('appointments') @RequirePermission('pos.tech_appointments.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.appointments(ctxFrom(r), filtersFrom(q))); }
  @Post('appointments') @RequirePermission('pos.tech_appointments.create') create(@Req() r: any, @Body(ValidatedBody(TA_CREATE_BODY)) b: any) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Post('conflicts/check') @RequirePermission('pos.tech_appointments.view') conflict(@Req() r: any, @Body(ValidatedBody(TA_CONFLICT_BODY)) b: any) { return run(() => this.svc.checkConflict(ctxFrom(r), b, b?.date)); }
  @Get('appointments/:appointmentId') @RequirePermission('pos.tech_appointments.view') detail(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch('appointments/:appointmentId') @RequirePermission('pos.tech_appointments.edit') update(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(TA_UPDATE_BODY)) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post('appointments/:appointmentId/reschedule') @RequirePermission('pos.tech_appointments.reschedule') reschedule(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(TA_RESCHEDULE_BODY)) b: any) { return run(() => this.svc.reschedule(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/check-in') @RequirePermission('pos.tech_appointments.check_in') checkIn(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.checkIn(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/cancel') @RequirePermission('pos.tech_appointments.cancel') cancel(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(TA_CANCEL_BODY)) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/no-show') @RequirePermission('pos.tech_appointments.no_show') noShow(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.noShow(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/assign-technician') @RequirePermission('pos.tech_appointments.assign_technician') assign(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(TA_ASSIGN_BODY)) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/move-to-queue') @RequirePermission('pos.queue.create') moveQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/move-to-tech-queue') @RequirePermission('pos.tech_queue.create') moveTechQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToTechQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/start-service') @RequirePermission('pos.serving.start') startService(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.startService(ctxFrom(r), id)); }
}
