// ai-scheduling-day.ts — BUILD_PLAN Phase 7: the PURE day model every optimizer decision reads (options, generate's gate +
// simulation, runs' detection). The reader (ai-scheduling.booking-read.adapter.ts) fills a DayData from the real booking
// and technician tables; everything here is deterministic minutes-from-midnight arithmetic in the branch's zone.
//
// What the Oct 6 audit found and this file fixes:
//   • the gate saw `techShifts:[branchHours]`, `breaks:[]`, `timeOff:[]` — now each technician's own shift windows
//     (technician_shifts > weekly schedule > store hours), breaks (lunch + jsonb breaks + blocked times) and approved time off;
//   • all services were summed into one block — now each service is its own block (its learned duration), in order, with the
//     service profile's setup / cleanup around the visit and the booking buffer around every other appointment;
//   • "locked" was checked_in / in_progress (not a status) / completed — now every started status, a paid deposit and a
//     manual lock (appointment_schedule_locks);
//   • every technician was "at the session branch" — now technicians.branch_id (NULL = every location of the salon);
//   • lunch was reported as a gap and the simulation returned client metrics — now dayMetrics re-measures the day itself;
//   • a second utilization formula — utilizationPct is the canonical workforce rule (see below).
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import { serviceSkillVerdict } from '@aipowersalon/workforce';
import { type Range, chainServices, subtractRanges, durationOf, overlaps, totalCovered, intersect, mergeRanges } from './ai-scheduling-core';
import { checkHardConstraints, type HardViolation, type Placement, type ConstraintContext, type ExistingAppt } from './ai-scheduling-constraints';
import { detectGaps, detectConflicts, type ApptRec, type Severity } from './ai-scheduling-detection';
import { rankOptions, ruleBasedFallback, components, type Candidate, type PlacementSignals } from './ai-scheduling-optimizer';
import type { ScheduleMetrics } from './ai-scheduling-recommendation';
import type { SchedulingConfig } from './ai-scheduling-settings';

/** PBStatus values (booking.dto) after which an appointment has started and must never be moved. */
export const LOCKED_STATUSES: ReadonlySet<string> = new Set(['arrived', 'checked_in', 'waiting', 'in_service', 'completed']);
export const INACTIVE_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'no_show']);
/** Channels where the CUSTOMER chose the technician (staff-entered walk-in / manual bookings are staff-assigned). */
export const CUSTOMER_CHOSEN_SOURCES: ReadonlySet<string> = new Set(['online', 'google', 'ai', 'customer_app', 'phone']);

export interface DayTech { technicianId: string; name: string; available: boolean; branchIds: string[]; skills: string[]; /** B-82: the exact services she is approved for (absent → the category rule: in-memory / a legacy unmapped technician) */ approvedServiceIds?: string[]; shifts: Range[]; breaks: Range[]; timeOff: Range[] }
export interface DayService { serviceId: string; name: string; categoryName: string; durationMin: number; setupMin: number; cleanupMin: number; maxGroupSize: number | null }
export interface DayAppt {
  id: string; technicianId: string | null; customerId: string | null; status: string; source: string | null;
  date: string; startMin: number; endMin: number; version: number; depositStatus: string | null; serviceIds: string[]; manualLock: boolean;
}
export interface DayData {
  date: string; branchId: string; timeZone: string;
  branchHours: Range | null; bufferMin: number; slotIntervalMin: number;
  techs: DayTech[]; services: Record<string, DayService>;
  /** approved service_duration_recommendations: `${technicianId}:${serviceId}` → min, and the branch/salon row per service */
  durationByTechService: Record<string, number>; durationByService: Record<string, number>;
  appts: DayAppt[];                                   // every appointment of the day at this branch (all statuses)
  holds: { technicianId: string | null; range: Range }[];   // LIVE booking holds (not released / converted / expired)
  nowMin: number | null;                              // the branch's minute when `date` is today, else null
  isPast: boolean;                                    // `date` is before the branch's today
}
export interface MoveTarget { date: string; startMin: number; technicianId: string | null }

export const toMin = (hhmmStr: string): number => { const [h, m] = String(hhmmStr).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;
const active = (a: DayAppt) => !INACTIVE_STATUSES.has(a.status);

export const isLockedAppt = (a: DayAppt): boolean => LOCKED_STATUSES.has(a.status) || a.depositStatus === 'paid' || a.manualLock;

/** The canonical utilization rule (modules/workforce/src/tech-utilization/tech-utilization.ts computeUtilization):
 *  min(100, round(busy / available × 100)); null when there is no available time (never an invented denominator).
 *  Mirrored here because @aipowersalon/workforce does not export the pure function (only the DB loader) — see report. */
export function utilizationPct(busyMin: number, availableMin: number): number | null {
  if (!availableMin || availableMin <= 0) return null;
  return Math.min(100, Math.round((busyMin / availableMin) * 100));
}

/** Duration hierarchy: approved (technician, service) → approved (service, branch / salon) → catalog. */
export function serviceDurationFor(day: DayData, technicianId: string | null, serviceId: string): number {
  const t = technicianId ? day.durationByTechService[`${technicianId}:${serviceId}`] : undefined;
  if (t != null && t > 0) return t;
  const b = day.durationByService[serviceId];
  if (b != null && b > 0) return b;
  return day.services[serviceId]?.durationMin ?? 0;
}

/** One block per service, in order (never summed). `start` is when the first service starts; the profile's setup sits
 *  before it and the last service's cleanup after the last block — both inside the visit span. */
export function visitBlocks(day: DayData, technicianId: string | null, serviceIds: string[], start: number, fallbackDurationMin = 0) {
  const ids = serviceIds.filter(Boolean);
  if (!ids.length) {
    const d = Math.max(1, fallbackDurationMin);
    return { services: [] as { serviceId: string; start: number; end: number }[], blocks: [{ start, end: start + d }], span: { start, end: start + d } };
  }
  const svc = ids.map((id) => ({ id, duration: Math.max(1, serviceDurationFor(day, technicianId, id) || fallbackDurationMin || 1), setup: day.services[id]?.setupMin ?? 0, cleanup: day.services[id]?.cleanupMin ?? 0 }));
  // setup only before the first service, cleanup only after the last: the visit is one sitting
  const chained = chainServices(start - svc[0].setup, svc.map((s, i) => ({ duration: s.duration, setup: i === 0 ? s.setup : 0, cleanup: i === svc.length - 1 ? s.cleanup : 0 })));
  return { services: chained.blocks.map((b, i) => ({ serviceId: svc[i].id, start: b.start, end: b.end })), blocks: chained.blocks, span: chained.span };
}

const techOf = (day: DayData, id: string | null) => (id ? day.techs.find((t) => t.technicianId === id) ?? null : null);
const groupCapacity = (day: DayData, serviceIds: string[]): number | undefined => {
  const caps = serviceIds.map((id) => day.services[id]?.maxGroupSize).filter((x): x is number => x != null && x > 0);
  return caps.length ? Math.min(...caps) : undefined;
};
const skillsFor = (day: DayData, tech: DayTech | null, serviceIds: string[]): Record<string, boolean> => {
  // B-82 (Oct 23 2026): the workforce eligibility rule — the EXACT service, and an add-on is covered by any main service in
  // the same request (D2). Only without exact approvals (in-memory, a legacy unmapped technician) the category rule.
  // §24 (Kevin, Oct 27 2026): THE workforce skill rule — exact for a configured technician, the category fallback for one
  // with no services set up (approvedServiceIds empty), never a second derivation here
  if (tech?.approvedServiceIds) {
    const info = Object.fromEntries(serviceIds.map((id) => [id, { isAddOn: isAddOnCategory(day.services[id]?.categoryName), categoryName: day.services[id]?.categoryName ?? null }]));
    return serviceSkillVerdict(tech.approvedServiceIds, info, serviceIds).allowed;
  }
  return Object.fromEntries(serviceIds.map((id) => { const cat = day.services[id]?.categoryName; return [id, !!tech && (!cat || tech.skills.includes(cat))]; }));
};

/** THE workforce skill rule (skillsFor) for one service — exported for read-only summaries (capacity heatmap); never a second rule. */
export function techQualifiedFor(day: DayData, technicianId: string, serviceId: string): boolean {
  return !!skillsFor(day, techOf(day, technicianId), [serviceId])[serviceId];
}

/** The gate's context for one technician on this day — real shifts, breaks, time off, every other appointment widened by
 *  the booking buffer on both sides. Stations: pos_stations are checkout terminals, not service chairs, so the station
 *  constraint stays dormant (no stationId on placements) — a recorded Phase 7 decision. */
export function constraintContext(day: DayData, technicianId: string | null, serviceIds: string[]): ConstraintContext {
  const tech = techOf(day, technicianId);
  const b = Math.max(0, day.bufferMin);
  const existing: ExistingAppt[] = day.appts.filter((a) => active(a) && a.technicianId)
    .map((a) => ({ id: a.id, technicianId: a.technicianId as string, range: { start: a.startMin - b, end: a.endMin + b }, locked: isLockedAppt(a) }));
  return {
    branchHours: day.branchHours,
    techBranchIds: tech?.branchIds ?? [],
    techShifts: tech && tech.available ? tech.shifts : [],
    techSkills: skillsFor(day, tech, serviceIds),
    breaks: tech?.breaks ?? [],
    timeOff: tech?.timeOff ?? [],
    existingAppointments: existing,
    groupCapacity: groupCapacity(day, serviceIds),
  };
}

/** Judge moving `a` to `to` on `day` (the TARGET date's day). Returns every violation (empty = feasible). */
export function checkMove(day: DayData, a: DayAppt, to: MoveTarget, opts: { groupSize?: number | null; requiredTechnicianId?: string | null } = {}): HardViolation[] {
  if (!to.technicianId) return [{ code: 'TECH_NOT_SCHEDULED', message: 'a technician is required' }];
  const visit = visitBlocks(day, to.technicianId, a.serviceIds, to.startMin, a.endMin - a.startMin);
  const placement: Placement = {
    technicianId: to.technicianId, branchId: day.branchId, serviceIds: a.serviceIds, blocks: [visit.span], span: visit.span,
    requiredTechnicianId: opts.requiredTechnicianId ?? null, movesAppointmentId: a.id, groupSize: opts.groupSize ?? undefined,
  };
  const ctx = constraintContext(day, to.technicianId, a.serviceIds);
  if (!ctx.existingAppointments.some((x) => x.id === a.id)) ctx.existingAppointments.push({ id: a.id, technicianId: a.technicianId ?? '', range: { start: -1, end: -1 }, locked: isLockedAppt(a) });
  return checkHardConstraints(placement, ctx).violations;
}

/** Day copy with one appointment moved (removed when it moves to another date; added when it arrives from one). */
export function withMove(day: DayData, apptId: string, to: { date: string; startMin: number; endMin: number; technicianId: string | null }, moving?: DayAppt): DayData {
  const src = day.appts.find((a) => a.id === apptId) ?? moving;
  const rest = day.appts.filter((a) => a.id !== apptId);
  if (to.date !== day.date || !src) return { ...day, appts: rest };
  return { ...day, appts: [...rest, { ...src, date: to.date, startMin: to.startMin, endMin: to.endMin, technicianId: to.technicianId }] };
}

interface TechDay { tech: DayTech; windows: Range[]; blocked: Range[]; ranges: Range[]; availableMin: number; busyMin: number }
function techDays(day: DayData): TechDay[] {
  return day.techs.filter((t) => t.available).map((tech) => {
    const windows = mergeRanges(tech.shifts);
    const blocked = mergeRanges([...tech.breaks, ...tech.timeOff]);
    const blockedInShift = windows.flatMap((w) => blocked.map((b) => intersect(w, b)).filter((x): x is Range => !!x));
    const ranges = day.appts.filter((a) => active(a) && a.technicianId === tech.technicianId).map((a) => ({ start: a.startMin, end: a.endMin }));
    return { tech, windows, blocked, ranges, availableMin: Math.max(0, totalCovered(windows) - totalCovered(blockedInShift)), busyMin: ranges.reduce((n, r) => n + durationOf(r), 0) };
  });
}

/** Re-measure the day (the server-side simulation — never a client-supplied number).
 *  idle  = free shift minutes stranded BEFORE a technician's last appointment (breaks / time off are not idle);
 *  gaps  = how many such stranded windows; utilization = the canonical rule over the branch's technicians;
 *  lateness risk = % of active appointments in a double booking or beyond their technician's shift; wait = 0 (no wait
 *  signal exists for future appointments — reported honestly, never invented). */
export function dayMetrics(day: DayData, _cfg?: Pick<SchedulingConfig, 'gapMinServiceMin'>): ScheduleMetrics {
  let idle = 0, gaps = 0, busy = 0, avail = 0;
  for (const td of techDays(day)) {
    busy += td.busyMin; avail += td.availableMin;
    if (!td.ranges.length) continue;
    const lastEnd = Math.max(...td.ranges.map((r) => r.end));
    for (const w of td.windows) {
      for (const f of subtractRanges(w, [...td.blocked, ...td.ranges])) {
        const clipped = intersect(f, { start: w.start, end: lastEnd });
        if (clipped && durationOf(clipped) > 0) { idle += durationOf(clipped); gaps++; }
      }
    }
  }
  const assigned = day.appts.filter((a) => active(a) && a.technicianId);
  const shiftsByTech = Object.fromEntries(day.techs.map((t) => [t.technicianId, t.shifts]));
  const risky = new Set<string>();
  for (const c of detectConflicts(assigned.map(toApptRec), { shiftsByTech })) if (c.type === 'DOUBLE_BOOK' || c.type === 'BEYOND_SHIFT') c.appointmentIds.forEach((id) => risky.add(id));
  return {
    idleMin: idle, waitMin: 0, utilizationPct: utilizationPct(busy, avail) ?? 0, gapCount: gaps,
    latenessRiskPct: assigned.length ? Math.round((risky.size / assigned.length) * 100) : 0,
  };
}
export const sumMetrics = (a: ScheduleMetrics, b: ScheduleMetrics): ScheduleMetrics => ({
  idleMin: a.idleMin + b.idleMin, waitMin: a.waitMin + b.waitMin, utilizationPct: Math.round((a.utilizationPct + b.utilizationPct) / 2),
  gapCount: a.gapCount + b.gapCount, latenessRiskPct: Math.max(a.latenessRiskPct, b.latenessRiskPct),
});

const toApptRec = (a: DayAppt): ApptRec => ({ id: a.id, technicianId: a.technicianId as string, range: { start: a.startMin, end: a.endMin } });
const SEVERITY: Record<Severity, 'critical' | 'warning' | 'info'> = { high: 'critical', medium: 'warning', low: 'info' };

export interface DetectedGap { technicianId: string; startMin: number; endMin: number; durationMin: number; cause: string; servicesThatFit: string[]; confidence: number }
export interface DetectedConflict { type: string; severity: 'critical' | 'warning' | 'info'; appointmentIds: string[]; technicianId: string | null; message: string }
/** Gaps (breaks / time off / blocked time are never gaps) and booking conflicts for every technician of the day. */
export function detectDay(day: DayData, cfg: Pick<SchedulingConfig, 'gapMinServiceMin' | 'largeBlockMin'>): { gaps: DetectedGap[]; conflicts: DetectedConflict[]; perTechUtilization: Record<string, number | null> } {
  const services = Object.values(day.services).map((s) => ({ serviceId: s.serviceId, durationMin: s.durationMin }));
  const gaps: DetectedGap[] = [];
  const perTechUtilization: Record<string, number | null> = {};
  for (const td of techDays(day)) {
    perTechUtilization[td.tech.technicianId] = utilizationPct(td.busyMin, td.availableMin);
    for (const w of td.windows) {
      const inWin = td.ranges.map((r) => intersect(r, w)).filter((x): x is Range => !!x);
      for (const g of detectGaps(w, inWin, td.blocked, { services, minServiceMin: cfg.gapMinServiceMin, largeBlockMin: cfg.largeBlockMin })) {
        gaps.push({ technicianId: td.tech.technicianId, startMin: g.range.start, endMin: g.range.end, durationMin: g.durationMin, cause: g.cause, servicesThatFit: g.servicesThatFit, confidence: g.confidence });
      }
    }
  }
  const assigned = day.appts.filter((a) => active(a) && a.technicianId);
  const shiftsByTech = Object.fromEntries(day.techs.map((t) => [t.technicianId, t.shifts]));
  const byId = new Map(assigned.map((a) => [a.id, a]));
  const conflicts = detectConflicts(assigned.map(toApptRec), { shiftsByTech, branchHours: day.branchHours }).map((c) => ({
    type: c.type, severity: SEVERITY[c.severity], appointmentIds: c.appointmentIds, message: c.message,
    technicianId: byId.get(c.appointmentIds[0])?.technicianId ?? null,
  }));
  return { gaps, conflicts, perTechUtilization };
}

/** Server-derived: does this change touch a customer's confirmed appointment (→ customer approval)? Yes when the
 *  appointment has a customer and its date / start changes, or its technician changes and the customer chose that
 *  technician; never for a cancelled / no-show / completed appointment. */
export function touchesConfirmed(a: DayAppt, to: MoveTarget): boolean {
  if (INACTIVE_STATUSES.has(a.status) || a.status === 'completed') return false;
  const timeChanges = to.date !== a.date || to.startMin !== a.startMin;
  if (a.customerId && timeChanges) return true;
  const techChanges = (to.technicianId ?? null) !== (a.technicianId ?? null);
  return techChanges && !!a.technicianId && !!a.source && CUSTOMER_CHOSEN_SOURCES.has(a.source);
}

// ── options ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OptionsInput {
  date: string; serviceIds: string[]; preferredTime?: string | null; technicianId?: string | null; preferredTechnicianId?: string | null;
  requiredTechnicianId?: string | null; groupSize?: number | null; excludeAppointmentId?: string | null;
}
export interface DayOption {
  id: string; technicianId: string; technicianName: string; date: string; startTime: string; endTime: string;
  score: number; breakdown: Record<string, number>; blocks: { serviceId: string; startTime: string; endTime: string }[];
  reasons: string[]; reasonCodes: string[]; fallback: boolean; spanStartMin: number; spanEndMin: number;
}

/** the labels and their codes (srv.SCHED_REASON.*, Vietnamese POS §21), same order */
const reasonPairs = (s: PlacementSignals, hasRequested: boolean): [string, string][] => {
  const r: [string, string][] = [];
  if (s.matchesPreferredTech) r.push(['PREFERRED_TECH', 'your preferred technician']);
  if (hasRequested && s.minutesFromRequested === 0) r.push(['AT_REQUESTED', 'at the requested time']);
  else if (hasRequested && s.minutesFromRequested <= 30) r.push(['NEAR_REQUESTED', 'close to the requested time']);
  if (s.gapLeftoverMin === 0) r.push(['FILLS_GAP', 'fills an open gap exactly']);
  else if (s.adjacentToExisting) r.push(['ADJACENT', 'next to an existing appointment (no idle gap)']);
  if (!s.nearOvertime) r.push(['INSIDE_SHIFT', 'well inside the technician’s shift']);
  return r;
};
const reasonsFor = (s: PlacementSignals, hasRequested: boolean): string[] => reasonPairs(s, hasRequested).map((x) => x[1]);
const reasonCodesFor = (s: PlacementSignals, hasRequested: boolean): string[] => reasonPairs(s, hasRequested).map((x) => x[0]);

/** Every feasible placement for the request (hard gate FIRST, live holds excluded), scored by the tenant's weights; a
 *  rule-based ordering when every candidate's signals are identical (fallback:true). Never books anything. */
export function enumerateOptions(day: DayData, req: OptionsInput, cfg: Pick<SchedulingConfig, 'weights' | 'utilizationTargetPct' | 'bookingIntervalMin' | 'minLeadTimeMin'>, limit: number): { options: DayOption[]; considered: number } {
  if (day.isPast || !day.branchHours) return { options: [], considered: 0 };
  const interval = Math.max(5, cfg.bookingIntervalMin || day.slotIntervalMin || 15);
  const lower = day.nowMin != null ? day.nowMin + Math.max(0, cfg.minLeadTimeMin) : 0;
  const requested = req.preferredTime ? toMin(req.preferredTime) : null;
  const exclude = req.excludeAppointmentId ?? null;
  const base: DayData = exclude ? { ...day, appts: day.appts.filter((a) => a.id !== exclude) } : day;
  const tds = new Map(techDays(base).map((t) => [t.tech.technicianId, t]));
  const candidates: Candidate<{ tech: DayTech; start: number; visit: ReturnType<typeof visitBlocks> }>[] = [];
  let considered = 0;
  const pseudo: DayAppt = { id: exclude ?? '__new__', technicianId: null, customerId: null, status: 'booked', source: null, date: day.date, startMin: 0, endMin: 0, version: 0, depositStatus: null, serviceIds: req.serviceIds, manualLock: false };
  for (const tech of base.techs) {
    if (!tech.available) continue;
    if (req.technicianId && tech.technicianId !== req.technicianId) continue;
    const td = tds.get(tech.technicianId);
    const windowsEnd = tech.shifts.length ? Math.max(...tech.shifts.map((s) => s.end)) : 0;
    const first = Math.ceil(Math.max(base.branchHours!.start, lower) / interval) * interval;
    for (let start = first; start < base.branchHours!.end; start += interval) {
      considered++;
      const visit = visitBlocks(base, tech.technicianId, req.serviceIds, start);
      const viol = checkMove(base, pseudo, { date: base.date, startMin: start, technicianId: tech.technicianId }, { groupSize: req.groupSize, requiredTechnicianId: req.requiredTechnicianId });
      if (viol.length) continue;
      if (base.holds.some((h) => (h.technicianId == null || h.technicianId === tech.technicianId) && overlaps(h.range, visit.span))) continue;
      const free = subtractRanges({ start: base.branchHours!.start, end: base.branchHours!.end }, [...(td?.blocked ?? []), ...(td?.ranges ?? []).map((r) => ({ start: r.start - base.bufferMin, end: r.end + base.bufferMin }))])
        .filter((f) => tech.shifts.some((s) => overlaps(s, f))).map((f) => tech.shifts.map((s) => intersect(s, f)).find((x) => x && x.start <= visit.span.start && x.end >= visit.span.end)).find(Boolean);
      const visitMin = durationOf(visit.span);
      const signals: PlacementSignals = {
        waitMin: requested != null ? Math.max(0, start - requested) : 0,
        gapLeftoverMin: free ? Math.max(0, durationOf(free) - visitMin) : 0,
        matchesPreferredTech: !!req.preferredTechnicianId && tech.technicianId === req.preferredTechnicianId,
        minutesFromRequested: requested != null ? Math.abs(start - requested) : 0,
        techUtilizationPct: utilizationPct((td?.busyMin ?? 0) + visitMin, td?.availableMin ?? 0) ?? 0,
        techLoadPct: utilizationPct(td?.busyMin ?? 0, td?.availableMin ?? 0) ?? 0,
        adjacentToExisting: (td?.ranges ?? []).some((r) => r.end + base.bufferMin === visit.span.start || visit.span.end + base.bufferMin === r.start),
        nearOvertime: visit.span.end > windowsEnd - 30,
      };
      candidates.push({ id: `${tech.technicianId}@${day.date}T${hhmm(start)}`, signals, meta: { tech, start, visit } });
    }
  }
  const flat = new Set(candidates.map((c) => JSON.stringify(components(c.signals, cfg.utilizationTargetPct)))).size <= 1;
  let ranked: { id: string; score: number; breakdown: Record<string, number>; meta?: { tech: DayTech; start: number; visit: ReturnType<typeof visitBlocks> }; signals: PlacementSignals }[];
  if (flat && candidates.length) {
    // thin signal: the deterministic rule — preferred technician, least wait, earliest start (ruleBasedFallback's order)
    const top = ruleBasedFallback(candidates);
    const order = [...candidates].sort((a, b) => (Number(b.signals.matchesPreferredTech) - Number(a.signals.matchesPreferredTech)) || (a.signals.waitMin - b.signals.waitMin) || (a.meta!.start - b.meta!.start) || a.id.localeCompare(b.id));
    const firstIdx = order.findIndex((c) => c.id === top?.id);
    if (firstIdx > 0) order.unshift(order.splice(firstIdx, 1)[0]);
    ranked = order.map((c) => ({ id: c.id, score: 0, breakdown: { fallback: 1 }, meta: c.meta, signals: c.signals }));
  } else {
    const bySig = new Map(candidates.map((c) => [c.id, c.signals]));
    ranked = rankOptions(candidates, cfg.weights, cfg.utilizationTargetPct).map((r) => ({ ...r, signals: bySig.get(r.id)! }));
  }
  const options = ranked.slice(0, Math.max(1, limit)).map((r) => {
    const m = r.meta!;
    const blocks = m.visit.services.length ? m.visit.services.map((s) => ({ serviceId: s.serviceId, startTime: hhmm(s.start), endTime: hhmm(s.end) })) : [];
    const startMin = m.visit.services[0]?.start ?? m.start;
    const endMin = m.visit.services.length ? m.visit.services[m.visit.services.length - 1].end : m.visit.span.end;
    return {
      id: r.id, technicianId: m.tech.technicianId, technicianName: m.tech.name, date: day.date, startTime: hhmm(startMin), endTime: hhmm(endMin),
      score: r.score, breakdown: r.breakdown, blocks, reasons: reasonsFor(r.signals, requested != null), reasonCodes: reasonCodesFor(r.signals, requested != null), fallback: flat,
      spanStartMin: m.visit.span.start, spanEndMin: m.visit.span.end,
    };
  });
  return { options, considered };
}
