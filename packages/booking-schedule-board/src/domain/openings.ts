/**
 * Find an Opening + Best Matches (spec §16, §17, §24).
 *
 * Both are driven by the availability engine and the eligibility rules;
 * the mock adapter runs these server-side-equivalently, and the production
 * adapter delegates to the real backend. The UI never scans the rendered grid.
 */
import { buildDayContext, daySummary, enumerateStarts, type Interval } from './availability';
import { evaluateEligibility, evaluateStaticEligibility, type EligibilityFailure } from './eligibility';
import type {
  Appointment,
  BookingPolicy,
  BranchHours,
  ID,
  ISODate,
  OpeningResult,
  ScheduleSegment,
  Service,
  Technician,
  TechnicianMatch,
} from './scheduleTypes';
import { toISO } from './time';

export interface SearchContext {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  branchHours: BranchHours;
  technicians: Technician[];
  appointments: Appointment[];
  segments: ScheduleSegment[];
  policy?: BookingPolicy;
  nowMinute?: number;
}

export interface FindOpeningsQuery {
  services: Service[];
  /** Total required minutes incl. add-ons. Defaults to the sum of service durations. */
  durationMinutes?: number;
  /** Specific technician, or null/undefined for Any Technician. */
  technicianId?: ID | null;
  /** Preferred window in minutes since local midnight. */
  window?: Interval;
  /** Customer-preferred technician (soft preference used by ranking). */
  preferredTechnicianId?: ID | null;
  /** Exclude this appointment's own time (when searching for a move). */
  ignoreAppointmentIds?: ReadonlySet<ID>;
  limit?: number;
}

export function sumServiceDuration(services: Service[]): number {
  return services.reduce((n, s) => n + s.durationMinutes, 0);
}

export function findOpenings(ctx: SearchContext, q: FindOpeningsQuery): OpeningResult[] {
  const duration = q.durationMinutes ?? sumServiceDuration(q.services);
  const candidates = q.technicianId
    ? ctx.technicians.filter((t) => t.id === q.technicianId)
    : ctx.technicians;
  const results: OpeningResult[] = [];
  for (const t of candidates) {
    const staticFailures = evaluateStaticEligibility({
      technician: t,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      services: q.services,
    });
    if (staticFailures.length) continue;
    const dayCtx = buildDayContext({
      technician: t,
      date: ctx.date,
      timezone: ctx.timezone,
      branchHours: ctx.branchHours,
      appointments: ctx.appointments,
      segments: ctx.segments,
      ignoreAppointmentIds: q.ignoreAppointmentIds,
    });
    let window = q.window;
    if (ctx.nowMinute !== undefined && ctx.policy?.minLeadMinutes) {
      const earliest = ctx.nowMinute + ctx.policy.minLeadMinutes;
      window = { start: Math.max(window?.start ?? 0, earliest), end: window?.end ?? 1440 };
    }
    for (const s of enumerateStarts(dayCtx, duration, window)) {
      const gapEnd = gapEndFrom(dayCtx, s);
      results.push({
        technicianId: t.id,
        technicianName: t.displayName,
        startAt: toISO(ctx.date, s, ctx.timezone),
        endAt: toISO(ctx.date, s + duration, ctx.timezone),
        durationMinutes: duration,
        gapDurationMinutes: gapEnd - s,
      });
    }
  }
  results.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.technicianName.localeCompare(b.technicianName));
  return q.limit ? results.slice(0, q.limit) : results;
}

function gapEndFrom(dayCtx: ReturnType<typeof buildDayContext>, start: number): number {
  const w = dayCtx.working.find((x) => start >= x.start && start < x.end);
  if (!w) return start;
  let end = w.end;
  for (const b of dayCtx.busy) if (b.start >= start && b.start < end) end = b.start;
  const p = dayCtx.protectedStarts.find((x) => x.at >= start);
  if (p && p.at < end) end = p.at;
  return end;
}

/** Collapse per-cell openings into one entry per contiguous run (for the Find an Opening list). */
export function collapseOpenings(list: OpeningResult[]): OpeningResult[] {
  const out: OpeningResult[] = [];
  const byTech = new Map<ID, OpeningResult[]>();
  for (const o of list) {
    const arr = byTech.get(o.technicianId) ?? [];
    arr.push(o);
    byTech.set(o.technicianId, arr);
  }
  for (const arr of byTech.values()) {
    arr.sort((a, b) => a.startAt.localeCompare(b.startAt));
    let run: OpeningResult | null = null;
    let lastStart = 0;
    for (const o of arr) {
      const s = new Date(o.startAt).getTime();
      if (run && s - lastStart === 15 * 60000) {
        lastStart = s;
        continue;
      }
      run = { ...o };
      out.push(run);
      lastStart = s;
    }
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.technicianName.localeCompare(b.technicianName));
}

export interface BestMatchesQuery {
  services: Service[];
  durationMinutes?: number;
  /** Customer explicitly requested this technician (hard rule). */
  requestedTechnicianId?: ID | null;
  /** Soft preference (e.g. last technician this customer saw). */
  preferredTechnicianId?: ID | null;
  /** Preferred start; earliest valid opening at/after it is used for ranking. */
  preferredStartMinute?: number;
  /** Fair Turn order from the host: technicianId → position (0 = next up). */
  fairTurnOrder?: Record<ID, number>;
  /** Phase-2 weights, all optional. */
  weights?: Partial<typeof DEFAULT_WEIGHTS>;
  ignoreAppointmentIds?: ReadonlySet<ID>;
}

export const DEFAULT_WEIGHTS = {
  requested: 1000,
  preferred: 300,
  /** Penalty per minute between preferred start and earliest valid opening. */
  waitPerMinute: 1,
  /** Bonus per percent of free time remaining (favours under-utilised technicians). */
  utilizationPerPercent: 0.5,
  /** Bonus for each additional service the technician is qualified for beyond the requested set. */
  skillBreadth: 2,
  /** Bonus for being next in Fair Turn; decays by position. */
  fairTurnTop: 120,
  fairTurnDecay: 20,
  /** Bonus when the opening is flush against an existing booking (schedule efficiency). */
  adjacency: 40,
};

export interface BestMatchDiagnostics {
  ineligible: { technicianId: ID; technicianName: string; failures: EligibilityFailure[] }[];
}

export function bestMatches(
  ctx: SearchContext,
  q: BestMatchesQuery,
  diagnostics?: BestMatchDiagnostics,
): TechnicianMatch[] {
  const w = { ...DEFAULT_WEIGHTS, ...(q.weights ?? {}) };
  const duration = q.durationMinutes ?? sumServiceDuration(q.services);
  const preferredStart = q.preferredStartMinute ?? ctx.nowMinute ?? 0;
  const matches: TechnicianMatch[] = [];

  for (const t of ctx.technicians) {
    // ---- Phase 1: eligibility ------------------------------------------------
    const elig = evaluateEligibility({
      technician: t,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      services: q.services,
      durationMinutes: duration,
      date: ctx.date,
      timezone: ctx.timezone,
      branchHours: ctx.branchHours,
      appointments: ctx.appointments,
      segments: ctx.segments,
      policy: ctx.policy,
      requestedTechnicianId: q.requestedTechnicianId ?? undefined,
      ignoreAppointmentIds: q.ignoreAppointmentIds,
    });
    if (!elig.eligible) {
      diagnostics?.ineligible.push({ technicianId: t.id, technicianName: t.displayName, failures: elig.failures });
      continue;
    }
    const dayCtx = buildDayContext({
      technician: t,
      date: ctx.date,
      timezone: ctx.timezone,
      branchHours: ctx.branchHours,
      appointments: ctx.appointments,
      segments: ctx.segments,
      ignoreAppointmentIds: q.ignoreAppointmentIds,
    });
    const starts = enumerateStarts(dayCtx, duration, { start: preferredStart, end: 1440 });
    if (starts.length === 0) {
      diagnostics?.ineligible.push({ technicianId: t.id, technicianName: t.displayName, failures: ['NOT_WORKING'] });
      continue; // no full-duration opening today → not eligible (spec §17 "full duration availability")
    }

    // ---- Phase 2: ranking (eligible only) -------------------------------------
    const earliest = starts[0];
    const reasons: string[] = [];
    let score = 0;
    if (q.requestedTechnicianId === t.id) { score += w.requested; reasons.push('Requested by customer'); }
    if (q.preferredTechnicianId === t.id) { score += w.preferred; reasons.push('Customer preference'); }
    const wait = Math.max(0, earliest - preferredStart);
    score -= wait * w.waitPerMinute;
    reasons.push(wait === 0 ? 'Available at requested time' : `Earliest opening in ${wait} min`);
    const sum = daySummary(dayCtx);
    if (sum.workingMinutes > 0) {
      const freePct = (sum.openMinutes / sum.workingMinutes) * 100;
      score += freePct * w.utilizationPerPercent;
      reasons.push(`${Math.round(100 - freePct)}% booked`);
    }
    const breadth = (t.serviceIds?.length ?? q.services.length) - q.services.length;
    score += Math.max(0, breadth) * w.skillBreadth;
    if (q.fairTurnOrder && t.id in q.fairTurnOrder) {
      const pos = q.fairTurnOrder[t.id];
      const bonus = Math.max(0, w.fairTurnTop - pos * w.fairTurnDecay);
      score += bonus;
      if (pos === 0) reasons.push('Next in Fair Turn');
    }
    const adjacent = dayCtx.busy.some((b) => b.end === earliest || b.start === earliest + duration);
    if (adjacent) { score += w.adjacency; reasons.push('Keeps schedule compact'); }

    matches.push({
      technicianId: t.id,
      technicianName: t.displayName,
      score: Math.round(score * 100) / 100,
      earliestStartAt: toISO(ctx.date, earliest, ctx.timezone),
      reasons,
    });
  }
  return matches.sort((a, b) => b.score - a.score || (a.earliestStartAt ?? '').localeCompare(b.earliestStartAt ?? ''));
}
