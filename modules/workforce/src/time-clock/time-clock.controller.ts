// time-clock.controller.ts — GET /pos/time-clock/state (view) + POST clock-in / clock-out (manage) + break-start /
// break-end (manage_status). Server time only; tenant/branch from the session.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Put, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TimeClockService, TimeClockForbiddenError, TimeClockValidationError, TimeClockConflictError } from './time-clock.service';
import type { TimeClockContext } from './time-clock.dto';
import type { TimeClockBreakBody, TimeClockTechnicianRow, TimeClockBreakPolicyView } from '@aipowersalon/api-contracts/tenant';
import { TIME_CLOCK_BODY, TIME_CLOCK_BREAK_BODY, TIME_CLOCK_INTERRUPT_BODY, BREAK_POLICY_BODY } from '../request-schemas';

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
@Controller('pos/time-clock')
export class TimeClockController {
  constructor(private readonly svc: TimeClockService) {}

  @Get('state') @RequirePermission('pos.technicians.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Post('clock-in') @RequirePermission('pos.technicians.manage')
  clockIn(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY)) b: any) { return run(() => this.svc.clockIn(ctxFrom(r), String(b?.technicianId || ''))); }

  @Post('clock-out') @RequirePermission('pos.technicians.manage')
  clockOut(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY)) b: any) { return run(() => this.svc.clockOut(ctxFrom(r), String(b?.technicianId || ''))); }

  @Post('break-start') @RequirePermission('pos.technicians.manage_status')
  breakStart(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BREAK_BODY)) b: TimeClockBreakBody): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakStart(ctxFrom(r), String(b?.technicianId || ''), { kind: b?.kind === 'lunch' ? 'lunch' : 'break', reason: b?.reason ? String(b.reason) : null })); }

  @Post('break-end') @RequirePermission('pos.technicians.manage_status')
  breakEnd(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_BODY)) b: { technicianId: string }): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakEnd(ctxFrom(r), String(b?.technicianId || ''))); }

  // Fair Turn Engine §36: called back to work during a break — BREAK_INTERRUPTED (the meal is never recorded as full)
  @Post('break-interrupt') @RequirePermission('pos.technicians.manage_status')
  breakInterrupt(@Req() r: any, @Body(ValidatedBody(TIME_CLOCK_INTERRUPT_BODY)) b: any): Promise<TimeClockTechnicianRow> { return run(() => this.svc.breakInterrupt(ctxFrom(r), String(b?.technicianId || ''), b?.reason)); }

  // Fair Turn Engine §35: the salon's break policy (paid / unpaid classification by jurisdiction) — payroll meaning
  @Get('break-policy') @RequirePermission('pos.technicians.view')
  breakPolicy(@Req() r: any): Promise<TimeClockBreakPolicyView> { return run(() => this.svc.breakPolicy(ctxFrom(r))); }
  @Put('break-policy') @RequirePermission('payroll.manage')
  saveBreakPolicy(@Req() r: any, @Body(ValidatedBody(BREAK_POLICY_BODY)) b: any): Promise<TimeClockBreakPolicyView> { return run(() => this.svc.saveBreakPolicy(ctxFrom(r), b ?? {})); }
}
