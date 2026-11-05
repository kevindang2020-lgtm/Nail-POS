// turn-core.ts — PURE rules of the technician TURN QUEUE (Fair Turn Engine mandate, Oct 12 2026). No I/O.
//
// The technician turn queue answers "which eligible technician should receive the next fair opportunity?" (§4). It is
// separate from the customer queue (pos_queue_items) and from the workforce state (employment / clock / service). This
// file holds every deterministic rule the ledger (turn-ledger.ts), the Fair Turn Engine (modules/ai fair-turn-engine.ts),
// the board, the simulation and the analytics share — so they can never disagree:
//   • the salon's turn policy (defaults = the Recommended Nail Salon Default §124, validation §166, branch merge),
//   • turn units in FIXED POINT hundredths (§41–43: 25 = 0.25 turn, 100 = 1.00) and the rule hierarchy (§44),
//   • how many units an assignment consumes (requested / appointment / manual policies §17–19, §68),
//   • the rotation order for every fairness mode with the deterministic tie-breakers and the capped age boost (§46–60),
//   • position moves: full / half turns (§46, §89), join position (§27–29, §128, §131–132), break return (§32–34),
//     technician decline and offer timeout consequences (§64–66, §153),
//   • the Technician App visibility projection (§94–96) and the standard error codes (§194–195).
// FAIR DOES NOT MEAN RANDOM: nothing here calls Math.random, and no AI model decides anything (§8, §58, §162).

// ── units ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 1.00 turn = 100 units. Every stored / computed turn amount is an integer in hundredths. */
export const TURN_SCALE = 100;
export const FULL_TURN = 100;
export function unitsToTurns(units: number): number { return Math.round(units) / TURN_SCALE; }
/** "1.5" / 1.5 → 150. Refuses anything that is not a whole number of hundredths (no float drift). */
export function turnsToUnits(turns: number | string): number {
  const n = typeof turns === 'string' ? Number(turns) : turns;
  if (!Number.isFinite(n)) throw new TurnPolicyError('Turn amounts must be numbers.');
  const u = Math.round(n * TURN_SCALE);
  if (Math.abs(u - n * TURN_SCALE) > 1e-6) throw new TurnPolicyError('Turn amounts are counted in hundredths (e.g. 0.25, 0.5, 1.5).');
  return u;
}
export function formatTurns(units: number): string { const t = unitsToTurns(units); return Number.isInteger(t) ? t.toFixed(1) : String(t); }

// ── vocabularies ──────────────────────────────────────────────────────────────────────────────────────────────────
export const ASSIGNMENT_MODES = ['AUTOMATIC', 'RECOMMEND_AND_CONFIRM', 'MANUAL'] as const;
export type AssignmentMode = typeof ASSIGNMENT_MODES[number];
/** The five fairness modes (§122). Stored lower-case in rotation_policy, next to the five legacy policies. */
export const FAIRNESS_MODES = ['traditional_weighted_rotation', 'lowest_turn_units', 'workload_balanced', 'hybrid_fairness', 'manual_order'] as const;
export type FairnessMode = typeof FAIRNESS_MODES[number];
export function isFairnessMode(p: unknown): p is FairnessMode { return typeof p === 'string' && (FAIRNESS_MODES as readonly string[]).includes(p); }
/** Oct 13 2026 (FLOW duplicate T1 merged): the five legacy scoring policies (the pre-Fair-Turn "Best Match" rotation
 *  term) are no longer a second ranking authority — each one MEANS its fairness mode, so every salon ranks through the one
 *  explainable engine. A legacy value is accepted from an old screen or an old row and resolved here; nothing else reads it. */
export const LEGACY_ROTATION_TO_MODE: Readonly<Record<string, FairnessMode>> = {
  hybrid: 'hybrid_fairness', least_minutes: 'workload_balanced', least_customers: 'lowest_turn_units', first_available: 'traditional_weighted_rotation', fixed_order: 'manual_order',
};
export function normalizeRotationPolicy(p: unknown): FairnessMode {
  if (isFairnessMode(p)) return p;
  if (typeof p === 'string' && LEGACY_ROTATION_TO_MODE[p]) return LEGACY_ROTATION_TO_MODE[p];
  return 'traditional_weighted_rotation';
}

export const TURN_STATUSES = ['CLOCKED_IN', 'READY', 'ASSIGNED', 'SERVING', 'BREAK', 'HOLD', 'UNAVAILABLE', 'CLOCKED_OUT'] as const;
export type TurnStatus = typeof TURN_STATUSES[number];
/** What the board shows (§25): the stored status plus the derived NEXT_UP / APPOINTMENT_SOON / ASSIGNMENT_OFFERED / OFF_SHIFT. */
export type BoardStatus = TurnStatus | 'NEXT_UP' | 'APPOINTMENT_SOON' | 'ASSIGNMENT_OFFERED' | 'OFF_SHIFT';

export const TURN_EVENT_TYPES = ['JOIN', 'READY', 'ASSIGN', 'MANUAL_ASSIGN', 'START', 'COMPLETE', 'TURN_CREDIT', 'HOLD', 'RELEASE', 'BREAK_START', 'BREAK_END',
  'SKIP', 'DECLINE', 'CUSTOMER_DECLINED', 'OFFER_TIMEOUT', 'REORDER', 'ADJUST', 'CORRECTION', 'CLOCK_OUT', 'DAY_CLOSE'] as const;
export type TurnEventType = typeof TURN_EVENT_TYPES[number];

/** §67 skip reasons (mandatory whenever the engine passes someone ahead of the selected technician). */
export const SKIP_REASONS = ['SKILL_INELIGIBLE', 'ON_BREAK', 'APPOINTMENT_CONFLICT', 'ALREADY_SERVING', 'CUSTOMER_REQUEST', 'CUSTOMER_DECLINED',
  'MANAGER_HOLD', 'NOT_CLOCKED_IN', 'NOT_ON_SHIFT', 'WRONG_BRANCH', 'BLOCKED', 'STATION_UNAVAILABLE', 'ASSIGNMENT_LOCKED',
  'MAX_CONSECUTIVE_AUTO', 'MANUAL_OVERRIDE', 'CERTIFICATION_INVALID', 'LANGUAGE_MATCH'] as const;
export type SkipReason = typeof SKIP_REASONS[number];
/** Every skip reason keeps the technician's position: none of them is a voluntary refusal (§16, §62–63, §66). */
export const SKIP_KEEPS_POSITION = true;

export const ASSIGNMENT_KINDS = ['walk_in_shared', 'walk_in_requested', 'appointment_any', 'appointment_requested'] as const;
export type AssignmentKind = typeof ASSIGNMENT_KINDS[number];

/** §69 manual override reasons (a free-text note may accompany any of them). */
export const OVERRIDE_REASONS = ['CUSTOMER_REQUEST', 'SKILL_MATCH', 'APPOINTMENT_PROTECTION', 'LANGUAGE_MATCH', 'ACCESSIBILITY_NEED', 'TRAINING',
  'MANAGER_DECISION', 'CORRECT_PREVIOUS_MISTAKE', 'EMERGENCY'] as const;
export type OverrideReason = typeof OVERRIDE_REASONS[number];

/** §64–66 technician decline reasons. The SAFETY ones are never penalised, whatever the policy says. */
export const SAFETY_DECLINE_REASONS = ['NOT_LICENSED', 'NOT_SKILLED', 'MEDICAL_RESTRICTION', 'PHYSICAL_LIMITATION', 'EQUIPMENT_UNAVAILABLE',
  'APPOINTMENT_CONFLICT', 'MANAGER_DECISION', 'MANAGER_APPROVED'] as const;
export const POLICY_DECLINE_REASONS = ['SERVICE_CONCERN', 'PERSONAL_EMERGENCY', 'CUSTOMER_HISTORY', 'PERSONAL_PREFERENCE', 'OTHER'] as const;
export type DeclineReason = typeof SAFETY_DECLINE_REASONS[number] | typeof POLICY_DECLINE_REASONS[number];
export const DECLINE_REASONS: readonly string[] = [...SAFETY_DECLINE_REASONS, ...POLICY_DECLINE_REASONS];

// ── the policy ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TurnPolicy {
  autoJoinRotationOnClockIn: boolean;
  clockInJoinPosition: 'BACK_OF_QUEUE' | 'MANAGER_SELECTED_POSITION' | 'FAIRNESS_ENGINE_BASELINE';
  requestedClientTurnPolicy: 'DO_NOT_CONSUME_ROTATION_TURN' | 'COUNT_FULL_TURN' | 'COUNT_WEIGHTED_TURN' | 'MANAGER_DECIDES';
  appointmentTurnPolicy: 'DO_NOT_COUNT' | 'COUNT_ALL' | 'COUNT_ANY_TECH_APPOINTMENTS' | 'COUNT_REQUESTED_APPOINTMENTS' | 'WEIGHT_BY_SERVICE';
  walkInPolicy: 'FAIR_TURN_ENGINE' | 'PREFERRED_TECHNICIAN_FIRST';
  appointmentProtectionEnabled: boolean;
  appointmentProtectionBufferMinutes: number;
  breakPositionPolicy: 'PRESERVE_POSITION' | 'MOVE_TO_BACK_ON_RETURN' | 'REJOIN_BY_FAIRNESS' | 'MANAGER_DECIDES';
  preservePositionForMinutes: number;
  afterPreserveWindow: 'PRESERVE' | 'MOVE_BACK' | 'MANAGER_DECIDES';
  halfTurnBehavior: 'WAIT_UNTIL_FULL_TURN' | 'KEEP_RELATIVE_POSITION' | 'MOVE_PARTIALLY';
  /** units for a service no rule covers (100 = 1.00 turn) */
  defaultTurnUnits: number;
  technicianDeclinePolicy: 'KEEP_POSITION' | 'MOVE_TO_BACK' | 'CHARGE_HALF_TURN' | 'CHARGE_FULL_TURN' | 'MANAGER_DECIDES';
  offerTimeoutPolicy: 'KEEP_POSITION' | 'MOVE_BACK' | 'MANAGER_REVIEW';
  manualAssignmentTurnPolicy: 'COUNT_AS_TURN' | 'DO_NOT_COUNT';
  manualOverridePolicy: 'ALLOWED_FOR_MANAGER_WITH_REASON' | 'ANY_ASSIGNER_WITH_REASON';
  /** 0 = off. Otherwise the auto-run never gives the same technician more than N in a row unless she is the only one eligible. */
  maxConsecutiveAutomaticAssignments: number;
  ageBoostEnabled: boolean;
  ageBoostAfterMinutes: number;
  ageBoostStepMinutes: number;
  ageBoostUnitsPerStep: number;
  ageBoostMaxUnits: number;
  dailyResetPolicy: 'BUSINESS_DAY_RESET';
  dailyFairnessCarryover: 'NONE' | 'PARTIAL' | 'FULL';
  startOfDayOrder: 'CLOCK_IN_ORDER' | 'SCHEDULE_ORDER' | 'PREVIOUS_ROTATION_CARRYOVER' | 'MANAGER_DEFINED';
  /** MANAGER_DEFINED start of day: technician ids in order (a location's list — set on the branch) */
  startingRotation: string[];
  lateTechnicianPolicy: 'NO_QUEUE_PENALTY' | 'JOIN_BACK';
  technicianQueueVisibility: 'FULL_TEAM_QUEUE' | 'POSITION_ONLY' | 'NEXT_FEW' | 'PRIVATE_POSITION';
  nextFewCount: number;
  /** show Sales / Earnings today beside turns on the manager board (display only — never an assignment factor, §51–52) */
  revenueBalanceIndicator: boolean;
  specialRotationEnabled: boolean;
  /** fairness indicator: "within fair range" when |gap| ≤ max(fairRangeUnits, expected × fairRangePercent %) */
  fairRangeUnits: number;
  fairRangePercent: number;
  /** §158 (Oct 13 2026): the guest's preferred language — SOFT = prefer a technician who speaks it (those passed keep their
   *  place, reason LANGUAGE_MATCH); HARD = a technician who does not speak it is ineligible; OFF = ignored. */
  languageMatch: 'OFF' | 'SOFT' | 'HARD';
}

/** §123–124: the Recommended Nail Salon Default — what an owner gets without configuring anything. */
export const RECOMMENDED_TURN_POLICY: Readonly<TurnPolicy> = Object.freeze({
  autoJoinRotationOnClockIn: true,
  clockInJoinPosition: 'BACK_OF_QUEUE',
  requestedClientTurnPolicy: 'DO_NOT_CONSUME_ROTATION_TURN',
  appointmentTurnPolicy: 'COUNT_ANY_TECH_APPOINTMENTS',
  walkInPolicy: 'FAIR_TURN_ENGINE',
  appointmentProtectionEnabled: true,
  appointmentProtectionBufferMinutes: 10,
  breakPositionPolicy: 'PRESERVE_POSITION',
  preservePositionForMinutes: 30,
  afterPreserveWindow: 'MOVE_BACK',
  halfTurnBehavior: 'WAIT_UNTIL_FULL_TURN',
  defaultTurnUnits: FULL_TURN,
  technicianDeclinePolicy: 'KEEP_POSITION',
  offerTimeoutPolicy: 'KEEP_POSITION',
  manualAssignmentTurnPolicy: 'COUNT_AS_TURN',
  manualOverridePolicy: 'ALLOWED_FOR_MANAGER_WITH_REASON',
  maxConsecutiveAutomaticAssignments: 1,
  ageBoostEnabled: true,
  ageBoostAfterMinutes: 45,
  ageBoostStepMinutes: 15,
  ageBoostUnitsPerStep: 25,
  ageBoostMaxUnits: 100,
  dailyResetPolicy: 'BUSINESS_DAY_RESET',
  dailyFairnessCarryover: 'NONE',
  startOfDayOrder: 'CLOCK_IN_ORDER',
  startingRotation: [],
  lateTechnicianPolicy: 'NO_QUEUE_PENALTY',
  technicianQueueVisibility: 'POSITION_ONLY',
  nextFewCount: 3,
  revenueBalanceIndicator: false,
  specialRotationEnabled: false,
  fairRangeUnits: 50,
  fairRangePercent: 15,
  languageMatch: 'SOFT',
});
export const RECOMMENDED_ASSIGNMENT_MODE: AssignmentMode = 'RECOMMEND_AND_CONFIRM';
export const RECOMMENDED_FAIRNESS_MODE: FairnessMode = 'traditional_weighted_rotation';

const ENUMS: { [K in keyof TurnPolicy]?: readonly string[] } = {
  clockInJoinPosition: ['BACK_OF_QUEUE', 'MANAGER_SELECTED_POSITION', 'FAIRNESS_ENGINE_BASELINE'],
  requestedClientTurnPolicy: ['DO_NOT_CONSUME_ROTATION_TURN', 'COUNT_FULL_TURN', 'COUNT_WEIGHTED_TURN', 'MANAGER_DECIDES'],
  appointmentTurnPolicy: ['DO_NOT_COUNT', 'COUNT_ALL', 'COUNT_ANY_TECH_APPOINTMENTS', 'COUNT_REQUESTED_APPOINTMENTS', 'WEIGHT_BY_SERVICE'],
  walkInPolicy: ['FAIR_TURN_ENGINE', 'PREFERRED_TECHNICIAN_FIRST'],
  breakPositionPolicy: ['PRESERVE_POSITION', 'MOVE_TO_BACK_ON_RETURN', 'REJOIN_BY_FAIRNESS', 'MANAGER_DECIDES'],
  afterPreserveWindow: ['PRESERVE', 'MOVE_BACK', 'MANAGER_DECIDES'],
  halfTurnBehavior: ['WAIT_UNTIL_FULL_TURN', 'KEEP_RELATIVE_POSITION', 'MOVE_PARTIALLY'],
  technicianDeclinePolicy: ['KEEP_POSITION', 'MOVE_TO_BACK', 'CHARGE_HALF_TURN', 'CHARGE_FULL_TURN', 'MANAGER_DECIDES'],
  offerTimeoutPolicy: ['KEEP_POSITION', 'MOVE_BACK', 'MANAGER_REVIEW'],
  manualAssignmentTurnPolicy: ['COUNT_AS_TURN', 'DO_NOT_COUNT'],
  manualOverridePolicy: ['ALLOWED_FOR_MANAGER_WITH_REASON', 'ANY_ASSIGNER_WITH_REASON'],
  dailyResetPolicy: ['BUSINESS_DAY_RESET'],
  dailyFairnessCarryover: ['NONE', 'PARTIAL', 'FULL'],
  startOfDayOrder: ['CLOCK_IN_ORDER', 'SCHEDULE_ORDER', 'PREVIOUS_ROTATION_CARRYOVER', 'MANAGER_DEFINED'],
  lateTechnicianPolicy: ['NO_QUEUE_PENALTY', 'JOIN_BACK'],
  technicianQueueVisibility: ['FULL_TEAM_QUEUE', 'POSITION_ONLY', 'NEXT_FEW', 'PRIVATE_POSITION'],
  languageMatch: ['OFF', 'SOFT', 'HARD'],
};
const BOOLS: (keyof TurnPolicy)[] = ['autoJoinRotationOnClockIn', 'appointmentProtectionEnabled', 'ageBoostEnabled', 'revenueBalanceIndicator', 'specialRotationEnabled'];
const INTS: [keyof TurnPolicy, number, number][] = [
  ['appointmentProtectionBufferMinutes', 0, 120], ['preservePositionForMinutes', 0, 240], ['defaultTurnUnits', 0, 1000],
  ['maxConsecutiveAutomaticAssignments', 0, 20], ['ageBoostAfterMinutes', 1, 600], ['ageBoostStepMinutes', 1, 240],
  ['ageBoostUnitsPerStep', 0, 500], ['ageBoostMaxUnits', 0, 1000], ['nextFewCount', 1, 20], ['fairRangeUnits', 0, 500], ['fairRangePercent', 0, 100],
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TurnPolicyError extends Error { readonly code = 'TURN_POLICY_INVALID'; constructor(m: string) { super(m); this.name = 'TurnPolicyError'; } }

/**
 * §166: validate a policy patch against the policy it lands on. Returns the problems (empty = fine). Unknown keys are
 * refused (a typo must not silently save nothing). `scope` 'salon' refuses the branch-only starting rotation.
 */
export function validateTurnPolicyPatch(patch: unknown, scope: 'salon' | 'branch' = 'branch'): string[] {
  const out: string[] = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['The turn policy must be an object.'];
  const p = patch as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!(k in RECOMMENDED_TURN_POLICY)) out.push(`Unknown turn policy setting "${k}".`);
  for (const [k, vals] of Object.entries(ENUMS)) if (p[k] !== undefined && !(vals as readonly string[]).includes(p[k] as string)) out.push(`${k} must be one of ${(vals as readonly string[]).join(', ')}.`);
  for (const k of BOOLS) if (p[k] !== undefined && typeof p[k] !== 'boolean') out.push(`${k} must be true or false.`);
  for (const [k, min, max] of INTS) if (p[k] !== undefined && !(Number.isInteger(p[k]) && (p[k] as number) >= min && (p[k] as number) <= max)) out.push(`${k} must be a whole number from ${min} to ${max}.`);
  if (p.startingRotation !== undefined) {
    if (!Array.isArray(p.startingRotation) || !p.startingRotation.every((x) => typeof x === 'string' && UUID_RE.test(x))) out.push('startingRotation must be a list of technician ids.');
    else if (new Set(p.startingRotation as string[]).size !== (p.startingRotation as string[]).length) out.push('startingRotation lists a technician twice.');
    if (scope === 'salon' && Array.isArray(p.startingRotation) && p.startingRotation.length) out.push('A starting rotation names one location’s technicians — set it on the location, not salon-wide.');
  }
  return out;
}

/** The effective policy: defaults ← salon row ← branch row (only keys present override). Unknown / invalid keys are ignored. */
export function mergeTurnPolicy(salon: unknown, branch?: unknown): TurnPolicy {
  const out: any = { ...RECOMMENDED_TURN_POLICY, startingRotation: [] };
  for (const layer of [salon, branch]) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    for (const [k, v] of Object.entries(layer as Record<string, unknown>)) {
      if (!(k in RECOMMENDED_TURN_POLICY) || v === undefined || v === null) continue;
      if (validateTurnPolicyPatch({ [k]: v }, 'branch').length) continue;
      out[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return out as TurnPolicy;
}

/** §167: Current vs New with plain-language example outcomes, for the settings preview. */
export function previewTurnPolicyChange(current: TurnPolicy, next: TurnPolicy, modes?: { currentMode?: AssignmentMode; nextMode?: AssignmentMode; currentFairness?: string; nextFairness?: string }): { key: string; current: unknown; next: unknown; outcome: string }[] {
  const changes: { key: string; current: unknown; next: unknown; outcome: string }[] = [];
  const say: Partial<Record<keyof TurnPolicy, (v: any) => string>> = {
    requestedClientTurnPolicy: (v) => ({ DO_NOT_CONSUME_ROTATION_TURN: 'A guest who asks for a technician will not use up that technician’s walk-in turn.', COUNT_FULL_TURN: 'A guest who asks for a technician will count as a full 1.0 turn.', COUNT_WEIGHTED_TURN: 'A guest who asks for a technician will count by the service’s turn weight.', MANAGER_DECIDES: 'A guest who asks for a technician counts 0 until a manager adjusts the turn.' } as Record<string, string>)[v],
    appointmentTurnPolicy: (v) => ({ DO_NOT_COUNT: 'Appointments will not count as turns.', COUNT_ALL: 'Every appointment will count as a full 1.0 turn.', COUNT_ANY_TECH_APPOINTMENTS: 'Only "any technician" appointments will count, by service weight.', COUNT_REQUESTED_APPOINTMENTS: 'Only appointments booked with a chosen technician will count, by service weight.', WEIGHT_BY_SERVICE: 'Every appointment will count by its service weight.' } as Record<string, string>)[v],
    breakPositionPolicy: (v) => ({ PRESERVE_POSITION: 'A technician back from a short break keeps her place.', MOVE_TO_BACK_ON_RETURN: 'A technician back from a break goes to the back of the rotation.', REJOIN_BY_FAIRNESS: 'A technician back from a break rejoins where her turn count places her.', MANAGER_DECIDES: 'A technician back from a break waits on hold until a manager places her.' } as Record<string, string>)[v],
    clockInJoinPosition: (v) => ({ BACK_OF_QUEUE: 'A technician who clocks in joins at the back.', MANAGER_SELECTED_POSITION: 'A technician who clocks in waits on hold until a manager places her.', FAIRNESS_ENGINE_BASELINE: 'A technician who clocks in starts at the team’s average turn count.' } as Record<string, string>)[v],
    technicianDeclinePolicy: (v) => ({ KEEP_POSITION: 'A technician who declines keeps her place.', MOVE_TO_BACK: 'A technician who declines for a personal reason goes to the back.', CHARGE_HALF_TURN: 'A technician who declines for a personal reason is charged 0.5 turn.', CHARGE_FULL_TURN: 'A technician who declines for a personal reason is charged 1.0 turn.', MANAGER_DECIDES: 'A personal decline goes on hold for a manager to decide.' } as Record<string, string>)[v],
    defaultTurnUnits: (v) => `A service with no turn rule will count as ${formatTurns(v)} turn.`,
    appointmentProtectionBufferMinutes: (v) => `A technician is kept free of walk-ins that would end less than ${v} minutes before her next appointment.`,
    maxConsecutiveAutomaticAssignments: (v) => v ? `Automatic assignment will not give the same technician more than ${v} in a row while someone else is eligible.` : 'Automatic assignment may give the same technician several guests in a row.',
    technicianQueueVisibility: (v) => ({ FULL_TEAM_QUEUE: 'Technicians will see the whole team’s order in their app.', POSITION_ONLY: 'Technicians will see their own position and the queue length.', NEXT_FEW: 'Technicians will see who is next and their own position.', PRIVATE_POSITION: 'Technicians will see only their own position.' } as Record<string, string>)[v],
  };
  for (const k of Object.keys(RECOMMENDED_TURN_POLICY) as (keyof TurnPolicy)[]) {
    const a = current[k], b = next[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({ key: k, current: a, next: b, outcome: say[k]?.(b) ?? `${k} changes from ${JSON.stringify(a)} to ${JSON.stringify(b)}.` });
  }
  if (modes?.currentMode && modes.nextMode && modes.currentMode !== modes.nextMode) changes.unshift({ key: 'assignmentMode', current: modes.currentMode, next: modes.nextMode,
    outcome: ({ AUTOMATIC: 'The salon will assign the next fair technician automatically.', RECOMMEND_AND_CONFIRM: 'The salon will recommend a technician and staff confirm it.', MANUAL: 'Staff will choose every technician; turns are still tracked.' } as Record<string, string>)[modes.nextMode] });
  if (modes?.currentFairness && modes.nextFairness && modes.currentFairness !== modes.nextFairness) changes.unshift({ key: 'fairnessMode', current: modes.currentFairness, next: modes.nextFairness,
    outcome: FAIRNESS_MODE_LABEL[modes.nextFairness as FairnessMode] ?? `The rotation will follow "${modes.nextFairness}".` });
  return changes;
}
export const FAIRNESS_MODE_LABEL: Record<FairnessMode, string> = {
  traditional_weighted_rotation: 'Weighted traditional rotation: the next technician in line gets the guest; a full turn moves her to the back, half turns add up.',
  lowest_turn_units: 'Lowest turns: the eligible technician with the fewest turn units today goes next.',
  workload_balanced: 'Workload balanced: the eligible technician with the fewest service minutes today goes next.',
  hybrid_fairness: 'Hybrid: turn units plus service minutes, with a capped boost for anyone waiting unusually long.',
  manual_order: 'Manual order: the manager sets the order; assignments do not move anyone.',
};

// ── turn units: the rule hierarchy (§44) ──────────────────────────────────────────────────────────────────────────
export interface TurnUnitRule { id: string; ruleKey: string; version: number; scope: 'service' | 'category' | 'duration'; serviceId: string | null; category: string | null; maxDurationMinutes: number | null; turnUnits: number; specialRotation: boolean }
export interface TurnServiceInput { serviceId: string | null; category: string | null; durationMinutes: number }
export interface ResolvedServiceUnits { serviceId: string | null; units: number; ruleId: string | null; ruleVersion: number | null; source: 'service' | 'category' | 'duration' | 'default'; special: boolean }

/** Deterministic precedence: service rule → category rule → the smallest duration bound that covers the service → default. */
export function resolveServiceUnits(svc: TurnServiceInput, rules: TurnUnitRule[], defaultUnits: number): ResolvedServiceUnits {
  const bySvc = svc.serviceId ? rules.find((r) => r.scope === 'service' && r.serviceId === svc.serviceId) : undefined;
  if (bySvc) return { serviceId: svc.serviceId, units: bySvc.turnUnits, ruleId: bySvc.id, ruleVersion: bySvc.version, source: 'service', special: bySvc.specialRotation };
  const cat = (svc.category ?? '').trim().toLowerCase();
  const byCat = cat ? rules.find((r) => r.scope === 'category' && (r.category ?? '').trim().toLowerCase() === cat) : undefined;
  if (byCat) return { serviceId: svc.serviceId, units: byCat.turnUnits, ruleId: byCat.id, ruleVersion: byCat.version, source: 'category', special: byCat.specialRotation };
  const dur = Math.max(0, Math.round(svc.durationMinutes || 0));
  const byDur = rules.filter((r) => r.scope === 'duration' && (r.maxDurationMinutes ?? 0) >= dur && dur > 0)
    .sort((a, b) => (a.maxDurationMinutes ?? 0) - (b.maxDurationMinutes ?? 0) || a.id.localeCompare(b.id))[0];
  if (byDur) return { serviceId: svc.serviceId, units: byDur.turnUnits, ruleId: byDur.id, ruleVersion: byDur.version, source: 'duration', special: byDur.specialRotation };
  return { serviceId: svc.serviceId, units: defaultUnits, ruleId: null, ruleVersion: null, source: 'default', special: false };
}
/** A visit's units: the sum of its services' units (each service its own rule). `special` = every service is special-pool. */
export function resolveVisitUnits(services: TurnServiceInput[], rules: TurnUnitRule[], defaultUnits: number): { units: number; perService: ResolvedServiceUnits[]; special: boolean } {
  const perService = (services.length ? services : [{ serviceId: null, category: null, durationMinutes: 0 }]).map((s) => resolveServiceUnits(s, rules, defaultUnits));
  return { units: perService.reduce((a, s) => a + s.units, 0), perService, special: perService.length > 0 && perService.every((s) => s.special) };
}

// ── how much an assignment consumes (§17–19, §68, §200) ───────────────────────────────────────────────────────────
export function assignmentKindOf(v: { isAppointment: boolean; requestedTechnicianId: string | null; technicianId: string; appointmentAnyTechnician?: boolean | null }): AssignmentKind {
  if (v.isAppointment) return v.appointmentAnyTechnician === true ? 'appointment_any' : 'appointment_requested';
  return v.requestedTechnicianId && v.requestedTechnicianId === v.technicianId ? 'walk_in_requested' : 'walk_in_shared';
}
export interface ConsumedUnits { units: number; needsManagerDecision: boolean; why: string }
export function unitsForAssignment(kind: AssignmentKind, baseUnits: number, policy: TurnPolicy, opts: { manualOverride?: boolean } = {}): ConsumedUnits {
  const base = Math.max(0, Math.round(baseUnits));
  if (kind === 'walk_in_shared') {
    if (opts.manualOverride && policy.manualAssignmentTurnPolicy === 'DO_NOT_COUNT') return { units: 0, needsManagerDecision: false, why: 'Manual assignment — this salon does not count manual assignments as turns.' };
    return { units: base, needsManagerDecision: false, why: `Shared walk-in — ${formatTurns(base)} turn by service weight.` };
  }
  if (kind === 'walk_in_requested') {
    switch (policy.requestedClientTurnPolicy) {
      case 'COUNT_FULL_TURN': return { units: FULL_TURN, needsManagerDecision: false, why: 'Requested by the guest — counts as a full turn (salon rule).' };
      case 'COUNT_WEIGHTED_TURN': return { units: base, needsManagerDecision: false, why: `Requested by the guest — counts ${formatTurns(base)} turn by service weight (salon rule).` };
      case 'MANAGER_DECIDES': return { units: 0, needsManagerDecision: true, why: 'Requested by the guest — a manager decides whether it counts.' };
      default: return { units: 0, needsManagerDecision: false, why: 'Requested by the guest — does not use a shared walk-in turn.' };
    }
  }
  const p = policy.appointmentTurnPolicy;
  if (p === 'DO_NOT_COUNT') return { units: 0, needsManagerDecision: false, why: 'Appointment — this salon does not count appointments as turns.' };
  if (p === 'COUNT_ALL') return { units: FULL_TURN, needsManagerDecision: false, why: 'Appointment — every appointment counts as a full turn (salon rule).' };
  if (p === 'WEIGHT_BY_SERVICE') return { units: base, needsManagerDecision: false, why: `Appointment — counts ${formatTurns(base)} turn by service weight.` };
  if (kind === 'appointment_any') return p === 'COUNT_ANY_TECH_APPOINTMENTS'
    ? { units: base, needsManagerDecision: false, why: `"Any technician" appointment — counts ${formatTurns(base)} turn by service weight.` }
    : { units: 0, needsManagerDecision: false, why: '"Any technician" appointment — not counted under this salon’s rule.' };
  return p === 'COUNT_REQUESTED_APPOINTMENTS'
    ? { units: base, needsManagerDecision: false, why: `Appointment booked with this technician — counts ${formatTurns(base)} turn by service weight.` }
    : { units: 0, needsManagerDecision: false, why: 'Appointment booked with this technician — outside the walk-in rotation.' };
}

// ── rotation order (§46–50, §57–61) ───────────────────────────────────────────────────────────────────────────────
export interface TurnStateLike {
  technicianId: string; name?: string | null; status: TurnStatus; inRotation: boolean; rotationPosition: number;
  accumulatedUnits: number; provisionalUnits: number; pendingUnits: number; baselineUnits: number; specialUnits: number;
  serviceMinutes: number; baselineMinutes: number; readySince: string | null; eligibleSkipCount?: number; consecutiveAuto?: number;
  lastAssignmentAt?: string | null; holdReason?: string | null;
}
/** turn units the fairness modes compare: credited + in-progress + the join / carry-over baseline */
export function effectiveUnits(s: TurnStateLike): number { return s.accumulatedUnits + s.provisionalUnits + s.baselineUnits; }
export function readyMinutes(s: TurnStateLike, nowMs: number): number {
  if (s.status !== 'READY' || !s.readySince) return 0;
  const t = Date.parse(s.readySince); return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60000)) : 0;
}
/** §60: the capped, documented, deterministic age boost (units). Applies in the unit / workload / hybrid modes only —
 *  in the position modes a waiting technician already keeps her place. */
export function ageBoostUnits(policy: TurnPolicy, mode: FairnessMode, waitedMinutes: number): number {
  if (!policy.ageBoostEnabled || mode === 'traditional_weighted_rotation' || mode === 'manual_order') return 0;
  if (waitedMinutes <= policy.ageBoostAfterMinutes) return 0;
  const steps = Math.floor((waitedMinutes - policy.ageBoostAfterMinutes) / Math.max(1, policy.ageBoostStepMinutes)) + 1;
  return Math.min(policy.ageBoostMaxUnits, steps * policy.ageBoostUnitsPerStep);
}
export interface RankedTurn {
  technicianId: string; name: string | null; rank: number; fairnessKey: number; effectiveUnits: number; serviceMinutes: number;
  readyMinutes: number; position: number; ageBoost: number; basis: string;
}
/** The primary fairness key of one technician (lower = sooner) and the plain words for it. */
export function fairnessKeyOf(mode: FairnessMode, policy: TurnPolicy, s: TurnStateLike, nowMs: number, opts: { specialPool?: boolean } = {}): { key: number; ageBoost: number; basis: string } {
  const waited = readyMinutes(s, nowMs);
  const boost = ageBoostUnits(policy, mode, waited);
  const eff = effectiveUnits(s);
  const mins = s.serviceMinutes + s.baselineMinutes;
  if (opts.specialPool) return { key: s.specialUnits, ageBoost: 0, basis: `Special-job rotation: ${formatTurns(s.specialUnits)} special turns today` };
  switch (mode) {
    case 'lowest_turn_units': return { key: eff - boost, ageBoost: boost, basis: `Lowest turns: ${formatTurns(eff)} turn units today${boost ? `, waiting boost −${formatTurns(boost)}` : ''}` };
    case 'workload_balanced': { const bm = Math.round(boost * 60 / TURN_SCALE); return { key: mins - bm, ageBoost: boost, basis: `Workload: ${mins} service minutes today${bm ? `, waiting boost −${bm} min` : ''}` }; }
    case 'hybrid_fairness': { const k = eff + Math.round(mins * TURN_SCALE / 120) - boost; return { key: k, ageBoost: boost, basis: `Hybrid: ${formatTurns(eff)} turns + ${mins} service min${boost ? ` − waiting boost ${formatTurns(boost)}` : ''}` }; }
    case 'manual_order': return { key: s.rotationPosition, ageBoost: 0, basis: 'Manager-set order' };
    case 'traditional_weighted_rotation':
    default: return { key: s.rotationPosition, ageBoost: 0, basis: `Rotation position${s.pendingUnits ? ` (${formatTurns(s.pendingUnits)} partial turn carried)` : ''}` };
  }
}
/**
 * §58 ORDER: (1) the mode's fairness key, then the deterministic tie-breakers — (2) lowest effective turn burden,
 * (3) longest ready wait (earliest readySince), (4) earliest rotation position (join sequence), (5) technician id.
 * Never random. Only technicians in the rotation are ranked; the caller filters eligibility separately.
 */
export function rotationOrder(mode: FairnessMode, policy: TurnPolicy, states: TurnStateLike[], nowMs: number, opts: { specialPool?: boolean } = {}): RankedTurn[] {
  const rows = states.filter((s) => s.inRotation).map((s) => {
    const k = fairnessKeyOf(mode, policy, s, nowMs, opts);
    const rs = s.readySince ? Date.parse(s.readySince) : NaN;
    return { s, k, eff: effectiveUnits(s), readyAt: Number.isFinite(rs) && s.status === 'READY' ? rs : Number.POSITIVE_INFINITY };
  });
  rows.sort((a, b) => a.k.key - b.k.key || a.eff - b.eff || a.readyAt - b.readyAt || a.s.rotationPosition - b.s.rotationPosition || a.s.technicianId.localeCompare(b.s.technicianId));
  return rows.map((r, i) => ({ technicianId: r.s.technicianId, name: r.s.name ?? null, rank: i + 1, fairnessKey: r.k.key, effectiveUnits: r.eff, serviceMinutes: r.s.serviceMinutes,
    readyMinutes: readyMinutes(r.s, nowMs), position: r.s.rotationPosition, ageBoost: r.k.ageBoost, basis: r.k.basis }));
}

// ── position moves ────────────────────────────────────────────────────────────────────────────────────────────────
function backOf(others: { rotationPosition: number; inRotation: boolean }[]): number {
  const ps = others.filter((o) => o.inRotation).map((o) => o.rotationPosition);
  return (ps.length ? Math.max(...ps) : 0) + 1;
}
/** §46 / §89: where the technician stands after receiving `units` in this mode. Units 0 → nothing moves. */
export function positionAfterAssignment(mode: FairnessMode, policy: TurnPolicy, me: TurnStateLike, units: number, others: TurnStateLike[]): { position: number; pending: number; moved: 'back' | 'partial' | 'none' } {
  if (units <= 0 || mode === 'manual_order') return { position: me.rotationPosition, pending: me.pendingUnits, moved: 'none' };
  const rest = others.filter((o) => o.technicianId !== me.technicianId);
  if (mode !== 'traditional_weighted_rotation') {
    // unit / workload / hybrid modes rank by their own key; the position only breaks ties — it follows the turn taken
    return { position: backOf(rest), pending: 0, moved: 'back' };
  }
  let pending = me.pendingUnits + units;
  if (pending >= FULL_TURN) { pending = pending % FULL_TURN; return { position: backOf(rest), pending, moved: 'back' }; }
  if (policy.halfTurnBehavior === 'MOVE_PARTIALLY') {
    // move back by round(units/100 × the number behind) places, between two neighbours (positions are numeric)
    const behind = rest.filter((o) => o.inRotation && o.rotationPosition > me.rotationPosition).map((o) => o.rotationPosition).sort((a, b) => a - b);
    const k = Math.round((units / FULL_TURN) * behind.length);
    if (k <= 0) return { position: me.rotationPosition, pending, moved: 'none' };
    const after = behind[k - 1]; const next = behind[k];
    return { position: next === undefined ? after + 1 : Math.round(((after + next) / 2) * 10000) / 10000, pending, moved: 'partial' };
  }
  return { position: me.rotationPosition, pending, moved: 'none' };   // WAIT_UNTIL_FULL_TURN / KEEP_RELATIVE_POSITION
}

export interface JoinPlacement { position: number; baselineUnits: number; baselineMinutes: number; status: 'READY' | 'HOLD'; holdReason: string | null; basis: string }
/**
 * §27–29, §128, §131–132: where a technician joins. `dayStarted` = someone already received a guest today (before that,
 * the start-of-day order applies). `scheduleStartMinutes` / `previousRank` feed SCHEDULE_ORDER / PREVIOUS_ROTATION_CARRYOVER;
 * `carryoverUnits` = yesterday's relative imbalance (FULL / PARTIAL carry-over).
 */
export function joinPlacement(mode: FairnessMode, policy: TurnPolicy, technicianId: string, others: TurnStateLike[], ctx: { dayStarted: boolean; scheduleStartMinutes?: number | null; previousRank?: number | null; carryoverUnits?: number }): JoinPlacement {
  const inRot = others.filter((o) => o.inRotation && o.technicianId !== technicianId);
  const carry = policy.dailyFairnessCarryover === 'FULL' ? Math.max(0, ctx.carryoverUnits ?? 0) : policy.dailyFairnessCarryover === 'PARTIAL' ? Math.floor(Math.max(0, ctx.carryoverUnits ?? 0) / 2) : 0;
  if (policy.clockInJoinPosition === 'MANAGER_SELECTED_POSITION') return { position: backOf(inRot), baselineUnits: carry, baselineMinutes: 0, status: 'HOLD', holdReason: 'AWAITING_MANAGER_POSITION', basis: 'Waiting for a manager to place her (salon rule).' };
  if (!ctx.dayStarted) {
    // start of day: nobody has had a guest yet — the house's starting order
    if (policy.startOfDayOrder === 'MANAGER_DEFINED' && policy.startingRotation.includes(technicianId)) return { position: (policy.startingRotation.indexOf(technicianId) + 1) / 100, baselineUnits: carry, baselineMinutes: 0, status: 'READY', holdReason: null, basis: 'Starting rotation set by the manager.' };
    if (policy.startOfDayOrder === 'SCHEDULE_ORDER' && typeof ctx.scheduleStartMinutes === 'number') return { position: Math.max(0, ctx.scheduleStartMinutes) / 10000, baselineUnits: carry, baselineMinutes: 0, status: 'READY', holdReason: null, basis: 'Start-of-day order by scheduled start.' };
    if (policy.startOfDayOrder === 'PREVIOUS_ROTATION_CARRYOVER' && typeof ctx.previousRank === 'number') return { position: ctx.previousRank / 100, baselineUnits: carry, baselineMinutes: 0, status: 'READY', holdReason: null, basis: 'Start-of-day order carried from the previous day.' };
  }
  const position = backOf(inRot);
  if (mode === 'traditional_weighted_rotation' || mode === 'manual_order' || !inRot.length) return { position, baselineUnits: carry, baselineMinutes: 0, status: 'READY', holdReason: null, basis: 'Joined at the back of the rotation.' };
  const effs = inRot.map(effectiveUnits); const mins = inRot.map((o) => o.serviceMinutes + o.baselineMinutes);
  if (policy.clockInJoinPosition === 'FAIRNESS_ENGINE_BASELINE') {
    const avgU = Math.round(effs.reduce((a, b) => a + b, 0) / effs.length); const avgM = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    return { position, baselineUnits: avgU + carry, baselineMinutes: avgM, status: 'READY', holdReason: null, basis: `Joined at the team average (${formatTurns(avgU)} turns).` };
  }
  // BACK_OF_QUEUE in a unit mode: start level with the busiest so a late arrival does not take the next several guests (§28, §128)
  return { position, baselineUnits: Math.max(...effs) + carry, baselineMinutes: Math.max(...mins), status: 'READY', holdReason: null, basis: 'Joined at the back (level with the busiest technician).' };
}

/** §32–34: what happens when a technician comes back from a time-clock break. */
export function breakReturn(mode: FairnessMode, policy: TurnPolicy, me: TurnStateLike, breakMinutes: number, others: TurnStateLike[]): { position: number; status: 'READY' | 'HOLD'; holdReason: string | null; basis: string } {
  const rest = others.filter((o) => o.technicianId !== me.technicianId);
  const keep = { position: me.rotationPosition, status: 'READY' as const, holdReason: null, basis: 'Position kept after the break.' };
  const back = { position: backOf(rest), status: 'READY' as const, holdReason: null, basis: 'Back of the rotation after the break.' };
  const hold = { position: me.rotationPosition, status: 'HOLD' as const, holdReason: 'AWAITING_MANAGER_POSITION', basis: 'On hold until a manager places her (salon rule).' };
  switch (policy.breakPositionPolicy) {
    case 'MOVE_TO_BACK_ON_RETURN': return back;
    case 'MANAGER_DECIDES': return hold;
    case 'REJOIN_BY_FAIRNESS': {
      if (mode !== 'traditional_weighted_rotation' && mode !== 'manual_order') return { ...keep, basis: 'Rejoined by turn count.' };
      // position modes: stand behind everyone with no more turn units than her
      const mine = effectiveUnits(me);
      const ahead = rest.filter((o) => o.inRotation && effectiveUnits(o) <= mine).map((o) => o.rotationPosition);
      const behind = rest.filter((o) => o.inRotation && effectiveUnits(o) > mine).map((o) => o.rotationPosition);
      const after = ahead.length ? Math.max(...ahead) : 0; const before = behind.filter((p) => p > after).sort((a, b) => a - b)[0];
      return { position: before === undefined ? after + 1 : Math.round(((after + before) / 2) * 10000) / 10000, status: 'READY', holdReason: null, basis: 'Rejoined by turn count.' };
    }
    case 'PRESERVE_POSITION':
    default:
      if (policy.preservePositionForMinutes > 0 && breakMinutes > policy.preservePositionForMinutes) {
        if (policy.afterPreserveWindow === 'MOVE_BACK') return { ...back, basis: `Break longer than ${policy.preservePositionForMinutes} min — back of the rotation.` };
        if (policy.afterPreserveWindow === 'MANAGER_DECIDES') return { ...hold, basis: `Break longer than ${policy.preservePositionForMinutes} min — on hold for a manager.` };
      }
      return keep;
  }
}

/** §64–66: the consequence of a technician declining an eligible turn. Safety reasons are never penalised. */
export function declineConsequence(policy: TurnPolicy, reason: string): { action: 'KEEP_POSITION' | 'MOVE_TO_BACK' | 'CHARGE' | 'HOLD'; chargeUnits: number; penalized: boolean; basis: string } {
  if ((SAFETY_DECLINE_REASONS as readonly string[]).includes(reason)) return { action: 'KEEP_POSITION', chargeUnits: 0, penalized: false, basis: 'Safety / eligibility decline — never counted against the technician.' };
  switch (policy.technicianDeclinePolicy) {
    case 'MOVE_TO_BACK': return { action: 'MOVE_TO_BACK', chargeUnits: 0, penalized: true, basis: 'Declined — moved to the back (salon rule).' };
    case 'CHARGE_HALF_TURN': return { action: 'CHARGE', chargeUnits: FULL_TURN / 2, penalized: true, basis: 'Declined — charged 0.5 turn (salon rule).' };
    case 'CHARGE_FULL_TURN': return { action: 'CHARGE', chargeUnits: FULL_TURN, penalized: true, basis: 'Declined — charged 1.0 turn (salon rule).' };
    case 'MANAGER_DECIDES': return { action: 'HOLD', chargeUnits: 0, penalized: false, basis: 'Declined — on hold for a manager to decide (salon rule).' };
    default: return { action: 'KEEP_POSITION', chargeUnits: 0, penalized: false, basis: 'Declined — position kept (salon rule).' };
  }
}
/** §152–153: an offer that timed out is not automatically a full penalty. */
export function offerTimeoutConsequence(policy: TurnPolicy): { action: 'KEEP_POSITION' | 'MOVE_TO_BACK' | 'HOLD'; basis: string } {
  if (policy.offerTimeoutPolicy === 'MOVE_BACK') return { action: 'MOVE_TO_BACK', basis: 'Offer timed out — moved to the back (salon rule).' };
  if (policy.offerTimeoutPolicy === 'MANAGER_REVIEW') return { action: 'HOLD', basis: 'Offer timed out — on hold for a manager to review.' };
  return { action: 'KEEP_POSITION', basis: 'Offer timed out — position kept.' };
}

// ── board status (§25, §91) ───────────────────────────────────────────────────────────────────────────────────────
export function boardStatusOf(s: Pick<TurnStateLike, 'status' | 'inRotation'>, ctx: { isNext: boolean; appointmentSoon: boolean; offerPending: boolean }): BoardStatus {
  if (s.status === 'CLOCKED_OUT') return 'CLOCKED_OUT';
  if (s.status === 'ASSIGNED' && ctx.offerPending) return 'ASSIGNMENT_OFFERED';
  if (s.status === 'READY') { if (ctx.appointmentSoon) return 'APPOINTMENT_SOON'; if (ctx.isNext) return 'NEXT_UP'; }
  return s.status;
}
export type BoardColumn = 'NEXT_READY' | 'SERVING' | 'APPOINTMENT_SOON' | 'BREAK_HOLD' | 'OFF_SHIFT';
export function boardColumnOf(b: BoardStatus): BoardColumn {
  switch (b) {
    case 'NEXT_UP': case 'READY': return 'NEXT_READY';
    case 'ASSIGNED': case 'ASSIGNMENT_OFFERED': case 'SERVING': return 'SERVING';
    case 'APPOINTMENT_SOON': return 'APPOINTMENT_SOON';
    case 'BREAK': case 'HOLD': case 'UNAVAILABLE': return 'BREAK_HOLD';
    default: return 'OFF_SHIFT';
  }
}

// ── Technician App visibility (§94–96) ────────────────────────────────────────────────────────────────────────────
export interface TechQueueEntry { technicianId: string; name: string | null; rank: number; status: BoardStatus }
export interface TechQueueView {
  visibility: TurnPolicy['technicianQueueVisibility'];
  myRank: number | null; queueLength: number | null; myStatus: BoardStatus | null;
  /** only what the salon's visibility allows — names and statuses, never anyone's money (§95) */
  team: { name: string | null; rank: number; status: BoardStatus; isMe: boolean }[];
}
export function techQueueView(policy: TurnPolicy, order: TechQueueEntry[], meId: string): TechQueueView {
  const me = order.find((o) => o.technicianId === meId) ?? null;
  const v = policy.technicianQueueVisibility;
  const base = { visibility: v, myRank: me?.rank ?? null, myStatus: me?.status ?? null };
  const row = (o: TechQueueEntry) => ({ name: o.name, rank: o.rank, status: o.status, isMe: o.technicianId === meId });
  if (v === 'FULL_TEAM_QUEUE') return { ...base, queueLength: order.length, team: order.map(row) };
  if (v === 'NEXT_FEW') return { ...base, queueLength: order.length, team: order.slice(0, policy.nextFewCount).map(row) };
  if (v === 'POSITION_ONLY') return { ...base, queueLength: order.length, team: [] };
  return { ...base, queueLength: null, team: [] };   // PRIVATE_POSITION
}

// ── errors (§194–195) ─────────────────────────────────────────────────────────────────────────────────────────────
export const TURN_ERROR_MESSAGES = {
  TURN_QUEUE_NOT_CONFIGURED: 'The turn queue is not set up for this location yet.',
  TECHNICIAN_NOT_CLOCKED_IN: 'This technician is not clocked in.',
  TECHNICIAN_NOT_READY: 'This technician is not ready for a new guest right now.',
  TECHNICIAN_NOT_ELIGIBLE: 'This technician cannot take this guest right now.',
  TECHNICIAN_SKILL_MISMATCH: 'This technician is not approved for the requested service.',
  TECHNICIAN_ON_BREAK: 'This technician is on a break.',
  APPOINTMENT_CONFLICT: 'This technician has an appointment soon and cannot take this service without creating a scheduling conflict.',
  TECHNICIAN_ALREADY_SERVING: 'This technician is already serving a guest.',
  NO_ELIGIBLE_TECHNICIAN: 'No technician can take this guest right now.',
  QUEUE_VERSION_CONFLICT: 'The queue changed while you were looking at it. It has been refreshed — please try again.',
  ASSIGNMENT_ALREADY_EXISTS: 'This guest already has that assignment.',
  TURN_POLICY_INVALID: 'These turn settings contradict each other.',
  MANUAL_OVERRIDE_REASON_REQUIRED: 'Choose a reason for assigning someone other than the recommended technician.',
} as const;
export type TurnErrorCode = keyof typeof TURN_ERROR_MESSAGES;
export class TurnQueueError extends Error {
  constructor(public readonly code: TurnErrorCode, message?: string, public readonly status = code === 'QUEUE_VERSION_CONFLICT' || code === 'ASSIGNMENT_ALREADY_EXISTS' || code === 'APPOINTMENT_CONFLICT' ? 409 : code === 'TURN_QUEUE_NOT_CONFIGURED' ? 404 : 400) {
    super(message ?? TURN_ERROR_MESSAGES[code]); this.name = 'TurnQueueError';
  }
}
/** A friendly sentence naming the technician (§195). */
export function friendlyTurnError(code: TurnErrorCode, technicianName?: string | null): string {
  const who = technicianName?.trim();
  if (!who) return TURN_ERROR_MESSAGES[code];
  return TURN_ERROR_MESSAGES[code].replace(/^This technician/, who).replace(/^This guest/, 'This guest');
}
/** Map the engine's hard-fail reasons to the standard skip / error vocabularies. */
export const HARD_FAIL_TO_SKIP: Record<string, SkipReason> = {
  wrong_branch: 'WRONG_BRANCH', not_clocked_in: 'NOT_CLOCKED_IN', missing_skill: 'SKILL_INELIGIBLE', at_capacity: 'ALREADY_SERVING', on_break: 'ON_BREAK',
  blocked: 'BLOCKED', appointment_reserved: 'APPOINTMENT_CONFLICT', station_unavailable: 'STATION_UNAVAILABLE', manual_lock: 'ASSIGNMENT_LOCKED',
  manager_hold: 'MANAGER_HOLD', not_in_rotation: 'NOT_ON_SHIFT', customer_declined: 'CUSTOMER_DECLINED', max_consecutive_auto: 'MAX_CONSECUTIVE_AUTO',
  language_mismatch: 'LANGUAGE_MATCH',
};
export const SKIP_TO_ERROR: Partial<Record<SkipReason, TurnErrorCode>> = {
  SKILL_INELIGIBLE: 'TECHNICIAN_SKILL_MISMATCH', ON_BREAK: 'TECHNICIAN_ON_BREAK', APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT', ALREADY_SERVING: 'TECHNICIAN_ALREADY_SERVING',
  NOT_CLOCKED_IN: 'TECHNICIAN_NOT_CLOCKED_IN', NOT_ON_SHIFT: 'TECHNICIAN_NOT_READY', MANAGER_HOLD: 'TECHNICIAN_NOT_READY',
};
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  SKILL_INELIGIBLE: 'not approved for this service', ON_BREAK: 'on break', APPOINTMENT_CONFLICT: 'appointment soon', ALREADY_SERVING: 'already serving',
  CUSTOMER_REQUEST: 'guest asked for someone else', CUSTOMER_DECLINED: 'guest declined this technician', MANAGER_HOLD: 'on hold', NOT_CLOCKED_IN: 'not clocked in',
  NOT_ON_SHIFT: 'not in the rotation', WRONG_BRANCH: 'working at another location', BLOCKED: 'blocked time', STATION_UNAVAILABLE: 'station unavailable',
  ASSIGNMENT_LOCKED: 'guest locked to another technician', MAX_CONSECUTIVE_AUTO: 'just received the previous automatic assignment', MANUAL_OVERRIDE: 'staff chose another technician',
  CERTIFICATION_INVALID: 'certification not valid', LANGUAGE_MATCH: "does not speak the guest's language",
};

/** §158: a language name or code → a short code (vi, en, es, zh, ko, …) so a guest's "Vietnamese" matches a technician's "vi";
 *  anything unrecognised is kept lower-cased. Empty → null. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: 'en', vietnamese: 'vi', 'tiếng việt': 'vi', 'tieng viet': 'vi', spanish: 'es', español: 'es', espanol: 'es', chinese: 'zh', mandarin: 'zh', cantonese: 'zh',
  korean: 'ko', 한국어: 'ko', japanese: 'ja', tagalog: 'tl', filipino: 'tl', khmer: 'km', cambodian: 'km', thai: 'th', lao: 'lo', french: 'fr', portuguese: 'pt', russian: 'ru', arabic: 'ar', hindi: 'hi',
};
export function languageCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase(); if (!t) return null;
  if (LANGUAGE_NAMES[t]) return LANGUAGE_NAMES[t];
  const base = t.split(/[-_]/)[0];
  return LANGUAGE_NAMES[base] ?? base;
}
