// ai-queue-assignment-plan.ts — PURE. Serving-time multi-technician routing (contract §2): composes a VISIT plan (one
// technician, or the visit's services split over several) and a PARTY plan (one visit plan per member) from lines the
// ONE engine already ranked — compute() runs once per line with `lineScope`, so every hard rule (branch, clock-in, skill,
// capacity, break, blocked, appointment reservation, station, lock), rotation and the requested / previous / shift-end
// scoring apply per line unchanged. No scorer of its own beyond the two plan terms below, no I/O, no clock.
//
// Product defaults for Kevin (contract §10) — change them here:
//   D1 one technician is preferred when they finish within SINGLE_TECH_GRACE_MIN of the split.
//   D2 at most MAX_PARALLEL_TECHS technicians work on one guest at once, at most MAX_TECHS_PER_VISIT per visit.
//   D3 an add-on follows its parent service; other lines on different technicians run side by side.
//   D6 a manager lock to T keeps every line on T.   D7 a "together" party never shares a technician between members.
// Honesty rule (as the engine): an unknown availability makes the line's and the visit's ETA null — never a guess.
//
// Shift end over the PLANNED window: compute() judges each line as if it started when its technician is free ("now" +
// availability), so a later line (an add-on after its parent, a technician's 2nd line, a "together" party's shared start)
// would never see that the shift ends first. The composer re-judges every placed line with the engine's ONE rule
// (shiftEndCaution) at the line's planned end: a technician who can finish within shift is preferred; otherwise the line is
// kept with the shift-end warning, which makes the plan staff_review (the auto-run never takes a plan with a warning).
// Capacity (by design, contract §11): a technician on a later "after" line holds one capacity slot from assignment, so
// they may look busy before their line starts — the queue's techSignals counts them once per visit.
import type { RequiredAction, VisitPlan, VisitPlanLine, VisitPlanLineCandidate, PartyPlan } from '@aipowersalon/api-contracts/tenant';
import { shiftEndCaution, isShiftEndWarning } from './ai-queue-assignment-engine';

export const PLAN_VERSION = 'qa-plan-1';
export const MAX_PARALLEL_TECHS = 2;
export const MAX_TECHS_PER_VISIT = 3;
export const SINGLE_TECH_GRACE_MIN = 15;
/** a technician already on this plan is preferred for another line (one slot, one hand-off fewer) */
export const SAME_TECH_BONUS = 10;
/** a "together" party whose shared start is further away than this gets a warning with the any-order finish */
export const PARTY_SHARED_START_WARN_MIN = 20;
const CONFIDENCE_FLOOR = 0.55;
const ALTERNATES_PER_LINE = 3;

/** One requested service of the visit (the queue's line, `entry.services`). */
export interface PlanServiceLine {
  serviceId: string; serviceName: string; category: string | null; durationMinutes: number; sequence: number;
  isAddon: boolean; parentServiceId: string | null; assignedTechnicianId: string | null; status: string;
}
/** An ELIGIBLE technician for one line, as the engine ranked them (best first). startInMinutes null = unknown.
 *  shiftEndsInMinutes (from now; null / absent = unknown) lets the composer judge the line at its planned window. */
export interface PlanCandidate { technicianId: string; name: string; matchScore: number; startInMinutes: number | null; reasons: string[]; warnings: string[]; shiftEndsInMinutes?: number | null }
export interface PlanLineInput {
  line: PlanServiceLine; ranked: PlanCandidate[]; ineligible: { technicianId: string; name: string; reasons: string[] }[];
  /** the line envelope's confidence */
  confidence: number; conflicts: string[];
}
export interface ComposeVisitInput {
  queueItemId: string; customerName: string; queueVersion: number | null;
  /** the lead on the guest now (null = unassigned) — the plan's expectation */
  currentTechnicianId: string | null;
  requestedTechnicianId: string | null; requestedTechnicianName: string | null;
  /** undefined = no lock; null = "do not assign anyone yet"; an id = every line on that technician (D6) */
  lockTechnicianId?: string | null;
  /** today's whole-visit result: the single technician who covers every line (null = nobody) */
  whole: { recommended: PlanCandidate | null; confidence: number; warnings: string[]; conflicts: string[] };
  lines: PlanLineInput[];
}
export interface ComposeOpts {
  /** technicians this plan may not use (a "together" party's earlier members — D7) */
  forbid?: ReadonlySet<string>;
  /** minutes every placed line moves later (a "together" party's shared start) — applied before the shift-end check */
  delayBy?: number;
}

interface Placed {
  li: PlanLineInput; cand: PlanCandidate | null;
  start: number; end: number; known: boolean;
  timing: 'parallel' | 'after'; afterServiceId: string | null;
}

const bySeq = (a: PlanLineInput, b: PlanLineInput) => a.line.sequence - b.line.sequence || a.line.serviceId.localeCompare(b.line.serviceId);
/** By sequence, but an add-on never before its parent on the visit (it starts when the parent ends — D3). */
function ordered(lines: PlanLineInput[]): PlanLineInput[] {
  const sorted = [...lines].sort(bySeq);
  const onVisit = new Set(sorted.map((l) => l.line.serviceId));
  const out: PlanLineInput[] = []; const done = new Set<string>(); let waiting: PlanLineInput[] = [];
  const parentOf = (li: PlanLineInput) => (li.line.isAddon && li.line.parentServiceId && li.line.parentServiceId !== li.line.serviceId && onVisit.has(li.line.parentServiceId) ? li.line.parentServiceId : null);
  const push = (li: PlanLineInput) => {
    out.push(li); done.add(li.line.serviceId);
    const ready = waiting.filter((w) => parentOf(w) === li.line.serviceId);
    waiting = waiting.filter((w) => !ready.includes(w));
    for (const r of ready) push(r);
  };
  for (const li of sorted) { const par = parentOf(li); if (par && !done.has(par)) waiting.push(li); else push(li); }
  return [...out, ...waiting];   // a parent cycle (bad data) keeps sequence order
}
const dur = (l: PlanServiceLine) => Math.max(0, Number(l.durationMinutes) || 0);
/** The line's warnings judged at its PLANNED window: the engine's "from now" shift caution is replaced by the same rule
 *  at the planned end. Unknown shift end → the engine's warnings untouched. */
function plannedWarnings(c: PlanCandidate, end: number, d: number): string[] {
  if (typeof c.shiftEndsInMinutes !== 'number') return c.warnings;
  const caution = shiftEndCaution(c.shiftEndsInMinutes, end, d);
  const rest = c.warnings.filter((w) => !isShiftEndWarning(w));
  return caution ? [caution.warning, ...rest] : rest;
}
const overShift = (c: PlanCandidate, end: number, d: number) => shiftEndCaution(c.shiftEndsInMinutes, end, d)?.kind === 'past';
const overruns = (p: Placed[]) => p.some((x) => x.cand && overShift(x.cand, x.end, dur(x.li.line)));
const altOf = (c: PlanCandidate): VisitPlanLineCandidate => ({ technicianId: c.technicianId, name: c.name, matchScore: c.matchScore, estimatedStartInMinutes: c.startInMinutes, reasons: c.reasons, warnings: c.warnings });

/** The candidates a line may use: not forbidden, the lock's technician only (D6), the requested technician when they can. */
function usable(li: PlanLineInput, input: ComposeVisitInput, forbid: ReadonlySet<string>): PlanCandidate[] {
  if (input.lockTechnicianId === null) return [];
  let c = li.ranked.filter((x) => !forbid.has(x.technicianId));
  if (input.lockTechnicianId !== undefined) c = c.filter((x) => x.technicianId === input.lockTechnicianId);
  return c;
}

/** Lines placed one after another on ONE technician (the single-technician option). */
function placeSingle(lines: PlanLineInput[], cand: PlanCandidate, perLine?: (li: PlanLineInput) => PlanCandidate | undefined): Placed[] {
  const out: Placed[] = [];
  let t = Math.max(0, cand.startInMinutes ?? 0); const known = cand.startInMinutes != null; let prev: string | null = null;
  for (const li of lines) {
    const c = perLine?.(li) ?? cand;
    out.push({ li, cand: c, start: t, end: t + dur(li.line), known, timing: prev ? 'after' : 'parallel', afterServiceId: prev });
    t += dur(li.line); prev = li.line.serviceId;
  }
  return out;
}

/** Greedy split by sequence: per line the best of matchScore + SAME_TECH_BONUS (already on the plan) − minutes of delay. */
function placeSplit(input: ComposeVisitInput, lines: PlanLineInput[], forbid: ReadonlySet<string>): Placed[] {
  const onVisit = new Set(lines.map((l) => l.line.serviceId));
  const placed: Placed[] = [];
  const free = new Map<string, { at: number; known: boolean; last: string }>();
  const techs = new Set<string>();
  const requested = input.requestedTechnicianId;
  for (const li of lines) {
    const d = dur(li.line);
    const parent = li.line.isAddon && li.line.parentServiceId && onVisit.has(li.line.parentServiceId) ? placed.find((p) => p.li.line.serviceId === li.line.parentServiceId && p.cand) : undefined;
    let cands = usable(li, input, forbid);
    // the guest's requested technician keeps every line they can do
    if (requested && cands.some((c) => c.technicianId === requested)) cands = cands.filter((c) => c.technicianId === requested);
    // a technician who finishes this line within their shift (at its planned window) beats one who would not
    let best: { c: PlanCandidate; score: number; start: number; known: boolean; fits: boolean } | null = null;
    for (const c of cands) {
      if (!techs.has(c.technicianId) && techs.size >= MAX_TECHS_PER_VISIT) continue;
      const mine = free.get(c.technicianId);
      let start = Math.max(mine ? mine.at : Math.max(0, c.startInMinutes ?? 0), parent ? parent.end : 0);
      start = parallelSlot(placed, c.technicianId, start, d);
      const known = (mine ? mine.known : c.startInMinutes != null) && (!parent || parent.known);
      const score = c.matchScore + (techs.has(c.technicianId) ? SAME_TECH_BONUS : 0) - start;
      const fits = !overShift(c, start + d, d);
      if (!best || (fits && !best.fits) || (fits === best.fits && score > best.score)) best = { c, score, start, known, fits };
    }
    if (!best) { placed.push({ li, cand: null, start: 0, end: 0, known: false, timing: 'parallel', afterServiceId: null }); continue; }
    const mine = free.get(best.c.technicianId);
    const timing: 'parallel' | 'after' = parent || mine ? 'after' : 'parallel';
    const afterServiceId = parent ? parent.li.line.serviceId : mine ? mine.last : null;
    placed.push({ li, cand: best.c, start: best.start, end: best.start + d, known: best.known, timing, afterServiceId });
    techs.add(best.c.technicianId);
    free.set(best.c.technicianId, { at: best.start + d, known: best.known, last: li.line.serviceId });
  }
  return placed;
}

/** D2: never more than MAX_PARALLEL_TECHS technicians at once — wait for the earliest other line to end. */
function parallelSlot(placed: Placed[], techId: string, start: number, d: number): number {
  let s = start;
  for (let guard = 0; guard < 50; guard++) {
    const others = placed.filter((p) => p.cand && p.cand.technicianId !== techId && p.start < s + Math.max(d, 1) && s < p.end);
    if (new Set(others.map((p) => p.cand!.technicianId)).size < MAX_PARALLEL_TECHS) return s;
    s = Math.min(...others.map((p) => p.end));
  }
  return s;
}

function finishOf(p: Placed[]): number | null {
  const a = p.filter((x) => x.cand);
  if (!a.length || a.some((x) => !x.known)) return null;
  return Math.max(...a.map((x) => x.end));
}
function leadOf(p: Placed[]): string | null {
  const a = p.filter((x) => x.cand);
  if (!a.length) return null;
  const minutes = new Map<string, number>();
  for (const x of a) minutes.set(x.cand!.technicianId, (minutes.get(x.cand!.technicianId) ?? 0) + dur(x.li.line));
  const s = [...a].sort((x, y) => x.start - y.start || (minutes.get(y.cand!.technicianId)! - minutes.get(x.cand!.technicianId)!) || x.li.line.sequence - y.li.line.sequence);
  return s[0].cand!.technicianId;
}

export function composeVisitPlan(input: ComposeVisitInput, opts: ComposeOpts = {}): VisitPlan {
  const forbid = opts.forbid ?? new Set<string>();
  const lines = ordered(input.lines.filter((l) => l.line.status !== 'cancelled'));
  const requested = input.requestedTechnicianId;

  // 1. the single-technician option: today's whole-visit pick, or the requested technician when they cover every line
  const reqCovers = !!requested && lines.length > 0 && lines.every((li) => usable(li, input, forbid).some((c) => c.technicianId === requested));
  let single: PlanCandidate | null = null;
  if (reqCovers) single = lines[0].ranked.find((c) => c.technicianId === requested) ?? null;
  else if (input.whole.recommended && !forbid.has(input.whole.recommended.technicianId) && input.lockTechnicianId !== null
    && (input.lockTechnicianId === undefined || input.lockTechnicianId === input.whole.recommended.technicianId)) single = input.whole.recommended;
  const singlePlaced = single && lines.length ? placeSingle(lines, single, (li) => li.ranked.find((c) => c.technicianId === single!.technicianId)) : null;

  // 2. the split
  const split = lines.length ? placeSplit(input, lines, forbid) : null;
  const splitComplete = !!split && split.every((p) => p.cand);

  // 3. prefer one technician (D1), or the requested technician covering every line — unless one technician would run past
  //    their shift and a complete split finishes everyone within shift
  const splitBeatsShift = !!singlePlaced && splitComplete && overruns(singlePlaced) && !overruns(split!);
  let mode: 'single' | 'split'; let placed: Placed[];
  if (singlePlaced && (reqCovers || !splitComplete || (!splitBeatsShift && withinGrace(finishOf(singlePlaced), finishOf(split!))))) { mode = 'single'; placed = singlePlaced; }
  else if (split) { placed = split; mode = new Set(split.filter((p) => p.cand).map((p) => p.cand!.technicianId)).size > 1 ? 'split' : 'single'; }
  else { mode = 'single'; placed = lines.map((li) => ({ li, cand: null, start: 0, end: 0, known: false, timing: 'parallel' as const, afterServiceId: null })); }

  // a "together" party's shared start moves every line; the shift-end check below then sees the moved window
  if (opts.delayBy) placed = placed.map((p) => (p.cand ? { ...p, start: p.start + opts.delayBy!, end: p.end + opts.delayBy! } : p));

  const assigned = placed.filter((p) => p.cand);
  const etaKnown = assigned.length > 0 && assigned.every((p) => p.known);
  const outLines: VisitPlanLine[] = placed.map((p) => {
    const l = p.li.line;
    const alternates = p.li.ranked.filter((c) => c.technicianId !== p.cand?.technicianId && !forbid.has(c.technicianId)).slice(0, ALTERNATES_PER_LINE).map(altOf);
    return {
      queueItemId: input.queueItemId, serviceId: l.serviceId, serviceName: l.serviceName, category: l.category, durationMinutes: dur(l), sequence: l.sequence,
      technicianId: p.cand?.technicianId ?? null, technicianName: p.cand?.name ?? null, expectedTechnicianId: l.assignedTechnicianId ?? null,
      timing: p.timing, afterServiceId: p.afterServiceId,
      estimatedStartInMinutes: p.cand && p.known ? p.start : null, estimatedEndInMinutes: p.cand && p.known ? p.end : null,
      confidence: mode === 'single' && p.cand ? input.whole.confidence : p.li.confidence,
      reasons: p.cand?.reasons ?? [], warnings: p.cand ? plannedWarnings(p.cand, p.end, dur(l)) : [], alternates, ineligible: p.li.ineligible,
    };
  });

  // 4. ETA (honesty: one unknown line → the visit's ETA is unknown)
  const estimatedStartInMinutes = etaKnown ? Math.min(...assigned.map((p) => p.start)) : null;
  const estimatedFinishInMinutes = etaKnown ? Math.max(...assigned.map((p) => p.end)) : null;

  // 5. confidence, warnings, conflicts, required action
  const warnings: string[] = [];
  for (const l of outLines) for (const w of l.warnings) { const s = `${l.serviceName}: ${w}`; if (!warnings.includes(s)) warnings.push(s); }
  if (requested && !outLines.some((l) => l.technicianId === requested)) {
    const why = lines.flatMap((li) => li.ineligible.filter((i) => i.technicianId === requested).flatMap((i) => i.reasons));
    warnings.push(`The guest asked for ${input.requestedTechnicianName || 'another technician'}${why.length ? ` (${[...new Set(why)].join(', ')})` : ''} — check with the guest before assigning someone else`);
  }
  const conflicts: string[] = [];
  if (input.lockTechnicianId === null) conflicts.push('Locked — do not assign anyone yet');
  for (const p of placed) if (!p.cand) conflicts.push(`${p.li.line.serviceName}: ${p.li.conflicts[0] ?? 'No eligible technician'}`);
  const confidence = outLines.length ? Math.min(...outLines.map((l) => l.confidence)) : 0;
  const requiredAction: RequiredAction = !outLines.length || outLines.some((l) => !l.technicianId) ? 'no_eligible_technician'
    : warnings.length || confidence < CONFIDENCE_FLOOR ? 'staff_review' : 'assignable';
  const lead = leadOf(placed);
  return {
    queueItemId: input.queueItemId, customerName: input.customerName, queueVersion: input.queueVersion, expectedTechnicianId: input.currentTechnicianId,
    mode, leadTechnicianId: lead, lines: outLines, technicianCount: new Set(assigned.map((p) => p.cand!.technicianId)).size,
    estimatedStartInMinutes, estimatedFinishInMinutes,
    singleTechnicianAlternative: mode === 'split' && singlePlaced ? { technicianId: single!.technicianId, name: single!.name, estimatedFinishInMinutes: finishOf(singlePlaced) } : null,
    confidence, warnings, conflicts, requiredAction,
  };
}
function withinGrace(singleFinish: number | null, splitFinish: number | null): boolean {
  if (singleFinish == null || splitFinish == null) return true;   // unknown → never trade one technician for a guess
  return singleFinish <= splitFinish + SINGLE_TECH_GRACE_MIN;
}

const RANK: Record<RequiredAction, number> = { assignable: 0, staff_review: 1, no_eligible_technician: 2 };

/** A party: members in check-in order. together = every member starts at the shared start and no technician serves two
 *  members (D7); any order = each member as soon as possible. */
export function composePartyPlan(input: { groupId: string; label: string; together: boolean; members: ComposeVisitInput[] }): PartyPlan {
  const compose = (delays: (number | undefined)[]) => {
    const used = new Set<string>();
    return input.members.map((m, i) => {
      const p = composeVisitPlan(m, { forbid: input.together ? used : new Set(), delayBy: delays[i] });
      for (const l of p.lines) if (l.technicianId) used.add(l.technicianId);
      return p;
    });
  };
  let members: VisitPlan[] = compose([]);
  const finishes = members.map((m) => m.estimatedFinishInMinutes);
  const anyOrderFinishInMinutes = finishes.length && finishes.every((f) => f != null) ? Math.max(...(finishes as number[])) : null;
  const warnings: string[] = []; const conflicts: string[] = [];
  let sharedStartInMinutes: number | null = null;
  if (input.together) {
    const starts = members.map((m) => m.estimatedStartInMinutes);
    sharedStartInMinutes = starts.length && starts.every((s) => s != null) ? Math.max(...(starts as number[])) : null;
    // recompose with each member moved to the shared start (same picks — placement does not depend on the delay), so every
    // line's ETA and shift-end check use the window it will really run in
    if (sharedStartInMinutes != null) { const s = sharedStartInMinutes; members = compose(members.map((m) => s - (m.estimatedStartInMinutes as number))); }
    if (sharedStartInMinutes != null && sharedStartInMinutes > PARTY_SHARED_START_WARN_MIN) {
      warnings.push(`Starting together means the party waits ~${sharedStartInMinutes} min; one by one, everyone would be done in ~${anyOrderFinishInMinutes ?? '?'} min`);
    }
  }
  for (const m of members) {
    for (const w of m.warnings) warnings.push(`${m.customerName}: ${w}`);
    for (const c of m.conflicts) conflicts.push(`${m.customerName}: ${c}`);
  }
  const ends = members.map((m) => m.estimatedFinishInMinutes);
  const estimatedFinishInMinutes = ends.length && ends.every((f) => f != null) ? Math.max(...(ends as number[])) : null;
  const confidence = members.length ? Math.min(...members.map((m) => m.confidence)) : 0;
  let requiredAction: RequiredAction = members.reduce<RequiredAction>((a, m) => (RANK[m.requiredAction] > RANK[a] ? m.requiredAction : a), 'assignable');
  if (requiredAction === 'assignable' && (warnings.length || confidence < CONFIDENCE_FLOOR)) requiredAction = 'staff_review';
  return { groupId: input.groupId, label: input.label, together: input.together, members, sharedStartInMinutes, estimatedFinishInMinutes, anyOrderFinishInMinutes, confidence, warnings, conflicts, requiredAction };
}
