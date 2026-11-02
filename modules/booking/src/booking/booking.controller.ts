// booking.controller.ts — tenant POS Booking HTTP surface (`/pos/booking/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/
// appointments/conflicts/availability/integration-status) are declared before the bare `:appointmentId`.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Idempotent } from '@aipowersalon/database/nest';   // mandate §31 (Oct 20 2026): a retried create never books twice
import { hasPermission } from '@aipowersalon/permissions';
import { PRICE_OVERRIDE_PERMISSION } from '@aipowersalon/appointments';
import { recordConflict } from '@aipowersalon/observability';
import { BookingResyncRequired } from './booking.dto';
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BookingService, ForbiddenError, ValidationError, ConflictError } from './booking.service';
import type { BookingContext } from './booking.repository';
import type { BookingFilters, PBAvailabilityQuery } from './booking.dto';
import type { BookingTechnicianPage, BookingTechnicianQuery, BookingOpeningsResponse } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { BookingControllerListQueries } from './booking.list-queries';

import { ASSIGN_TECHNICIAN_BODY, BLOCKED_TIME_BODY, CANCEL_APPOINTMENT_BODY, CONFLICT_CHECK_BODY, CREATE_APPOINTMENT_BODY, NO_SHOW_BODY, RESCHEDULE_BODY, UPDATE_APPOINTMENT_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5 (Oct 27 2026)
function ctxFrom(req: any): BookingContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): BookingFilters { const b = (v: any) => (v === undefined || v === '' ? undefined : v === 'true' || v === true); const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { from: q.from, to: q.to, date: q.date, search: q.search, technicianId: q.technicianId, status: q.status, source: q.source, serviceCategory: q.serviceCategory, conflictOnly: b(q.conflictOnly), depositStatus: q.depositStatus, branchId: q.branchId, page: n(q.page), pageSize: n(q.pageSize), ...(q.roster === 'none' ? { roster: 'none' as const } : {}) }; }
/** Merged from the developer tree (Oct 23 2026, mandate §52): a lost booking race answers 409 WITH the day's fresh open times
 *  for the same services (and technician, when one was chosen), so the screen can offer the next slot at once. Best-effort:
 *  a failed availability read never changes the 409. */
const FRESH_LOG = new Logger('BookingConflictFreshAvailability');
async function withFreshAvailability<T>(svc: BookingService, ctx: BookingContext, b: any, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof ConflictError && typeof b?.date === 'string') {
      try { e.freshAvailability = await svc.availability(ctx, { date: b.date, serviceIds: Array.isArray(b.serviceIds) ? b.serviceIds : [], technicianId: b.technicianId || undefined }); }
      catch (err) { FRESH_LOG.warn(`fresh availability for a 409 could not be read (the 409 stands): ${String((err as Error)?.message ?? err).slice(0, 160)}`); }
    }
    throw e;
  }
}
function ids(v: any): string[] { if (!v) return []; return Array.isArray(v) ? v : String(v).split(',').filter(Boolean); }
async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    // Smooth Refresh spec §12/§14: a stable machine `code` on every 409 — APPOINTMENT_CONFLICT / VERSION_CONFLICT /
    // OVERBOOK_CONFIRMATION_REQUIRED — plus the row's current version so the client can refresh just that record.
    if (e instanceof ConflictError) { recordConflict('booking', e.code); throw new HttpException({ message: e.message, code: e.code, conflictingAppointmentId: e.conflictingAppointmentId, currentVersion: e.currentVersion ?? undefined, freshAvailability: e.freshAvailability ?? undefined }, HttpStatus.CONFLICT); }
    if (e instanceof BookingResyncRequired) { recordConflict('booking', e.code); throw new HttpException({ message: e.message, code: e.code, reason: e.reason, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }   // spec §26
    if (e instanceof ValidationError && e.code && isRegisteredCode(e.code)) throw new HttpException({ message: e.message, code: e.code, ...(e.params ? { details: e.params } : {}) }, ERROR_REGISTRY[e.code].status);   // V-5: the code the POS words in the cashier's language
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
  // mandate §31: durable Idempotency-Key (api_idempotency) — a network retry of a "first available" booking used to be able to
  // book a SECOND technician (the EXCLUDE constraint only stops the same technician / time). The POS sends a key per intent.
  @Idempotent() @Post('appointments') @RequirePermission('pos.booking.create') create(@Req() r: any, @Body(ValidatedBody(CREATE_APPOINTMENT_BODY, { strict: true })) b: any) { return run(() => withFreshAvailability(this.svc, ctxFrom(r), b, () => this.svc.create(ctxFrom(r), b))); }
  @Post('conflicts/check') @RequirePermission('pos.booking.view') conflict(@Req() r: any, @Body(ValidatedBody(CONFLICT_CHECK_BODY, { strict: true })) b: any) { return run(() => this.svc.checkConflict(ctxFrom(r), b)); }
  @Get('availability') @RequirePermission('pos.booking.view') availability(@Req() r: any, @Query() q: any) { const query: PBAvailabilityQuery = { date: q.date, serviceIds: ids(q.serviceIds), technicianId: q.technicianId, branchId: q.branchId, technicianIds: ids(q.technicianIds) }; return run(() => this.svc.availability(ctxFrom(r), query)); }
  // 200-technician mandate (Oct 23 2026): the board's technician columns paged on the server (12 a page → 200 = 17 pages),
  // search / working / status / skill / exact-service filters and jump-to-technician (locate). Scope = the session's.
  @Get('technicians') @RequirePermission('pos.booking.view') technicianPage(@Req() r: any, @Query() q: any): Promise<BookingTechnicianPage> {
    const b = (v: any) => v === true || v === 'true' || v === '1';
    const query: BookingTechnicianQuery = { date: q.date, page: q.page != null ? Number(q.page) : undefined, pageSize: q.pageSize != null ? Number(q.pageSize) : undefined, search: q.search ? String(q.search).slice(0, 80) : undefined,
      serviceIds: ids(q.serviceIds), working: b(q.working), status: q.status, skill: q.skill ? String(q.skill).slice(0, 80) : undefined, locate: q.locate ? String(q.locate) : undefined };
    return run(() => this.svc.technicianPage(ctxFrom(r), query));
  }
  // mandate §15–§17: Find an Opening / Best Matches — eligibility first, ranking second, top N + View More (offset)
  @Get('openings') @RequirePermission('pos.booking.view') openings(@Req() r: any, @Query() q: any): Promise<BookingOpeningsResponse> {
    return run(() => this.svc.openings(ctxFrom(r), { date: q.date, serviceIds: ids(q.serviceIds), limit: q.limit != null ? Number(q.limit) : undefined, offset: q.offset != null ? Number(q.offset) : undefined }));
  }
  // Smooth Refresh spec §25: the board's change feed (before the ':appointmentId' routes so 'changes' is never read as an id).
  @Get('changes') @RequirePermission('pos.booking.view') changes(@Req() r: any, @Query('since') since?: string) { return run(() => this.svc.changes(ctxFrom(r), since)); }
  @Get('day-grid') @RequirePermission('pos.booking.view') dayGrid(@Req() r: any, @Query() q: any) { const conflictOnly = q.conflictOnly === undefined || q.conflictOnly === '' ? undefined : q.conflictOnly === 'true' || q.conflictOnly === true; return run(() => this.svc.dayGrid(ctxFrom(r), q.date, ids(q.technicianIds), { search: q.search, status: q.status, source: q.source, serviceCategory: q.serviceCategory, depositStatus: q.depositStatus, conflictOnly })); }
  @Get('integration-status') @RequirePermission('pos.booking.view') integration(@Req() r: any) { return run(() => this.svc.integrationStatus(ctxFrom(r))); }
  @Get('appointments/:appointmentId') @RequirePermission('pos.booking.view') detail(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch('appointments/:appointmentId') @RequirePermission('pos.booking.edit') update(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(UPDATE_APPOINTMENT_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post('appointments/:appointmentId/reschedule') @RequirePermission('pos.booking.reschedule') reschedule(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(RESCHEDULE_BODY, { strict: true })) b: any) { return run(() => withFreshAvailability(this.svc, ctxFrom(r), b, () => this.svc.reschedule(ctxFrom(r), id, b))); }
  @Post('appointments/:appointmentId/arrived') @RequirePermission('pos.booking.check_in') arrived(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.markArrived(ctxFrom(r), id)); }   // Decision 38
  @Post('appointments/:appointmentId/check-in') @RequirePermission('pos.booking.check_in') checkIn(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.checkIn(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/cancel') @RequirePermission('pos.booking.cancel') cancel(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(CANCEL_APPOINTMENT_BODY, { strict: true })) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/no-show') @RequirePermission('pos.booking.no_show') noShow(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(NO_SHOW_BODY, { strict: true })) b: any) { return run(() => this.svc.noShow(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/assign-technician') @RequirePermission('pos.booking.assign_technician') assign(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(ASSIGN_TECHNICIAN_BODY, { strict: true })) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('appointments/:appointmentId/move-to-queue') @RequirePermission('pos.queue.create') moveQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/move-to-tech-queue') @RequirePermission('pos.tech_queue.create') moveTechQueue(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.moveToTechQueue(ctxFrom(r), id)); }
  @Post('appointments/:appointmentId/start-service') @RequirePermission('pos.serving.start') startService(@Req() r: any, @Param('appointmentId') id: string) { return run(() => this.svc.startService(ctxFrom(r), id)); }

  // §9 blocked-time / break write path — same permission tier as appointment edits; audited in the service.
  @Post('blocked-times') @RequirePermission('pos.booking.edit') addBlockedTime(@Req() r: any, @Body(ValidatedBody(BLOCKED_TIME_BODY, { strict: true })) b: any) { return run(() => this.svc.addBlockedTime(ctxFrom(r), b)); }
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
