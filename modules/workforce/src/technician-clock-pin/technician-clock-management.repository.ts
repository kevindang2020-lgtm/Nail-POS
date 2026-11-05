// In-memory ClockManagementRepository — module fallback when no Postgres, and the test seam. The Kysely
// implementation (real technician_shifts + technician_timecard_adjustments + audit_logs) lives alongside.
import type { ClockManagementRepository, ClockManagementCtx, TimecardShift, AdjustmentChange } from './technician-clock-management.service';
export type { ClockManagementRepository } from './technician-clock-management.service';

interface AdjRow { shiftId: string; technicianId: string; field: string; originalValue: string | null; newValue: string | null; reason: string; adjustedBy: string; }

export class InMemoryClockManagementRepository implements ClockManagementRepository {
  private readonly shifts = new Map<string, TimecardShift>();
  readonly adjustments: AdjRow[] = [];
  readonly audits: { action: string; entityId: string; metadata: unknown }[] = [];

  seedShift(s: TimecardShift) { this.shifts.set(s.id, { ...s }); }

  async getShift(_ctx: ClockManagementCtx, shiftId: string): Promise<TimecardShift | null> {
    const s = this.shifts.get(shiftId); return s ? { ...s } : null;
  }
  async applyCorrection(ctx: ClockManagementCtx, shift: TimecardShift, changes: AdjustmentChange[], times: { startTime?: string | null; endTime?: string | null }, reason: string, actorId: string): Promise<void> {
    for (const c of changes) this.adjustments.push({ shiftId: shift.id, technicianId: shift.technicianId, field: c.field, originalValue: c.originalValue, newValue: c.newValue, reason, adjustedBy: actorId });
    const s = this.shifts.get(shift.id); if (!s) return;
    if (times.startTime !== undefined) s.startTime = times.startTime;
    if (times.endTime !== undefined) s.endTime = times.endTime;
    await this.writeAudit(ctx, 'technician_timecard_adjusted', shift.id, { technicianId: shift.technicianId, fields: changes.map((c) => c.field), reason });
  }
  async writeAudit(_ctx: ClockManagementCtx, action: string, entityId: string, metadata: unknown): Promise<void> {
    this.audits.push({ action, entityId, metadata });
  }
}
