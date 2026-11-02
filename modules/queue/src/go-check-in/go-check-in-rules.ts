// go-check-in-rules.ts — 23-inch dual-screen spec §16–§17, §20–§27: the pure rules of a guest's own check-in, shared by
// the Go Check-In kiosk and the customer display (both run on GoCheckInService). No I/O — everything here is decided
// from facts the repository read, so it unit-tests without a database and cannot drift between screens.
import { skillMatch } from '@aipowersalon/workforce';
import { CHECK_IN_WAIT_BAND_MINUTES, isAddOnCategory } from '@aipowersalon/api-contracts';

/** '14:30' / '14:30:00' → '2:30 PM' (the branch's wall clock, as a guest reads it); malformed → as given. */
export function clockLabel(hhmm: unknown): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]), mi = m[2];
  if (h > 23) return String(hhmm);
  return `${h % 12 === 0 ? 12 : h % 12}:${mi} ${h < 12 ? 'AM' : 'PM'}`;
}
/** 'HH:MM[:SS]' → minutes since midnight, or null. */
export function minutesOf(hhmm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

/** §26–§27: the band a guest is shown, from the queue engine's minutes — the display shows it as it comes. */
export function waitRangeFor(minutes: unknown): { fromMinutes: number; toMinutes: number } | undefined {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return undefined;
  const from = Math.round(minutes);
  return { fromMinutes: from, toMinutes: from + CHECK_IN_WAIT_BAND_MINUTES };
}

// ── the visit (§16–§17) ─────────────────────────────────────────────────────────────────────────────────────────────
/** Appointments that start within this long of the visit's first one belong to the same visit (booked together, or
 *  back to back — one appointment per technician). */
export const VISIT_WINDOW_MINUTES = 60;
export interface VisitAppointment { appointmentId: string; startMinutes: number; endMinutes: number }
/**
 * The visit a guest is checking in for, from their eligible appointments today at this branch: the first one that is
 * not long over (ended less than an hour ago) — else the latest — and every appointment starting within the visit
 * window after it. A 2 pm appointment is not checked in by an 11 am arrival.
 */
export function visitFor<T extends VisitAppointment>(appts: T[], nowMinutes: number): T[] {
  const sorted = [...appts].sort((a, b) => a.startMinutes - b.startMinutes || a.appointmentId.localeCompare(b.appointmentId));
  if (!sorted.length) return [];
  const anchor = sorted.find((a) => a.endMinutes > nowMinutes - VISIT_WINDOW_MINUTES) ?? sorted[sorted.length - 1];
  return visitAnchoredAt(sorted, anchor.appointmentId);
}
/** "I'm Here" on the visit the screen showed: the appointment it was anchored on and those within the window after it. */
export function visitAnchoredAt<T extends VisitAppointment>(appts: T[], anchorId: string): T[] {
  const anchor = appts.find((a) => a.appointmentId === anchorId);
  if (!anchor) return [];
  return appts.filter((a) => a.startMinutes >= anchor.startMinutes && a.startMinutes <= anchor.startMinutes + VISIT_WINDOW_MINUTES)
    .sort((a, b) => a.startMinutes - b.startMinutes || (a.appointmentId === anchorId ? -1 : b.appointmentId === anchorId ? 1 : a.appointmentId.localeCompare(b.appointmentId)));
}

// ── technicians (§25) ───────────────────────────────────────────────────────────────────────────────────────────────
/** What the repository knows about one technician of the branch, today. */
export interface KioskTechFacts {
  technicianId: string;
  firstName: string; lastName: string;
  avatarUrl?: string | null;
  /** Service categories this technician performs (technician_services → services → categories) — the queue's skills. */
  skills: string[];
  /** Today's scheduled shift on the branch's clock (null: not scheduled today, or off that weekday). */
  shift: { startMinutes: number; endMinutes: number } | null;
  /** Today's blocked times (time off, a meeting). */
  blocks: { startMinutes: number; endMinutes: number }[];
  /** An open time-clock punch today. */
  clockedIn: boolean;
  /** The live status the front desk sees (technician_statuses, latest). */
  liveStatus: string | null;
}
/** Live statuses that mean "not working" unless the technician is clocked in — the Live Technician Schedule's rule. */
const OFF = new Set(['inactive', 'offline', 'off_shift', 'clocked_out']);

/**
 * Working for the rest of today (the Live Technician Schedule's "working today", limited to what is left of the day):
 * clocked in now; or scheduled today, not switched off by the front desk, and with some of the shift still ahead of
 * them that is not blocked.
 */
export function isWorkingRestOfToday(t: KioskTechFacts, nowMinutes: number): boolean {
  if (t.clockedIn) return true;
  if (t.liveStatus && OFF.has(t.liveStatus.toLowerCase())) return false;
  if (!t.shift) return false;
  let free: { start: number; end: number }[] = [{ start: Math.max(nowMinutes, t.shift.startMinutes), end: t.shift.endMinutes }].filter((w) => w.end > w.start);
  for (const b of t.blocks) {
    free = free.flatMap((w) => (b.endMinutes <= w.start || b.startMinutes >= w.end) ? [w]
      : [{ start: w.start, end: Math.min(w.end, b.startMinutes) }, { start: Math.max(w.start, b.endMinutes), end: w.end }]);
    free = free.filter((w) => w.end > w.start);
  }
  return free.length > 0;
}

/** The categories a technician must cover for these services — add-ons are done by whoever does the main service. */
export function requiredCategories(serviceIds: string[], catalog: { id: string; category: string; isAddOn: boolean }[]): string[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return [...new Set(serviceIds.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && !c.isAddOn).map((c) => c.category))];
}

/** First names, with a last initial only where two share one (two Lisas → "Lisa N.", "Lisa P."). */
export function technicianNames(techs: { technicianId: string; firstName: string; lastName: string }[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const t of techs) { const k = t.firstName.trim().toLowerCase(); count.set(k, (count.get(k) ?? 0) + 1); }
  return new Map(techs.map((t) => {
    const first = t.firstName.trim() || t.lastName.trim() || 'Technician';
    const shared = (count.get(t.firstName.trim().toLowerCase()) ?? 0) > 1 && t.lastName.trim();
    return [t.technicianId, shared ? `${first} ${t.lastName.trim()[0].toUpperCase()}.` : first];
  }));
}

/** §25: who the guest may ask for — working the rest of today at this branch, and qualified for every chosen service. */
export function kioskTechnicians(techs: KioskTechFacts[], nowMinutes: number, required: string[]): { technicianId: string; name: string; avatarUrl?: string | null; fromLabel?: string }[] {
  const ok = techs.filter((t) => isWorkingRestOfToday(t, nowMinutes) && skillMatch(t.skills, required));
  const names = technicianNames(ok);
  return ok.map((t) => {
    const later = !t.clockedIn && t.shift && t.shift.startMinutes > nowMinutes ? clockLabel(`${Math.floor(t.shift.startMinutes / 60)}:${String(t.shift.startMinutes % 60).padStart(2, '0')}`) : undefined;
    return { technicianId: t.technicianId, name: names.get(t.technicianId)!, ...(t.avatarUrl ? { avatarUrl: t.avatarUrl } : {}), ...(later ? { fromLabel: `From ${later}` } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export { isAddOnCategory };
