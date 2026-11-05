// ai-scheduling.data-adapter.ts — BUILD_PLAN Phase 7: the optimizer's READ seam. The engine never queries booking tables
// itself; it asks a SchedDayReader for a DayData (ai-scheduling-day.ts) — the whole branch day as the gate, the scorer and
// the simulation must see it — and for one appointment's current state. The production reader is
// ai-scheduling.booking-read.adapter.ts (booking repository reads + the optimizer's own inputs); tests pass fakes.
import type { SchedCtx } from './ai-scheduling.ports';
import type { DayAppt, DayData } from './ai-scheduling-day';

/** An appointment as the engine needs it: the day fields plus its branch and wall-clock times. */
export interface SchedApptRecord extends DayAppt { branchId: string | null; startTime: string; endTime: string }

export interface SchedDayReader {
  /** The branch's day / minute / zone (branches.timezone). */
  clock(ctx: SchedCtx, branchId: string): Promise<{ today: string; nowMinute: number; timeZone: string }>;
  /** Every input the optimizer reads for one branch day — tenant + branch scoped. */
  loadDay(ctx: SchedCtx, branchId: string, date: string): Promise<DayData>;
  /** One appointment (tenant-scoped; the caller enforces the branch), with its manual-lock flag. */
  appointment(ctx: SchedCtx, appointmentId: string): Promise<SchedApptRecord | null>;
  /** The technician row linked to the signed-in user (view_own filtering). */
  technicianIdForUser(ctx: SchedCtx): Promise<string | null>;
  technicianExists(ctx: SchedCtx, technicianId: string): Promise<boolean>;
  serviceExists(ctx: SchedCtx, serviceId: string): Promise<boolean>;
}
