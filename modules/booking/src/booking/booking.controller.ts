// booking.controller.ts — tenant POS Booking HTTP surface (`/pos/booking/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/
// appointments/conflicts/availability/integration-status) are declared before the bare `:appointmentId`.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { PRICE_OVERRIDE_PERMISSION } from '@aipowersalon/appointments';
import { recordConflict } from '@aipowersalon/observability';
import { BookingResyncRequired } from './booking.dto';
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { BookingService, ForbiddenError, ValidationError, ConflictError } from './booking.service';
import type { BookingContext } from './booking.repository';
import type { BookingFilters, PBAvailabilityQuery } from './booking.dto';
import type { BookingTechnicianPage, BookingTechnicianQuery } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { BookingControllerListQueries } from './booking.list-queries';

import { ASSIGN_TECHNICIAN_BODY, BLOCKED_TIME_BODY, CANCEL_APPOINTMENT_BODY, CONFLICT_CHECK_BODY, CREATE_APPOINTMENT_BODY, NO_SHOW_BODY, RESCHEDULE_BODY, UPDATE_APPOINTMENT_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): BookingContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): BookingFilters { const b = (v: any) => (v === undefined || v === '' ? undefined : v === 'true' || v === true); const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { from: q.from, to: q.to, date: q.date, search: q.search, technicianId: q.technicianId, status: q.status, source: q.source, serviceCategory: q.serviceCategory, conflictOnly: b(q.conflictOnly), depositStatus: q.depositStatus, branchId: q.branchId, page: n(q.page), pageSize: n(q.pageSize) }; }
function ids(v: any): string[] { if (!v) return []; return Array.isArray(v) ? v : String(v).split(',').filter(Boolean); }
async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Smooth Refresh spec §12/§14: a stable machine `code` on every 409 — APPOINTMENT_CONFLICT / VERSION_CONFLICT /
    // OVERBOOK_CONFIRMATION_REQUIRED — plus the row's current version so the client can refresh just that record.
    if (e instanceof ConflictError) { recordConflict('booking', e.code); throw new HttpException({ message: e.message, code: e.code, conflictingAppointmentId: e.conflictingAppointmentId, currentVersion: e.currentVersion ?? undefined, freshAvailability: (e as any).freshAvailability ?? undefined }, HttpStatus.CONFLICT); }
    if (e instanceof BookingResyncRequired) { recordConflict('booking', e.code); throw new HttpException({ message: e.message, code: e.code, reason: e.reason, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }   // spec §26
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(BookingControllerListQueries)
@Controller('pos/booking')
export class BookingController {
  constructor(private readonly svc: BookingService) {}

  @Get('state') @RequirePermission('pos.booking.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.booking.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('appointments') @RequirePermission('pos.booking.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.appointments(ctxFrom(r), filtersFrom(q))); }
  @Idempotent({ required: false }) @Post('appointments') @RequirePermission('pos.booking.create') create(@Req() r: any, @Body(ValidatedBody(CREATE_APPOINTMENT_BODY)) b: any) {
    return run(async () => {
      try {
        return await this.svc.create(ctxFrom(r), b);
      } catch (e: any) {
        if (e instanceof ConflictError && b?.date) {
          try {
            (e as any).freshAvailability = await this.svc.availability(ctxFrom(r), {
              date: b.date,
              serviceIds: b.serviceIds || [],
              technicianId: b.technicianId,
              branchId: b.branchId || ctxFrom(r).branchId,
            });
          } catch { /* best effort */ }
        }
        throw e;
      }
    });
  }
  @Post('conflicts/check') @RequirePermission('pos.booking.view') conflict(@Req() r: any, @Body(ValidatedBody(CONFLICT_CHECK_BODY)) b: any) { return run(() => this.svc.checkConflict(ctxFrom(r), b)); }
  @Get('availability') @RequirePermission('pos.booking.view') availability(@Req() r: any, @Query() q: any) { const query: PBAvailabilityQuery = { date: q.date, serviceIds: ids(q.serviceIds), technicianId: q.technicianId, branchId: q.branchId }; return run(() => this.svc.availability(ctxFrom(r), query)); }
  @Get('technicians') @RequirePermission('pos.booking.view') technicianPage(@Req() r: any, @Query() q: any): Promise<BookingTechnicianPage> {
    const b = (v: any) => v === true || v === 'true' || v === '1';
    const query: BookingTechnicianQuery = {
      date: q.date,
      page: q.page != null ? Number(q.page) : undefined,
      pageSize: q.pageSize != null ? Number(q.pageSize) : undefined,
      search: q.search ? String(q.search).slice(0, 80) : undefined,
      serviceIds: ids(q.serviceIds),
      working: b(q.working),
      status: q.status,
      skill: q.skill ? String(q.skill).slice(0, 80) : undefined,
      locate: q.locate ? String(q.locate) : undefined,
    };
    return run(() => this.svc.technicianPage(ctxFrom(r), query));
  }
  // Smooth Refresh spec §25: the board's change feed (before the ':appointmentId' routes so 'changes' is never read as an id).
  @Get('changes') @RequirePermission('pos.booking.view') changes(@Req() r: any, @Query('since') since?: string) { return run(() => this.svc.changes(ctxFrom(r), since)); }
  @Get('day-grid') @RequirePermission('pos.booking.view') dayGrid(@Req() r: any, @Query() q: any) { return run(() => this.svc.dayGrid(ctxFrom(r), q.date)); }
  @Get('integration-status') @RequirePermission('pos.booking.view') integration(@Req() r: any) { return run(() => this.svc.integrationStatus(ctxFrom(r))); }
  @Get('appointments/:appointmentId') @RequirePermission('pos.booking.view') detail(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch('appointments/:appointmentId') @RequirePermission('pos.booking.edit') update(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(UPDATE_APPOINTMENT_BODY)) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post('appointments/:appointmentId/reschedule') @RequirePermission('pos.booking.reschedule') reschedule(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(RESCHEDULE_BODY)) b: any) {
    return run(async () => {
      try {
        return await this.svc.reschedule(ctxFrom(r), id, b);
      } catch (e: any) {
        if (e instanceof ConflictError && b?.date) {
          try {
            (e as any).freshAvailability = await this.svc.availability(ctxFrom(r), {
              date: b.date,
              branchId: ctxFrom(r).branchId,
            });
          } catch { /* best effort */ }
        }
        throw e;
      }
    });
  }
  @Post('appointments/:appointmentId/arrived') @RequirePermission('pos.booking.check_in') arrived(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.markArrived(ctxFrom(r), id)); }   // Decision 38
  @Post('appointments/:appointmentId/check-in') @RequirePermission('pos.booking.check_in') checkIn(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.checkIn(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/cancel') @RequirePermission('pos.booking.cancel') cancel(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(CANCEL_APPOINTMENT_BODY)) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/no-show') @RequirePermission('pos.booking.no_show') noShow(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(NO_SHOW_BODY)) b: any) { return run(() => this.svc.noShow(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/assign-technician') @RequirePermission('pos.booking.assign_technician') assign(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(ASSIGN_TECHNICIAN_BODY)) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/move-to-queue') @RequirePermission('pos.queue.create') moveQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/move-to-tech-queue') @RequirePermission('pos.tech_queue.create') moveTechQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToTechQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/start-service') @RequirePermission('pos.serving.start') startService(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.startService(ctxFrom(r), id)); }

  // §9 blocked-time / break write path — same permission tier as appointment edits; audited in the service.
  @Post('blocked-times') @RequirePermission('pos.booking.edit') addBlockedTime(@Req() r: any, @Body(ValidatedBody(BLOCKED_TIME_BODY)) b: any) { return run(() => this.svc.addBlockedTime(ctxFrom(r), b)); }
  @Delete('blocked-times/:blockId') @RequirePermission('pos.booking.edit') removeBlockedTime(@Req() r: any, @Param('blockId') blockId: string) { return run(() => this.svc.removeBlockedTime(ctxFrom(r), blockId)); }

  // §4 role-based permissions — returns the current user's pricing/catalog/add-on permission set from session context.
  @Get('permissions') @RequirePermission('pos.booking.view') permissions(@Req() r: any) {
    // The SAME checks the server enforces (Oct 6 2026). This compared roles in lowercase ('owner', 'manager') — the
    // session carries 'OWNER' / 'MANAGER' — and looked for granular pos.* keys the session never holds (it holds the
    // coarse capabilities), so every flag was false for everyone, owners included, and the screen hid "Edit price".
    const ctx = ctxFrom(r) as any;
    return {
      canOverridePrice: hasPermission(ctx, PRICE_OVERRIDE_PERMISSION),
      canEditCatalog: hasPermission(ctx, 'pos.services.edit'),
      canManageAddOns: hasPermission(ctx, 'pos.services.edit'),
      role: ctx.role || 'staff',
    };
  }
}
