// live-schedule-screen.controller.ts — `/pos/live-schedule-screen/*`, the read model beside the canonical Live Technician
// Schedule board (Oct 30 2026): the six KPIs with definitions, one universal search, the schedule activity history and the
// impact of a weekly-shift change before it is saved. Read only — writes stay on their existing routes.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { LiveScheduleScreenRepository, ACTIVITY_KINDS } from './live-schedule-screen.repository';
import { teamCtx, per, PRESET } from './technicians-screen.controller';

export const LIVE_SCHEDULE_SCREEN = 'LiveScheduleScreenRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const ACTIVITY = { filters: { preset: PRESET, kind: { type: 'enum', values: ACTIVITY_KINDS }, technicianId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 8, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const SEARCH = { search: { maxLength: 100 }, maxLimit: 6, defaultLimit: 6 } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/live-schedule-screen')
export class LiveScheduleScreenController {
  constructor(@Inject(LIVE_SCHEDULE_SCREEN) private readonly repo: LiveScheduleScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The live schedule screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('kpis') @RequirePermission('pos.technicians.view')
  kpis(@Req() req: any, @Query() q: any) { return this.r().kpis(teamCtx(req), { date: s(q?.date) }); }

  @Get('search') @RequirePermission('pos.technicians.view') @ListQuery(SEARCH)
  search(@Req() req: any, @Query() q: any) { return this.r().search(teamCtx(req), { q: s(q?.q) }); }

  @Get('activity') @RequirePermission('pos.technicians.view') @ListQuery(ACTIVITY)
  activity(@Req() req: any, @Query() q: any) { return this.r().activity(teamCtx(req), { q: s(q?.q), kind: s(q?.kind), technicianId: s(q?.technicianId), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('shift-impact') @RequirePermission('pos.technicians.view')
  shiftImpact(@Req() req: any, @Query() q: any) {
    return this.r().shiftImpact(teamCtx(req), { technicianId: s(q?.technicianId), dow: q?.dow, working: q?.working, start: s(q?.start), end: s(q?.end), lunchStart: s(q?.lunchStart), lunchEnd: s(q?.lunchEnd) });
  }
}
