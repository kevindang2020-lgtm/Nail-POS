// tech-appointments-screen.controller.ts — `/pos/tech-appointments-screen/*`, the read model behind the rebuilt Tech
// Appointments page (Oct 30 2026). Read only: every change goes through TechAppointmentsController / Booking.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { TechAppointmentsScreenRepository, APPT_STATUSES, APPT_SORTS } from './tech-appointments-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';

export const TECH_APPOINTMENTS_SCREEN = 'TechAppointmentsScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const LIST = { filters: { preset: PRESET, status: { type: 'enum', values: APPT_STATUSES }, source: { type: 'enum', values: ['online', 'in_salon', 'all'] }, technicianId: { type: 'uuid' },
  dateField: { type: 'enum', values: ['scheduled', 'created'] }, sort: { type: 'enum', values: APPT_SORTS } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const HISTORY = { filters: { preset: PRESET, changeType: { type: 'enum', values: ['created', 'updated', 'cancelled', 'rescheduled', 'all'] } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const WEEK = { filters: { start: { type: 'text', maxLength: 10 } }, maxLimit: 50, defaultLimit: 12, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/tech-appointments-screen')
export class TechAppointmentsScreenController {
  constructor(@Inject(TECH_APPOINTMENTS_SCREEN) private readonly repo: TechAppointmentsScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The appointments screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('kpis') @RequirePermission('pos.tech_appointments.view')
  kpis(@Req() req: any, @Query() q: any) { return this.r().kpis(teamCtx(req), { date: s(q?.date) }); }

  @Get('appointments') @RequirePermission('pos.tech_appointments.view') @ListQuery(LIST)
  list(@Req() req: any, @Query() q: any) {
    return this.r().list(teamCtx(req), { q: s(q?.q), status: s(q?.status), source: s(q?.source), technicianId: s(q?.technicianId), dateField: s(q?.dateField), sort: s(q?.sort), ...per(q), page: q?.page, pageSize: q?.pageSize });
  }

  @Get('week') @RequirePermission('pos.tech_appointments.view') @ListQuery(WEEK)
  week(@Req() req: any, @Query() q: any) { return this.r().week(teamCtx(req), { start: s(q?.start), page: q?.page, pageSize: q?.pageSize }); }

  @Get('conflicts') @RequirePermission('pos.tech_appointments.view')
  conflicts(@Req() req: any, @Query() q: any) {
    return this.r().conflicts(teamCtx(req), { technicianId: s(q?.technicianId), date: s(q?.date), start: s(q?.start), minutes: q?.minutes, serviceIds: s(q?.serviceIds), appointmentId: s(q?.appointmentId) });
  }

  @Get('history') @RequirePermission('pos.tech_appointments.view') @ListQuery(HISTORY)
  history(@Req() req: any, @Query() q: any) { return this.r().history(teamCtx(req), { q: s(q?.q), changeType: s(q?.changeType), ...per(q), page: q?.page, pageSize: q?.pageSize }); }
}
