// time-clock.dto.ts — technician time clock (clock-in / clock-out). This is the WRITE PATH for the
// existing technician_shifts table (id, technician_id, shift_date, start_time, end_time, status), which
// until now was read-only. Status semantics reused from the codebase: 'scheduled' (not clocked in),
// 'active' (clocked in), 'completed' (clocked out). Hours are computed from start/end timestamps.

export interface TimeClockContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type ClockState = 'clocked_in' | 'on_break' | 'clocked_out' | 'off';

export interface ShiftPunch {
  id: string;
  technicianId: string;
  /** The salon-LOCAL calendar date the punch belongs to (YYYY-MM-DD in the branch timezone). */
  shiftDate?: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
}

/** A break row (technician_breaks, 580) — part of the clock, not a free-form status flag. */
export interface BreakRow {
  id: string;
  technicianId: string;
  shiftId: string | null;
  kind: string;             // break | lunch
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
  startedBy: string | null;
  endedBy: string | null;
  /** migration 603: the break policy's classification (set on break end / clock out); null while open */
  classification?: string | null;
  paidMinutes?: number | null;
  unpaidMinutes?: number | null;
  interruptedAt?: string | null;
}

export interface TechnicianClockRow {
  technicianId: string;
  technicianName: string | null;
  state: ClockState;
  clockedInAt: string | null;
  onBreakSince: string | null;
  lastClockOutAt: string | null;
  hoursToday: number;       // sum of completed + in-progress time today, 2 dp
  shiftCount: number;
  shifts: ShiftPunch[];     // the technician's individual punches today (id + times), so a manager can correct one
  /** today's breaks with their policy classification (Fair Turn §35–40) — a manager can correct one */
  breaks?: { id: string; kind: string; startedAt: string; endedAt: string | null; classification: string | null; paidMinutes: number | null; unpaidMinutes: number | null; interrupted: boolean }[];
}

export interface TimeClockSummary {
  technicianCount: number;
  clockedInCount: number;
  totalHoursToday: number;
}

export interface TimeClockState { kpis: TimeClockSummary; technicians: TechnicianClockRow[]; }

export const ACTIVE_STATUS = 'active';
export const CLOCKED_OUT_STATUS = 'completed';

// Hours between two ISO timestamps (end defaults to now), floored at 0, 2 dp.
export function computeHoursWorked(startIso: string | null, endIso: string | null, nowIso: string): number {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso || nowIso).getTime();
  if (!isFinite(start) || !isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 100) / 100;
}

// Is this technician currently clocked in (an active punch with a start and no end)?
export function isActivePunch(p: ShiftPunch): boolean {
  return p.status === ACTIVE_STATUS && !!p.startTime && !p.endTime;
}

// Derive a technician's clock state for today from their punches.
export function deriveTechClock(technicianId: string, technicianName: string | null, punches: ShiftPunch[], nowIso: string, breaks: BreakRow[] = []): TechnicianClockRow {
  const mine = punches.filter((p) => p.technicianId === technicianId);
  const active = mine.find(isActivePunch);
  const openBreak = active ? breaks.find((b) => b.technicianId === technicianId && !b.endedAt) : undefined;
  const hoursToday = Math.round(mine.reduce((a, p) => a + computeHoursWorked(p.startTime, p.endTime, nowIso), 0) * 100) / 100;
  const completed = mine.filter((p) => p.endTime).sort((a, b) => new Date(b.endTime!).getTime() - new Date(a.endTime!).getTime());
  return {
    technicianId, technicianName,
    state: active ? (openBreak ? 'on_break' : 'clocked_in') : (completed.length ? 'clocked_out' : 'off'),
    clockedInAt: active?.startTime ?? null,
    onBreakSince: openBreak?.startedAt ?? null,
    lastClockOutAt: completed[0]?.endTime ?? null,
    hoursToday,
    shiftCount: mine.filter((p) => p.startTime).length,
    shifts: [...mine].sort((a, b) => (a.startTime ? new Date(a.startTime).getTime() : 0) - (b.startTime ? new Date(b.startTime).getTime() : 0)),
    breaks: breaks.filter((b) => b.technicianId === technicianId).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((b) => ({ id: b.id, kind: b.kind, startedAt: b.startedAt, endedAt: b.endedAt, classification: b.classification ?? null, paidMinutes: b.paidMinutes ?? null, unpaidMinutes: b.unpaidMinutes ?? null, interrupted: !!b.interruptedAt })),
  };
}

export function buildTimeClockSummary(rows: TechnicianClockRow[]): TimeClockSummary {
  return {
    technicianCount: rows.length,
    clockedInCount: rows.filter((r) => r.state === 'clocked_in' || r.state === 'on_break').length,
    totalHoursToday: Math.round(rows.reduce((a, r) => a + r.hoursToday, 0) * 100) / 100,
  };
}
