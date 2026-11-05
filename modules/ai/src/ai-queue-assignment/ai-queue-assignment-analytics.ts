// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { DecisionAnalytics } from '@aipowersalon/api-contracts/tenant';
import type { DecisionAnalytics } from '@aipowersalon/api-contracts/tenant';
import { toCsv } from '@aipowersalon/reports';
import { businessDate, utcDate } from '@aipowersalon/date-time';
// ai-queue-assignment-analytics.ts — PURE aggregation for AI queue assignment (BUILD_PLAN Phase 6).
//
// Decisions: accept / reject / override / kept unassigned are STAFF reviews of a suggestion; 'auto_assigned' is the
// auto-run acting on its own. Audit bug 13: auto-assignments were logged as 'accepted' and counted in the acceptance
// rate, so turning auto on made the suggestions look better than staff found them. Rates are over staff decisions only;
// auto-assignments are their own count. Rates are null when there is no data (never a fabricated 0 % or 100 %).
// Waits, by technician, by hour (in the branch's own time zone) and the CSV exports live here too.
export interface DecisionLike {
  decision: 'accepted' | 'rejected' | 'overridden' | 'kept_unassigned' | 'auto_assigned';
  chosenTechnicianId: string | null;
  reason: string | null;
  createdAt: string;
  feedbackCode?: string | null;
}

/** DecisionAnalytics + the auto-run kept apart (bug 13). */
export interface QueueDecisionAnalytics extends DecisionAnalytics {
  autoAssigned: number;
  /** staff-reviewed decisions (the denominator of every rate) */
  staffTotal: number;
  topFeedbackCodes: { code: string; count: number }[];
  byHour: { hour: number; total: number; accepted: number; autoAssigned: number }[];
}

const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

/** The hour (0–23) of an instant in a time zone (the branch's); UTC when the zone is unknown or invalid. */
export function hourIn(iso: string, timeZone?: string | null): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (timeZone) {
    try {
      const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t));
      const n = Number(h);
      if (Number.isInteger(n) && n >= 0 && n <= 23) return n;
    } catch { /* invalid zone → UTC */ }
  }
  return new Date(t).getUTCHours();
}
/** The calendar day of an instant in a time zone (YYYY-MM-DD). */
export function dayIn(iso: string, timeZone?: string | null): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // the salon's day when its zone is known (businessDate), else the UTC day — named, not the inline idiom (§87)
  if (timeZone) { try { return businessDate(timeZone, new Date(t)); } catch { /* unknown zone → UTC */ } }
  return utcDate(new Date(t));
}

export function computeDecisionAnalytics(records: DecisionLike[], timeZone?: string | null): QueueDecisionAnalytics {
  const total = records.length;
  let accepted = 0, rejected = 0, overridden = 0, keptUnassigned = 0, autoAssigned = 0;
  const reasons = new Map<string, number>(); const codes = new Map<string, number>();
  const days = new Map<string, { total: number; accepted: number; overridden: number }>();
  const hours = new Map<number, { total: number; accepted: number; autoAssigned: number }>();
  const techs = new Map<string, number>();

  for (const r of records) {
    switch (r.decision) {
      case 'accepted': accepted++; break;
      case 'rejected': rejected++; break;
      case 'overridden': overridden++; break;
      case 'kept_unassigned': keptUnassigned++; break;
      case 'auto_assigned': autoAssigned++; break;
    }
    if (r.decision === 'rejected' && r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    if (r.feedbackCode) codes.set(r.feedbackCode, (codes.get(r.feedbackCode) ?? 0) + 1);
    const day = dayIn(r.createdAt, timeZone);
    if (day) {
      const d = days.get(day) ?? { total: 0, accepted: 0, overridden: 0 };
      d.total++; if (r.decision === 'accepted') d.accepted++; if (r.decision === 'overridden') d.overridden++;
      days.set(day, d);
    }
    const h = hourIn(r.createdAt, timeZone);
    if (h !== null) {
      const x = hours.get(h) ?? { total: 0, accepted: 0, autoAssigned: 0 };
      x.total++; if (r.decision === 'accepted') x.accepted++; if (r.decision === 'auto_assigned') x.autoAssigned++;
      hours.set(h, x);
    }
    if (r.chosenTechnicianId) techs.set(r.chosenTechnicianId, (techs.get(r.chosenTechnicianId) ?? 0) + 1);
  }
  const staffTotal = total - autoAssigned;
  return {
    total, accepted, rejected, overridden, keptUnassigned, autoAssigned, staffTotal,
    acceptanceRate: rate(accepted, staffTotal), overrideRate: rate(overridden, staffTotal), rejectionRate: rate(rejected, staffTotal),
    topRejectionReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    topFeedbackCodes: [...codes.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    byDay: [...days.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    byHour: [...hours.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byChosenTechnician: [...techs.entries()].map(([technicianId, count]) => ({ technicianId, count })).sort((a, b) => b.count - a.count),
  };
}

// ── waits ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One served visit: checked in → service started. */
export interface ServedWait { queueItemId: string; technicianId: string | null; checkedInAt: string; startedAt: string }
export interface WaitAnalytics {
  served: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null; longestMinutes: number | null;
  byHour: { hour: number; served: number; avgMinutes: number }[];
  byTechnician: { technicianId: string; served: number; avgMinutes: number }[];
}
export function waitMinutesOf(w: ServedWait): number | null {
  const a = Date.parse(w.checkedInAt), b = Date.parse(w.startedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 60_000));
}
export function computeWaitAnalytics(rows: ServedWait[], timeZone?: string | null): WaitAnalytics {
  const vals: { w: ServedWait; m: number }[] = [];
  for (const w of rows) { const m = waitMinutesOf(w); if (m !== null) vals.push({ w, m }); }
  const xs = vals.map((v) => v.m).sort((a, b) => a - b);
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))];
  const avg = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const hours = new Map<number, number[]>(); const techs = new Map<string, number[]>();
  for (const v of vals) {
    const h = hourIn(v.w.checkedInAt, timeZone); if (h !== null) (hours.get(h) ?? hours.set(h, []).get(h)!).push(v.m);
    if (v.w.technicianId) (techs.get(v.w.technicianId) ?? techs.set(v.w.technicianId, []).get(v.w.technicianId)!).push(v.m);
  }
  return {
    served: xs.length,
    avgMinutes: xs.length ? avg(xs) : null,
    medianMinutes: xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : Math.round((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2)) : null,
    p90Minutes: xs.length ? at(0.9) : null,
    longestMinutes: xs.length ? xs[xs.length - 1] : null,
    byHour: [...hours.entries()].map(([hour, a]) => ({ hour, served: a.length, avgMinutes: avg(a) })).sort((a, b) => a.hour - b.hour),
    byTechnician: [...techs.entries()].map(([technicianId, a]) => ({ technicianId, served: a.length, avgMinutes: avg(a) })).sort((a, b) => b.served - a.served),
  };
}

/** Per technician: what the AI suggested / staff chose / the auto-run did, beside how fast their guests were served. */
export interface TechnicianRow { technicianId: string; name: string | null; served: number; avgWaitMinutes: number | null; chosenByStaff: number; autoAssigned: number; overriddenTo: number }
export function byTechnician(decisions: DecisionLike[], waits: WaitAnalytics, names: Record<string, string> = {}): TechnicianRow[] {
  const m = new Map<string, TechnicianRow>();
  const row = (id: string) => m.get(id) ?? m.set(id, { technicianId: id, name: names[id] ?? null, served: 0, avgWaitMinutes: null, chosenByStaff: 0, autoAssigned: 0, overriddenTo: 0 }).get(id)!;
  for (const d of decisions) {
    if (!d.chosenTechnicianId) continue;
    const r = row(d.chosenTechnicianId);
    if (d.decision === 'auto_assigned') r.autoAssigned++;
    else if (d.decision === 'overridden') r.overriddenTo++;
    else if (d.decision === 'accepted') r.chosenByStaff++;
  }
  for (const w of waits.byTechnician) { const r = row(w.technicianId); r.served = w.served; r.avgWaitMinutes = w.avgMinutes; }
  return [...m.values()].sort((a, b) => b.served - a.served || b.chosenByStaff - a.chosenByStaff);
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Formula-injection-safe CSV (CWE-1236) over the platform's one CSV writer (reports' toCsv, which neutralises = + - @).
 * A cell starting with a tab or carriage return is also prefixed — spreadsheet apps strip those and then evaluate.
 */
export function safeCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined): string | number => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    const s = String(v);
    return /^[\t\r]/.test(s) ? "'" + s : s;
  };
  return toCsv(headers, rows.map((r) => r.map(cell)));
}
