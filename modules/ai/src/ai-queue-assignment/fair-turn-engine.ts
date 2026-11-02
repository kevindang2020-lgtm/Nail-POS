// fair-turn-engine.ts — PURE. The Fair Turn Engine (mandate §5–8, §14–16, §57–61, §157–163): which ELIGIBLE technician
// gets the next fair opportunity, and why. It replaces the weighted "Best Match" score whenever the salon's rotation is
// one of the five fairness modes (the legacy policies keep their scoring path untouched).
//
// The pipeline is staged and every stage is explainable — no opaque score (§160):
//   1. HARD ELIGIBILITY — the existing deterministic gate (branch, clock, skill, capacity, break, blocked, appointment
//      protection, station, lock) plus the turn queue's own: not in today's rotation, manager hold, declined by this guest.
//   2. BUSINESS CONSTRAINTS — max consecutive automatic assignments (auto runs only, never when she is the only one).
//   3. FAIRNESS PRIORITY — the rotation order of the salon's fairness mode (turn-core.rotationOrder: the mode's key, then
//      lowest burden → longest ready wait → earliest join → technician id; never random, §58).
//   4. SOFT PREFERENCES — the guest's requested technician (REQUESTED_TECHNICIAN, §17) and, under walkInPolicy
//      PREFERRED_TECHNICIAN_FIRST, the preferred / previous technician (§157); language stays soft (§158).
//   5. DETERMINISTIC TIE BREAK — already inside rotationOrder.
// Everyone ranked AHEAD of the pick in the rotation gets a skip reason (§67) and keeps her position (§16). AI is not the
// turn authority (§8): nothing here calls a model; if the AI platform is down this still answers (§162).
import { coded, type CodedText } from '@aipowersalon/api-contracts';
import { rotationOrder, HARD_FAIL_TO_SKIP, SKIP_REASON_LABEL, formatTurns, type FairnessMode, type TurnPolicy, type TurnStateLike, type SkipReason, type AssignmentMode } from '@aipowersalon/workforce';

export const FAIR_TURN_ENGINE_VERSION = 'fair-turn-1';

export interface FairTurnCandidate {
  technicianId: string; name: string;
  /** the hard-rule failures from the eligibility gate (engine vocabulary: missing_skill, on_break, appointment_reserved, …) */
  hardFails: string[];
  /** today's turn state at this branch (null = not in the rotation today) */
  turn: TurnStateLike | null;
  isPrevious?: boolean; isPreferred?: boolean;
  /** §158: does she speak the guest's preferred language? null/undefined = unknown (no effect either way) */
  speaksGuestLanguage?: boolean | null;
  /** soft cautions shown with the pick (shift ending, appointment soon) — they never reorder the rotation */
  warnings?: string[];
  nextAppointmentInMinutes?: number | null;
}
export interface FairTurnInput {
  mode: FairnessMode; policy: TurnPolicy; assignmentMode: AssignmentMode; policyVersion: string; nowMs: number;
  candidates: FairTurnCandidate[];
  requestedTechnicianId?: string | null;
  /** technicians this guest declined (§62) */
  declinedTechnicianIds?: string[];
  /** every required service is a special-rotation job (§74–75) */
  specialPool?: boolean;
  /** §158: the guest's preferred language (short code) — null/undefined = unknown */
  guestLanguage?: string | null;
  /** apply the max-consecutive-automatic rule (the auto-run) */
  automatic?: boolean;
  serviceLabel?: string | null;
}
export interface FairTurnRanked {
  technicianId: string; name: string; turnRank: number | null; eligible: boolean; hardFails: string[]; skipReason: SkipReason | null;
  effectiveUnits: number | null; readyMinutes: number | null; basis: string | null; reasons: string[];
}
export interface FairTurnResult {
  version: string; mode: FairnessMode; assignmentMode: AssignmentMode; policyVersion: string;
  recommendedTechnicianId: string | null; requested: boolean;
  /** eligible technicians in fairness order (the recommendation first) */
  eligibleOrder: string[];
  /** everyone the engine considered, in rotation order then the rest */
  ranking: FairTurnRanked[];
  /** technicians ranked ahead of the pick who were passed over, with the reason (written as SKIP events on assignment) */
  skips: { technicianId: string; reason: SkipReason }[];
  /** "Why Lisa?" — the plain lines of §7 */
  why: string[];
  /** `why` line by line as code + vars (Vietnamese POS §21 — srv.FAIR_WHY.*; same length and order as `why`) */
  whyCoded: CodedText[];
  /** "Why was Mary skipped?" — one sentence per skipped technician (`textCoded`: srv.FAIR_SKIP.*) */
  skippedText: { technicianId: string; name: string; reason: SkipReason; text: string; textCoded: CodedText }[];
  eligiblePool: string[];
  warnings: string[];
}

const pronoun = 'Her';
/** The stage-1 extension: turn-queue facts become hard fails in the engine's vocabulary. */
export function turnHardFails(c: FairTurnCandidate, declined: Set<string>, language?: { mode: TurnPolicy['languageMatch']; guestLanguage: string | null }): string[] {
  const out = [...c.hardFails];
  if (!c.turn || !c.turn.inRotation || c.turn.status === 'CLOCKED_OUT') { if (!out.includes('not_clocked_in')) out.push('not_in_rotation'); }
  else if (c.turn.status === 'HOLD' || c.turn.status === 'UNAVAILABLE') out.push('manager_hold');
  else if (c.turn.status === 'BREAK' && !out.includes('on_break')) out.push('on_break');
  if (declined.has(c.technicianId)) out.push('customer_declined');
  // §158 HARD: the owner made the guest's language a requirement — a technician known NOT to speak it is ineligible (unknown stays eligible)
  if (language?.mode === 'HARD' && language.guestLanguage && c.speaksGuestLanguage === false) out.push('language_mismatch');
  return out;
}
function skipOf(fails: string[]): SkipReason {
  for (const f of fails) { const s = HARD_FAIL_TO_SKIP[f]; if (s) return s; }
  return 'NOT_ON_SHIFT';
}

/** Oct 13 2026 (FLOW T1): a salon that configured a fixed turn order under the legacy fixed_order policy keeps it — under
 *  manual_order the configured list IS the rotation order (listed technicians first, in list order; everyone else after,
 *  in her own queue position). Other modes, or no list, leave the candidates untouched. */
export function applyConfiguredOrder(mode: FairnessMode, fixedOrder: readonly string[] | null | undefined, candidates: FairTurnCandidate[]): FairTurnCandidate[] {
  const list = [...new Set((fixedOrder ?? []).filter((x) => typeof x === 'string' && x))];
  if (mode !== 'manual_order' || !list.length) return candidates;
  const pos = new Map(list.map((id, i) => [id, i + 1]));
  return candidates.map((c) => (c.turn ? { ...c, turn: { ...c.turn, rotationPosition: pos.get(c.technicianId) ?? 1000 + list.length + c.turn.rotationPosition } } : c));
}

export function rankFairTurn(input: FairTurnInput): FairTurnResult {
  const declined = new Set(input.declinedTechnicianIds ?? []);
  const states = input.candidates.filter((c) => c.turn).map((c) => ({ ...c.turn!, name: c.name, technicianId: c.technicianId }));
  const order = rotationOrder(input.mode, input.policy, states, input.nowMs, { specialPool: !!input.specialPool });
  const rankOf = new Map(order.map((o) => [o.technicianId, o]));
  const byId = new Map(input.candidates.map((c) => [c.technicianId, c]));
  const guestLanguage = input.guestLanguage ?? null;
  const languageMode = input.policy.languageMatch ?? 'SOFT';
  const fails = new Map(input.candidates.map((c) => [c.technicianId, turnHardFails(c, declined, { mode: languageMode, guestLanguage })]));
  const eligible = (id: string) => (fails.get(id)?.length ?? 1) === 0;

  // stage 3: fairness order of the eligible
  let eligibleOrder = order.map((o) => o.technicianId).filter(eligible);
  // stage 2: max consecutive automatic assignments — demote the streak holder unless she is the only one
  const max = input.policy.maxConsecutiveAutomaticAssignments;
  const demoted = new Set<string>();
  if (input.automatic && max > 0 && eligibleOrder.length > 1) {
    const top = byId.get(eligibleOrder[0])?.turn;
    if (top && (top.consecutiveAuto ?? 0) >= max) { demoted.add(eligibleOrder[0]); eligibleOrder = [...eligibleOrder.slice(1), eligibleOrder[0]]; }
  }
  // stage 4: requested technician (§17) / preferred technician (§157) — soft, never past a hard rule
  const req = input.requestedTechnicianId ?? null;
  let requested = false;
  if (req && eligibleOrder.includes(req)) { eligibleOrder = [req, ...eligibleOrder.filter((x) => x !== req)]; requested = true; }
  else if (!req && input.policy.walkInPolicy === 'PREFERRED_TECHNICIAN_FIRST') {
    const pref = eligibleOrder.find((id) => byId.get(id)?.isPreferred) ?? eligibleOrder.find((id) => byId.get(id)?.isPrevious);
    if (pref) eligibleOrder = [pref, ...eligibleOrder.filter((x) => x !== pref)];
  }
  // stage 4 (§158 SOFT): when the next technician is known NOT to speak the guest's language and another eligible one does,
  // the first speaker takes this guest; everyone passed keeps her place with the LANGUAGE_MATCH reason
  let languagePick = false;
  if (!req && languageMode === 'SOFT' && guestLanguage && eligibleOrder.length > 1 && byId.get(eligibleOrder[0])?.speaksGuestLanguage === false) {
    const speaker = eligibleOrder.find((id) => byId.get(id)?.speaksGuestLanguage === true);
    if (speaker) { eligibleOrder = [speaker, ...eligibleOrder.filter((x) => x !== speaker)]; languagePick = true; }
  }
  const pick = eligibleOrder[0] ?? null;

  // skips: everyone ahead of the pick in the ROTATION (not just the eligible) keeps her place, with the reason
  const skips: { technicianId: string; reason: SkipReason }[] = [];
  const pickRank = pick ? rankOf.get(pick)?.rank ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const o of order) {
    if (!pick || o.technicianId === pick || o.rank >= pickRank) continue;
    const f = fails.get(o.technicianId) ?? [];
    const reason: SkipReason = f.length ? skipOf(f) : requested ? 'CUSTOMER_REQUEST' : demoted.has(o.technicianId) ? 'MAX_CONSECUTIVE_AUTO' : languagePick ? 'LANGUAGE_MATCH' : 'CUSTOMER_REQUEST';
    skips.push({ technicianId: o.technicianId, reason });
  }
  // a demoted streak holder that ended up behind the pick still gets her reason recorded
  for (const id of demoted) if (id !== pick && !skips.some((s) => s.technicianId === id)) skips.push({ technicianId: id, reason: 'MAX_CONSECUTIVE_AUTO' });

  const ranking: FairTurnRanked[] = [
    ...order.map((o) => o.technicianId),
    ...input.candidates.map((c) => c.technicianId).filter((id) => !rankOf.has(id)),
  ].map((id) => {
    const c = byId.get(id); const r = rankOf.get(id); const f = fails.get(id) ?? [];
    const skip = skips.find((s) => s.technicianId === id)?.reason ?? null;
    return { technicianId: id, name: c?.name ?? id, turnRank: r?.rank ?? null, eligible: f.length === 0, hardFails: f, skipReason: skip,
      effectiveUnits: r?.effectiveUnits ?? null, readyMinutes: r?.readyMinutes ?? null, basis: r?.basis ?? null,
      reasons: f.length ? f.map((x) => SKIP_REASON_LABEL[HARD_FAIL_TO_SKIP[x] ?? 'NOT_ON_SHIFT']) : r ? [r.basis] : [] };
  }).filter((x) => byId.has(x.technicianId));

  const why: string[] = [];
  const whyCoded: CodedText[] = [];
  const say = (text: string, c: CodedText) => { why.push(text); whyCoded.push(c); };
  const warnings: string[] = [];
  if (pick) {
    const c = byId.get(pick)!; const r = rankOf.get(pick);
    const name = c.name;
    if (requested) say(`${name} selected because the guest asked for ${name}.`, coded('FAIR_WHY.REQUESTED', { name }));
    else if (languagePick) say(`${name} selected because ${name} speaks the guest's language (${guestLanguage}) and is next among the technicians who do.`, coded('FAIR_WHY.LANGUAGE_PICK', { name, language: guestLanguage }));
    else say(`${name} selected because ${name} is next among the technicians who can take this guest.`, coded('FAIR_WHY.NEXT', { name }));
    if (guestLanguage && languageMode !== 'OFF') {
      const spoken = c.speaksGuestLanguage === true ? 'SPOKEN' : c.speaksGuestLanguage === false ? 'NOT_SPOKEN' : 'UNKNOWN'; const need = languageMode === 'HARD' ? 'REQUIRED' : 'PREFERRED';
      say(`Guest language (${guestLanguage}): ${c.speaksGuestLanguage === true ? 'spoken' : c.speaksGuestLanguage === false ? 'not spoken' : 'unknown'} — ${languageMode === 'HARD' ? 'required' : 'preferred'}`,
        coded('FAIR_WHY.GUEST_LANGUAGE', { language: guestLanguage, spoken: '@srv.FAIR_WORD.' + spoken, need: '@srv.FAIR_WORD.' + need }));
    }
    if (r) { say(`Ready position: #${r.rank}`, coded('FAIR_WHY.READY_POSITION', { rank: r.rank })); say(`Turn units today: ${formatTurns(r.effectiveUnits)}`, coded('FAIR_WHY.TURN_UNITS', { turns: formatTurns(r.effectiveUnits) })); }
    say('Service eligible: YES', coded('FAIR_WHY.SERVICE_ELIGIBLE_YES')); say('Clocked in: YES', coded('FAIR_WHY.CLOCKED_IN_YES'));
    say('On break: NO', coded('FAIR_WHY.ON_BREAK_NO')); say('Available: YES', coded('FAIR_WHY.AVAILABLE_YES'));
    say(`Next appointment conflict: NO${typeof c.nextAppointmentInMinutes === 'number' ? ` (next in ${c.nextAppointmentInMinutes} min)` : ''}`,
      typeof c.nextAppointmentInMinutes === 'number' ? coded('FAIR_WHY.NEXT_APPOINTMENT_NO_IN', { minutes: c.nextAppointmentInMinutes }) : coded('FAIR_WHY.NEXT_APPOINTMENT_NO'));
    say(`Customer requested another technician: ${req && req !== pick ? 'YES' : 'NO'}`, coded(req && req !== pick ? 'FAIR_WHY.OTHER_REQUESTED_YES' : 'FAIR_WHY.OTHER_REQUESTED_NO'));
    if (r?.readyMinutes) say(`Ready for ${r.readyMinutes} min`, coded('FAIR_WHY.READY_FOR', { minutes: r.readyMinutes }));
    if (r?.ageBoost) say(`Waiting boost applied: −${formatTurns(r.ageBoost)} (capped at ${formatTurns(input.policy.ageBoostMaxUnits)})`, coded('FAIR_WHY.BOOST', { boost: formatTurns(r.ageBoost), cap: formatTurns(input.policy.ageBoostMaxUnits) }));
    if (r) say(`Rule: ${r.basis}`, coded('FAIR_WHY.RULE', { ...(r.basisText.vars ?? {}), rule: '@srv.' + r.basisText.code }));
    warnings.push(...(c.warnings ?? []));
  }
  if (req && pick !== req) {
    const rn = byId.get(req)?.name ?? 'the requested technician';
    const rf = fails.get(req) ?? [];
    warnings.push(`The guest asked for ${rn}${rf.length ? ` (${rf.map((x) => SKIP_REASON_LABEL[HARD_FAIL_TO_SKIP[x] ?? 'NOT_ON_SHIFT']).join(', ')})` : ''} — check with the guest before assigning someone else`);
  }
  const skippedText = skips.map((s) => {
    const n = byId.get(s.technicianId)?.name ?? 'Technician';
    const svc = input.serviceLabel ? ` for this ${input.serviceLabel}` : '';
    const text = s.reason === 'SKILL_INELIGIBLE' ? `${n} remained ahead in rotation, but was not eligible${svc}. ${pronoun} turn position was preserved.`
      : s.reason === 'CUSTOMER_REQUEST' ? `${n} remained ahead in rotation; the guest asked for someone else. ${pronoun} turn position was preserved.`
      : `${n} remained ahead in rotation, but was skipped (${SKIP_REASON_LABEL[s.reason]}). ${pronoun} turn position was preserved.`;
    const textCoded = s.reason === 'SKILL_INELIGIBLE' ? coded(input.serviceLabel ? 'FAIR_SKIP.NOT_ELIGIBLE_SERVICE' : 'FAIR_SKIP.NOT_ELIGIBLE', { name: n, service: input.serviceLabel ?? undefined })
      : s.reason === 'CUSTOMER_REQUEST' ? coded('FAIR_SKIP.CUSTOMER_REQUEST', { name: n })
      : coded('FAIR_SKIP.OTHER', { name: n, reason: '@srv.SKIP_REASON.' + s.reason });
    return { technicianId: s.technicianId, name: n, reason: s.reason, text, textCoded };
  });
  return {
    version: FAIR_TURN_ENGINE_VERSION, mode: input.mode, assignmentMode: input.assignmentMode, policyVersion: input.policyVersion,
    recommendedTechnicianId: pick, requested, eligibleOrder, ranking, skips, why, whyCoded, skippedText,
    eligiblePool: eligibleOrder.filter((id) => byId.get(id)?.turn?.status === 'READY' || id === pick), warnings,
  };
}
