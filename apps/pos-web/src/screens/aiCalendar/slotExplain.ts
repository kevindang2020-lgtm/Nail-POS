// slotExplain.ts — AI Calendar extras #05 Conflict Explanation. Given the day view the screen already loaded (Booking's
// own hours, the technician's working windows, her blocked times and approved time off, live holds and appointments),
// explain why a start time cannot be booked for a technician. Read-only and pure: nothing is held or booked here, and the
// last word stays with POS Booking (service qualification and the buffer are checked there when services are picked).

export type SlotReasonCode = 'OUTSIDE_HOURS' | 'OFF_TODAY' | 'OUTSIDE_SHIFT' | 'TIME_OFF' | 'BLOCKED' | 'HOLD' | 'APPOINTMENT';
export interface SlotReason { code: SlotReasonCode; start?: string; end?: string; reason?: string; status?: string; ref?: string; pendingCode?: boolean }
export interface SlotExplanation { bookable: boolean; start: string; end: string; reasons: SlotReason[] }

/** the statuses that keep a technician's chair busy (same list as the AI Calendar conflict check) */
const CHAIR = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'];
const HM = /^(\d{1,2}):(\d{2})/;
export const minutesOf = (v: unknown): number | null => { const m = HM.exec(String(v ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const overlaps = (a0: number, a1: number, b0: number | null, b1: number | null) => b0 != null && b1 != null && a0 < b1 && b0 < a1;

interface DayLike {
  hours?: { open?: string | null; close?: string | null } | null;
  technicians?: Array<{ id: string; workingToday?: boolean; windows?: Array<{ start: string; end: string }>; blocked?: Array<{ blockId?: string; startTime: string; endTime: string; reason?: string }> }>;
  appointments?: Array<{ id: string; technicianId?: string | null; start: string; end: string; status: string }>;
  holds?: Array<{ id: string; technicianId?: string | null; start: string; end: string; pendingVerification?: boolean }>;
}

export function explainSlot(d: DayLike, technicianId: string, start: string, durationMinutes: number): SlotExplanation | null {
  const s = minutesOf(start); const dur = Math.trunc(Number(durationMinutes));
  const tech = (d.technicians ?? []).find((x) => x.id === technicianId);
  if (s == null || !(dur > 0) || !tech) return null;
  const e = s + dur; const reasons: SlotReason[] = [];
  const open = minutesOf(d.hours?.open), close = minutesOf(d.hours?.close);
  if (open != null && close != null && (s < open || e > close)) reasons.push({ code: 'OUTSIDE_HOURS', start: hm(open), end: hm(close) });
  const blocks = (tech.blocked ?? []).filter((b) => overlaps(s, e, minutesOf(b.startTime), minutesOf(b.endTime)));
  for (const b of blocks) reasons.push({ code: String(b.blockId ?? '').startsWith('time-off:') ? 'TIME_OFF' : 'BLOCKED', start: b.startTime, end: b.endTime, reason: b.reason ?? undefined });
  if (!tech.workingToday || !(tech.windows ?? []).length) reasons.push({ code: 'OFF_TODAY' });
  else if (!blocks.length && !(tech.windows ?? []).some((w) => { const w0 = minutesOf(w.start), w1 = minutesOf(w.end); return w0 != null && w1 != null && w0 <= s && e <= w1; })) {
    reasons.push({ code: 'OUTSIDE_SHIFT', reason: (tech.windows ?? []).map((w) => `${w.start}–${w.end}`).join(', ') });
  }
  for (const h of d.holds ?? []) if (h.technicianId === technicianId && overlaps(s, e, minutesOf(h.start), minutesOf(h.end))) reasons.push({ code: 'HOLD', start: h.start, end: h.end, ref: h.id, pendingCode: !!h.pendingVerification });
  for (const a of d.appointments ?? []) if (a.technicianId === technicianId && CHAIR.includes(a.status) && overlaps(s, e, minutesOf(a.start), minutesOf(a.end))) reasons.push({ code: 'APPOINTMENT', start: a.start, end: a.end, status: a.status, ref: a.id });
  return { bookable: !reasons.length, start: hm(s), end: hm(e), reasons };
}
