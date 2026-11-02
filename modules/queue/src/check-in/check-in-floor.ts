// check-in-floor.ts — the POS Check-In screen's pure server rules (Check-In 27-inch mandate, Oct 28 2026). Unit-tested in
// check-in-floor.vitest.spec.ts; used by mapToCheckInState (check-in.dto.ts) and both repository adapters. The screen
// renders these answers — it no longer labels a 2-hour and a 3-hour window over the same list, invents a "0% vs
// yesterday", calls a technician "available" because she has no queue entry, or routes an insight by its English text.
import type { FloorTech } from '../queue/queue-floor';
import { projectOnDutyStaff } from '../queue/queue-floor';
import type { QueueStaffRow } from '../queue/queue.dto';

/** §11–§13, §32–§34, §41, §74: the rows each card shows; the server's totals give "+N more" (never a taller card). */
export const CHECK_IN_TOP_ROWS = { arrivals: 8, arriving: 6, waiting: 6, technicians: 6, insights: 5 } as const;
/** §32: "Today's Appointments Arriving" = not yet checked in, starting within this many minutes (late ones included). */
export const CHECK_IN_ARRIVAL_WINDOW_MINUTES = 180;
/** §30: an appointment starting within this many minutes is "arriving soon" for the insight. */
export const CHECK_IN_ARRIVING_SOON_MINUTES = 20;
/** §30: a guest waiting longer than this is called out ("3 guests waiting > 15 min"). */
export const CHECK_IN_LONG_WAIT_MINUTES = 15;

/** 'HH:MM' (the branch's clock) → minutes since the branch's midnight; null when it is not a clock time. */
export function clockMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
  if (!m) return null; const h = Number(m[1]), mm = Number(m[2]);
  return h > 24 || mm > 59 ? null : h * 60 + mm;
}

/** §32: the arriving window over today's not-yet-checked-in appointments (start ≤ now + window; a late one stays until
 *  it is checked in or marked a no-show). An appointment whose time cannot be read stays in (never silently dropped). */
export function arrivingWithin<T extends { startTime: string }>(appts: T[], nowMinutes: number | null, windowMinutes = CHECK_IN_ARRIVAL_WINDOW_MINUTES): T[] {
  if (nowMinutes == null) return appts.slice();
  return appts.filter((a) => { const s = clockMinutes(a.startTime); return s == null || s <= nowMinutes + windowMinutes; })
    .sort((a, b) => (clockMinutes(a.startTime) ?? 1e9) - (clockMinutes(b.startTime) ?? 1e9));
}
/** an appointment past its start time by more than `graceMinutes` and not checked in = a no-show risk */
export function lateAppointments<T extends { startTime: string }>(appts: T[], nowMinutes: number | null, graceMinutes = 10): T[] {
  if (nowMinutes == null) return [];
  return appts.filter((a) => { const s = clockMinutes(a.startTime); return s != null && nowMinutes - s > graceMinutes; });
}

/** §84: "vs yesterday" = today's check-ins against yesterday's check-ins up to the same clock time. null when yesterday
 *  had none at this time (no baseline — the KPI shows no comparison rather than "▲ 0%"). */
export function checkInTrendPercent(today: number, yesterdaySameTime: number | null | undefined): number | null {
  if (yesterdaySameTime == null || yesterdaySameTime <= 0) return null;
  return Math.round(((today - yesterdaySameTime) / yesterdaySameTime) * 1000) / 10;
}

/** §40–§44, §89: Available Technicians = the on-duty projection from real signals (the Customer Queue's rule), top rows.
 *  Load (§43) = guests assigned to her and not yet in service. Next (§44) = Now / minutes until free / — (on break). */
export interface CheckInStaff { rows: QueueStaffRow[]; summary: { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; roster: number } }
export function checkInStaff(techs: FloorTech[], loadBy: Record<string, number>, limit: number): CheckInStaff {
  const { staff, staffSummary } = projectOnDutyStaff(techs, loadBy, limit);
  return { rows: staff, summary: { onDuty: staffSummary.onDuty, available: staffSummary.available, finishing: staffSummary.finishing, busy: staffSummary.busy, onBreak: staffSummary.onBreak, roster: staffSummary.roster } };
}

/** §29–§31: advisory front-desk insights — at most five, only when there is something to say, in a fixed priority order;
 *  each names where to act (`route`). None of them changes the queue, an assignment, an appointment or a payment. */
export interface CheckInInsightFacts {
  longWaitCount: number; waitingNow: number; techsAvailable: number; lateAppointments: number; arrivingSoon: number;
  averageWaitMinutes: number; vip: number; walkInsToday: number; checkedInToday: number; peak: { hour: number; count: number } | null;
}
export interface CheckInInsight { id: string; text: string; severity: 'info' | 'warn'; vars?: Record<string, number>; route?: string }
export function buildCheckInInsights(f: CheckInInsightFacts): CheckInInsight[] {
  const out: CheckInInsight[] = [];
  if (f.longWaitCount > 0) out.push({ id: 'longWait', text: `${f.longWaitCount} guest(s) waiting > ${CHECK_IN_LONG_WAIT_MINUTES} min.`, severity: 'warn', vars: { count: f.longWaitCount, minutes: CHECK_IN_LONG_WAIT_MINUTES }, route: '/queue' });
  if (f.waitingNow > 0 && f.techsAvailable === 0) out.push({ id: 'noidle', text: `${f.waitingNow} guest(s) waiting and no idle technicians.`, severity: 'warn', vars: { count: f.waitingNow }, route: '/queue' });
  if (f.lateAppointments > 0) out.push({ id: 'late', text: `${f.lateAppointments} appointment(s) late — no-show risk.`, severity: 'warn', vars: { count: f.lateAppointments }, route: '/booking' });
  if (f.arrivingSoon > 0) out.push({ id: 'arriving', text: `${f.arrivingSoon} appointment(s) arriving in the next ${CHECK_IN_ARRIVING_SOON_MINUTES} min.`, severity: 'info', vars: { count: f.arrivingSoon, minutes: CHECK_IN_ARRIVING_SOON_MINUTES } });
  if (f.techsAvailable > 0 && f.waitingNow > 0) out.push({ id: 'available', text: `${f.techsAvailable} technician(s) available.`, severity: 'info', vars: { count: f.techsAvailable }, route: '/queue?assign=1' });
  if (f.averageWaitMinutes >= 20) out.push({ id: 'wait', text: `Average wait is ${f.averageWaitMinutes} min — consider adding a technician.`, severity: 'warn', vars: { minutes: f.averageWaitMinutes }, route: '/technicians' });
  if (f.vip > 0) out.push({ id: 'vip', text: `${f.vip} VIP guest(s) checked in today — ensure a premium experience.`, severity: 'info', vars: { count: f.vip } });
  if (f.checkedInToday > 0 && f.walkInsToday / f.checkedInToday >= 0.5) { const p = Math.round((f.walkInsToday / f.checkedInToday) * 100); out.push({ id: 'walkin', text: `Walk-ins are ${p}% of today's check-ins.`, severity: 'info', vars: { percent: p } }); }
  if (f.peak && f.peak.count > 0) out.push({ id: 'peak', text: `Peak arrival window around ${((f.peak.hour % 12) || 12) + (f.peak.hour < 12 ? 'am' : 'pm')} (${f.peak.count} check-ins).`, severity: 'info', vars: { hour: f.peak.hour, count: f.peak.count } });
  return out;
}

/** §84: every Check-In KPI's business definition (also in the status report). */
export const CHECK_IN_KPI_DEFINITIONS: Record<string, string> = {
  checkInsToday: "Queue entries checked in on the branch's business day (pos_queue_items.checked_in_at ≥ the branch's midnight). Trend = against yesterday up to the same clock time; none without a baseline.",
  waitingGuests: 'Entries checked in and not yet sent to a technician (queue status waiting), now.',
  walkIns: "Of today's check-ins, source = walk_in.",
  arrivingSoon: `Today's appointments not yet checked in that start within ${CHECK_IN_ARRIVAL_WINDOW_MINUTES} minutes (late ones included) — the same list as Today's Appointments Arriving.`,
  readyForService: 'Entries sent to a technician (queue status assigned / called) and not yet in service.',
  averageWait: 'Mean minutes waited by the guests waiting now (0 with nobody waiting).',
  noShows: "Today's appointments marked no-show (pos_tech_appointments.status = no_show on the branch's business day).",
  techsAvailable: 'On-duty technicians whose real signals say available now (clocked in / on schedule, not on break, not blocked, no service running) — the Customer Queue rule.',
  customerReturnRate: "Of today's check-ins, the share whose customer has at least one earlier paid visit.",
};
