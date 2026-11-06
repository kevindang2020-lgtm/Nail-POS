// ai-scheduling-day-context.ts — A5 AI Scheduling Optimizer, the parts left "for a decision" (Nov 6 2026; Kevin: "continue
// finish all"): the technician's FULL DAY around a recommendation, and the before / after preview of the neighbouring
// bookings — the new gaps and conflicts next to the proposed slot, measured with the same day model the optimizer uses
// (detectDay), at preview time (the day is read fresh). Pure: the reader fills DayData, this only computes.
import { detectDay, hhmm, isLockedAppt, withMove, INACTIVE_STATUSES, type DayData, type DayAppt } from './ai-scheduling-day';

export interface DayContextItem { appointmentId: string; start: string; end: string; services: string[]; status: string; locked: boolean; moving: boolean }
export interface DayContextSide {
  technicianId: string | null; technicianName: string | null;
  shifts: { start: string; end: string }[]; breaks: { start: string; end: string }[];
  items: DayContextItem[];
  gaps: { start: string; end: string; minutes: number }[];
  conflicts: { type: string; severity: string; message: string }[];
}
export interface DayContext {
  date: string; timeZone: string; appointmentId: string;
  proposed: { start: string; end: string; technicianId: string | null };
  neighbours: { previous: DayContextItem | null; next: DayContextItem | null; gapBeforeMin: number | null; gapAfterMin: number | null };
  before: DayContextSide; after: DayContextSide;
  change: { newGaps: number; closedGaps: number; newConflicts: number; resolvedConflicts: number };
}

const cfgDefault = { gapMinServiceMin: 15, largeBlockMin: 120 };
const span = (r: { start: number; end: number }) => ({ start: hhmm(r.start), end: hhmm(r.end) });

function side(day: DayData, techId: string | null, movingId: string, cfg: { gapMinServiceMin: number; largeBlockMin: number }): DayContextSide {
  const tech = day.techs.find((t) => t.technicianId === techId) ?? null;
  const items = day.appts.filter((a) => a.technicianId === techId && !INACTIVE_STATUSES.has(a.status)).sort((a, b) => a.startMin - b.startMin)
    .map((a): DayContextItem => ({ appointmentId: a.id, start: hhmm(a.startMin), end: hhmm(a.endMin), services: a.serviceIds.map((s) => day.services[s]?.name ?? 'Service'),
      status: a.status, locked: isLockedAppt(a), moving: a.id === movingId }));
  const d = detectDay(day, cfg);
  return {
    technicianId: techId, technicianName: tech?.name ?? null,
    shifts: (tech?.shifts ?? []).map(span), breaks: [...(tech?.breaks ?? []), ...(tech?.timeOff ?? [])].map(span), items,
    gaps: d.gaps.filter((g) => g.technicianId === techId).map((g) => ({ start: hhmm(g.startMin), end: hhmm(g.endMin), minutes: g.durationMin })),
    conflicts: d.conflicts.filter((c) => c.technicianId === techId || c.appointmentIds.some((id) => items.some((i) => i.appointmentId === id))).map((c) => ({ type: c.type, severity: c.severity, message: c.message })),
  };
}

/** The target technician's day before and after the move, and the bookings right next to the proposed slot.
 *  `day` is the TARGET day; `moving` is the appointment that moves (it may come from another day). */
export function technicianDayContext(day: DayData, moving: DayAppt, to: { startMin: number; endMin: number; technicianId: string | null },
  cfg: { gapMinServiceMin: number; largeBlockMin: number } = cfgDefault): DayContext {
  const before = side(day, to.technicianId, moving.id, cfg);
  const afterDay = withMove(day, moving.id, { date: day.date, startMin: to.startMin, endMin: to.endMin, technicianId: to.technicianId }, moving);
  const after = side(afterDay, to.technicianId, moving.id, cfg);
  const others = after.items.filter((i) => i.appointmentId !== moving.id);
  const toMinutes = (h: string) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const previous = [...others].reverse().find((i) => toMinutes(i.end) <= to.startMin) ?? null;
  const next = others.find((i) => toMinutes(i.start) >= to.endMin) ?? null;
  const key = (g: { start: string; end: string }) => `${g.start}-${g.end}`;
  const bG = new Set(before.gaps.map(key)), aG = new Set(after.gaps.map(key));
  const bC = new Set(before.conflicts.map((c) => c.type + c.message)), aC = new Set(after.conflicts.map((c) => c.type + c.message));
  return {
    date: day.date, timeZone: day.timeZone, appointmentId: moving.id,
    proposed: { start: hhmm(to.startMin), end: hhmm(to.endMin), technicianId: to.technicianId },
    neighbours: { previous, next, gapBeforeMin: previous ? to.startMin - toMinutes(previous.end) : null, gapAfterMin: next ? toMinutes(next.start) - to.endMin : null },
    before, after,
    change: { newGaps: [...aG].filter((g) => !bG.has(g)).length, closedGaps: [...bG].filter((g) => !aG.has(g)).length,
      newConflicts: [...aC].filter((c) => !bC.has(c)).length, resolvedConflicts: [...bC].filter((c) => !aC.has(c)).length },
  };
}
