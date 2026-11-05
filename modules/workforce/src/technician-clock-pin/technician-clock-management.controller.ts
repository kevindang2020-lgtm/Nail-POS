// technician-clock-management.controller.ts — MANAGER controls for the technician time clock.
// Guarded by TenantAuthGuard + RolePermissionGuard; tenant/branch/actor are server-derived from the session.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TechnicianClockManagementService, ClockManagementError, type ClockManagementCtx } from './technician-clock-management.service';
import { ClockPinValidationError } from './technician-clock-pin.service';
import { CLOCK_PIN_RESET_BODY, TIMECARD_ADJUST_BODY, BREAK_ADJUST_BODY } from '../request-schemas';
import type { TimeClockBreakAdjustResult } from '@aipowersalon/api-contracts/tenant';

function ctxFrom(req: any): ClockManagementCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ClockManagementError) throw new HttpException({ message: e.message, code: e.code }, e.status);
    if (e instanceof ClockPinValidationError) throw new HttpException({ message: e.message, code: 'invalid_pin' }, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/technician-clock')
export class TechnicianClockManagementController {
  constructor(private readonly svc: TechnicianClockManagementService) {}

  // Create or reset a technician's 4-digit Clock PIN.
  @Post('technicians/:technicianId/clock-pin/reset') @RequirePermission('pos.technicians.manage')
  resetPin(@Req() r: any, @Param('technicianId') technicianId: string, @Body(ValidatedBody(CLOCK_PIN_RESET_BODY)) b: any) {
    return run(() => this.svc.resetPin(ctxFrom(r), technicianId, String(b?.pin ?? '')));
  }

  // Correct a timecard entry (a punch). Preserves the original, requires a reason, records the actor + an audit event.
  @Post('timecards/:shiftId/adjust') @RequirePermission('pos.technicians.manage')
  adjust(@Req() r: any, @Param('shiftId') shiftId: string, @Body(ValidatedBody(TIMECARD_ADJUST_BODY)) b: any) {
    return run(() => this.svc.adjustTimecard(ctxFrom(r), shiftId, { startTime: b?.startTime, endTime: b?.endTime, reason: String(b?.reason ?? '') }));
  }

  // Fair Turn §39: correct a break (original kept in the trail, reason required, paid / unpaid re-classified, audited)
  @Post('breaks/:breakId/adjust') @RequirePermission('pos.technicians.manage')
  adjustBreak(@Req() r: any, @Param('breakId') breakId: string, @Body(ValidatedBody(BREAK_ADJUST_BODY)) b: any): Promise<TimeClockBreakAdjustResult> {
    return run(() => this.svc.adjustBreak(ctxFrom(r), breakId, { startedAt: b?.startedAt, endedAt: b?.endedAt, reason: String(b?.reason ?? '') }));
  }
}
