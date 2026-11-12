// liveScheduleChecks.ts — two read-only helpers for the Live Technician Schedule (extras backlog, Nov 2026):
//   presenceBadge  — Shift-vs-Clock-In (#04): the PLANNED shift and the time clock's PHYSICAL presence side by side, each
//                    with its own true label. A clock the server did not report is "unknown", never "clocked out".
//   scheduleHealth — One-click Schedule Health (#02): checks over the board already on screen — double-booked times,
//                    appointments outside / without a scheduled shift, blocked time over an appointment, a stale read, and
//                    whether the KPI row agrees with the board. Nothing is changed, booked or moved.
// Pure; no i18n here — the screen turns the codes into words.

export type ClockState = 'clocked_in' | 'on_break' | 'clocked_out' | null | undefined;
export interface BoardAppt { appointmentId: string; customerName?: string; startTime: string; endTime: string; status: string }
export interface BoardBlock { blockId: string; startTime: string; endTime: string }
export interface BoardCol {
  technicianId: string; fullName: string; status?: string;
  shift?: { startTime: string; endTime: string } | null; shiftScheduled?: boolean; clock?: ClockState;
  appointments?: BoardAppt[]; blocks?: BoardBlock[];
}

export type PresenceCode =
  | 'on_shift_in'          // scheduled and clocked in
  | 'on_shift_break'       // scheduled and on break (clocked in)
  | 'expected_not_in'      // scheduled, the shift has started, not clocked in
  | 'scheduled_later'      // scheduled, the shift has not started yet, not clocked in
  | 'shift_over_out'       // scheduled, the shift has ended, clocked out
  | 'in_no_shift'          // clocked in (or on break) without a scheduled shift
  | 'off'                  // no scheduled shift, clocked out
  | 'clock_unknown';       // the server has no clock record
export interface Presence { code: PresenceCode; tone: 'ok' | 'warn' | 'bad' | 'mut' }

const mins = (t: string | undefined | null) => { const [h, m] = String(t ?? '').split(':').map((x) => parseInt(x, 10)); return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : NaN; };

/** Planned vs present. `live` false (a past or future day) → null: presence only means something for today. */
export function presenceBadge(c: BoardCol, live: boolean, nowMinute: number | null): Presence | null {
  if (!live) return null;
  const scheduled = !!c.shift && c.shiftScheduled !== false;
  const clock = c.clock;
  if (clock === 'clocked_in') return scheduled ? { code: 'on_shift_in', tone: 'ok' } : { code: 'in_no_shift', tone: 'warn' };
  if (clock === 'on_break') return scheduled ? { code: 'on_shift_break', tone: 'warn' } : { code: 'in_no_shift', tone: 'warn' };
  if (clock !== 'clocked_out') return { code: 'clock_unknown', tone: 'mut' };
  if (!scheduled) return { code: 'off', tone: 'mut' };
  const s = mins(c.shift!.startTime), e = mins(c.shift!.endTime);
  if (nowMinute == null || !Number.isFinite(s)) return { code: 'expected_not_in', tone: 'bad' };
  if (nowMinute < s) return { code: 'scheduled_later', tone: 'mut' };
  if (Number.isFinite(e) && nowMinute >= e) return { code: 'shift_over_out', tone: 'mut' };
  return { code: 'expected_not_in', tone: 'bad' };
}

const DEAD = new Set(['cancelled', 'canceled', 'no_show']);
export type HealthCode = 'conflicts' | 'outside_shift' | 'no_shift' | 'blocked_over_appt' | 'stale' | 'kpi_wiring';
export interface HealthFinding { technician?: string; detail: string }
export interface HealthCheck { code: HealthCode; state: 'pass' | 'warn' | 'not_checked'; findings: HealthFinding[]; reason?: 'paged' | 'not_live' | 'no_kpis' }
export interface HealthInput {
  cols: BoardCol[];
  /** minutes since the board was last read successfully (null = never read) */
  ageMinutes: number | null;
  live: boolean;
  /** the KPI row for the same day (null when it did not load) */
  kpis: { appointments?: number | null; workingToday?: number | null } | null;
  /** true when the board shows the whole salon (no filter, one page) — the KPI totals are only comparable then */
  wholeRoster: boolean;
  staleAfterMinutes?: number;
}
const span = (a: { startTime: string; endTime: string }) => `${a.startTime}–${a.endTime}`;

export function scheduleHealth(i: HealthInput): HealthCheck[] {
  const conflicts: HealthFinding[] = [], outside: HealthFinding[] = [], noShift: HealthFinding[] = [], blocked: HealthFinding[] = [];
  let liveAppts = 0;
  for (const c of i.cols) {
    const appts = (c.appointments ?? []).filter((a) => !DEAD.has(String(a.status)));
    liveAppts += appts.length;
    const sorted = [...appts].sort((x, y) => mins(x.startTime) - mins(y.startTime));
    for (let k = 1; k < sorted.length; k++) for (let j = 0; j < k; j++)
      if (mins(sorted[j].endTime) > mins(sorted[k].startTime)) conflicts.push({ technician: c.fullName, detail: `${span(sorted[j])} × ${span(sorted[k])}` });
    const scheduled = !!c.shift && c.shiftScheduled !== false;
    for (const a of appts) {
      if (!scheduled) noShift.push({ technician: c.fullName, detail: `${span(a)}${a.customerName ? ` · ${a.customerName}` : ''}` });
      else if (mins(a.startTime) < mins(c.shift!.startTime) || mins(a.endTime) > mins(c.shift!.endTime)) outside.push({ technician: c.fullName, detail: `${span(a)} / ${span(c.shift!)}` });
      for (const b of c.blocks ?? []) if (mins(b.startTime) < mins(a.endTime) && mins(b.endTime) > mins(a.startTime)) blocked.push({ technician: c.fullName, detail: `${span(b)} × ${span(a)}` });
    }
  }
  const st = (f: HealthFinding[]): 'pass' | 'warn' => (f.length ? 'warn' : 'pass');
  const out: HealthCheck[] = [
    { code: 'conflicts', state: st(conflicts), findings: conflicts },
    { code: 'outside_shift', state: st(outside), findings: outside },
    { code: 'no_shift', state: st(noShift), findings: noShift },
    { code: 'blocked_over_appt', state: st(blocked), findings: blocked },
  ];
  const limit = i.staleAfterMinutes ?? 5;
  if (!i.live) out.push({ code: 'stale', state: 'not_checked', findings: [], reason: 'not_live' });
  else out.push(i.ageMinutes == null || i.ageMinutes > limit ? { code: 'stale', state: 'warn', findings: [{ detail: i.ageMinutes == null ? '—' : String(i.ageMinutes) }] } : { code: 'stale', state: 'pass', findings: [] });
  if (!i.kpis) out.push({ code: 'kpi_wiring', state: 'not_checked', findings: [], reason: 'no_kpis' });
  else if (!i.wholeRoster) out.push({ code: 'kpi_wiring', state: 'not_checked', findings: [], reason: 'paged' });
  else {
    const f: HealthFinding[] = [];
    if (i.kpis.appointments != null && i.kpis.appointments !== liveAppts) f.push({ detail: `${i.kpis.appointments} / ${liveAppts}` });   // KPI appointments / board appointments
    out.push({ code: 'kpi_wiring', state: st(f), findings: f });
  }
  return out;
}
