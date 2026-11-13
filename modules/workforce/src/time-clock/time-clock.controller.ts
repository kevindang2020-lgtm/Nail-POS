// time-clock.controller.ts — GET /pos/time-clock/state (view) + POST clock-in / clock-out (manage) + break-start /
// break-end (manage_status). Server time only; tenant/branch from the session.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Put, Body, Req, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TimeClockService, TimeClockForbiddenError, TimeClockValidationError, TimeClockConflictError } from './time-clock.service';
import type { TimeClockContext } from './time-clock.dto';
import type { TimeClockBreakBody, TimeClockTechnicianRow, TimeClockBreakPolicyView, OpeningRushView, ClockInBatchResult } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { TimeClockControllerListQueries } from './time-clock.list-queries';
import { TIME_CLOCK_BATCH_BODY, TIME_CLOCK_BODY, TIME_CLOCK_BREAK_BODY, TIME_CLOCK_INTERRUPT_BODY, BREAK_POLICY_BODY } from '../request-schemas';

function ctxFrom(req: any): TimeClockContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TimeClockForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof TimeClockValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof TimeClockConflictError) throw new HttpException({ message: e.message, code: e.code }, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TimeClockControllerListQueries)
@Controller('pos/time-clock')
export class TimeClockController {
  constructor(private readonly svc: TimeClockService) {}

  // 200-technician §2: ?page&pageSize&search&state → one page of the roster (omitted page = every row, the legacy shape)
  @Get('state') @RequirePermission('pos.technicians.view')
  state(@Req() r: any, @Query() q: any) {
    const n = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
    return run(() => this.svc.getState(ctxFrom(r), { page: n(q?.page), pageSize: n(q?.pageSize), search: q?.search ? String(q.search) : undefined, state: q?.state ? String(q.state) : undefined }));
  }

  @Post('clock-in') @RequirePermission('pos.technicians.manage')
  clockIn(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.clockIn(ctxFrom(r), String(b?.technicianId || ''))); }

  /** 200-Technician 04 — opening rush: scheduled today, not on the clock yet (read only) */
  @Get('opening-rush') @RequirePermission('pos.technicians.view')
  openingRush(@Req() r: any): Promise<OpeningRushView> { return run(() => this.svc.openingRush(ctxFrom(r))); }
  /** 200-Technician 04 — batch clock-in: THE clock-in per technician (≤ 25), each result reported */
  @Post('clock-in-batch') @RequirePermission('pos.technicians.manage')
  clockInBatch(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BATCH_BODY, { strict: true })) b: { technicianIds: string[] }): Promise<ClockInBatchResult> { return run(() => this.svc.clockInBatch(ctxFrom(r), b?.technicianIds ?? [])); }

  @Post('clock-out') @RequirePermission('pos.technicians.manage')
  clockOut(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.clockOut(ctxFrom(r), String(b?.technicianId || ''))); }

  @Post('break-start') @RequirePermission('pos.technicians.manage_status')
  breakStart(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BREAK_BODY, { strict: true })) b: TimeClockBreakBody): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakStart(ctxFrom(r), String(b?.technicianId || ''), { kind: b?.kind === 'lunch' ? 'lunch' : 'break', reason: b?.reason ? String(b.reason) : null })); }

  @Post('break-end') @RequirePermission('pos.technicians.manage_status')
  breakEnd(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY, { strict: true })) b: { technicianId: string }): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakEnd(ctxFrom(r), String(b?.technicianId || ''))); }

  // Fair Turn Engine §36: called back to work during a break — BREAK_INTERRUPTED (the meal is never recorded as full)
  @Post('break-interrupt') @RequirePermission('pos.technicians.manage_status')
  breakInterrupt(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_INTERRUPT_BODY, { strict: true })) b: any): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakInterrupt(ctxFrom(r), String(b?.technicianId || ''), b?.reason)); }

  // Fair Turn Engine §35: the salon's break policy (paid / unpaid classification by jurisdiction) — payroll meaning
  @Get('break-policy') @RequirePermission('pos.technicians.view')
  breakPolicy(@Req() r: any): Promise<TimeClockBreakPolicyView> { return run(() => this.svc.breakPolicy(ctxFrom(r))); }
  @Put('break-policy') @RequirePermission('payroll.manage')
  saveBreakPolicy(@Req() r: any, @Body(ValidatedBody(BREAK_POLICY_BODY, { strict: true })) b: any): Promise<TimeClockBreakPolicyView> { return run(() => this.svc.saveBreakPolicy(ctxFrom(r), b ?? {})); }
}
