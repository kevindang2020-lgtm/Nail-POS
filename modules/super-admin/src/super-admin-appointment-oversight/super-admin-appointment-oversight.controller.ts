// super-admin-appointment-oversight.controller.ts — SuperAdminGuard-only, read-only Appointment Oversight ›
// Overview. Tenant scope is server-derived via parseScope (raw client tenantId is never trusted; the guard
// restricts this surface to SUPER_ADMIN principals). This route is distinct from /super-admin/booking-checkin
// (Booking & Check-In Monitor), which monitors booking creation + check-in infrastructure — not the same module.

import { safeInet, parseScope, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminAppointmentOversightService } from './super-admin-appointment-oversight.service';
import { SuperAdminAppointmentOversightControllerListQueries } from './super-admin-appointment-oversight.list-queries';

function ctxFrom(r: any) {
  return { userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email, ip: safeInet(r?.ip) ?? undefined };
}

@ListQueries(SuperAdminAppointmentOversightControllerListQueries)
@Controller('super-admin/appointment-oversight')
@UseGuards(SuperAdminGuard)
export class SuperAdminAppointmentOversightController {
  constructor(private readonly svc: SuperAdminAppointmentOversightService) {}

  @Get('overview')
  overview(@Req() r: any, @Query('tenantId') tenantId: unknown) {
    return this.svc.overview(ctxFrom(r), parseScope(tenantId));
  }

  @Get('search')
  search(@Req() r: any, @Query('q') q: unknown, @Query('status') status: unknown, @Query('source') source: unknown, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const s = (v: unknown) => { const x = Array.isArray(v) ? v[0] : v; return x == null ? undefined : String(x); };
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.search(ctxFrom(r), parseScope(tenantId), { q: s(q), status: s(status), source: s(source), page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('duplicates')
  duplicates(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.duplicates(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('overlapping')
  overlapping(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.overlaps(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('change-history')
  changeHistory(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.changeHistory(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('failures')
  failures(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.failures(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('rescheduled')
  rescheduled(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.reschedules(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('missing-info')
  missingInfo(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.missingInfo(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('history')
  history(@Req() r: any, @Query('appointmentId') appointmentId: unknown, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    const id = String(Array.isArray(appointmentId) ? appointmentId[0] : (appointmentId ?? ''));
    return this.svc.appointmentHistory(ctxFrom(r), parseScope(tenantId), id, { page: n(page, 1), pageSize: n(pageSize, 50) });
  }

  @Get('data-integrity')
  dataIntegrity(@Req() r: any, @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('tenantId') tenantId: unknown) {
    const n = (v: unknown, d: number) => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
    return this.svc.dataIntegrity(ctxFrom(r), parseScope(tenantId), { page: n(page, 1), pageSize: n(pageSize, 25) });
  }

  @Get('correction/preview')
  correctionPreview(@Req() r: any, @Query('appointmentId') appointmentId: unknown, @Query('tenantId') tenantId: unknown) {
    const id = String(Array.isArray(appointmentId) ? appointmentId[0] : (appointmentId ?? ''));
    return this.svc.correctionPreview(ctxFrom(r), parseScope(tenantId), id);
  }
}
