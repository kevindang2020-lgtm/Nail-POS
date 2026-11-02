// technician-time-off.controller.ts — HTTP surface for time off (technician_time_off, 528 + 582). Merge Oct 12 2026.
//   Tech app (own):  GET /tech/time-off · POST /tech/time-off · DELETE /tech/time-off/:id (withdraw a pending request)
//   POS (manager):   GET /pos/technicians/time-off/pending · GET|POST /pos/technicians/:technicianId/time-off ·
//                    POST /pos/technicians/:technicianId/time-off/:id/decision { decision: approved|rejected, note? }
// Tenant / branch / actor come from the session. The tech routes resolve the technician from the session user — a client
// can never name another technician. Status vocabulary is ours (pending | approved | rejected | cancelled).
import { Controller, Get, Post, Delete, Body, Param, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQueries } from '@aipowersalon/database';
import { TechnicianTimeOffService, TimeOffError, type TimeOffCtx } from './technician-time-off.service';
import { TIME_OFF_REQUEST_BODY, TIME_OFF_CREATE_BODY, TIME_OFF_DECISION_BODY } from '../request-schemas';
import { TechTimeOffListQueries, PosTimeOffListQueries } from './technician-time-off.list-queries';
import type { TimeOffEntry, TimeOffRequestBody, TimeOffCreateBody, TimeOffDecisionBody, TimeOffWithdrawResult } from '@aipowersalon/api-contracts/tenant';

function ctxFrom(req: any): TimeOffCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TimeOffError) throw new HttpException({ message: e.message, code: e.code }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechTimeOffListQueries)
@Controller('tech/time-off')
export class TechTimeOffController {
  constructor(private readonly svc: TechnicianTimeOffService) {}
  @Get() @RequirePermission('tech.schedule.view')
  list(@Req() r: any, @Query() q: any): Promise<TimeOffEntry[]> { return run(() => this.svc.listMine(ctxFrom(r), { status: q?.status, from: q?.from, to: q?.to })); }
  @Post() @RequirePermission('tech.time_off.request')
  request(@Req() r: any, @Body(ValidatedBody(TIME_OFF_REQUEST_BODY, { strict: true })) b: TimeOffRequestBody): Promise<TimeOffEntry> { return run(() => this.svc.requestMine(ctxFrom(r), { startsAt: String(b?.startsAt ?? ''), endsAt: String(b?.endsAt ?? ''), kind: b?.kind ?? null, reason: b?.reason ?? null })); }
  @Delete(':id') @RequirePermission('tech.time_off.request')
  cancel(@Req() r: any, @Param('id') id: string): Promise<TimeOffWithdrawResult> { return run(() => this.svc.cancelMine(ctxFrom(r), id)); }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PosTimeOffListQueries)
@Controller('pos/technicians')
export class TechnicianTimeOffController {
  constructor(private readonly svc: TechnicianTimeOffService) {}
  @Get('time-off/pending') @RequirePermission('pos.technicians.view')
  pending(@Req() r: any): Promise<TimeOffEntry[]> { return run(() => this.svc.listPending(ctxFrom(r))); }
  @Get(':technicianId/time-off') @RequirePermission('pos.technicians.view')
  list(@Req() r: any, @Param('technicianId') id: string, @Query() q: any): Promise<TimeOffEntry[]> { return run(() => this.svc.listFor(ctxFrom(r), id, { status: q?.status, from: q?.from, to: q?.to })); }
  @Post(':technicianId/time-off') @RequirePermission('pos.technicians.schedule.edit')
  create(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TIME_OFF_CREATE_BODY, { strict: true })) b: TimeOffCreateBody): Promise<TimeOffEntry> { return run(() => this.svc.createFor(ctxFrom(r), id, { startsAt: String(b?.startsAt ?? ''), endsAt: String(b?.endsAt ?? ''), kind: b?.kind ?? null, reason: b?.reason ?? null, allBranches: b?.allBranches === true })); }
  @Post(':technicianId/time-off/:id/decision') @RequirePermission('pos.technicians.schedule.edit')
  decide(@Req() r: any, @Param('technicianId') id: string, @Param('id') reqId: string, @Body(ValidatedBody(TIME_OFF_DECISION_BODY, { strict: true })) b: TimeOffDecisionBody): Promise<TimeOffEntry> { return run(() => this.svc.decide(ctxFrom(r), id, reqId, String(b?.decision ?? ''), b?.note ?? null)); }
}
