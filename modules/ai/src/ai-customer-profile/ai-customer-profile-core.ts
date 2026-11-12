// ai-customer-profile-core.ts — PURE, dependency-free derivations for the AI Customer Profile Assistant.
// No DB, no Nest, no I/O. Everything here is a deterministic function of already-tenant-scoped inputs that the
// service layer fetches from existing domain services (customers/booking/loyalty/etc). Keeping it pure makes the
// honest-verification invariants (spec §10/§11/§14) unit-testable in isolation.
//
// HARD RULES ENCODED HERE (do not weaken):
//  - A completed visit is ONLY a completed service record. A booked/canceled/no-show appointment is NEVER a
//    completed visit (§10).
//  - A single visit is never a "preference" (§11) — confidence requires a configurable minimum of evidence.
//  - Technician preference distinguishes a CUSTOMER-REQUESTED tech from a SALON-ASSIGNED one (§12). Without an
//    explicit requested/confirmed signal the ceiling is "likely", never "confirmed".
//  - Inactivity/churn are classified as ranges/risks, never certainties, and honor a future appointment (§14/§15).
//  - Insufficient data yields an explicit "insufficient" result, never a fabricated strong label (§32).

// ---------- inputs (already tenant-scoped by the caller) ----------

/** A COMPLETED service record (from customers.visits — completed service lines only). */
export interface VisitRecord {
  date: string;            // ISO
  serviceName: string;
  technicianName: string;  // who performed it
  requestedTechnician?: boolean; // true ONLY when the customer explicitly requested this tech (if recorded)
  totalCents: number;
  tipCents: number;
}

/** An appointment row (any status). status is the domain string, lowercased here defensively. */
export interface AppointmentRecord {
  startsAt: string;        // ISO
  serviceName: string;
  technicianName: string;
  status: string;          // e.g. 'completed' | 'cancelled' | 'no_show' | 'booked' | 'rescheduled' | ...
}

export interface ProfileFields {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  preferredLanguage?: string | null;
  birthday?: string | null;
  smsConsentKnown?: boolean; // whether a consent state is recorded (not the value)
  preferredBranchKnown?: boolean;
}

// ---------- tunables (spec §32/§52 — tenant-configurable; these are safe platform defaults) ----------

export interface ProfileTunables {
  minVisitsForServicePref: number;     // §32
  minVisitsForTechPref: number;        // §32
  minVisitsForCadence: number;         // need >=N completed visits before we quote a "usual interval"
  inactiveDays: number;                // default flat threshold (§14) when no personal cadence is known
  longTermInactiveDays: number;
  dueMultiplier: number;               // "due for return" once elapsed > cadence * this
  inactiveMultiplier: number;          // "inactive" once elapsed > cadence * this
}

export const DEFAULT_TUNABLES: ProfileTunables = {
  minVisitsForServicePref: 3,
  minVisitsForTechPref: 3,
  minVisitsForCadence: 3,
  inactiveDays: 90,
  longTermInactiveDays: 180,
  dueMultiplier: 1.0,
  inactiveMultiplier: 1.5,
};

export type Confidence = 'confirmed' | 'high' | 'medium' | 'low' | 'insufficient';

// ---------- helpers ----------

const DAY_MS = 86_400_000;
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS); }
function isCompleted(s: string): boolean { return s.trim().toLowerCase() === 'completed'; }
function isCanceled(s: string): boolean { const x = s.trim().toLowerCase(); return x === 'cancelled' || x === 'canceled'; }
function isNoShow(s: string): boolean { const x = s.trim().toLowerCase().replace(/[\s-]/g, '_'); return x === 'no_show' || x === 'noshow'; }
function isRescheduled(s: string): boolean { return s.trim().toLowerCase() === 'rescheduled'; }
function fmtRange(lo: number, hi: number): string { return lo === hi ? `${lo} weeks` : `${lo}\u2013${hi} weeks`; }

// ---------- §10 visit summary (honest counts) ----------

export interface VisitSummary {
  completedVisits: number;
  canceledCount: number;
  noShowCount: number;
  rescheduledCount: number;
  firstVisit: string | null;
  lastVisit: string | null;
  branchesVisited: number;   // caller may pass distinct-branch count separately; 0 if unknown here
  typicalIntervalDays: number | null;    // median gap between completed visits, if enough data
  typicalIntervalText: string | null;    // e.g. "3–5 weeks"
  upcomingCount: number;
  nextAppointment: string | null;
  headline: string;          // human-readable, evidence-only
}

export function summarizeVisits(
  visits: VisitRecord[],
  appointments: AppointmentRecord[],
  nowIso: string,
  distinctBranches = 0,
  t: ProfileTunables = DEFAULT_TUNABLES,
): VisitSummary {
  const completed = [...visits].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const canceledCount = appointments.filter(a => isCanceled(a.status)).length;
  const noShowCount = appointments.filter(a => isNoShow(a.status)).length;
  const rescheduledCount = appointments.filter(a => isRescheduled(a.status)).length;

  const now = Date.parse(nowIso);
  const upcoming = appointments
    .filter(a => Date.parse(a.startsAt) > now && !isCanceled(a.status) && !isNoShow(a.status))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  // typical interval = median of consecutive completed-visit gaps (only if enough completed visits)
  let typicalIntervalDays: number | null = null;
  let typicalIntervalText: string | null = null;
  if (completed.length >= t.minVisitsForCadence) {
    const gaps: number[] = [];
    for (let i = 1; i < completed.length; i++) gaps.push(daysBetween(completed[i - 1].date, completed[i].date));
    gaps.sort((a, b) => a - b);
    typicalIntervalDays = gaps[Math.floor(gaps.length / 2)];
    const loW = Math.max(1, Math.floor(gaps[0] / 7));
    const hiW = Math.max(loW, Math.ceil(gaps[gaps.length - 1] / 7));
    typicalIntervalText = fmtRange(loW, hiW);
  }

  const firstVisit = completed.length ? completed[0].date : null;
  const lastVisit = completed.length ? completed[completed.length - 1].date : null;

  const headline = completed.length === 0
    ? 'No completed visits on record yet.'
    : `${completed.length} completed visit${completed.length === 1 ? '' : 's'}` +
      (lastVisit ? `, last on ${lastVisit.slice(0, 10)}` : '') +
      (typicalIntervalText ? `; usually returns every ${typicalIntervalText}` : '') +
      (upcoming.length ? `; next appointment ${upcoming[0].startsAt.slice(0, 10)}` : '; no upcoming appointment') + '.';

  return {
    completedVisits: completed.length,
    canceledCount, noShowCount, rescheduledCount,
    firstVisit, lastVisit,
    branchesVisited: distinctBranches,
    typicalIntervalDays, typicalIntervalText,
    upcomingCount: upcoming.length,
    nextAppointment: upcoming.length ? upcoming[0].startsAt : null,
    headline,
  };
}

// ---------- §11 service preferences ----------

export interface ServicePreference { serviceName: string; completedCount: number; confidence: Confidence; evidence: string[]; }

export function detectServicePreferences(visits: VisitRecord[], nowIso: string, t: ProfileTunables = DEFAULT_TUNABLES): ServicePreference[] {
  if (visits.length === 0) return [];
  const byService = new Map<string, VisitRecord[]>();
  for (const v of visits) { const k = v.serviceName; (byService.get(k) ?? byService.set(k, []).get(k)!).push(v); }
  const total = visits.length;
  const out: ServicePreference[] = [];
  for (const [serviceName, recs] of byService) {
    const count = recs.length;
    const last = recs.map(r => r.date).sort().at(-1)!;
    const weeksSince = Math.max(0, Math.round(daysBetween(last, nowIso) / 7));
    let confidence: Confidence;
    if (count < t.minVisitsForServicePref) confidence = count <= 1 ? 'insufficient' : 'low';
    else if (count >= Math.ceil(total * 0.6)) confidence = 'high';
    else confidence = 'medium';
    out.push({
      serviceName, completedCount: count, confidence,
      evidence: [
        `Booked in ${count} of the last ${total} completed visits`,
        `Most recent ${weeksSince} week${weeksSince === 1 ? '' : 's'} ago`,
      ],
    });
  }
  return out.sort((a, b) => b.completedCount - a.completedCount);
}

// ---------- §12 technician preference (requested vs assigned) ----------

export interface TechnicianPreference { technicianName: string; completedCount: number; requestedCount: number; confidence: Confidence; evidence: string[]; }

export function detectTechnicianPreference(visits: VisitRecord[], t: ProfileTunables = DEFAULT_TUNABLES): TechnicianPreference | null {
  if (visits.length === 0) return null;
  const byTech = new Map<string, { total: number; requested: number }>();
  for (const v of visits) {
    const cur = byTech.get(v.technicianName) ?? { total: 0, requested: 0 };
    cur.total++; if (v.requestedTechnician) cur.requested++;
    byTech.set(v.technicianName, cur);
  }
  let bestName = ''; let best = { total: 0, requested: 0 };
  for (const [name, s] of byTech) if (s.total > best.total) { best = s; bestName = name; }
  const total = visits.length;

  let confidence: Confidence;
  if (best.total < t.minVisitsForTechPref) confidence = best.total <= 1 ? 'insufficient' : 'low';
  else if (best.requested >= t.minVisitsForTechPref) confidence = 'confirmed'; // explicit customer request repeated
  else if (best.total >= Math.ceil(total * 0.6)) confidence = 'high';
  else confidence = 'medium';

  const evidence: string[] = [`Performed ${best.total} of the last ${total} completed visits`];
  if (best.requested > 0) evidence.push(`Customer explicitly requested this technician ${best.requested} time${best.requested === 1 ? '' : 's'}`);
  else evidence.push('No explicit customer request recorded (assignment may be salon-driven)');

  return { technicianName: bestName, completedCount: best.total, requestedCount: best.requested, confidence, evidence };
}

// ---------- §14 inactivity ----------

export type InactivityStatus = 'active' | 'rebooking_soon' | 'due_for_return' | 'inactive' | 'long_term_inactive' | 'insufficient_history';

export interface InactivityResult { status: InactivityStatus; daysSinceLastVisit: number | null; evidence: string[]; }

export function classifyInactivity(
  lastVisitIso: string | null,
  typicalIntervalDays: number | null,
  hasFutureAppointment: boolean,
  completedCount: number,
  nowIso: string,
  t: ProfileTunables = DEFAULT_TUNABLES,
): InactivityResult {
  if (completedCount === 0 || !lastVisitIso) return { status: 'insufficient_history', daysSinceLastVisit: null, evidence: ['No completed visit history'] };
  const elapsed = daysBetween(lastVisitIso, nowIso);
  if (hasFutureAppointment) return { status: 'active', daysSinceLastVisit: elapsed, evidence: ['Has an upcoming appointment'] };
  if (completedCount < t.minVisitsForCadence)   // the SALON's minimum (was the code default — the setting was shown but ignored here)
    return { status: 'insufficient_history', daysSinceLastVisit: elapsed, evidence: [`Only ${completedCount} completed visit(s); cadence not established`] };

  // personal cadence when known, else flat thresholds
  if (typicalIntervalDays) {
    const due = typicalIntervalDays * t.dueMultiplier;
    const inactive = typicalIntervalDays * t.inactiveMultiplier;
    if (elapsed <= due * 0.75) return { status: 'active', daysSinceLastVisit: elapsed, evidence: [`Within normal ~${typicalIntervalDays}-day interval`] };
    if (elapsed <= due) return { status: 'rebooking_soon', daysSinceLastVisit: elapsed, evidence: [`Approaching normal ~${typicalIntervalDays}-day interval`] };
    if (elapsed <= inactive) return { status: 'due_for_return', daysSinceLastVisit: elapsed, evidence: [`Past normal interval (~${typicalIntervalDays} days), no future appointment`] };
    if (elapsed <= t.longTermInactiveDays) return { status: 'inactive', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last visit vs ~${typicalIntervalDays}-day norm`] };
    return { status: 'long_term_inactive', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last completed visit`] };
  }
  if (elapsed <= t.inactiveDays * 0.5) return { status: 'active', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last visit`] };
  if (elapsed <= t.inactiveDays) return { status: 'due_for_return', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last visit`] };
  if (elapsed <= t.longTermInactiveDays) return { status: 'inactive', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last visit (> ${t.inactiveDays}d)`] };
  return { status: 'long_term_inactive', daysSinceLastVisit: elapsed, evidence: [`${elapsed} days since last visit (> ${t.longTermInactiveDays}d)`] };
}

// ---------- §18 profile completeness (DATA QUALITY ONLY — never a customer-value score) ----------

export interface CompletenessResult { percent: number; missingRequired: string[]; missingOptional: string[]; invalid: string[]; }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[+()\-\s\d]{7,}$/;

export function profileCompleteness(f: ProfileFields, requiredExtra: string[] = []): CompletenessResult {
  // required = identity + contact + consent-known; optional = language/birthday/preferred-branch
  const required: Array<[string, boolean]> = [
    ['first name', !!f.firstName], ['last name', !!f.lastName],
    ['phone', !!f.phone], ['email', !!f.email],
    ['communication consent', !!f.smsConsentKnown],
  ];
  const optional: Array<[string, boolean]> = [
    ['preferred language', !!f.preferredLanguage], ['birthday', !!f.birthday],
    ['preferred branch', !!f.preferredBranchKnown],
  ];
  const invalid: string[] = [];
  if (f.email && !EMAIL_RE.test(f.email)) invalid.push('email format');
  if (f.phone && !PHONE_RE.test(f.phone)) invalid.push('phone format');

  const missingRequired = required.filter(([, ok]) => !ok).map(([k]) => k).concat(requiredExtra);
  const missingOptional = optional.filter(([, ok]) => !ok).map(([k]) => k);
  const totalRequired = required.length + requiredExtra.length;
  const haveRequired = totalRequired - missingRequired.length;
  const percent = Math.round((haveRequired / Math.max(1, totalRequired)) * 100);
  return { percent, missingRequired, missingOptional, invalid };
}

// ---------- §16 duplicate confidence (over the EXISTING dedup groups; never cross-tenant) ----------

export type DuplicateConfidence = 'exact' | 'strong' | 'possible' | 'not_duplicate';

/**
 * Maps an existing dedup group's field overlap to a confidence label. Reuses, never re-derives, dedup.
 * Nov 2 2026 (Duplicate Review guide §04): each `same*` flag must mean "EVERY member has this value and they are all
 * equal" — a blank is not a match (the old caller compared only the non-empty values, so one profile with a phone and
 * one without counted as "same phone" → Strong: the screenshot's two "test" records). Strong also needs the same full
 * name: a shared family phone with different names is only Possible. Same rule as Duplicate Review (dr-2026-11-02).
 */
export function duplicateConfidence(_reason: string, samePhone: boolean, sameEmail: boolean, sameName: boolean): DuplicateConfidence {
  if (samePhone && sameEmail && sameName) return 'exact';
  if ((samePhone || sameEmail) && sameName) return 'strong';
  return 'possible';
}

/** true when every value is present and they are all equal (case/space-insensitive) */
export function allSame(values: (string | null | undefined)[]): boolean {
  const v = values.map((x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
  return v.length > 1 && v.every((x) => x !== '' && x === v[0]);
}

// ---------- §21/§22 rebooking opportunity (suppressed when a future appointment exists) ----------

export interface RebookingResult { eligible: boolean; reason: string; suggestedFromDays: number | null; suggestedToDays: number | null; }

export function rebookingOpportunity(
  inactivity: InactivityResult,
  hasFutureAppointment: boolean,
  doNotContact: boolean,
  typicalIntervalDays: number | null,
): RebookingResult {
  if (hasFutureAppointment) return { eligible: false, reason: 'Customer already has a future appointment', suggestedFromDays: null, suggestedToDays: null };
  if (doNotContact) return { eligible: false, reason: 'Customer is marked do-not-contact', suggestedFromDays: null, suggestedToDays: null };
  if (inactivity.status === 'insufficient_history') return { eligible: false, reason: 'Insufficient history to suggest rebooking', suggestedFromDays: null, suggestedToDays: null };
  if (inactivity.status === 'active' || inactivity.status === 'rebooking_soon')
    return { eligible: inactivity.status === 'rebooking_soon', reason: inactivity.status === 'rebooking_soon' ? 'Approaching normal return window' : 'Within normal interval', suggestedFromDays: typicalIntervalDays, suggestedToDays: typicalIntervalDays ? Math.round(typicalIntervalDays * 1.5) : null };
  return { eligible: true, reason: `Past normal return window (${inactivity.status})`, suggestedFromDays: 0, suggestedToDays: typicalIntervalDays ?? 14 };
}

// ============================ STAGE 2 ADDITIONS ============================

// ---------- §15/§33 churn risk (rules-based, ranges not certainties, no sensitive attributes) ----------

export type ChurnLevel = 'low' | 'possible' | 'elevated' | 'high' | 'insufficient';

export interface ChurnSignals {
  completedVisits: number;
  daysSinceLastVisit: number | null;
  typicalIntervalDays: number | null;
  hasFutureAppointment: boolean;
  canceledCount: number;
  noShowCount: number;
  membershipCanceled: boolean;   // membership status === 'cancelled'
  unresolvedFollowUp: boolean;   // an open follow-up/complaint (from communications), when known
}

export interface ChurnResult { level: ChurnLevel; confidence: Confidence; evidence: string[]; note: string; }

/**
 * Cautious, explainable churn scoring. NEVER a certainty. One cancellation is not churn (§15). Requires minimum
 * history. Uses ONLY behavioural signals — no race/religion/medical/financial/etc. (§15 prohibition list).
 */
export function evaluateChurnRisk(s: ChurnSignals, t: ProfileTunables = DEFAULT_TUNABLES): ChurnResult {
  const NOTE = 'This is a risk indicator, not a confirmed decision to leave.';
  if (s.completedVisits < Math.max(3, t.minVisitsForCadence))
    return { level: 'insufficient', confidence: 'insufficient', evidence: [`Only ${s.completedVisits} completed visit(s); not enough history for churn analysis`], note: NOTE };
  if (s.hasFutureAppointment)
    return { level: 'low', confidence: 'medium', evidence: ['Customer has an upcoming appointment'], note: NOTE };

  const evidence: string[] = [];
  let score = 0;

  // recency vs personal cadence (the strongest, most explainable signal)
  if (s.typicalIntervalDays && s.daysSinceLastVisit != null) {
    const ratio = s.daysSinceLastVisit / s.typicalIntervalDays;
    if (ratio >= 3) { score += 3; evidence.push(`${s.daysSinceLastVisit} days since last visit vs a ~${s.typicalIntervalDays}-day norm (3x+ overdue)`); }
    else if (ratio >= 2) { score += 2; evidence.push(`${s.daysSinceLastVisit} days since last visit vs a ~${s.typicalIntervalDays}-day norm (2x overdue)`); }
    else if (ratio >= 1.25) { score += 1; evidence.push(`Past normal ~${s.typicalIntervalDays}-day interval`); }
  } else if (s.daysSinceLastVisit != null && s.daysSinceLastVisit >= t.longTermInactiveDays) {
    score += 2; evidence.push(`${s.daysSinceLastVisit} days since last completed visit`);
  }

  if (!s.hasFutureAppointment) { score += 1; evidence.push('No future appointment scheduled'); }
  // one cancellation is never churn — only REPEATED negative behaviour counts
  if (s.canceledCount >= 3) { score += 1; evidence.push(`${s.canceledCount} cancellations on record`); }
  if (s.noShowCount >= 2) { score += 1; evidence.push(`${s.noShowCount} no-shows on record`); }
  if (s.membershipCanceled) { score += 1; evidence.push('Membership was cancelled'); }
  if (s.unresolvedFollowUp) { score += 1; evidence.push('An unresolved follow-up/complaint is open'); }

  let level: ChurnLevel;
  if (score >= 5) level = 'high';
  else if (score >= 3) level = 'elevated';
  else if (score >= 1) level = 'possible';
  else level = 'low';

  const confidence: Confidence = evidence.length >= 3 ? 'high' : evidence.length === 2 ? 'medium' : 'low';
  if (evidence.length === 0) evidence.push('Visit pattern is within normal range');
  return { level, confidence, evidence, note: NOTE };
}

// ---------- §19 service recommendations (active-catalog gated; evidence-based; never fabricated) ----------

export type RecommendationCategory = 'rebook_usual' | 'previously_requested' | 'complementary';

export interface ServiceRecommendation {
  serviceName: string;
  category: RecommendationCategory;
  confidence: Confidence;
  evidence: string[];
  availabilityConfirmed: boolean; // true only when the service is confirmed active in the tenant catalog
}

/**
 * Recommends from the customer's ACTUAL completed history, intersected with the tenant's ACTIVE services (§19: never
 * recommend an inactive/unavailable service). `activeServiceNames` is the set of currently-active service names; when
 * it is null the caller could not read the catalog (permission), so we emit only "rebook usual" with
 * availabilityConfirmed=false and never invent new-service suggestions.
 */
export function recommendServices(
  visits: VisitRecord[],
  activeServiceNames: Set<string> | null,
  nowIso: string,
  t: ProfileTunables = DEFAULT_TUNABLES,
): ServiceRecommendation[] {
  if (visits.length === 0) return [];
  const counts = new Map<string, number>();
  const lastByService = new Map<string, string>();
  for (const v of visits) {
    counts.set(v.serviceName, (counts.get(v.serviceName) ?? 0) + 1);
    const prev = lastByService.get(v.serviceName);
    if (!prev || v.date > prev) lastByService.set(v.serviceName, v.date);
  }
  const active = (name: string) => (activeServiceNames ? activeServiceNames.has(name) : false);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out: ServiceRecommendation[] = [];

  // rebook usual — the most-completed service, if still active (or availability-unconfirmed when catalog unreadable)
  if (ranked.length) {
    const [name, count] = ranked[0];
    if (activeServiceNames === null || active(name)) {
      out.push({
        serviceName: name, category: 'rebook_usual',
        confidence: count >= t.minVisitsForServicePref ? 'high' : count > 1 ? 'medium' : 'low',
        evidence: [`Completed ${count} time(s); the customer's most frequent service`],
        availabilityConfirmed: activeServiceNames !== null && active(name),
      });
    }
  }

  // previously requested — services completed historically but not recently, still active
  if (activeServiceNames !== null) {
    for (const [name, count] of ranked.slice(1)) {
      if (!active(name)) continue;
      const weeks = Math.round(daysBetween(lastByService.get(name)!, nowIso) / 7);
      if (weeks >= 8 && count >= 2) {
        out.push({ serviceName: name, category: 'previously_requested', confidence: 'medium',
          evidence: [`Completed ${count} time(s); last ${weeks} weeks ago`], availabilityConfirmed: true });
      }
    }
  }
  return out;
}

// ============================ STAGE: CUSTOMER TIMELINE (§23) ============================

export type TimelineEventType =
  | 'visit_completed' | 'appointment_booked' | 'appointment_cancelled' | 'appointment_no_show' | 'appointment_upcoming';

export interface TimelineEvent {
  at: string;             // ISO timestamp used for ordering + the cursor
  type: TimelineEventType;
  title: string;
  detail: string;
  serviceName?: string;
  technicianName?: string;
}

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: string | null; // pass back as `before` to page older; null when exhausted
  hasMore: boolean;
}

/**
 * Build a unified, tenant-scoped timeline from ALREADY-tenant-scoped records (§23). Newest-first, cursor-paginated,
 * and bounded — never an unbounded history load. `before` (ISO) returns only events strictly older than the cursor;
 * `limit` is clamped to [1,100]. Completed visits and appointment lifecycle events are distinct (a canceled/no-show
 * appointment is never rendered as a completed visit).
 */
export function buildTimeline(
  visits: VisitRecord[],
  appointments: AppointmentRecord[],
  nowIso: string,
  opts: { limit?: number; before?: string | null } = {},
): TimelinePage {
  const now = Date.parse(nowIso);
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 25)));
  const beforeMs = opts.before ? Date.parse(opts.before) : Infinity;

  const events: TimelineEvent[] = [];
  for (const v of visits) {
    events.push({ at: v.date, type: 'visit_completed', title: 'Completed visit', detail: `${v.serviceName} with ${v.technicianName}`, serviceName: v.serviceName, technicianName: v.technicianName });
  }
  for (const a of appointments) {
    const s = a.status.trim().toLowerCase();
    const future = Date.parse(a.startsAt) > now;
    if (s === 'completed') continue; // completed appts are represented by the visit record (no double-count)
    let type: TimelineEventType; let title: string;
    if (s === 'cancelled' || s === 'canceled') { type = 'appointment_cancelled'; title = 'Appointment cancelled'; }
    else if (s.replace(/[\s-]/g, '_') === 'no_show') { type = 'appointment_no_show'; title = 'No-show'; }
    else if (future) { type = 'appointment_upcoming'; title = 'Upcoming appointment'; }
    else { type = 'appointment_booked'; title = 'Appointment'; }
    events.push({ at: a.startsAt, type, title, detail: `${a.serviceName} with ${a.technicianName}`, serviceName: a.serviceName, technicianName: a.technicianName });
  }

  // newest-first, filtered by cursor
  const ordered = events
    .filter(e => Date.parse(e.at) < beforeMs)
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const pageEvents = ordered.slice(0, limit);
  const hasMore = ordered.length > limit;
  const nextCursor = hasMore ? pageEvents[pageEvents.length - 1].at : null;
  return { events: pageEvents, nextCursor, hasMore };
}

// ============================ TENANT AGGREGATE SCAN (§44) ============================

/** Per-customer inputs for the tenant aggregate (already tenant-scoped). Membership is omitted here to keep the scan
 *  bounded, so the aggregate churn count is a COARSE indicator (recency + no-future-appointment); the per-customer
 *  churn view remains the authoritative one. */
export interface TenantScanItem { visits: VisitRecord[]; appointments: AppointmentRecord[]; }

export interface TenantAggregate {
  totalScanned: number;
  active: number;
  rebookingSoon: number;
  dueForReturn: number;
  inactive: number;
  longTermInactive: number;
  insufficientHistory: number;
  withUpcomingAppointment: number;
  rebookingOpportunities: number;
  coarseChurnWatch: number; // due/inactive/long-term with no upcoming appointment — a review shortlist, not a verdict
}

export function aggregateTenant(items: TenantScanItem[], nowIso: string, t: ProfileTunables = DEFAULT_TUNABLES): TenantAggregate {
  const agg: TenantAggregate = { totalScanned: items.length, active: 0, rebookingSoon: 0, dueForReturn: 0, inactive: 0, longTermInactive: 0, insufficientHistory: 0, withUpcomingAppointment: 0, rebookingOpportunities: 0, coarseChurnWatch: 0 };
  for (const it of items) {
    const vs = summarizeVisits(it.visits, it.appointments, nowIso, 0, t);
    const hasUpcoming = vs.upcomingCount > 0;
    if (hasUpcoming) agg.withUpcomingAppointment++;
    const inact = classifyInactivity(vs.lastVisit, vs.typicalIntervalDays, hasUpcoming, vs.completedVisits, nowIso, t);
    switch (inact.status) {
      case 'active': agg.active++; break;
      case 'rebooking_soon': agg.rebookingSoon++; break;
      case 'due_for_return': agg.dueForReturn++; break;
      case 'inactive': agg.inactive++; break;
      case 'long_term_inactive': agg.longTermInactive++; break;
      case 'insufficient_history': agg.insufficientHistory++; break;
    }
    const rb = rebookingOpportunity(inact, hasUpcoming, false, vs.typicalIntervalDays);
    if (rb.eligible) agg.rebookingOpportunities++;
    if (!hasUpcoming && (inact.status === 'due_for_return' || inact.status === 'inactive' || inact.status === 'long_term_inactive')) agg.coarseChurnWatch++;
  }
  return agg;
}

// ============================ CALL SUMMARY (§24) ============================

/** A verified per-customer call row (customer_id already matched). No transcript/recording — those are separate,
 *  permission-gated, and not surfaced here. */
export interface CallRow {
  startedAt: string;
  direction: 'inbound' | 'outbound' | string;
  aiHandled: boolean;
  intent?: string | null;
  outcome?: string | null;
  durationSeconds?: number;
  recoveredAppointmentId?: string | null;
}

export interface CallSummary {
  totalCalls: number;
  aiHandledCalls: number;
  lastCall: {
    at: string; direction: string; aiHandled: boolean;
    intent: string | null; outcome: string | null; durationSeconds: number | null;
    appointmentAction: string | null; // recovered appointment id, when the call led to a booking
  } | null;
  connected: boolean; // true when call data exists for this customer
}

/** Summarize a customer's verified call history (§24). Newest first; never fabricates. */
export function summarizeCalls(rows: CallRow[]): CallSummary {
  if (!rows || rows.length === 0) return { totalCalls: 0, aiHandledCalls: 0, lastCall: null, connected: false };
  const sorted = [...rows].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const last = sorted[0];
  return {
    totalCalls: rows.length,
    aiHandledCalls: rows.filter(r => r.aiHandled).length,
    lastCall: {
      at: last.startedAt, direction: last.direction, aiHandled: !!last.aiHandled,
      intent: last.intent ?? null, outcome: last.outcome ?? null,
      durationSeconds: last.durationSeconds ?? null,
      appointmentAction: last.recoveredAppointmentId ?? null,
    },
    connected: true,
  };
}

// ============================ BRANCH PREFERENCE (§13) ============================

/** Branch-preference result. NOTE: the current customers.visits/appointments read model does NOT expose a per-visit
 *  branch, so visit-based inference is unavailable — this uses the customer's EXPLICITLY SAVED preferred branch only
 *  (a §13-valid signal). Full multi-branch visit inference needs a `branchName` on CustomerVisitRow. */
export interface BranchPreference {
  preferredBranch: string | null;
  source: 'saved' | 'visit_history' | 'none';
  confidence: Confidence;
  evidence: string[];
  visitInferenceAvailable: boolean; // false until per-visit branch is exposed by the read model
}

export function detectBranchPreference(
  savedBranchName: string | null,
  visitBranches?: string[], // reserved for when per-visit branch becomes available
): BranchPreference {
  if (visitBranches && visitBranches.length > 0) {
    const counts = new Map<string, number>();
    for (const b of visitBranches) counts.set(b, (counts.get(b) ?? 0) + 1);
    const [name, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      preferredBranch: name, source: 'visit_history',
      confidence: n >= Math.ceil(visitBranches.length * 0.6) ? 'high' : 'medium',
      evidence: [`Visited ${name} in ${n} of ${visitBranches.length} completed visits`],
      visitInferenceAvailable: true,
    };
  }
  if (savedBranchName) {
    return { preferredBranch: savedBranchName, source: 'saved', confidence: 'confirmed',
      evidence: ['Explicitly saved as the customer\u2019s preferred branch'], visitInferenceAvailable: false };
  }
  return { preferredBranch: null, source: 'none', confidence: 'insufficient',
    evidence: ['No saved preferred branch, and per-visit branch history is not available in the current read model'],
    visitInferenceAvailable: false };
}
