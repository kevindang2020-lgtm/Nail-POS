// technician-clock-management.service.ts — the MANAGER controls for the technician time clock:
//   • reset/create a technician's 4-digit Clock PIN (reuses TechnicianClockPinService.setPin — hashed, validated)
//   • correct a timecard entry WITHOUT silently altering history: the original value is preserved in an append-only
//     adjustment trail, a reason is required, the actor is recorded, and an audit event is written.
import { TechnicianClockPinService } from './technician-clock-pin.service';
import type { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export interface ClockManagementCtx { tenantId: string; branchId?: string | null; userId: string; role?: string; }
export interface TimecardShift { id: string; technicianId: string; branchId: string | null; startTime: string | null; endTime: string | null; }
export interface TimecardAdjustmentInput { startTime?: string | null; endTime?: string | null; reason: string; }
export interface AdjustmentChange { field: 'start_time' | 'end_time' | 'break_start' | 'break_end'; originalValue: string | null; newValue: string | null; }

export interface ClockManagementRepository {
  /** Branch-scoped: a manager at branch A cannot read/correct a punch that belongs to branch B. */
  getShift(ctx: ClockManagementCtx, shiftId: string): Promise<TimecardShift | null>;
  /**
   * ONE transaction: append the adjustment trail rows, apply the correction to the punch, write the audit row.
   * The audit write is NOT optional — if it fails, the whole correction rolls back (a silent correction is the bug).
   */
  applyCorrection(ctx: ClockManagementCtx, shift: TimecardShift, changes: AdjustmentChange[], times: { startTime?: string | null; endTime?: string | null }, reason: string, actorId: string): Promise<void>;
  writeAudit(ctx: ClockManagementCtx, action: string, entityId: string, metadata: unknown): Promise<void>;
  /** Fair Turn §39 / 603: the break (branch-scoped) and its correction through the SAME append-only trail. */
  getBreak?(ctx: ClockManagementCtx, breakId: string): Promise<TimecardBreak | null>;
  applyBreakCorrection?(ctx: ClockManagementCtx, brk: TimecardBreak, changes: AdjustmentChange[], times: { startedAt?: string | null; endedAt?: string | null }, reason: string, actorId: string): Promise<void>;
}
export interface TimecardBreak { id: string; technicianId: string; shiftId: string | null; branchId: string | null; kind: string; startedAt: string; endedAt: string | null; interruptedAt: string | null }

export class ClockManagementError extends Error {
  constructor(msg: string, public status = 400, public code = 'clock_management_error') { super(msg); }
}

export class TechnicianClockManagementService {
  constructor(private readonly pins: TechnicianClockPinService, private readonly repo: ClockManagementRepository, private readonly workforce?: WorkforceStatusService | null) {}

  /** Manager creates or resets a technician's Clock PIN. setPin hashes + validates (format + weak-PIN) and clears any
   *  lockout. The plaintext PIN is never stored or logged; the audit records only that a reset happened + by whom. */
  async resetPin(ctx: ClockManagementCtx, technicianId: string, pin: string): Promise<{ ok: true }> {
    if (!technicianId) throw new ClockManagementError('technicianId is required', 400, 'invalid_input');
    await this.pins.setPin({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, technicianId, String(pin ?? ''), ctx.userId);
    await this.repo.writeAudit(ctx, 'technician_clock_pin_reset', technicianId, { by: ctx.userId });
    return { ok: true };
  }

  /** Correct a timecard entry. Preserves the original value in the adjustment trail, requires a reason, records the
   *  actor, then applies the correction and writes an audit event. */
  async adjustTimecard(ctx: ClockManagementCtx, shiftId: string, input: TimecardAdjustmentInput): Promise<{ ok: true; adjustments: number }> {
    const reason = (input.reason || '').trim();
    if (!reason) throw withCode(new ClockManagementError('A correction reason is required.', 400, 'reason_required'), 'CORRECTION_REASON_REQUIRED');

    const shift = await this.repo.getShift(ctx, shiftId);
    if (!shift) throw withCode(new ClockManagementError('Timecard entry not found.', 404, 'not_found'), 'TIMECARD_NOT_FOUND');

    const changes: AdjustmentChange[] = [];
    if (input.startTime !== undefined && (input.startTime ?? null) !== (shift.startTime ?? null)) changes.push({ field: 'start_time', originalValue: shift.startTime, newValue: input.startTime ?? null });
    if (input.endTime !== undefined && (input.endTime ?? null) !== (shift.endTime ?? null)) changes.push({ field: 'end_time', originalValue: shift.endTime, newValue: input.endTime ?? null });
    if (!changes.length) throw withCode(new ClockManagementError('No changes were provided.', 400, 'no_changes'), 'NO_CHANGES');

    const finalStart = input.startTime !== undefined ? input.startTime : shift.startTime;
    const finalEnd = input.endTime !== undefined ? input.endTime : shift.endTime;
    if (finalStart && finalEnd && new Date(finalEnd).getTime() <= new Date(finalStart).getTime()) {
      throw withCode(new ClockManagementError('Clock-out must be after clock-in.', 400, 'invalid_range'), 'CLOCK_OUT_AFTER_IN');
    }

    // Trail + correction + audit in ONE transaction (the adapter decides; the in-memory port is trivially atomic).
    await this.repo.applyCorrection(ctx, shift, changes, { startTime: input.startTime, endTime: input.endTime }, reason, ctx.userId);
    // Closing a still-open punch by correction is a clock-out: move the authoritative workforce state too.
    if (changes.some((c) => c.field === 'end_time' && c.newValue) && !shift.endTime && this.workforce) {
      try { await this.workforce.clockOut(ctx.tenantId, shift.technicianId); } catch { /* already clocked out → nothing to move */ }
    }
    return { ok: true, adjustments: changes.length };
  }

  /** Fair Turn §39–40: correct a break's start / end. The original values stay in the trail, a reason is required, the
   *  paid / unpaid classification is re-stamped from the corrected times (never a silent overwrite). */
  async adjustBreak(ctx: ClockManagementCtx, breakId: string, input: { startedAt?: string | null; endedAt?: string | null; reason: string }): Promise<{ ok: true; adjustments: number }> {
    const reason = (input.reason || '').trim();
    if (!reason) throw withCode(new ClockManagementError('A correction reason is required.', 400, 'reason_required'), 'CORRECTION_REASON_REQUIRED');
    if (!this.repo.getBreak || !this.repo.applyBreakCorrection) throw new ClockManagementError('Break corrections need the database.', 400, 'not_supported');
    const brk = await this.repo.getBreak(ctx, breakId);
    if (!brk) throw withCode(new ClockManagementError('Break not found.', 404, 'not_found'), 'BREAK_NOT_FOUND');
    if (!brk.shiftId) throw withCode(new ClockManagementError('This break is not attached to a timecard — correct the timecard instead.', 400, 'no_shift'), 'BREAK_NOT_ON_TIMECARD');
    const changes: AdjustmentChange[] = [];
    if (input.startedAt !== undefined && input.startedAt && input.startedAt !== brk.startedAt) changes.push({ field: 'break_start', originalValue: brk.startedAt, newValue: input.startedAt });
    if (input.endedAt !== undefined && (input.endedAt ?? null) !== (brk.endedAt ?? null)) changes.push({ field: 'break_end', originalValue: brk.endedAt, newValue: input.endedAt ?? null });
    if (!changes.length) throw withCode(new ClockManagementError('No changes were provided.', 400, 'no_changes'), 'NO_CHANGES');
    const start = input.startedAt ?? brk.startedAt; const end = input.endedAt !== undefined ? input.endedAt : brk.endedAt;
    if ([start, end].some((x) => x && !Number.isFinite(Date.parse(x)))) throw new ClockManagementError('Times must be ISO timestamps.', 400, 'invalid_time');
    if (start && end && Date.parse(end) <= Date.parse(start)) throw withCode(new ClockManagementError('A break must end after it starts.', 400, 'invalid_range'), 'BREAK_END_AFTER_START');
    await this.repo.applyBreakCorrection(ctx, brk, changes, { startedAt: input.startedAt, endedAt: input.endedAt }, reason, ctx.userId);
    return { ok: true, adjustments: changes.length };
  }
}
