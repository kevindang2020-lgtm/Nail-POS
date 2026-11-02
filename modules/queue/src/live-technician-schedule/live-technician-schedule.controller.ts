// live-technician-schedule.controller.ts — HTTP surface for the Live Technician Schedule.
// Mounted under /pos/technicians (alongside the existing TechniciansController — Nest merges routes; the literal
// `live-schedule/*` paths and the new `:technicianId/{live-detail,block-time,start-break,end-break}` actions do not
// collide with the technicians controller's routes). Guards: TenantAuthGuard + RolePermissionGuard; ctx from req.ctx.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { LS_BLOCK_BODY, LS_BOOK_BODY, LS_BREAK_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { LiveTechnicianScheduleService, ForbiddenError, ValidationError, ConflictError } from './live-technician-schedule.service';
import type { LiveScheduleContext } from './live-technician-schedule.repository';
import type { LiveScheduleFilters, LiveTechnicianScheduleState } from './live-technician-schedule.dto';
import type { LiveScheduleWeek } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { LiveTechnicianScheduleControllerListQueries } from './live-technician-schedule.list-queries';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5 (Oct 27 2026)

function ctxFrom(req: any): LiveScheduleContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): LiveScheduleFilters {
  return { date: q.date, view: q.view === 'week' ? 'week' : 'day', status: q.status || undefined, skill: q.skill || undefined, search: q.search || undefined,
    /* 200-technician §2: column paging + no roster */
    ...(q.lanePage !== undefined && q.lanePage !== '' ? { lanePage: Number(q.lanePage) || 1 } : {}),
    ...(q.lanePageSize !== undefined && q.lanePageSize !== '' ? { lanePageSize: Number(q.lanePageSize) || undefined } : {}),
    ...(q.laneSearch ? { laneSearch: String(q.laneSearch).slice(0, 80) } : {}), ...(q.roster === 'none' ? { roster: 'none' as const } : {}) };
}
async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    if (e instanceof ValidationError && e.code && isRegisteredCode(e.code)) throw new HttpException({ message: e.message, code: e.code, ...(e.params ? { details: e.params } : {}) }, ERROR_REGISTRY[e.code].status);   // V-5: the code the POS words in the cashier's language
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(LiveTechnicianScheduleControllerListQueries)
@Controller('pos/technicians')
export class LiveTechnicianScheduleController {
  constructor(private readonly svc: LiveTechnicianScheduleService) {}

  @Get('live-schedule/state') @RequirePermission('pos.technicians.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.pageState(ctxFrom(r), filtersFrom(q))); }
  @Get('live-schedule/kpis') @RequirePermission('pos.technicians.view') kpis(@Req() r: any, @Query() q: any) { return run(() => this.svc.kpis(ctxFrom(r), q.date)); }
  @Get('live-schedule/board') @RequirePermission('pos.technicians.view') board(@Req() r: any, @Query() q: any) { return run(() => this.svc.board(ctxFrom(r), filtersFrom(q))); }
  @Get('live-schedule/week') @RequirePermission('pos.technicians.view') week(@Req() r: any, @Query() q: any): Promise<LiveScheduleWeek<LiveTechnicianScheduleState>> { return run(() => this.svc.week(ctxFrom(r), filtersFrom(q))); }   // merge Oct 12 2026 (FE wave wires the week screen)
  @Post('live-schedule/open-slots/:slotId/book') @RequirePermission('pos.booking.create') book(@Req() r: any, @Param('slotId') slotId: string, @Body(ValidatedBody(LS_BOOK_BODY, { strict: true })) b: any) { return run(() => this.svc.bookOpenSlot(ctxFrom(r), slotId, b || {})); }

  @Get(':technicianId/live-detail') @RequirePermission('pos.technicians.view') detail(@Req() r: any, @Param('technicianId') id: string, @Query() q: any) { return run(() => this.svc.detail(ctxFrom(r), id, q.date)); }
  @Post(':technicianId/block-time') @RequirePermission('pos.technicians.block_time') block(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(LS_BLOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.blockTime(ctxFrom(r), id, b)); }
  @Post(':technicianId/start-break') @RequirePermission('pos.technicians.manage_status') startBreak(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(LS_BREAK_BODY, { strict: true })) b: any) { return run(() => this.svc.startBreak(ctxFrom(r), id, b || {})); }
  @Post(':technicianId/end-break') @RequirePermission('pos.technicians.manage_status') endBreak(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.endBreak(ctxFrom(r), id)); }
}
