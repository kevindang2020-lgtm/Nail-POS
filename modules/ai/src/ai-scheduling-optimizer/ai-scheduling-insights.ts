// ai-scheduling-insights.ts — BUILD_PLAN Phase 7 (agent B): what the optimizer LEARNS, always behind a human approval.
//
//   duration      completed service lines (ticket_service_lines started_at → completed_at, last 90 days) per location ×
//                 service and per location × service × technician → robust statistics (median / percentiles / trimmed
//                 mean, ai-scheduling-stats.ts) → service_duration_statistics; a service_duration_recommendations row when
//                 the median differs from the duration the engine uses today by ≥ max(5 min, 15 %) over ≥ 10 samples.
//                 APPROVING one makes it the duration the engine uses (the hierarchy reads approved rows: technician ×
//                 service → service × location → catalog). The catalog itself is never changed.
//   staffing      next 7 days per location: booked minutes + a same-weekday history forecast vs scheduled technician
//                 minutes → detectUnderstaffing → staffing_coverage_recommendations when understaffed.
//   availability  same inputs: projected utilization < 35 % → suggest CLOSING availability; > 100 % with an active
//                 technician not scheduled that weekday → suggest OPENING availability with them.
// Generation supersedes the previous open suggestion for the same key (never a pile of duplicates). Decisions are CAS on
// (tenant, id, version, status 'review_required'); events INSIGHT_GENERATED / INSIGHT_DECIDED.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { APPOINTMENT_AVAILABILITY_RECOMMENDATION, SERVICE_DURATION_RECOMMENDATION, STAFFING_COVERAGE_RECOMMENDATION } from '../ai-lifecycles';
/** BUILD_PLAN Phase 12 (#27): one machine per insight table (they share the approval-required shape) */
const INSIGHT_MACHINE = { duration: SERVICE_DURATION_RECOMMENDATION, staffing: STAFFING_COVERAGE_RECOMMENDATION, availability: APPOINTMENT_AVAILABILITY_RECOMMENDATION } as const;
import { businessDate, utcDate } from '@aipowersalon/date-time';
import type { SchedInsight, SchedInsightKind, SchedInsightList, SchedInsightStatus, SchedDurationInsight, SchedStaffingInsight, SchedAvailabilityInsight } from '@aipowersalon/api-contracts/tenant';
import { schedInsightReasonCoded } from '@aipowersalon/api-contracts/tenant';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { robustDurationStats, type DurationStats } from './ai-scheduling-stats';
import { detectUnderstaffing } from './ai-scheduling-detection';
import type { SchedCtx, SchedEventsPort } from './ai-scheduling.ports';
import { SchedOpsError, addDaysYmd, iso, isUuid, needPerm, rowsOf, uuidOrNull } from './ai-scheduling-ops.common';

export const KINDS: SchedInsightKind[] = ['duration', 'staffing', 'availability'];
const TABLE: Record<SchedInsightKind, string> = { duration: 'service_duration_recommendations', staffing: 'staffing_coverage_recommendations', availability: 'appointment_availability_recommendations' };
export const MIN_SAMPLE = 10;
export const HISTORY_DAYS = 90;

// ── pure rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Does history disagree with the duration in use enough to ask a human? ≥ MIN_SAMPLE samples and |median − current| ≥ max(5, 15 %). */
export function durationSuggestion(currentMin: number | null, stats: DurationStats): { action: 'increase' | 'decrease'; suggestedMin: number; confidence: number; reason: string } | null {
  if (stats.n < MIN_SAMPLE || !currentMin || currentMin <= 0) return null;
  const diff = stats.median - currentMin;
  if (Math.abs(diff) < Math.max(5, currentMin * 0.15)) return null;
  const spread = stats.median > 0 ? stats.stddev / stats.median : 1;
  const confidence = Math.round(Math.max(0.3, Math.min(0.95, 0.5 + stats.n / 100 - (spread > 0.35 ? 0.2 : 0))) * 100) / 100;
  const action = diff > 0 ? 'increase' : 'decrease';
  return { action, suggestedMin: Math.round(stats.median), confidence, reason: `Median of ${stats.n} completed services is ${Math.round(stats.median)} min (configured ${currentMin} min; middle half ${Math.round(stats.p25)}–${Math.round(stats.p75)} min).` };
}

/** Service Duration Confidence (extras): how much the observed times vary, from the stored statistics. Middle-half width
 *  (p75 − p25) ÷ median: < 20 % steady · < 40 % variable · otherwise wide; fewer than MIN_SAMPLE samples → too_few (never
 *  a confident label on thin data). Read only — it explains, it never changes a duration. */
export type DurationVariability = 'too_few' | 'steady' | 'variable' | 'wide';
export interface DurationObserved { sampleSize: number; medianMin: number; p25Min: number; p75Min: number; p90Min: number; stddevMin: number; variability: DurationVariability; spreadPct: number | null }
export function durationObserved(st: { n: number; median: number; p25: number; p75: number; p90: number; stddev: number } | null): DurationObserved | null {
  if (!st || !Number.isFinite(st.n) || st.n <= 0) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const spread = st.median > 0 ? (st.p75 - st.p25) / st.median : null;
  const variability: DurationVariability = st.n < MIN_SAMPLE || spread == null ? 'too_few' : spread < 0.2 ? 'steady' : spread < 0.4 ? 'variable' : 'wide';
  return { sampleSize: st.n, medianMin: r1(st.median), p25Min: r1(st.p25), p75Min: r1(st.p75), p90Min: r1(st.p90), stddevMin: r1(st.stddev), variability, spreadPct: spread == null ? null : Math.round(spread * 100) };
}

export interface DayCapacityInput { capacityMin: number; confirmedMin: number; historyDailyMin: number[]; unscheduledTechnicianIds: string[];
  /** extras 200-Technician 06 (skill coverage): the services booked that day and the ones at least one SCHEDULED technician is
   *  approved for (technician_services, the one eligibility table). A booked service nobody scheduled may do is a gap. */
  bookedServices?: string[]; coveredServices?: string[] }
/** Staffing + availability suggestions for one location-day. Pure. */
export function dayInsights(d: DayCapacityInput) {
  const forecastAvailable = d.historyDailyMin.length >= 2;
  const avg = forecastAvailable ? d.historyDailyMin.reduce((a, b) => a + b, 0) / d.historyDailyMin.length : 0;
  const forecastExtra = Math.max(0, Math.round(avg - d.confirmedMin));
  const staffing = detectUnderstaffing({ confirmedDemandMin: d.confirmedMin, forecastDemandMin: forecastAvailable ? forecastExtra : null, capacityMin: d.capacityMin, forecastAvailable, sampleSize: d.capacityMin > 0 || d.confirmedMin > 0 ? 1 : 0,
    requiredSkills: d.bookedServices ?? [], availableSkills: d.coveredServices ?? [] });
  const demand = d.confirmedMin + forecastExtra;
  const projected = d.capacityMin > 0 ? demand / d.capacityMin : null;
  let availability: { direction: 'open' | 'close'; technicianId: string | null; reason: string; confidence: number } | null = null;
  if (projected != null && forecastAvailable && projected < 0.35) availability = { direction: 'close', technicianId: null, reason: `Projected utilization ${Math.round(projected * 100)} % — consider closing some open time.`, confidence: 0.6 };
  else if (projected != null && projected > 1 && d.unscheduledTechnicianIds.length) availability = { direction: 'open', technicianId: d.unscheduledTechnicianIds[0], reason: `Projected demand is ${Math.round(projected * 100)} % of scheduled time — a technician who is not scheduled could open availability.`, confidence: forecastAvailable ? 0.7 : 0.5 };
  // a booked service with no qualified technician on the schedule is worth a review even when total hours are enough
  const understaffed = staffing.state === 'understaffed' || staffing.state === 'severely_understaffed' || staffing.missingSkills.length > 0;
  return { staffing: understaffed ? staffing : null, availability };
}

// ── round 10 (AI Scheduling Optimizer 05 · 11): coverage by hour and by service category ─────────────────────────────
/** One location-day broken down with the SAME rule the day-level check uses (detectUnderstaffing): per clock hour, the booked
 *  minutes falling in that hour vs the scheduled technician minutes in it (lunch removed); per service category, the booked
 *  minutes of that category's services vs the scheduled minutes of technicians approved for at least one of them
 *  (technician_services). Confirmed bookings only — no forecast is spread over hours, so confidence stays lower and an
 *  hour with nothing booked and nobody scheduled is left out (never an invented busy hour). Pure. */
export interface CoverageShift { technicianId: string; startMin: number; endMin: number; lunchStartMin: number | null; lunchEndMin: number | null }
export interface CoverageBooking { startMin: number; endMin: number; services: { serviceId: string; minutes: number }[] }
export interface HourCoverage { hour: number; demandMinutes: number; capacityMinutes: number; state: string; missingMinutes: number }
export interface CategoryCoverage { category: string; demandMinutes: number; capacityMinutes: number; qualifiedTechnicians: number; state: string; missingMinutes: number }
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const shiftMinutesIn = (sh: CoverageShift, h0: number, h1: number) => overlap(sh.startMin, sh.endMin, h0, h1) - (sh.lunchStartMin != null && sh.lunchEndMin != null ? overlap(sh.lunchStartMin, sh.lunchEndMin, Math.max(h0, sh.startMin), Math.min(h1, sh.endMin)) : 0);
export function hourlyCoverage(shifts: CoverageShift[], bookings: CoverageBooking[]): HourCoverage[] {
  const pts = [...shifts.flatMap((x) => [x.startMin, x.endMin]), ...bookings.flatMap((b) => [b.startMin, b.endMin])].filter((x) => Number.isFinite(x));
  if (!pts.length) return [];
  const out: HourCoverage[] = [];
  for (let h = Math.floor(Math.min(...pts) / 60); h < Math.ceil(Math.max(...pts) / 60) && h < 24; h++) {
    const h0 = h * 60, h1 = h0 + 60;
    const demand = Math.round(bookings.reduce((a, b) => a + overlap(b.startMin, b.endMin, h0, h1), 0));
    const capacity = Math.round(shifts.reduce((a, x) => a + Math.max(0, shiftMinutesIn(x, h0, h1)), 0));
    if (demand === 0 && capacity === 0) continue;
    const r = detectUnderstaffing({ confirmedDemandMin: demand, capacityMin: capacity, forecastAvailable: false, sampleSize: 1 });
    out.push({ hour: h, demandMinutes: demand, capacityMinutes: capacity, state: r.state, missingMinutes: r.missingMinutes });
  }
  return out;
}
export function categoryCoverage(shifts: CoverageShift[], bookings: CoverageBooking[], categoryOf: Record<string, string>, qualified: Record<string, string[]>): CategoryCoverage[] {
  const demand = new Map<string, number>(); const services = new Map<string, Set<string>>();
  for (const b of bookings) for (const sv of b.services) {
    const c = categoryOf[sv.serviceId] ?? 'uncategorized';
    demand.set(c, (demand.get(c) ?? 0) + Math.max(0, sv.minutes));
    if (!services.has(c)) services.set(c, new Set()); services.get(c)!.add(sv.serviceId);
  }
  const minutesOf = (techId: string) => shifts.filter((x) => x.technicianId === techId).reduce((a, x) => a + Math.max(0, x.endMin - x.startMin - (x.lunchStartMin != null && x.lunchEndMin != null ? overlap(x.lunchStartMin, x.lunchEndMin, x.startMin, x.endMin) : 0)), 0);
  return [...demand.entries()].map(([category, dem]) => {
    const techs = new Set([...(services.get(category) ?? [])].flatMap((sv) => qualified[sv] ?? []).filter((t) => shifts.some((x) => x.technicianId === t)));
    const capacity = Math.round([...techs].reduce((a, t) => a + minutesOf(t), 0));
    const r = detectUnderstaffing({ confirmedDemandMin: Math.round(dem), capacityMin: capacity, forecastAvailable: false, sampleSize: 1 });
    return { category, demandMinutes: Math.round(dem), capacityMinutes: capacity, qualifiedTechnicians: techs.size, state: r.state, missingMinutes: r.missingMinutes };
  }).sort((a, b) => b.missingMinutes - a.missingMinutes || a.category.localeCompare(b.category));
}

// ── store ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DurationSample { branchId: string | null; serviceId: string; technicianId: string | null; minutes: number }
export interface InsightStore {
  list(tenantId: string, branchId: string | null, kind: SchedInsightKind | null, status: SchedInsightStatus | null, limit: number): Promise<SchedInsight[]>;
  get(tenantId: string, kind: SchedInsightKind, id: string): Promise<SchedInsight | null>;
  decide(tenantId: string, kind: SchedInsightKind, id: string, expectedVersion: number, status: 'approved' | 'rejected', userId: string | null): Promise<SchedInsight | null>;
  /** Approving a duration retires the previously approved row for the same (location, service, technician). */
  supersedeApprovedDuration(tenantId: string, keep: SchedDurationInsight): Promise<void>;
  durationSamples(tenantId: string, sinceIso: string): Promise<DurationSample[]>;
  /** The duration the engine would use today for the key (approved tech × service → service × location → catalog). */
  currentDurations(tenantId: string): Promise<{ catalog: Record<string, number>; approved: { branchId: string | null; serviceId: string; technicianId: string | null; minutes: number }[] }>;
  replaceStats(tenantId: string, rows: { branchId: string | null; serviceId: string; technicianId: string | null; stats: DurationStats }[]): Promise<void>;
  /** Insert unless an open row for the same key already suggests the same thing; older open rows for the key → superseded. */
  upsertDuration(tenantId: string, r: { branchId: string | null; serviceId: string; technicianId: string | null; action: string; currentMin: number; suggestedMin: number; reason: string; confidence: number; sampleSize: number }): Promise<string | null>;
  branches(tenantId: string): Promise<{ branchId: string; tz: string }[]>;
  dayInputs(tenantId: string, branchId: string, date: string): Promise<DayCapacityInput>;
  /** round 10: the shifts, bookings, categories and approvals for one location-day (hour / category coverage) */
  coverageInputs?(tenantId: string, branchId: string, date: string): Promise<{ shifts: CoverageShift[]; bookings: CoverageBooking[]; categoryOf: Record<string, string>; qualified: Record<string, string[]> }>;
  upsertStaffing(tenantId: string, r: { branchId: string; date: string; state: string; missingMinutes: number; missingSkills: string[]; action: string | null; confidence: number }): Promise<string | null>;
  upsertAvailability(tenantId: string, r: { branchId: string; date: string; direction: 'open' | 'close'; technicianId: string | null; reason: string; confidence: number }): Promise<string | null>;
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));
function toInsight(kind: SchedInsightKind, r: any): SchedInsight {
  const base = { id: String(r.id), branchId: r.branch_id ?? null, status: r.status as SchedInsightStatus, version: Number(r.version ?? 1), createdAt: iso(r.created_at) ?? '', confidence: n(r.confidence) };
  const tr = r.time_range && typeof r.time_range === 'object' ? r.time_range : {};
  const date = r.date ? (r.date instanceof Date ? utcDate(r.date) : String(r.date).slice(0, 10)) : null;
  // reasonCoded / recommendedActionCoded (Vietnamese POS §21): the stored English re-coded at read time (old rows too)
  if (kind === 'duration') {
    // observed: the latest stored statistics for the same (location, service, technician) key, when the list joined them
    const observed = r.st_n == null ? null : durationObserved({ n: Number(r.st_n), median: Number(r.st_median), p25: Number(r.st_p25), p75: Number(r.st_p75), p90: Number(r.st_p90), stddev: Number(r.st_stddev) });
    return { kind, ...base, serviceId: String(r.service_id), technicianId: r.technician_id ?? null, action: String(r.action), currentMin: n(r.current_min), suggestedMin: n(r.suggested_min), sampleSize: Number(r.sample_size ?? 0), reason: r.reason ?? null, reasonCoded: schedInsightReasonCoded(r.reason), observed } as SchedDurationInsight;
  }
  if (kind === 'staffing') return { kind, ...base, date, startTime: tr.start ?? null, endTime: tr.end ?? null, state: String(r.state), missingMinutes: n(r.missing_minutes), missingSkills: Array.isArray(r.missing_skills) ? r.missing_skills : [], recommendedAction: r.recommended_action ?? null, recommendedActionCoded: schedInsightReasonCoded(r.recommended_action) } as SchedStaffingInsight;
  return { kind, ...base, date, startTime: tr.start ?? null, endTime: tr.end ?? null, technicianId: r.technician_id ?? null, serviceId: r.service_id ?? null, direction: r.direction, reason: r.reason ?? null, reasonCoded: schedInsightReasonCoded(r.reason) } as SchedAvailabilityInsight;
}

export class KyselyInsightStore implements InsightStore {
  constructor(private readonly db: Kysely<any>) {}
  private t(kind: SchedInsightKind) { return sql.table(TABLE[kind]); }
  async list(tenantId: string, branchId: string | null, kind: SchedInsightKind | null, status: SchedInsightStatus | null, limit: number) {
    const out: SchedInsight[] = [];
    for (const k of kind ? [kind] : KINDS) {
      if (k === 'duration') {
        const rows = rowsOf(await sql`select dr.id, dr.branch_id, dr.status, dr.version, dr.created_at, dr.confidence, dr.service_id, dr.technician_id, dr.action, dr.current_min, dr.suggested_min, dr.sample_size, dr.reason, st.sample_size as st_n, st.median_min as st_median, st.p25_min as st_p25, st.p75_min as st_p75, st.p90_min as st_p90, st.stddev_min as st_stddev
                                        from service_duration_recommendations dr
                                        left join service_duration_statistics st on st.tenant_id = dr.tenant_id and st.service_id = dr.service_id
                                             and st.branch_id is not distinct from dr.branch_id and st.technician_id is not distinct from dr.technician_id
                                       where dr.tenant_id = ${tenantId}
                                         and (${branchId}::uuid is null or dr.branch_id = ${branchId}::uuid)
                                         and (${status}::text is null or dr.status = ${status}::text)
                                       order by dr.created_at desc limit ${limit}`.execute(this.db));
        out.push(...rows.map((r) => toInsight(k, r)));
        continue;
      }
      const rows = rowsOf(await sql`select * from ${this.t(k)} where tenant_id = ${tenantId}
                                      and (${branchId}::uuid is null or branch_id = ${branchId}::uuid)
                                      and (${status}::text is null or status = ${status}::text)
                                    order by created_at desc limit ${limit}`.execute(this.db));
      out.push(...rows.map((r) => toInsight(k, r)));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async get(tenantId: string, kind: SchedInsightKind, id: string) {
    const r = rowsOf(await sql`select * from ${this.t(kind)} where tenant_id = ${tenantId} and id = ${id}`.execute(this.db))[0];
    return r ? toInsight(kind, r) : null;
  }
  async decide(tenantId: string, kind: SchedInsightKind, id: string, v: number, status: 'approved' | 'rejected', userId: string | null) {
    const r = rowsOf(await sql`update ${this.t(kind)} set status = ${status}, decided_by_user_id = ${userId}, decided_at = now(), version = version + 1, updated_at = now()
                                where tenant_id = ${tenantId} and id = ${id} and version = ${v} and status = 'review_required' and ${canMoveToSql(INSIGHT_MACHINE[kind], status)} returning *`.execute(this.db))[0];
    return r ? toInsight(kind, r) : null;
  }
  async supersedeApprovedDuration(tenantId: string, keep: SchedDurationInsight) {
    await sql`update service_duration_recommendations set status = 'superseded', version = version + 1, updated_at = now()
              where tenant_id = ${tenantId} and status = 'approved' and ${canMoveToSql(SERVICE_DURATION_RECOMMENDATION, 'superseded')} and id <> ${keep.id} and service_id = ${keep.serviceId}
                and branch_id is not distinct from ${keep.branchId}::uuid and technician_id is not distinct from ${keep.technicianId}::uuid`.execute(this.db);
  }
  async durationSamples(tenantId: string, sinceIso: string) {
    return rowsOf(await sql`select l.branch_id, l.service_id, l.technician_id, extract(epoch from (l.completed_at - l.started_at)) / 60.0 as minutes
                              from ticket_service_lines l
                             where l.tenant_id = ${tenantId} and l.service_id is not null and l.started_at is not null and l.completed_at is not null
                               and l.removed_at is null and l.completed_at >= ${sinceIso} and l.completed_at > l.started_at`.execute(this.db))
      .map((r) => ({ branchId: r.branch_id ?? null, serviceId: String(r.service_id), technicianId: r.technician_id ?? null, minutes: Number(r.minutes) }));
  }
  async currentDurations(tenantId: string) {
    const catalog: Record<string, number> = {};
    for (const r of rowsOf(await sql`select id, duration_minutes from services where tenant_id = ${tenantId} and archived_at is null`.execute(this.db))) catalog[String(r.id)] = Number(r.duration_minutes ?? 0);
    const approved = rowsOf(await sql`select branch_id, service_id, technician_id, suggested_min from service_duration_recommendations
                                        where tenant_id = ${tenantId} and status = 'approved' and suggested_min is not null`.execute(this.db))
      .map((r) => ({ branchId: r.branch_id ?? null, serviceId: String(r.service_id), technicianId: r.technician_id ?? null, minutes: Number(r.suggested_min) }));
    return { catalog, approved };
  }
  async replaceStats(tenantId: string, rows: { branchId: string | null; serviceId: string; technicianId: string | null; stats: DurationStats }[]) {
    await this.db.transaction().execute(async (trx) => {
      await sql`delete from service_duration_statistics where tenant_id = ${tenantId}`.execute(trx);
      for (const r of rows) {
        await sql`insert into service_duration_statistics (tenant_id, branch_id, service_id, technician_id, sample_size, median_min, p25_min, p75_min, p90_min, trimmed_mean_min, stddev_min)
                  values (${tenantId}, ${r.branchId}, ${r.serviceId}, ${r.technicianId}, ${r.stats.n}, ${r.stats.median}, ${r.stats.p25}, ${r.stats.p75}, ${r.stats.p90}, ${r.stats.trimmedMean}, ${r.stats.stddev})`.execute(trx);
      }
    });
  }
  async upsertDuration(tenantId: string, r: { branchId: string | null; serviceId: string; technicianId: string | null; action: string; currentMin: number; suggestedMin: number; reason: string; confidence: number; sampleSize: number }) {
    return this.db.transaction().execute(async (trx) => {
      const open = rowsOf(await sql`select id, suggested_min from service_duration_recommendations where tenant_id = ${tenantId} and status = 'review_required' and service_id = ${r.serviceId}
                                      and branch_id is not distinct from ${r.branchId}::uuid and technician_id is not distinct from ${r.technicianId}::uuid for update`.execute(trx));
      if (open.some((o) => Number(o.suggested_min) === r.suggestedMin)) return null;
      if (open.length) await sql`update service_duration_recommendations set status = 'superseded', version = version + 1, updated_at = now()
                                 where tenant_id = ${tenantId} and id in (${sql.join(open.map((o) => o.id))}) and ${canMoveToSql(SERVICE_DURATION_RECOMMENDATION, 'superseded')}`.execute(trx);
      const ins = rowsOf(await sql`insert into service_duration_recommendations (tenant_id, branch_id, service_id, technician_id, action, current_min, suggested_min, reason, confidence, sample_size)
                                    values (${tenantId}, ${r.branchId}, ${r.serviceId}, ${r.technicianId}, ${r.action}, ${r.currentMin}, ${r.suggestedMin}, ${r.reason}, ${r.confidence}, ${r.sampleSize}) returning id`.execute(trx))[0];
      return ins ? String(ins.id) : null;
    });
  }
  async branches(tenantId: string) {
    return rowsOf(await sql`select id, timezone from branches where tenant_id = ${tenantId} and status = 'active'`.execute(this.db)).map((r) => ({ branchId: String(r.id), tz: String(r.timezone || 'America/New_York') }));
  }
  async dayInputs(tenantId: string, branchId: string, date: string): Promise<DayCapacityInput> {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const sched = rowsOf(await sql`select technician_id,
                                          extract(epoch from (end_time - start_time)) / 60.0
                                          - coalesce(extract(epoch from (lunch_end_time - lunch_start_time)) / 60.0, 0) as minutes
                                     from technician_schedules
                                    where tenant_id = ${tenantId} and branch_id = ${branchId} and day_of_week = ${dow} and is_working = true`.execute(this.db));
    const scheduled = new Set(sched.map((s) => String(s.technician_id)));
    const capacityMin = Math.round(sched.reduce((a, s) => a + Math.max(0, Number(s.minutes ?? 0)), 0));
    const confirmed = rowsOf(await sql`select coalesce(sum(duration_minutes), 0)::int as m from pos_tech_appointments
                                        where tenant_id = ${tenantId} and branch_id = ${branchId} and appt_date = ${date}::date
                                          and status not in ('cancelled','no_show')`.execute(this.db))[0];
    const hist = rowsOf(await sql`select appt_date, coalesce(sum(duration_minutes), 0)::int as m from pos_tech_appointments
                                   where tenant_id = ${tenantId} and branch_id = ${branchId} and status = 'completed'
                                     and appt_date in (${sql.join([7, 14, 21, 28].map((d) => sql`${addDaysYmd(date, -d)}::date`))})
                                   group by appt_date`.execute(this.db));
    const techs = rowsOf(await sql`select id from technicians where tenant_id = ${tenantId} and branch_id = ${branchId} and is_active = true and archived_at is null`.execute(this.db));
    // extras 200-Technician 06: booked services of the day vs the services a scheduled, active technician is approved for
    const booked = rowsOf(await sql`select distinct sv.id, sv.name from pos_tech_appointments a
                                     cross join lateral jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) e
                                     join services sv on sv.tenant_id = a.tenant_id and sv.id::text = e->>'serviceId'
                                    where a.tenant_id = ${tenantId} and a.branch_id = ${branchId} and a.appt_date = ${date}::date and a.status not in ('cancelled','no_show')`.execute(this.db));
    const activeScheduled = techs.map((t) => String(t.id)).filter((id) => scheduled.has(id));
    const covered = new Set(activeScheduled.length && booked.length ? rowsOf(await sql`select distinct ts.service_id from technician_services ts
                                     where ts.tenant_id = ${tenantId} and ts.technician_id = any(${activeScheduled}::uuid[]) and ts.service_id = any(${booked.map((b) => String(b.id))}::uuid[])`.execute(this.db)).map((r) => String(r.service_id)) : []);
    return { capacityMin, confirmedMin: Number(confirmed?.m ?? 0), historyDailyMin: hist.map((h) => Number(h.m)).filter((m) => m > 0),
      unscheduledTechnicianIds: techs.map((t) => String(t.id)).filter((id) => !scheduled.has(id)),
      bookedServices: booked.map((b) => String(b.name)), coveredServices: booked.filter((b) => covered.has(String(b.id))).map((b) => String(b.name)) };
  }
  async coverageInputs(tenantId: string, branchId: string, date: string) {
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const mins = (col: 'start_time' | 'end_time' | 'lunch_start_time' | 'lunch_end_time') => col === 'start_time' ? sql`(extract(hour from s.start_time::time) * 60 + extract(minute from s.start_time::time))`
      : col === 'end_time' ? sql`(extract(hour from s.end_time::time) * 60 + extract(minute from s.end_time::time))`
      : col === 'lunch_start_time' ? sql`(extract(hour from s.lunch_start_time::time) * 60 + extract(minute from s.lunch_start_time::time))`
      : sql`(extract(hour from s.lunch_end_time::time) * 60 + extract(minute from s.lunch_end_time::time))`;
    const sched = rowsOf(await sql`select s.technician_id, ${mins('start_time')} as st, ${mins('end_time')} as en, ${mins('lunch_start_time')} as ls, ${mins('lunch_end_time')} as le
      from technician_schedules s join technicians te on te.id = s.technician_id and te.tenant_id = s.tenant_id and te.is_active = true and te.archived_at is null
      where s.tenant_id = ${tenantId} and s.branch_id = ${branchId} and s.day_of_week = ${dow} and s.is_working = true and s.start_time is not null and s.end_time is not null`.execute(this.db));
    const appts = rowsOf(await sql`select a.id, (extract(hour from a.start_time::time) * 60 + extract(minute from a.start_time::time)) as st, (extract(hour from a.end_time::time) * 60 + extract(minute from a.end_time::time)) as en,
        a.duration_minutes, case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end as services
      from pos_tech_appointments a where a.tenant_id = ${tenantId} and a.branch_id = ${branchId} and a.appt_date = ${date}::date and a.status not in ('cancelled','no_show')`.execute(this.db));
    const svcIds = [...new Set(appts.flatMap((a) => (Array.isArray(a.services) ? a.services : []).map((e: any) => String(e?.serviceId ?? '')).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x))))];
    const svcRows = svcIds.length ? rowsOf(await sql`select sv.id, sv.duration_minutes, coalesce(sc.name, 'uncategorized') as cat from services sv left join service_categories sc on sc.id = sv.category_id and sc.tenant_id = sv.tenant_id
      where sv.tenant_id = ${tenantId} and sv.id = any(${svcIds}::uuid[])`.execute(this.db)) : [];
    const qual = svcIds.length ? rowsOf(await sql`select ts.service_id, ts.technician_id from technician_services ts where ts.tenant_id = ${tenantId} and ts.service_id = any(${svcIds}::uuid[])`.execute(this.db)) : [];
    const categoryOf: Record<string, string> = Object.fromEntries(svcRows.map((r) => [String(r.id), String(r.cat)]));
    const durOf = new Map(svcRows.map((r) => [String(r.id), Number(r.duration_minutes ?? 0)]));
    const qualified: Record<string, string[]> = {};
    for (const q of qual) (qualified[String(q.service_id)] ??= []).push(String(q.technician_id));
    return {
      shifts: sched.map((x) => ({ technicianId: String(x.technician_id), startMin: Number(x.st), endMin: Number(x.en), lunchStartMin: x.ls == null ? null : Number(x.ls), lunchEndMin: x.le == null ? null : Number(x.le) })),
      bookings: appts.map((a) => {
        const list = (Array.isArray(a.services) ? a.services : []).map((e: any) => String(e?.serviceId ?? '')).filter((x: string) => durOf.has(x));
        const total = Number(a.duration_minutes ?? 0) || Math.max(0, Number(a.en) - Number(a.st));
        const cat = list.reduce((acc: number, x: string) => acc + (durOf.get(x) ?? 0), 0);
        // each booked service's share of the booking's own minutes (by catalog duration; equal shares when none is known)
        return { startMin: Number(a.st), endMin: Number(a.en), services: list.map((x: string) => ({ serviceId: x, minutes: cat > 0 ? Math.round((total * (durOf.get(x) ?? 0)) / cat) : Math.round(total / Math.max(1, list.length)) })) };
      }),
      categoryOf, qualified,
    };
  }
  async upsertStaffing(tenantId: string, r: { branchId: string; date: string; state: string; missingMinutes: number; missingSkills: string[]; action: string | null; confidence: number }) {
    return this.db.transaction().execute(async (trx) => {
      const open = rowsOf(await sql`select id, state, missing_minutes, missing_skills from staffing_coverage_recommendations where tenant_id = ${tenantId} and branch_id = ${r.branchId}
                                      and date = ${r.date}::date and status = 'review_required' for update`.execute(trx));
      const skillsKey = JSON.stringify([...r.missingSkills].sort());
      if (open.some((o) => o.state === r.state && Number(o.missing_minutes) === r.missingMinutes && JSON.stringify([...(Array.isArray(o.missing_skills) ? o.missing_skills : [])].map(String).sort()) === skillsKey)) return null;
      if (open.length) await sql`update staffing_coverage_recommendations set status = 'superseded', version = version + 1, updated_at = now() where tenant_id = ${tenantId} and id in (${sql.join(open.map((o) => o.id))}) and ${canMoveToSql(STAFFING_COVERAGE_RECOMMENDATION, 'superseded')}`.execute(trx);
      const ins = rowsOf(await sql`insert into staffing_coverage_recommendations (tenant_id, branch_id, date, state, missing_minutes, missing_skills, recommended_action, confidence)
                                    values (${tenantId}, ${r.branchId}, ${r.date}::date, ${r.state}, ${r.missingMinutes}, ${JSON.stringify(r.missingSkills)}::jsonb, ${r.action}, ${r.confidence}) returning id`.execute(trx))[0];
      return ins ? String(ins.id) : null;
    });
  }
  async upsertAvailability(tenantId: string, r: { branchId: string; date: string; direction: 'open' | 'close'; technicianId: string | null; reason: string; confidence: number }) {
    return this.db.transaction().execute(async (trx) => {
      const open = rowsOf(await sql`select id, technician_id from appointment_availability_recommendations where tenant_id = ${tenantId} and branch_id = ${r.branchId}
                                      and date = ${r.date}::date and direction = ${r.direction} and status = 'review_required' for update`.execute(trx));
      if (open.some((o) => (o.technician_id ?? null) === r.technicianId)) return null;
      if (open.length) await sql`update appointment_availability_recommendations set status = 'superseded', version = version + 1, updated_at = now() where tenant_id = ${tenantId} and id in (${sql.join(open.map((o) => o.id))}) and ${canMoveToSql(APPOINTMENT_AVAILABILITY_RECOMMENDATION, 'superseded')}`.execute(trx);
      const ins = rowsOf(await sql`insert into appointment_availability_recommendations (tenant_id, branch_id, date, technician_id, direction, reason, confidence)
                                    values (${tenantId}, ${r.branchId}, ${r.date}::date, ${r.technicianId}, ${r.direction}, ${r.reason}, ${r.confidence}) returning id`.execute(trx))[0];
      return ins ? String(ins.id) : null;
    });
  }
}

// ── service ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InsightRefreshQueue { enqueueRefresh(tenantId: string): Promise<{ queued: boolean }> }

export class SchedInsightService {
  constructor(private readonly store: InsightStore, private readonly events: SchedEventsPort | null, private readonly queue: InsightRefreshQueue | null = null, private readonly now: () => number = Date.now) {}

  async list(ctx: SchedCtx, q: { kind?: string; status?: string; limit?: string | number }): Promise<SchedInsightList> {
    needPerm(ctx, 'ai_scheduling.view');
    const kind = q.kind ? (KINDS.includes(q.kind as SchedInsightKind) ? (q.kind as SchedInsightKind) : null) : null;
    if (q.kind && !kind) throw new SchedOpsError('VALIDATION', 'kind must be duration, staffing or availability.');
    const statuses: SchedInsightStatus[] = ['review_required', 'approved', 'rejected', 'superseded'];
    if (q.status && !statuses.includes(q.status as SchedInsightStatus)) throw new SchedOpsError('VALIDATION', 'Unknown status.');
    const limit = Math.max(1, Math.min(200, Number(q.limit) || 100));
    const items = await this.store.list(ctx.tenantId, ctx.branchId ?? null, kind, (q.status as SchedInsightStatus) || null, limit);
    // round 10 (AI Scheduling Optimizer 05 · 11): open staffing insights carry their hour-by-hour and per-category coverage,
    // computed on read from the same bookings and schedules (at most 10 per page; read-only)
    if (this.store.coverageInputs) {
      let n = 0;
      for (const it of items) {
        if (it.kind !== 'staffing' || it.status !== 'review_required' || !it.branchId || !it.date || n >= 10) continue;
        n++;
        const c = await this.store.coverageInputs(ctx.tenantId, it.branchId, it.date);
        (it as SchedStaffingInsight & { coverage?: unknown }).coverage = { byHour: hourlyCoverage(c.shifts, c.bookings), byCategory: categoryCoverage(c.shifts, c.bookings, c.categoryOf, c.qualified), basis: 'confirmed_bookings_only' };
      }
    }
    return { items, total: items.length };
  }

  async decide(ctx: SchedCtx, kindRaw: string, id: string, approve: boolean, body: { expectedVersion?: unknown; reason?: string | null }): Promise<SchedInsight> {
    needPerm(ctx, 'ai_scheduling.approve');
    const kind = KINDS.find((k) => k === kindRaw);
    if (!kind) throw new SchedOpsError('NOT_FOUND', 'Unknown insight kind.');
    if (!isUuid(id)) throw new SchedOpsError('NOT_FOUND', 'Insight not found.');
    const v = Number(body?.expectedVersion);
    if (!Number.isInteger(v) || v < 1) throw new SchedOpsError('VALIDATION', 'expectedVersion is required.');
    const cur = await this.store.get(ctx.tenantId, kind, id);
    if (!cur || (ctx.branchId && cur.branchId && cur.branchId !== ctx.branchId)) throw new SchedOpsError('NOT_FOUND', 'Insight not found.');
    if (cur.status !== 'review_required') throw new SchedOpsError('INVALID_STATE', `This suggestion is already ${cur.status}.`);
    const done = await this.store.decide(ctx.tenantId, kind, id, v, approve ? 'approved' : 'rejected', uuidOrNull(ctx.userId));
    if (!done) throw new SchedOpsError('VERSION_CONFLICT', 'This suggestion changed — reload and try again.', { currentVersion: cur.version });
    if (approve && done.kind === 'duration') await this.store.supersedeApprovedDuration(ctx.tenantId, done);
    await this.emit(ctx, DOMAIN_EVENTS.SCHEDULE_INSIGHT_DECIDED, done, { approved: approve, reason: body?.reason ? String(body.reason).slice(0, 500) : null });
    return done;
  }

  async refresh(ctx: SchedCtx): Promise<{ queued: boolean }> {
    needPerm(ctx, 'ai_scheduling.approve');
    if (this.queue) return this.queue.enqueueRefresh(ctx.tenantId);
    await this.generate(ctx);
    return { queued: false };
  }

  private async emit(ctx: SchedCtx, type: string, ins: Pick<SchedInsight, 'id' | 'kind' | 'status' | 'version' | 'branchId'>, extra: Record<string, unknown> = {}) {
    await this.events?.emit({ ...ctx, branchId: ins.branchId ?? null }, type, { type: 'schedule_insight', id: ins.id, version: ins.version }, { insightId: ins.id, kind: ins.kind, status: ins.status, ...extra }).catch(() => undefined);
  }

  /** Nightly duration statistics + suggestions (and the job's insight run). ctx = a system context for the tenant. */
  async generateDurations(ctx: SchedCtx): Promise<{ keys: number; suggestions: number }> {
    const since = new Date(this.now() - HISTORY_DAYS * 86_400_000).toISOString();
    const samples = (await this.store.durationSamples(ctx.tenantId, since)).filter((s) => Number.isFinite(s.minutes) && s.minutes > 0 && s.minutes <= 600);
    const groups = new Map<string, { branchId: string | null; serviceId: string; technicianId: string | null; values: number[] }>();
    const add = (s: DurationSample, technicianId: string | null) => {
      const key = `${s.branchId}|${s.serviceId}|${technicianId}`;
      const g = groups.get(key) ?? { branchId: s.branchId, serviceId: s.serviceId, technicianId, values: [] };
      g.values.push(s.minutes); groups.set(key, g);
    };
    for (const s of samples) { add(s, null); if (s.technicianId) add(s, s.technicianId); }   // location × service, and × technician
    const cur = await this.store.currentDurations(ctx.tenantId);
    const approved = (b: string | null, svc: string, t: string | null) => cur.approved.find((a) => a.serviceId === svc && a.branchId === b && a.technicianId === t)?.minutes;
    const stats: { branchId: string | null; serviceId: string; technicianId: string | null; stats: DurationStats }[] = [];
    let suggestions = 0;
    for (const g of groups.values()) {
      const st = robustDurationStats(g.values);
      stats.push({ branchId: g.branchId, serviceId: g.serviceId, technicianId: g.technicianId, stats: st });
      const current = (g.technicianId ? approved(g.branchId, g.serviceId, g.technicianId) : undefined) ?? approved(g.branchId, g.serviceId, null) ?? cur.catalog[g.serviceId] ?? null;
      const s = durationSuggestion(current, st);
      if (!s) continue;
      const id = await this.store.upsertDuration(ctx.tenantId, { branchId: g.branchId, serviceId: g.serviceId, technicianId: g.technicianId, action: s.action, currentMin: current as number, suggestedMin: s.suggestedMin, reason: s.reason, confidence: s.confidence, sampleSize: st.n });
      if (id) { suggestions++; await this.emit(ctx, DOMAIN_EVENTS.SCHEDULE_INSIGHT_GENERATED, { id, kind: 'duration', status: 'review_required', version: 1, branchId: g.branchId }); }
    }
    await this.store.replaceStats(ctx.tenantId, stats);
    return { keys: stats.length, suggestions };
  }

  /** Staffing + availability suggestions for the next `days` days of every active location. */
  async generateCoverage(ctx: SchedCtx, days = 7): Promise<{ staffing: number; availability: number }> {
    let staffing = 0, availability = 0;
    for (const b of await this.store.branches(ctx.tenantId)) {
      const today = businessDate(b.tz, new Date(this.now()));   // the LOCATION's day
      for (let i = 0; i < days; i++) {
        const date = addDaysYmd(today, i);
        const out = dayInsights(await this.store.dayInputs(ctx.tenantId, b.branchId, date));
        if (out.staffing) {
          const hours = Math.ceil(out.staffing.missingMinutes / 60);
          // a skills-only gap carries no hours action (the missing services are listed on the suggestion itself)
          const id = await this.store.upsertStaffing(ctx.tenantId, { branchId: b.branchId, date, state: out.staffing.state, missingMinutes: out.staffing.missingMinutes, missingSkills: out.staffing.missingSkills,
            action: hours > 0 ? `Schedule about ${hours} more technician hour${hours === 1 ? '' : 's'}.` : null, confidence: out.staffing.confidence });
          if (id) { staffing++; await this.emit(ctx, DOMAIN_EVENTS.SCHEDULE_INSIGHT_GENERATED, { id, kind: 'staffing', status: 'review_required', version: 1, branchId: b.branchId }); }
        }
        if (out.availability) {
          const id = await this.store.upsertAvailability(ctx.tenantId, { branchId: b.branchId, date, ...out.availability });
          if (id) { availability++; await this.emit(ctx, DOMAIN_EVENTS.SCHEDULE_INSIGHT_GENERATED, { id, kind: 'availability', status: 'review_required', version: 1, branchId: b.branchId }); }
        }
      }
    }
    return { staffing, availability };
  }

  async generate(ctx: SchedCtx) { return { durations: await this.generateDurations(ctx), coverage: await this.generateCoverage(ctx) }; }
}
