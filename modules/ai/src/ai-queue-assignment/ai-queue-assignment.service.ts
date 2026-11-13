// ai-queue-assignment.service.ts — the AI queue-assignment engine's orchestration: read the queue domain's inputs, run
// the deterministic hard rules, rank with the engine, persist the envelope, and — when staff accept / override, or the
// auto-run acts — ASSIGN through the queue's own action. It never writes queue tables itself.
//
// BUILD_PLAN Phase 6 (docs/audit-2026-10-06/spec-ai-queue-assignment.md):
//  • inputs: requested / previous technician reach the engine (bug 1); appointment reservation from a real start time
//    (bug 2); every candidate's REAL branch, lock, break, blocked, station, max concurrent; availability + shift end.
//  • every envelope records the settings version (`configVersion`) and the guest's version (`queueVersion`).
//  • decisions ACT through QueueService.assignTechnician with the technician + version the suggestion saw (a stale
//    guest is refused, 409), idempotently; the row records `applied`; QUEUE_ASSIGNMENT_DECIDED is written with it and the
//    realtime `queueAssignmentDecided` goes out (bug 8 — decision events were dropped).
//  • the auto-run obeys every switch through the ONE settings source (platform `ai.auto_actions`, salon kill switch,
//    branch — bug 6), the delay and exclusions, never touches a locked guest or one who asked for someone else (bug 6),
//    never overwrites an assignment (expected technician = nobody + version — bug 5), and logs 'auto_assigned' (bug 13).
//  • it is also the board's recommender (QUEUE_RECOMMENDER): `suggest` (no persistence) and `balance`.
import { hasPermission } from '@aipowersalon/permissions';
import { evaluateEligibility } from './ai-queue-assignment-eligibility';
import { buildRecommendation, shiftEndCaution } from './ai-queue-assignment-engine';
import { applyConfiguredOrder, rankFairTurn, FAIR_TURN_ENGINE_VERSION, type FairTurnCandidate } from './fair-turn-engine';
import { isFairnessMode, HARD_FAIL_TO_SKIP, mergeTurnPolicy, type TurnStateLike, type FairnessMode, type SkipReason } from '@aipowersalon/workforce';
import { computeRotation, ROTATION_POLICIES, type RotationPolicy } from './ai-queue-assignment-rotation';
import { reservationDecision } from './ai-queue-assignment-appointment';
import { computeDecisionAnalytics, type DecisionLike } from './ai-queue-assignment-analytics';
import { autoAssignDecision } from './ai-queue-assignment-auto';
import { composeVisitPlan, composePartyPlan, PLAN_VERSION, type ComposeVisitInput, type PlanCandidate, type PlanLineInput } from './ai-queue-assignment-plan';
import type { VisitPlan, PartyPlan, PlanRecommendationView, PlanDecisionRequest, PlanDecisionResponse, AssignPlanResult } from '@aipowersalon/api-contracts/tenant';
import {
  InMemoryQueueAssignmentSettings, QueueSettingsConflictError, QueueSettingsValidationError,
  type QueueAssignmentSettingsPort, type EffectiveQueueAssignmentSettings, type SettingsPatch, type AutoExclusions,
} from './ai-queue-assignment-settings';
import type {
  QueueDataPort, AssignmentEmitterPort, QueueCandidateInput, AppointmentDataPort, QueueScanPort,
  AssignExecutionPort, QueueEntryInputs, ScanEntryData, UpcomingAppointment, PlanAssignOptions, TurnReadPort, AssignTurnDecision,
} from './ai-queue-assignment.ports';
import type { QueueAssignmentRepositoryPort, DecisionRecord } from './ai-queue-assignment.repository';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import {
  QueueAssignmentContext, RecommendationEnvelope, DecisionType, EligibilityInput, AssignmentSignals, HardFailReason, STAFF_DECISIONS,
  QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError, QueueAssignmentStaleError,
} from './ai-queue-assignment.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const FAIL_LABEL: Record<HardFailReason, string> = {
  wrong_branch: 'wrong branch', not_clocked_in: 'not clocked in', missing_skill: 'missing required skill',
  at_capacity: 'at capacity', on_break: 'on break', blocked: 'blocked', appointment_reserved: 'reserved for an appointment',
  station_unavailable: 'station unavailable', manual_lock: 'assignment locked',
  not_in_rotation: 'not in today\u2019s rotation', manager_hold: 'on hold', customer_declined: 'the guest declined this technician',
};
const FEEDBACK_CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;

export interface QueueAssignmentDeps {
  appointments?: AppointmentDataPort;
  scan?: QueueScanPort;
  /** the ONE settings source; without one, an in-memory default (auto OFF) */
  settings?: QueueAssignmentSettingsPort;
  /** the queue's own assign; without one, decisions are recorded but nothing is assigned (applied = false) */
  assign?: AssignExecutionPort;
  /** Fair Turn Engine: today's technician turn queue (without it a fairness-mode salon falls back to the scoring engine) */
  turn?: TurnReadPort;
}

export interface AutoConfigView {
  enabled: boolean; confidenceFloor: number; maxPerRun: number; delaySeconds: number; exclusions: AutoExclusions;
  autoAllowed: boolean; autoBlockedBy: EffectiveQueueAssignmentSettings['autoBlockedBy'];
  salonAutoKilled: boolean; salonAutoKilledReason: string | null; platformAutoActionsDisabled: boolean;
  configVersion: string; branchVersion: number;
}
export interface AutoRunResult {
  enabled: boolean; allowed: boolean; blockedBy: EffectiveQueueAssignmentSettings['autoBlockedBy'];
  assigned: number; considered: number; skipped: { queueEntryId: string; reason: string }[];
}
export interface DecisionResponse { decision: DecisionRecord; applied: boolean; queueItem: Record<string, unknown> | null; replayed?: boolean }
export interface SuggestResult { technicianId: string | null; name: string | null; confidence: number; requiredAction: string; reasons: string[]; mode?: 'single' | 'split'; technicianNames?: string[] }
export interface BalanceResult {
  proposals: { queueItemId: string; technicianId: string; technicianName: string; confidence: number; reasons: string[] }[];
  unassignable: { queueItemId: string; reason: string }[];
}

interface ComputeOpts {
  system?: boolean; excludeTechnicianIds?: string[]; extraLoad?: Record<string, number>;
  /** multi-technician routing: rank for ONE line — its category and minutes replace the visit's (every hard rule,
   *  rotation and scoring term runs unchanged per line) */
  lineScope?: { categories: string[]; durationMinutes: number; serviceId?: string | null };
  /** already-read inputs / appointments (one read per plan, not per line) */
  inputs?: QueueEntryInputs; upcoming?: Record<string, UpcomingAppointment>;
  /** M4: a board's Best Match for every waiting guest reads the salon's settings and today's turn queue ONCE */
  settings?: EffectiveQueueAssignmentSettings; turnShared?: TurnShared;
}
/** The branch-wide turn reads a batch of guests shares (computeFairTurn reads them per guest otherwise). */
interface TurnShared { day: { rows: TurnStateLike[] }; specialIds: string[] }
const PLAN_DECISIONS = ['accepted', 'adjusted', 'rejected', 'kept_unassigned'] as const;
type PlanEnvelopeExtra = { plan?: { kind: 'visit' | 'party'; visit?: VisitPlan | null; party?: PartyPlan | null; planVersion: string } };
/** One technician as the per-customer panel shows it: the engine's view, eligibility and the plain reasons. */
export interface PanelCandidate {
  technicianId: string; name: string; branchId: string | null; available: boolean; eligible: boolean; reasons: string[];
  matchScore: number | null; activeAssignments: number; maxConcurrent: number; availableInMinutes: number | null; shiftEndsInMinutes: number | null;
  nextAppointmentInMinutes: number | null; onBreak: boolean; blocked: boolean; isPrevious: boolean; isRequested: boolean; skills: string[];
}
interface Computed { inputs: QueueEntryInputs; envelope: RecommendationEnvelope; settings: EffectiveQueueAssignmentSettings; candidates: PanelCandidate[] }

export class QueueAssignmentService {
  private readonly settings: QueueAssignmentSettingsPort;
  constructor(
    private readonly repo: QueueAssignmentRepositoryPort,
    private readonly data: QueueDataPort,
    private readonly entitlement?: QueueAssignmentEntitlementPort,
    private readonly emitter?: AssignmentEmitterPort,
    private readonly deps: QueueAssignmentDeps = {},
  ) {
    this.settings = deps.settings ?? new InMemoryQueueAssignmentSettings();
  }

  private need(ctx: QueueAssignmentContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, perm)) throw new QueueAssignmentForbiddenError('Missing ' + perm);
    this.branch(ctx);
  }
  /** Audit bug 14: the queue belongs to one location — an empty branch is a plain 400, never '' into a UUID column. */
  private branch(ctx: QueueAssignmentContext): string {
    const b = typeof ctx?.branchId === 'string' ? ctx.branchId.trim() : '';
    if (!b) throw withCode(new QueueAssignmentValidationError('Choose a location first — the queue belongs to one location.'), 'BRANCH_REQUIRED');
    return b;
  }
  private async assertEnabled(ctx: QueueAssignmentContext) {
    if (this.entitlement && !(await this.entitlement.isEnabled(ctx.tenantId))) throw new QueueAssignmentDisabledError();
  }
  private scope(ctx: QueueAssignmentContext) { return { tenantId: ctx.tenantId, branchId: this.branch(ctx) }; }
  private actor(ctx: QueueAssignmentContext) { return { userId: ctx.userId || null, role: ctx.role ?? null }; }

  // ── the engine ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Inputs → hard rules → rotation → ranking. Pure of side effects (nothing persisted, nothing emitted). */
  private async compute(ctx: QueueAssignmentContext, queueEntryId: string, opts: ComputeOpts = {}): Promise<Computed> {
    const inputs = opts.inputs ?? await this.data.getInputs(ctx, queueEntryId, { system: opts.system });
    if (!inputs) throw new QueueAssignmentValidationError('QUEUE_ENTRY_NOT_FOUND');
    const settings = opts.settings ?? await this.settings.effective(this.scope(ctx));
    const entry = inputs.entry;
    const req = opts.lineScope ? opts.lineScope.categories : (entry.requiredCategories ?? []);
    const durationMinutes = opts.lineScope ? opts.lineScope.durationMinutes : entry.serviceDurationMinutes;
    const queueBranchId = entry.branchId ?? ctx.branchId;
    const lock = entry.lock ?? null;
    const exclude = new Set(opts.excludeTechnicianIds ?? []);
    const extra = opts.extraLoad ?? {};

    // Load, minutes, availability, break and shift end come with the queue's inputs; confirmed appointments from the
    // appointments domain (start resolved in the branch zone).
    const upcoming = opts.upcoming ?? (this.deps.appointments ? await this.deps.appointments.getUpcoming(ctx) : {});
    const enriched: QueueCandidateInput[] = inputs.candidates.filter((c) => !exclude.has(c.technicianId)).map((c) => {
      const appt = upcoming[c.technicianId];
      const known = [c.nextAppointmentInMinutes, appt?.nextAppointmentInMinutes].filter((x): x is number => typeof x === 'number' && isFinite(x) && x >= 0);
      const nextAppt = known.length ? Math.min(...known) : null;
      // Appointment protection: hold the technician (a hard fail) when this service would run into their next
      // confirmed appointment — unless this guest IS that appointment's customer (their own booked technician).
      const ownAppointment = !!entry.isAppointment && !!entry.requestedTechnicianId && entry.requestedTechnicianId === c.technicianId;
      // Fair Turn §21–23: the salon's protection switch + buffer (turn policy) — no longer an environment constant
      const protect = settings.turnPolicy?.appointmentProtectionEnabled !== false;
      const reserve = ownAppointment || !protect ? { reserved: false } : reservationDecision(nextAppt, durationMinutes, settings.turnPolicy?.appointmentProtectionBufferMinutes ?? undefined);
      return {
        ...c,
        activeAssignments: (c.activeAssignments ?? 0) + (extra[c.technicianId] ?? 0),
        assignedMinutes: c.assignedMinutes ?? null,
        availableInMinutes: c.availableInMinutes ?? null,
        onBreak: !!c.onBreak,
        nextAppointmentInMinutes: nextAppt,
        reservedForAppointment: !!(c.reservedForAppointment || reserve.reserved),
        // An active lock pins the guest to one technician (everyone else is locked out) or to nobody yet.
        manualLock: !!(c.manualLock || (lock && lock.technicianId !== c.technicianId)),
        isPrevious: !!(c.isPrevious || (entry.previousTechnicianId && entry.previousTechnicianId === c.technicianId)),
      };
    });

    const eligResults = enriched.map((c) => ({ c, r: evaluateEligibility(toEligibilityInput(c, req, queueBranchId, !opts.lineScope, opts.lineScope?.serviceId ?? null)) }));

    // ── Fair Turn Engine (wave 2): the salon ranks by the turn queue, not by a weighted score. Oct 13 2026 (FLOW T1):
    // every rotation value resolves to a fairness mode (legacy policies map onto their mode in settings), so the weighted
    // path below runs ONLY when no turn-queue adapter is wired (no database — in-memory / demo), never in production.
    if (isFairnessMode(settings.rotationPolicy) && this.deps.turn) {
      return this.computeFairTurn(ctx, queueEntryId, inputs, settings, eligResults, { durationMinutes, req, lock, system: !!opts.system, shared: opts.turnShared });
    }
    const eligible = eligResults.filter((x) => x.r.eligible).map((x) => x.c);
    const ineligible = eligResults.filter((x) => !x.r.eligible).map((x) => ({ technicianId: x.c.technicianId, name: x.c.name, reasons: x.r.hardFails.map((f) => FAIL_LABEL[f]) }));

    // Rotation orders ELIGIBLE technicians only (never overrides the hard rules). Policy + fixed order from settings.
    // the fairness mode's nearest scoring order for this degraded path (manual_order keeps the configured fixed order)
    const FALLBACK: Record<string, RotationPolicy> = { manual_order: 'fixed_order', workload_balanced: 'least_minutes', lowest_turn_units: 'least_customers', hybrid_fairness: 'hybrid', traditional_weighted_rotation: 'hybrid' };
    const policy: RotationPolicy = (ROTATION_POLICIES as string[]).includes(settings.rotationPolicy) ? (settings.rotationPolicy as RotationPolicy) : FALLBACK[settings.rotationPolicy] ?? 'hybrid';
    const lastServed = policy === 'fixed_order' ? (lastServedOf(inputs.candidates) ?? await this.repo.lastServedTechnician(ctx)) : null;
    const rotationMap = computeRotation(policy, eligible.map((c) => ({
      technicianId: c.technicianId, assignedMinutes: c.assignedMinutes ?? null, activeAssignments: c.activeAssignments,
      availableInMinutes: c.availableInMinutes ?? null, fixedRotationIndex: c.rotationIndex ?? null,
    })), { fixedOrder: settings.fixedOrder, lastServedTechnicianId: lastServed });

    const signals: AssignmentSignals[] = eligible.map((c) => ({ ...toSignals(c, entry.requestedTechnicianId), rotationIndex: rotationMap[c.technicianId] ?? null }));
    const conflicts = summarizeConflicts(eligResults.filter((x) => !x.r.eligible).flatMap((x) => x.r.hardFails), signals.length);
    if (lock && lock.technicianId === null) conflicts.unshift(`Locked — do not assign anyone yet${lock.reason ? ` (${lock.reason})` : ''}`);

    const envelope = buildRecommendation({
      queueEntryId, requiredCategories: req, serviceDurationMinutes: durationMinutes, eligible: signals, conflicts,
      configVersion: settings.configVersion, queueVersion: entry.version ?? null,
      requestedTechnicianId: entry.requestedTechnicianId ?? null,
      requestedTechnicianName: inputs.candidates.find((c) => c.technicianId === entry.requestedTechnicianId)?.name ?? null,
      ineligible,
    }, { allRanked: true });
    const scoreOf = new Map((envelope as any).ranked?.map((r: { technicianId: string; matchScore: number }) => [r.technicianId, r.matchScore]) ?? []);
    delete (envelope as any).ranked;
    const candidates: PanelCandidate[] = eligResults.map(({ c, r }) => ({
      technicianId: c.technicianId, name: c.name, branchId: c.branchId, available: c.available, eligible: r.eligible, reasons: r.hardFails.map((f) => FAIL_LABEL[f]),
      matchScore: (scoreOf.get(c.technicianId) as number | undefined) ?? null, activeAssignments: c.activeAssignments, maxConcurrent: Math.max(1, c.maxConcurrent ?? 1),
      availableInMinutes: c.availableInMinutes ?? null, shiftEndsInMinutes: c.shiftEndsInMinutes ?? null, nextAppointmentInMinutes: c.nextAppointmentInMinutes ?? null,
      onBreak: !!c.onBreak, blocked: !!c.blocked, isPrevious: !!c.isPrevious, isRequested: !!entry.requestedTechnicianId && entry.requestedTechnicianId === c.technicianId, skills: c.skills,
    }));
    return { inputs, envelope, settings, candidates };
  }

  /** The Fair Turn pipeline (fair-turn-engine.ts) over the gate's results + today's turn queue → the envelope + panel. */
  private async computeFairTurn(ctx: QueueAssignmentContext, queueEntryId: string, inputs: QueueEntryInputs, settings: EffectiveQueueAssignmentSettings,
    eligResults: { c: QueueCandidateInput; r: { eligible: boolean; hardFails: HardFailReason[] } }[], o: { durationMinutes: number; req: string[]; lock: { technicianId: string | null; reason: string | null } | null; system: boolean; shared?: TurnShared }): Promise<Computed> {
    const entry = inputs.entry;
    const nowMs = Date.now();
    const wantLanguage = (settings.turnPolicy.languageMatch ?? 'SOFT') !== 'OFF' && !!this.deps.turn!.guestLanguage && !!this.deps.turn!.technicianLanguages;
    const [day, declined, specialIds, guestLanguage] = await Promise.all([
      o.shared ? Promise.resolve(o.shared.day) : this.deps.turn!.day(ctx).catch(() => ({ rows: [] as TurnStateLike[] })),
      this.deps.turn!.declined(ctx, queueEntryId).catch(() => [] as string[]),
      o.shared ? Promise.resolve(o.shared.specialIds) : settings.turnPolicy.specialRotationEnabled && this.deps.turn!.specialServiceIds ? this.deps.turn!.specialServiceIds(ctx).catch(() => [] as string[]) : Promise.resolve([] as string[]),
      wantLanguage ? this.deps.turn!.guestLanguage!(ctx, queueEntryId).catch(() => null) : Promise.resolve(null as string | null),
    ]);
    // §158: who speaks the guest's language (only looked up when she has one); unknown stays unknown
    const spoken = guestLanguage ? await this.deps.turn!.technicianLanguages!(ctx, eligResults.map((x) => x.c.technicianId)).catch(() => new Map<string, Set<string>>()) : new Map<string, Set<string>>();
    const speaks = (id: string): boolean | null => (guestLanguage && spoken.has(id) ? spoken.get(id)!.has(guestLanguage) : null);
    const rowsBy = new Map(day.rows.map((r) => [r.technicianId, r]));
    // A technician the gate finds clocked in but who has no turn row today (clocked in before the day began, or before
    // the turn queue existed) joins at the back — virtually here; the assignment writes the real JOIN (history complete).
    let back = Math.max(0, ...day.rows.filter((r) => r.inRotation).map((r) => r.rotationPosition)) + 1;
    const cands: FairTurnCandidate[] = eligResults.map(({ c, r }) => {
      let turn: TurnStateLike | null = rowsBy.get(c.technicianId) ?? null;
      if (!turn && r.eligible) turn = { technicianId: c.technicianId, name: c.name, status: 'READY', inRotation: true, rotationPosition: back++, accumulatedUnits: 0, provisionalUnits: 0, pendingUnits: 0,
        baselineUnits: Math.max(0, ...day.rows.filter((x) => x.inRotation).map((x) => x.accumulatedUnits + x.provisionalUnits + x.baselineUnits)), specialUnits: 0, serviceMinutes: 0, baselineMinutes: 0, readySince: null };
      const warnings: string[] = [];
      const shift = shiftEndCaution(c.shiftEndsInMinutes, Math.max(0, c.availableInMinutes ?? 0) + Math.max(0, o.durationMinutes), o.durationMinutes);
      if (shift) warnings.push(shift.warning);
      return { technicianId: c.technicianId, name: c.name, hardFails: r.hardFails, turn, isPrevious: !!c.isPrevious, warnings, nextAppointmentInMinutes: c.nextAppointmentInMinutes ?? null, speaksGuestLanguage: speaks(c.technicianId) };
    });
    const serviceIds = (entry.services ?? []).filter((x) => x.status !== 'cancelled').map((x) => x.serviceId);
    const specialPool = specialIds.length > 0 && serviceIds.length > 0 && serviceIds.every((id) => specialIds.includes(id));
    const fair = rankFairTurn({
      mode: settings.rotationPolicy as FairnessMode, policy: settings.turnPolicy, assignmentMode: settings.assignmentMode, policyVersion: settings.configVersion, nowMs,
      candidates: applyConfiguredOrder(settings.rotationPolicy as FairnessMode, settings.fixedOrder, cands),   // T1: the configured fixed order under manual_order
      guestLanguage, requestedTechnicianId: entry.requestedTechnicianId ?? null, declinedTechnicianIds: declined, specialPool,
      automatic: settings.assignmentMode === 'AUTOMATIC', serviceLabel: (entry.services ?? []).map((x) => x.serviceName).filter(Boolean).join(' + ') || null,
    });
    const byId = new Map(eligResults.map((x) => [x.c.technicianId, x.c]));
    const rankOf = new Map(fair.ranking.map((x) => [x.technicianId, x]));
    const mk = (id: string, reasons: string[]) => {
      const c = byId.get(id)!; const start = typeof c.availableInMinutes === 'number' ? Math.max(0, c.availableInMinutes) : null;
      return { technicianId: id, name: c.name, eligible: true, matchScore: 1000 - (rankOf.get(id)?.turnRank ?? 999), reasons, warnings: cands.find((x) => x.technicianId === id)?.warnings ?? [],
        estimatedStartInMinutes: start, estimatedCompletionInMinutes: start == null ? null : start + Math.max(0, o.durationMinutes) };
    };
    const recommended = fair.recommendedTechnicianId ? mk(fair.recommendedTechnicianId, fair.why) : null;
    const alternates = fair.eligibleOrder.slice(1, 4).map((id) => mk(id, [rankOf.get(id)?.basis ?? 'Eligible']));
    const allFails = fair.ranking.filter((x) => !x.eligible).flatMap((x) => x.hardFails as HardFailReason[]);
    const conflicts = summarizeConflicts(allFails, fair.eligibleOrder.length);
    if (o.lock && o.lock.technicianId === null) conflicts.unshift(`Locked — do not assign anyone yet${o.lock.reason ? ` (${o.lock.reason})` : ''}`);
    const warnings = [...fair.warnings];
    const requiredAction = !recommended ? 'no_eligible_technician' : warnings.length ? 'staff_review' : 'assignable';
    const ineligible = fair.ranking.filter((x) => !x.eligible).map((x) => ({ technicianId: x.technicianId, name: x.name, reasons: x.hardFails.map((f) => FAIL_LABEL[f as HardFailReason] ?? f) }));
    const envelope: RecommendationEnvelope = {
      queueEntryId, recommended, alternates, confidence: recommended ? 1 : 0, conflicts, warnings, requiredAction: requiredAction,
      ruleVersion: FAIR_TURN_ENGINE_VERSION, recoVersion: FAIR_TURN_ENGINE_VERSION, generatedAt: new Date(nowMs).toISOString(),
      configVersion: settings.configVersion, queueVersion: entry.version ?? null, requestedTechnicianId: entry.requestedTechnicianId ?? null, ineligible,
      fairTurn: {
        mode: fair.mode, assignmentMode: fair.assignmentMode, policyVersion: fair.policyVersion, recommendedTechnicianId: fair.recommendedTechnicianId, requested: fair.requested,
        why: fair.why, whyCoded: fair.whyCoded, skipped: fair.skippedText, skips: fair.skips, eligiblePool: fair.eligiblePool,
        orderChange: fair.orderChange,   // LIVE TECHNICIAN SCHEDULE 14: rotation pick vs recommendation, and what changed it
        candidates: fair.ranking.map((x) => ({ technicianId: x.technicianId, name: x.name, turnRank: x.turnRank, eligible: x.eligible, reasons: x.reasons, hardFails: x.hardFails, skipReason: x.skipReason, effectiveUnits: x.effectiveUnits, readyMinutes: x.readyMinutes, basis: x.basis })),
      },
    } as RecommendationEnvelope;
    const candidates: PanelCandidate[] = eligResults.map(({ c }) => {
      const f = rankOf.get(c.technicianId);
      return {
        technicianId: c.technicianId, name: c.name, branchId: c.branchId, available: c.available, eligible: !!f?.eligible, reasons: (f?.hardFails ?? []).map((x) => FAIL_LABEL[x as HardFailReason] ?? x),
        matchScore: f?.eligible ? 1000 - (f.turnRank ?? 999) : null, activeAssignments: c.activeAssignments, maxConcurrent: Math.max(1, c.maxConcurrent ?? 1),
        availableInMinutes: c.availableInMinutes ?? null, shiftEndsInMinutes: c.shiftEndsInMinutes ?? null, nextAppointmentInMinutes: c.nextAppointmentInMinutes ?? null,
        onBreak: !!c.onBreak, blocked: !!c.blocked, isPrevious: !!c.isPrevious, isRequested: !!entry.requestedTechnicianId && entry.requestedTechnicianId === c.technicianId, skills: c.skills,
      };
    });
    return { inputs, envelope, settings, candidates };
  }

  /**
   * §168 Simulate Turn Rules — the SAME engine over hypothetical technicians; nothing is read from or written to the floor.
   * Each row: turns today, minutes ready, service minutes, and the hard facts (eligible for the service, on break, on hold,
   * appointment in N minutes). The salon's own policy is the default; `mode` / `turnPolicy` try a different one.
   */
  async simulateFairTurn(ctx: QueueAssignmentContext, body: { mode?: string; turnPolicy?: Record<string, unknown>; serviceMinutes?: number; requestedName?: string | null; serviceLabel?: string | null;
    technicians?: { name?: string; turns?: number; readyMinutes?: number; serviceMinutes?: number; skillEligible?: boolean; onBreak?: boolean; onHold?: boolean; appointmentInMinutes?: number | null; clockedIn?: boolean; position?: number }[] }) {
    if (!ctx?.tenantId || !ctx?.userId) throw new QueueAssignmentForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, 'turn_queue.read')) throw new QueueAssignmentForbiddenError('Missing turn_queue.read');
    const eff = await this.settings.effective({ tenantId: ctx.tenantId, branchId: typeof ctx.branchId === 'string' && ctx.branchId ? ctx.branchId : null });
    const mode = (isFairnessMode(body?.mode) ? body.mode : isFairnessMode(eff.rotationPolicy) ? eff.rotationPolicy : 'traditional_weighted_rotation') as FairnessMode;
    const policy = mergeTurnPolicy(eff.turnPolicy, body?.turnPolicy ?? {});
    const rows = Array.isArray(body?.technicians) ? body.technicians.slice(0, 30) : [];
    if (!rows.length) throw withCode(new QueueAssignmentValidationError('Add at least one technician to simulate.'), 'SIMULATE_TECHNICIANS_REQUIRED');
    const nowMs = Date.UTC(2026, 0, 5, 15, 0, 0);   // a fixed, arbitrary instant — the simulation never depends on today
    const svcMin = Math.max(0, Math.min(600, Number(body?.serviceMinutes) || 45));
    const cands: FairTurnCandidate[] = rows.map((r, i) => {
      const id = `sim-${String(i + 1).padStart(2, '0')}`;
      const fails: string[] = [];
      if (r.clockedIn === false) fails.push('not_clocked_in');
      if (r.skillEligible === false) fails.push('missing_skill');
      if (typeof r.appointmentInMinutes === 'number' && policy.appointmentProtectionEnabled && r.appointmentInMinutes >= 0 && r.appointmentInMinutes < svcMin + policy.appointmentProtectionBufferMinutes) fails.push('appointment_reserved');
      const units = Math.round((Number(r.turns) || 0) * 100);
      const turn: TurnStateLike = { technicianId: id, name: r.name || `Technician ${i + 1}`, status: r.onBreak ? 'BREAK' : r.onHold ? 'HOLD' : 'READY', inRotation: r.clockedIn !== false,
        rotationPosition: typeof r.position === 'number' ? r.position : i + 1, accumulatedUnits: units, provisionalUnits: 0, pendingUnits: units % 100, baselineUnits: 0, specialUnits: 0,
        serviceMinutes: Math.max(0, Number(r.serviceMinutes) || 0), baselineMinutes: 0, readySince: new Date(nowMs - Math.max(0, Number(r.readyMinutes) || 0) * 60000).toISOString() };
      return { technicianId: id, name: turn.name!, hardFails: fails, turn, nextAppointmentInMinutes: typeof r.appointmentInMinutes === 'number' ? r.appointmentInMinutes : null };
    });
    const requested = body?.requestedName ? cands.find((c) => c.name.toLowerCase() === String(body.requestedName).trim().toLowerCase())?.technicianId ?? null : null;
    const fair = rankFairTurn({ mode, policy, assignmentMode: eff.assignmentMode, policyVersion: eff.configVersion, nowMs, candidates: cands, requestedTechnicianId: requested, serviceLabel: body?.serviceLabel ?? null });
    const nameOf = (id: string | null) => cands.find((c) => c.technicianId === id)?.name ?? null;
    return { mode, recommended: nameOf(fair.recommendedTechnicianId), orderChange: fair.orderChange, why: fair.why, whyCoded: fair.whyCoded, skipped: fair.skippedText.map((x) => ({ name: x.name, reason: x.reason, text: x.text, textCoded: x.textCoded })),
      ranking: fair.ranking.map((r) => ({ name: r.name, turnRank: r.turnRank, eligible: r.eligible, reasons: r.reasons, effectiveTurns: r.effectiveUnits == null ? null : r.effectiveUnits / 100, readyMinutes: r.readyMinutes })),
      productionStateChanged: false as const };
  }

  /** QUEUE_RECOMMENDER.turnDecision — what assigning `assigneeId` means under the Fair Turn Engine (no persistence). */
  async turnDecision(ctx: QueueAssignmentContext, queueItemId: string, assigneeId: string): Promise<{ assignmentMode: 'AUTOMATIC' | 'RECOMMEND_AND_CONFIRM' | 'MANUAL'; recommendedTechnicianId: string | null; skips: { technicianId: string; reason: string }[]; eligiblePool: string[]; reasonRequired: boolean } | null> {
    if (!(await this.boardAllowed(ctx))) return null;
    const { envelope } = await this.compute(ctx, queueItemId);
    const ft = envelope.fairTurn;
    if (!ft) return null;
    const rec = ft.recommendedTechnicianId;
    return { assignmentMode: ft.assignmentMode, recommendedTechnicianId: rec, skips: turnSkipsFor(ft, assigneeId), eligiblePool: ft.eligiblePool,
      reasonRequired: ft.assignmentMode !== 'MANUAL' && !!rec && rec !== assigneeId };
  }

  // Build (and persist) a recommendation for one queue entry. Deterministic eligibility first, then the engine.
  async recommend(ctx: QueueAssignmentContext, queueEntryId: string): Promise<RecommendationEnvelope & { recommendationId: string }> {
    this.need(ctx, 'ai_queue_assignment.recommend');
    await this.assertEnabled(ctx);
    const { envelope } = await this.compute(ctx, queueEntryId);
    const saved = await this.repo.saveRecommendation(ctx, envelope, 'staff');
    this.emitter?.emit(ctx, 'queue.assignment_recommended', {
      queueEntryId, recommendationId: saved.id, recommended: envelope.recommended?.technicianId ?? null,
      requiredAction: envelope.requiredAction, confidence: envelope.confidence,
    });
    return { ...envelope, recommendationId: saved.id };
  }

  async getRecommendation(ctx: QueueAssignmentContext, id: string) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const rec = await this.repo.getRecommendation(ctx, id);
    if (!rec) throw new QueueAssignmentValidationError('RECOMMENDATION_NOT_FOUND');
    return { ...rec.envelope, recommendationId: rec.id };
  }

  async latestForEntry(ctx: QueueAssignmentContext, queueEntryId: string) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const rec = await this.repo.latestForEntry(ctx, queueEntryId);
    return rec ? { ...rec.envelope, recommendationId: rec.id } : null;
  }

  /** The per-customer panel: the guest as the engine sees it, the latest suggestion, the decisions, the lock. */
  async panel(ctx: QueueAssignmentContext, queueEntryId: string) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    // The live engine view (computed, not persisted) gives every candidate with eligibility — the panel's override list.
    const { inputs, candidates } = await this.compute(ctx, queueEntryId);
    const [rec, decisions] = await Promise.all([this.repo.latestForEntry(ctx, queueEntryId), this.repo.listDecisions(ctx, queueEntryId)]);
    return {
      entry: inputs.entry,
      candidates,
      recommendation: rec ? { ...rec.envelope, recommendationId: rec.id } : null,
      decisions,
      lock: inputs.entry.lock ?? null,
    };
  }

  // ── multi-technician routing: visit / party plans (contract §2) ───────────────────────────────────────────────
  /** The composer's input for one guest: the whole-visit result (today's single pick) plus every line ranked by the SAME
   *  compute() with its line scope. `whole` may be passed when the caller already computed it. */
  private async visitInput(ctx: QueueAssignmentContext, queueEntryId: string, opts: { system?: boolean; extraLoad?: Record<string, number>; excludeTechnicianIds?: string[]; whole?: Computed } = {}): Promise<{ input: ComposeVisitInput; whole: Computed }> {
    const base: ComputeOpts = { system: opts.system, extraLoad: opts.extraLoad, excludeTechnicianIds: opts.excludeTechnicianIds };
    const whole = opts.whole ?? await this.compute(ctx, queueEntryId, base);
    const upcoming = this.deps.appointments ? await this.deps.appointments.getUpcoming(ctx) : {};
    const entry = whole.inputs.entry;
    const lines: PlanLineInput[] = [];
    for (const svc of (entry.services ?? []).filter((x) => x.status !== 'cancelled')) {
      const c = await this.compute(ctx, queueEntryId, { ...base, inputs: whole.inputs, upcoming, lineScope: { categories: svc.category ? [svc.category] : [], durationMinutes: svc.durationMinutes, serviceId: svc.serviceId ?? null } });
      lines.push({ line: svc, ranked: rankedOf(c), ineligible: c.envelope.ineligible ?? [], confidence: c.envelope.confidence, conflicts: c.envelope.conflicts });
    }
    const requested = entry.requestedTechnicianId ?? null;
    const rec = whole.envelope.recommended;
    return {
      whole,
      input: {
        queueItemId: queueEntryId, customerName: entry.customerName ?? '', queueVersion: entry.version ?? null, currentTechnicianId: entry.assignedTechnicianId ?? null,
        requestedTechnicianId: requested, requestedTechnicianName: requested ? whole.inputs.candidates.find((c) => c.technicianId === requested)?.name ?? null : null,
        ...(entry.lock ? { lockTechnicianId: entry.lock.technicianId } : {}),
        whole: { recommended: rec ? { technicianId: rec.technicianId, name: rec.name, matchScore: rec.matchScore, startInMinutes: rec.estimatedStartInMinutes, reasons: rec.reasons, warnings: rec.warnings,
          shiftEndsInMinutes: whole.candidates.find((c) => c.technicianId === rec.technicianId)?.shiftEndsInMinutes ?? null } : null,
          confidence: whole.envelope.confidence, warnings: whole.envelope.warnings, conflicts: whole.envelope.conflicts },
        lines,
      },
    };
  }
  private planView(id: string, kind: 'visit' | 'party', visit: VisitPlan | null, party: PartyPlan | null, env: RecommendationEnvelope): PlanRecommendationView {
    return { recommendationId: id, kind, visit, party, planVersion: PLAN_VERSION, ruleVersion: env.ruleVersion, recoVersion: env.recoVersion, configVersion: env.configVersion ?? null, generatedAt: env.generatedAt };
  }

  /** POST entries/:id/plan — the visit plan (one technician, or the services split over several). Persisted like recommend(). */
  async planVisit(ctx: QueueAssignmentContext, queueEntryId: string): Promise<PlanRecommendationView> {
    this.need(ctx, 'ai_queue_assignment.recommend');
    await this.assertEnabled(ctx);
    const { input, whole } = await this.visitInput(ctx, queueEntryId);
    const visit = composeVisitPlan(input);
    const env: RecommendationEnvelope & PlanEnvelopeExtra = { ...whole.envelope, confidence: visit.confidence, warnings: visit.warnings, conflicts: visit.conflicts, requiredAction: visit.requiredAction,
      plan: { kind: 'visit', visit, planVersion: PLAN_VERSION } };
    const saved = await this.repo.saveRecommendation(ctx, env, 'staff');
    this.emitter?.emit(ctx, 'queue.assignment_recommended', { queueEntryId, recommendationId: saved.id, recommended: visit.leadTechnicianId, requiredAction: visit.requiredAction, confidence: visit.confidence, mode: visit.mode });
    return this.planView(saved.id, 'visit', visit, null, env);
  }

  /** POST groups/:groupId/plan — one visit plan per member (check-in order); "together" never shares a technician (D7). */
  async planParty(ctx: QueueAssignmentContext, groupId: string): Promise<PlanRecommendationView> {
    this.need(ctx, 'ai_queue_assignment.recommend');
    await this.assertEnabled(ctx);
    const g = this.data.getGroup ? await this.data.getGroup(ctx, groupId) : null;
    if (!g) throw new QueueAssignmentValidationError('QUEUE_GROUP_NOT_FOUND');
    const members = g.members.filter((m) => ['waiting', 'called', 'assigned', 'ready_for_tech'].includes(m.status));
    if (!members.length) throw withCode(new QueueAssignmentValidationError('Nobody in this party is waiting for a technician.'), 'NO_PARTY_GUEST_WAITING');
    const inputs: ComposeVisitInput[] = []; const used = new Set<string>(); const extra: Record<string, number> = {};
    let firstEnv: RecommendationEnvelope | null = null;
    for (const m of members) {
      const { input, whole } = await this.visitInput(ctx, m.queueItemId, { extraLoad: { ...extra }, excludeTechnicianIds: g.together ? [...used] : [] });
      firstEnv = firstEnv ?? whole.envelope;
      inputs.push(input);
      // the techs this member would take hold a slot for the next member (once each)
      for (const l of composeVisitPlan(input, { forbid: g.together ? used : new Set() }).lines) if (l.technicianId && !used.has(l.technicianId)) { used.add(l.technicianId); extra[l.technicianId] = (extra[l.technicianId] ?? 0) + 1; }
    }
    const party = composePartyPlan({ groupId: g.groupId, label: g.label, together: g.together, members: inputs });
    const env: RecommendationEnvelope & PlanEnvelopeExtra = {
      queueEntryId: groupId, recommended: null, alternates: [], confidence: party.confidence, conflicts: party.conflicts, warnings: party.warnings, requiredAction: party.requiredAction,
      ruleVersion: firstEnv!.ruleVersion, recoVersion: firstEnv!.recoVersion, generatedAt: firstEnv!.generatedAt, configVersion: firstEnv!.configVersion ?? null, queueVersion: null,
      plan: { kind: 'party', party, planVersion: PLAN_VERSION },
    };
    const saved = await this.repo.saveRecommendation(ctx, env, 'staff');
    this.emitter?.emit(ctx, 'queue.assignment_recommended', { queueEntryId: groupId, recommendationId: saved.id, recommended: null, requiredAction: party.requiredAction, confidence: party.confidence, mode: 'party' });
    return this.planView(saved.id, 'party', null, party, env);
  }

  /** POST plans/:recommendationId/decision — accepted (the stored plan) / adjusted (the full line list; needs override,
   *  stored as 'overridden') / rejected (reason) / kept_unassigned. Applies through the queue's ONE multi-line writer. */
  async decidePlan(ctx: QueueAssignmentContext, recommendationId: string, body: PlanDecisionRequest): Promise<PlanDecisionResponse> {
    const decision = body?.decision;
    if (!(PLAN_DECISIONS as readonly string[]).includes(decision as string)) throw new QueueAssignmentValidationError('Choose accepted, adjusted, rejected or kept_unassigned.');
    this.need(ctx, decision === 'adjusted' ? 'ai_queue_assignment.override' : 'ai_queue_assignment.assign');
    await this.assertEnabled(ctx);
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    const feedbackCode = body.feedbackCode == null || body.feedbackCode === '' ? null : String(body.feedbackCode);
    if (feedbackCode && !FEEDBACK_CODE_RE.test(feedbackCode)) throw new QueueAssignmentValidationError('feedbackCode must be a short code like "customer_preference".');
    const clientKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : null;
    if (clientKey && clientKey.length > 128) throw new QueueAssignmentValidationError('idempotencyKey is too long (128 characters at most).');
    if (clientKey) { const prior = await this.repo.findDecisionByKey(ctx, clientKey); if (prior) return this.replayPlan(prior); }
    const rec = await this.repo.getRecommendation(ctx, recommendationId);
    if (!rec) throw new QueueAssignmentValidationError('RECOMMENDATION_NOT_FOUND');
    const plan = (rec.envelope as RecommendationEnvelope & PlanEnvelopeExtra).plan;
    if (!plan) throw new QueueAssignmentValidationError('This recommendation is not a plan — decide it with recommendations/:id/decision.');
    if (decision === 'rejected' && !reason) throw new QueueAssignmentValidationError('REASON_REQUIRED');
    const members: VisitPlan[] = plan.kind === 'party' ? (plan.party?.members ?? []) : (plan.visit ? [plan.visit] : []);
    const planned = members.flatMap((m) => m.lines.map((l) => ({ queueItemId: m.queueItemId, serviceId: l.serviceId, technicianId: l.technicianId })));
    let lines: { queueItemId: string; serviceId: string; technicianId: string }[] | null = null;
    if (decision === 'accepted') {
      if (!planned.length || planned.some((l) => !l.technicianId)) throw withCode(new QueueAssignmentValidationError('Part of this plan has no technician — adjust it or keep the guest unassigned.'), 'PLAN_LINES_NEED_TECHNICIAN');
      lines = planned as { queueItemId: string; serviceId: string; technicianId: string }[];
    } else if (decision === 'adjusted') {
      const sent = Array.isArray(body.lines) ? body.lines : [];
      const k = (l: { queueItemId: string; serviceId: string }) => `${l.queueItemId}|${l.serviceId}`;
      if (sent.some((l) => !l?.queueItemId || !l?.serviceId || !l?.technicianId) || new Set(sent.map(k)).size !== sent.length
        || sent.length !== planned.length || planned.some((p) => !sent.some((l) => k(l) === k(p)))) throw withCode(new QueueAssignmentValidationError('An adjusted plan sends every line of the plan, each with a technician.'), 'PLAN_LINES_NEED_TECHNICIAN');
      lines = sent.map((l) => ({ queueItemId: String(l.queueItemId), serviceId: String(l.serviceId), technicianId: String(l.technicianId) }));
    }
    const key = clientKey ?? `${recommendationId}:${decision}:${hashLines(lines ?? [])}`;
    if (!clientKey) { const prior = await this.repo.findDecisionByKey(ctx, key); if (prior) return this.replayPlan(prior); }

    let applied = false; let result: AssignPlanResult | null = null;
    const assign = this.deps.assign;
    if (lines && assign?.assignPlan) {
      const items: PlanAssignOptions['items'] = members.map((m) => ({
        queueItemId: m.queueItemId, expectedVersion: m.queueVersion ?? 1, expectedTechnicianId: m.expectedTechnicianId,
        ...(decision === 'accepted' && m.leadTechnicianId ? { leadTechnicianId: m.leadTechnicianId } : {}),
        lines: m.lines.map((l) => ({
          serviceId: l.serviceId, technicianId: lines!.find((x) => x.queueItemId === m.queueItemId && x.serviceId === l.serviceId)!.technicianId, expectedTechnicianId: l.expectedTechnicianId,
          ...(decision === 'accepted' ? { timing: l.timing, afterServiceId: l.afterServiceId, plannedStartOffsetMin: l.estimatedStartInMinutes } : {}),
        })),
      }));
      const res = await assign.assignPlan(ctx, { items, groupId: plan.kind === 'party' ? plan.party?.groupId ?? null : null, idempotencyKey: `aqd:${key}`,
        managerOverride: decision === 'adjusted', source: 'ai_suggestion', reason });
      if (!res.ok) {
        if (res.conflict) throw new QueueAssignmentStaleError(res.currentTechnicianId ?? null, undefined, { queueItemId: res.queueItemId, serviceId: res.serviceId });
        throw new QueueAssignmentValidationError(res.error || 'The queue refused this plan.');
      }
      applied = true; result = res.result ?? null;
    }
    const stored = decision === 'adjusted' ? 'overridden' : decision;
    const lead = result?.items?.[0]?.assignedTechnicianId ?? members[0]?.leadTechnicianId ?? null;
    const saved = await this.repo.recordDecision(ctx, {
      recommendationId, queueEntryId: rec.queueEntryId, decision: stored, chosenTechnicianId: lines ? lead : null, reason, decidedBy: ctx.userId, applied, idempotencyKey: key,
      previousTechnicianId: members[0]?.expectedTechnicianId ?? null, feedbackCode, plan: lines,
    }, {
      type: 'decided', actorId: ctx.userId || null,
      payload: { recommendationId, queueItemId: rec.queueEntryId, decision: stored, technicianId: lines ? lead : null, previousTechnicianId: members[0]?.expectedTechnicianId ?? null, applied, feedbackCode, plan: lines, planKind: plan.kind },
    });
    if (saved.replayed) return this.replayPlan(saved);
    this.emitter?.emit(ctx, 'queue.assignment_decided', { queueEntryId: rec.queueEntryId, recommendationId, decisionId: saved.id, decision: stored, technicianId: lines ? lead : null, applied });
    return { decision: stripReplay(saved), applied, result };
  }
  private replayPlan(prior: DecisionRecord): PlanDecisionResponse {
    return { decision: stripReplay(prior), applied: prior.applied, result: null, replayed: true };
  }

  // ── decisions ACT through the queue ─────────────────────────────────────────────────────────────────────────
  async decide(ctx: QueueAssignmentContext, recommendationId: string, body: { decision: DecisionType; chosenTechnicianId?: string | null; reason?: string | null; feedbackCode?: string | null; idempotencyKey?: string | null; overrideReasonCode?: string | null }): Promise<DecisionResponse> {
    const decision = body?.decision;
    if (!(STAFF_DECISIONS as string[]).includes(decision as string)) throw new QueueAssignmentValidationError('Choose accepted, rejected, overridden or kept_unassigned.');
    this.need(ctx, decision === 'overridden' ? 'ai_queue_assignment.override' : 'ai_queue_assignment.assign');
    await this.assertEnabled(ctx);
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    const feedbackCode = body.feedbackCode == null || body.feedbackCode === '' ? null : String(body.feedbackCode);
    if (feedbackCode && !FEEDBACK_CODE_RE.test(feedbackCode)) throw new QueueAssignmentValidationError('feedbackCode must be a short code like "customer_preference".');
    const clientKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : null;
    if (clientKey && clientKey.length > 128) throw new QueueAssignmentValidationError('idempotencyKey is too long (128 characters at most).');

    // A key seen before replays the first answer — no second assignment, no second row.
    if (clientKey) { const prior = await this.repo.findDecisionByKey(ctx, clientKey); if (prior) return this.replay(ctx, prior); }

    const rec = await this.repo.getRecommendation(ctx, recommendationId);
    if (!rec) throw new QueueAssignmentValidationError('RECOMMENDATION_NOT_FOUND');
    if (decision === 'rejected' && !reason) throw new QueueAssignmentValidationError('REASON_REQUIRED');

    let technicianId: string | null = null;
    if (decision === 'accepted') {
      technicianId = rec.envelope.recommended?.technicianId ?? null;
      if (!technicianId) throw withCode(new QueueAssignmentValidationError('There is no suggested technician to accept — choose one (override) or keep the guest unassigned.'), 'NO_SUGGESTED_TECHNICIAN');
      if (body.chosenTechnicianId && body.chosenTechnicianId !== technicianId) throw withCode(new QueueAssignmentValidationError('That is not the suggested technician — use "overridden" to choose someone else.'), 'NOT_SUGGESTED_TECHNICIAN');
    } else if (decision === 'overridden') {
      technicianId = body.chosenTechnicianId ? String(body.chosenTechnicianId) : null;
      if (!technicianId) throw withCode(new QueueAssignmentValidationError('Choose the technician to assign instead.'), 'TECHNICIAN_REQUIRED');
      // Fair Turn §68–70: assigning someone other than the fair pick needs a reason (MANUAL mode never asks)
      const ft = rec.envelope.fairTurn;
      if (ft && ft.assignmentMode !== 'MANUAL' && ft.recommendedTechnicianId && ft.recommendedTechnicianId !== technicianId && !reason && !body.overrideReasonCode) throw new QueueAssignmentValidationError('MANUAL_OVERRIDE_REASON_REQUIRED');
    }
    const turnCtx: AssignTurnDecision | null = rec.envelope.fairTurn && technicianId ? {
      recommendedTechnicianId: rec.envelope.fairTurn.recommendedTechnicianId, overrideReasonCode: decision === 'overridden' ? (body.overrideReasonCode ?? 'MANAGER_DECISION') : null,
      skips: decision === 'accepted' ? rec.envelope.fairTurn.skips : turnSkipsFor(rec.envelope.fairTurn, technicianId), eligiblePool: rec.envelope.fairTurn.eligiblePool,
    } : null;
    // Without a client key the decision itself is the key: one recommendation, one outcome — a double click replays.
    const key = clientKey ?? `${recommendationId}:${decision}:${technicianId ?? '-'}`;
    if (!clientKey) { const prior = await this.repo.findDecisionByKey(ctx, key); if (prior) return this.replay(ctx, prior); }

    const assign = this.deps.assign;
    const cur = assign ? await assign.current(ctx, rec.queueEntryId) : null;
    const previousTechnicianId = cur?.assignedTechnicianId ?? null;
    let applied = false;
    let queueItem: Record<string, unknown> | null = cur?.item ?? null;
    if (technicianId && assign) {
      const res = await assign.assign(ctx, rec.queueEntryId, {
        technicianId, expectedTechnicianId: previousTechnicianId, expectedVersion: rec.envelope.queueVersion ?? null,
        managerOverride: decision === 'overridden', source: 'ai_suggestion', idempotencyKey: `aqd:${key}`, reason, turn: turnCtx,
      });
      if (!res.ok) {
        if (res.conflict) throw new QueueAssignmentStaleError(res.currentTechnicianId ?? null);
        throw new QueueAssignmentValidationError(res.error || 'The queue refused this assignment.');
      }
      applied = true;
      queueItem = res.item ?? (await assign.current(ctx, rec.queueEntryId))?.item ?? null;
    }

    const saved = await this.repo.recordDecision(ctx, {
      recommendationId, queueEntryId: rec.queueEntryId, decision, chosenTechnicianId: technicianId ?? (body.chosenTechnicianId ? String(body.chosenTechnicianId) : null),
      reason, decidedBy: ctx.userId, applied, idempotencyKey: key, previousTechnicianId, feedbackCode,
    }, {
      type: 'decided', actorId: ctx.userId || null,
      payload: { recommendationId, queueItemId: rec.queueEntryId, decision, technicianId, previousTechnicianId, applied, feedbackCode },
    });
    if (saved.replayed) return this.replay(ctx, saved);
    this.emitter?.emit(ctx, 'queue.assignment_decided', { queueEntryId: rec.queueEntryId, recommendationId, decisionId: saved.id, decision, technicianId, applied });
    return { decision: stripReplay(saved), applied, queueItem };
  }
  private async replay(ctx: QueueAssignmentContext, prior: DecisionRecord): Promise<DecisionResponse> {
    const cur = this.deps.assign ? await this.deps.assign.current(ctx, prior.queueEntryId).catch(() => null) : null;
    return { decision: stripReplay(prior), applied: prior.applied, queueItem: cur?.item ?? null, replayed: true };
  }

  async listDecisions(ctx: QueueAssignmentContext, queueEntryId: string) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    return this.repo.listDecisions(ctx, queueEntryId);
  }

  // Feedback history across the branch (not just one entry) — the raw decision log.
  async decisionHistory(ctx: QueueAssignmentContext, filter: { from?: string; to?: string; limit?: number } = {}) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    return this.repo.queryDecisions(ctx, filter);
  }

  // Aggregated feedback analytics (acceptance / override / rejection rates, reasons, by-day, by-technician).
  async decisionAnalytics(ctx: QueueAssignmentContext, range: { from?: string; to?: string } = {}) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const records = await this.repo.queryDecisions(ctx, { from: range.from, to: range.to, limit: 5000 });
    return computeDecisionAnalytics(records as unknown as DecisionLike[]);
  }

  // ── rotation (through the settings port — audit bug 7: a JSON object, never a bare string) ───────────────────
  async getRotationPolicy(ctx: QueueAssignmentContext): Promise<{ policy: RotationPolicy | FairnessMode; fixedOrder: string[] }> {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const eff = await this.settings.effective(this.scope(ctx));
    return { policy: eff.rotationPolicy as RotationPolicy, fixedOrder: [...(eff.fixedOrder ?? [])] };
  }
  async setRotationPolicy(ctx: QueueAssignmentContext, body: { policy?: string; fixedOrder?: unknown; expectedVersion?: number; reason?: string | null }): Promise<{ policy: RotationPolicy | FairnessMode; fixedOrder: string[] }> {
    this.need(ctx, 'ai_queue_assignment.manage_rules');
    await this.assertEnabled(ctx);
    const policy = body?.policy;
    // Fair Turn Engine: the five fairness modes are valid rotation policies too (they are the salon's turn rules — §139)
    if (policy && isFairnessMode(policy)) this.need(ctx, 'turn_queue.settings.manage');
    if (!policy || !((ROTATION_POLICIES as string[]).includes(policy) || isFairnessMode(policy))) throw new QueueAssignmentValidationError('INVALID_POLICY');
    const patch: SettingsPatch = { rotationPolicy: policy as any };
    if (body.fixedOrder !== undefined) {
      if (!Array.isArray(body.fixedOrder) || !body.fixedOrder.every((x) => typeof x === 'string' && x)) throw new QueueAssignmentValidationError('fixedOrder must be a list of technician ids.');
      patch.fixedOrder = [...new Set(body.fixedOrder as string[])];
    }
    const eff = await this.saveSettings(ctx, patch, { expectedVersion: body.expectedVersion, reason: body.reason ?? null, change: 'rotation' });
    return { policy: eff.rotationPolicy as RotationPolicy, fixedOrder: [...(eff.fixedOrder ?? [])] };
  }

  // ── auto-assignment (OFF by default; every switch read through the settings port) ────────────────────────────
  async getAutoConfig(ctx: QueueAssignmentContext): Promise<AutoConfigView> {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    return autoView(await this.settings.effective(this.scope(ctx)));
  }
  async setAutoConfig(ctx: QueueAssignmentContext, body: { enabled?: unknown; confidenceFloor?: unknown; maxPerRun?: unknown; delaySeconds?: unknown; exclusions?: unknown; expectedVersion?: number; reason?: string | null } = {}): Promise<AutoConfigView> {
    this.need(ctx, 'ai_queue_assignment.manage_auto');
    await this.assertEnabled(ctx);
    const patch: SettingsPatch = {};
    if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw new QueueAssignmentValidationError('enabled must be true or false.'); patch.autoEnabled = body.enabled; }
    if (body.confidenceFloor !== undefined) {
      if (typeof body.confidenceFloor !== 'number' || body.confidenceFloor < 0 || body.confidenceFloor > 1) throw new QueueAssignmentValidationError('CONFIDENCE_FLOOR_RANGE');
      patch.autoConfidenceFloor = body.confidenceFloor;
    }
    if (body.maxPerRun !== undefined) {
      if (!Number.isInteger(body.maxPerRun) || (body.maxPerRun as number) < 0 || (body.maxPerRun as number) > 100) throw new QueueAssignmentValidationError('MAX_PER_RUN_RANGE');
      patch.autoMaxPerRun = body.maxPerRun as number;
    }
    if (body.delaySeconds !== undefined) {
      if (!Number.isInteger(body.delaySeconds) || (body.delaySeconds as number) < 0 || (body.delaySeconds as number) > 3600) throw new QueueAssignmentValidationError('delaySeconds must be a whole number from 0 to 3600.');
      patch.autoDelaySeconds = body.delaySeconds as number;
    }
    if (body.exclusions !== undefined) patch.autoExclusions = parseExclusions(body.exclusions);
    if (!Object.keys(patch).length) throw withCode(new QueueAssignmentValidationError('Nothing to change.'), 'NOTHING_TO_UPDATE');
    return autoView(await this.saveSettings(ctx, patch, { expectedVersion: body.expectedVersion, reason: body.reason ?? null, change: 'auto' }));
  }

  /** Kill switch: branch (this location's auto-assign off) or salon (every location). Takes effect on the next run. */
  async killAutoAssignment(ctx: QueueAssignmentContext, body: { scope?: string; reason?: string | null } = {}): Promise<AutoConfigView> {
    this.need(ctx, 'ai_queue_assignment.manage_auto');
    await this.assertEnabled(ctx);
    const scope = body?.scope ?? 'branch';
    const reason = requireReason(body?.reason);
    if (scope === 'salon') await this.wrap(() => this.settings.setSalonKill(ctx.tenantId, true, this.actor(ctx), reason));
    else if (scope === 'branch') await this.saveSettings(ctx, { autoEnabled: false }, { reason, change: 'kill' });
    else throw new QueueAssignmentValidationError('scope must be "branch" or "salon".');
    this.emitter?.emit(ctx, 'queue.auto_assignment_killed', { scope, reason });
    return autoView(await this.settings.effective(this.scope(ctx)));
  }
  /** Undo a kill switch. The salon-wide switch comes back on only for the OWNER (a branch manager cannot re-arm every
   *  location the owner stopped); a branch's own switch needs manage_auto like any auto setting. */
  async unkillAutoAssignment(ctx: QueueAssignmentContext, body: { scope?: string; reason?: string | null } = {}): Promise<AutoConfigView> {
    this.need(ctx, 'ai_queue_assignment.manage_auto');
    await this.assertEnabled(ctx);
    const scope = body?.scope ?? 'branch';
    const reason = requireReason(body?.reason);
    if (scope === 'salon') {
      if (String(ctx.role || '').toUpperCase() !== 'OWNER') throw new QueueAssignmentForbiddenError('Only the salon owner can turn the salon-wide auto-assign back on.');
      await this.wrap(() => this.settings.setSalonKill(ctx.tenantId, false, this.actor(ctx), reason));
    } else if (scope === 'branch') await this.saveSettings(ctx, { autoEnabled: true }, { reason, change: 'unkill' });
    else throw new QueueAssignmentValidationError('scope must be "branch" or "salon".');
    const eff = await this.settings.effective(this.scope(ctx));
    this.emitter?.emit(ctx, 'queue.assignment_settings_changed', { scope, change: 'unkill', configVersion: eff.configVersion });
    return autoView(eff);
  }

  /**
   * One auto-assignment pass. Acts only when EVERY switch allows it (platform, salon kill switch, branch enabled), on
   * unassigned `waiting` guests older than the delay, never a locked / excluded guest or one who asked for someone else,
   * up to the per-run cap, and only through the queue's own assign with "nobody assigned yet" + the version it saw —
   * a guest staff assigned meanwhile is left alone. `system` = the background job (no user, no permission check).
   */
  async runAutoAssignment(ctx: QueueAssignmentContext, opts: { system?: boolean } = {}): Promise<AutoRunResult> {
    const system = !!opts.system;
    if (system) { if (!ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not authenticated'); this.branch(ctx); }
    else this.need(ctx, 'ai_queue_assignment.manage_auto');
    await this.assertEnabled(ctx);
    const eff = await this.settings.effective(this.scope(ctx));
    const result: AutoRunResult = { enabled: eff.autoEnabled, allowed: eff.autoAllowed, blockedBy: eff.autoBlockedBy, assigned: 0, considered: 0, skipped: [] };
    if (!eff.autoAllowed || !this.deps.scan || !this.deps.assign) return result;

    const excl = eff.autoExclusions ?? {};
    const entries = await this.deps.scan.getScanEntries(ctx, { system });
    const waiting = entries.filter((e) => e.status === 'waiting' && !e.assignedTechnicianId).sort((a, b) => b.waitMinutes - a.waitMinutes);
    result.considered = waiting.length;
    const skip = (queueEntryId: string, reason: string) => { result.skipped.push({ queueEntryId, reason }); };
    for (const e of waiting) {
      if (result.assigned >= eff.autoMaxPerRun) { skip(e.queueEntryId, 'max_per_run_reached'); continue; }
      if (e.waitMinutes * 60 < eff.autoDelaySeconds) { skip(e.queueEntryId, 'within_delay'); continue; }
      const pre = exclusionReason(e, excl);
      if (pre) { skip(e.queueEntryId, pre); continue; }
      // D5: a party is never auto-assigned (whatever exclusions.groups says) — staff plan it together
      if (e.groupId) { skip(e.queueEntryId, 'party_needs_staff'); continue; }
      let computed: Computed;
      try { computed = await this.compute(ctx, e.queueEntryId, { system, excludeTechnicianIds: excl.technicianIds }); }
      catch { skip(e.queueEntryId, 'inputs_unavailable'); continue; }
      // The inputs are the authority (the scan row can be older): re-check what they say about this guest.
      const entry = computed.inputs.entry;
      if (entry.assignedTechnicianId) { skip(e.queueEntryId, 'already_assigned'); continue; }
      if (entry.status && entry.status !== 'waiting') { skip(e.queueEntryId, 'not_waiting'); continue; }
      const post = exclusionReason({ ...e, lock: entry.lock ?? e.lock ?? null, isVip: entry.isVip ?? e.isVip, isAppointment: entry.isAppointment ?? e.isAppointment,
        requestedTechnicianId: entry.requestedTechnicianId ?? e.requestedTechnicianId ?? null, groupId: entry.groupId ?? e.groupId ?? null, serviceIds: entry.serviceIds ?? e.serviceIds }, excl);
      if (post) { skip(e.queueEntryId, post); continue; }
      if (entry.groupId) { skip(e.queueEntryId, 'party_needs_staff'); continue; }
      const env = computed.envelope;
      // multi-technician routing: nobody covers the whole visit → the visit plan may split it (D5: split visits may be
      // auto-assigned) — through the ONE multi-line writer, on the same switches, floor and requested-technician rule
      if (!env.recommended && (entry.services?.length ?? 0) >= 2 && this.deps.assign.assignPlan) {
        const r = await this.autoAssignSplit(ctx, e, computed, eff, system);
        if (r === 'assigned') result.assigned++; else skip(e.queueEntryId, r);
        continue;
      }
      const saved = await this.repo.saveRecommendation(ctx, env, 'auto_run');
      const d = autoAssignDecision(env, { enabled: true, confidenceFloor: eff.autoConfidenceFloor, maxPerRun: eff.autoMaxPerRun });
      if (!d.assign || !d.technicianId) { skip(e.queueEntryId, d.reason); continue; }
      const requested = entry.requestedTechnicianId ?? e.requestedTechnicianId ?? null;
      if (requested && requested !== d.technicianId) { skip(e.queueEntryId, 'requested_technician_conflict'); continue; }
      const key = `auto:${saved.id}`;
      const res = await this.deps.assign.assign(ctx, e.queueEntryId, {
        technicianId: d.technicianId, expectedTechnicianId: null, expectedVersion: env.queueVersion ?? e.version ?? null,
        source: 'auto_assign', idempotencyKey: key, reason: 'auto_assignment', system,
        ...(env.fairTurn ? { turn: { recommendedTechnicianId: env.fairTurn.recommendedTechnicianId, skips: env.fairTurn.skips, eligiblePool: env.fairTurn.eligiblePool } } : {}),
      });
      if (!res.ok) { skip(e.queueEntryId, res.conflict ? 'changed_meanwhile' : (res.error || 'assign_failed')); continue; }
      await this.repo.recordDecision(ctx, {
        recommendationId: saved.id, queueEntryId: e.queueEntryId, decision: 'auto_assigned', chosenTechnicianId: d.technicianId,
        reason: 'auto_assignment', decidedBy: system ? 'system' : ctx.userId, applied: true, idempotencyKey: key, previousTechnicianId: null,
      }, {
        type: 'auto_assigned', actorId: system ? null : ctx.userId || null,
        payload: { recommendationId: saved.id, queueItemId: e.queueEntryId, technicianId: d.technicianId, confidence: env.confidence, configVersion: env.configVersion ?? null },
      });
      this.emitter?.emit(ctx, 'queue.auto_assigned', { queueEntryId: e.queueEntryId, technicianId: d.technicianId, recommendationId: saved.id });
      result.assigned++;
    }
    return result;
  }

  /** One split visit through the auto-run: assign only a plan the auto rules would take for one technician — assignable,
   *  no warning / conflict, confidence ≥ the floor, the requested technician on it — with "nobody yet" on every line. */
  private async autoAssignSplit(ctx: QueueAssignmentContext, e: ScanEntryData, computed: Computed, eff: EffectiveQueueAssignmentSettings, system: boolean): Promise<string> {
    let visit: VisitPlan;
    try { visit = composeVisitPlan((await this.visitInput(ctx, e.queueEntryId, { system, whole: computed })).input); }
    catch { return 'inputs_unavailable'; }
    const env: RecommendationEnvelope & PlanEnvelopeExtra = { ...computed.envelope, confidence: visit.confidence, warnings: visit.warnings, conflicts: visit.conflicts, requiredAction: visit.requiredAction,
      plan: { kind: 'visit', visit, planVersion: PLAN_VERSION } };
    const saved = await this.repo.saveRecommendation(ctx, env, 'auto_run');
    if (visit.mode !== 'split') return 'no_eligible_technician';
    if (visit.requiredAction !== 'assignable') return visit.requiredAction === 'no_eligible_technician' ? 'no_eligible_technician' : 'plan_needs_review';
    if (visit.warnings.length || visit.conflicts.length) return 'plan_needs_review';
    if (visit.confidence < eff.autoConfidenceFloor) return 'below_confidence_floor';
    const requested = computed.inputs.entry.requestedTechnicianId ?? null;
    if (requested && !visit.lines.some((l) => l.technicianId === requested)) return 'requested_technician_conflict';
    const key = `auto:${saved.id}`;
    const res = await this.deps.assign!.assignPlan!(ctx, {
      items: [{ queueItemId: e.queueEntryId, expectedVersion: visit.queueVersion ?? e.version ?? 1, expectedTechnicianId: null, ...(visit.leadTechnicianId ? { leadTechnicianId: visit.leadTechnicianId } : {}),
        lines: visit.lines.map((l) => ({ serviceId: l.serviceId, technicianId: l.technicianId!, expectedTechnicianId: l.expectedTechnicianId, timing: l.timing, afterServiceId: l.afterServiceId, plannedStartOffsetMin: l.estimatedStartInMinutes })) }],
      idempotencyKey: key, source: 'auto_assign', reason: 'auto_assignment', system,
    });
    if (!res.ok) return res.conflict ? 'changed_meanwhile' : (res.error || 'assign_failed');
    const lines = visit.lines.map((l) => ({ queueItemId: e.queueEntryId, serviceId: l.serviceId, technicianId: l.technicianId! }));
    await this.repo.recordDecision(ctx, {
      recommendationId: saved.id, queueEntryId: e.queueEntryId, decision: 'auto_assigned', chosenTechnicianId: visit.leadTechnicianId,
      reason: 'auto_assignment', decidedBy: system ? 'system' : ctx.userId, applied: true, idempotencyKey: key, previousTechnicianId: null, plan: lines,
    }, {
      type: 'auto_assigned', actorId: system ? null : ctx.userId || null,
      payload: { recommendationId: saved.id, queueItemId: e.queueEntryId, technicianId: visit.leadTechnicianId, confidence: visit.confidence, configVersion: env.configVersion ?? null, plan: lines },
    });
    this.emitter?.emit(ctx, 'queue.auto_assigned', { queueEntryId: e.queueEntryId, technicianId: visit.leadTechnicianId, recommendationId: saved.id, mode: 'split' });
    return 'assigned';
  }

  // ── the board's recommender (QUEUE_RECOMMENDER) ─────────────────────────────────────────────────────────────
  /** Quiet gate for the boards: no AI permission / not entitled / no branch → no suggestion (never a second scorer). */
  private async boardAllowed(ctx: QueueAssignmentContext): Promise<boolean> {
    if (!ctx?.tenantId || !ctx?.userId || !(typeof ctx.branchId === 'string' && ctx.branchId.trim())) return false;
    if (!hasPermission(ctx as any, 'ai_queue_assignment.view')) return false;
    try { await this.assertEnabled(ctx); return true; } catch { return false; }
  }
  /** "Best Match" for each guest on the board — computed, NOT persisted. */
  async suggest(ctx: QueueAssignmentContext, queueItemIds: string[]): Promise<Record<string, SuggestResult>> {
    const out: Record<string, SuggestResult> = {};
    if (!(await this.boardAllowed(ctx))) return out;
    const ids = [...new Set(queueItemIds ?? [])];
    // M4 (200 technicians): the board asks for every waiting guest at once. The branch-wide reads — the queue's inputs
    // (active queue, technicians' signals, catalog, exact skills), the salon's settings, the appointments ahead, today's
    // turn queue — are read ONCE for the batch and every guest is ranked over the same snapshot (each one used to re-read
    // all of it: ~2,500 statements for one board with 60 waiting). A shared read that fails leaves that guest to read alone.
    const shared: ComputeOpts = {};
    if (ids.length > 1) {
      try {
        shared.settings = await this.settings.effective(this.scope(ctx));
        if (this.deps.appointments) shared.upcoming = await this.deps.appointments.getUpcoming(ctx);
        if (isFairnessMode(shared.settings.rotationPolicy) && this.deps.turn) {
          const [day, specialIds] = await Promise.all([
            this.deps.turn.day(ctx).catch(() => ({ rows: [] as TurnStateLike[] })),
            shared.settings.turnPolicy.specialRotationEnabled && this.deps.turn.specialServiceIds ? this.deps.turn.specialServiceIds(ctx).catch(() => [] as string[]) : Promise.resolve([] as string[]),
          ]);
          shared.turnShared = { day, specialIds };
        }
      } catch { delete shared.settings; delete shared.upcoming; delete shared.turnShared; }
    }
    const many = ids.length > 1 && this.data.getInputsMany ? await this.data.getInputsMany(ctx, ids).catch(() => ({} as Record<string, QueueEntryInputs>)) : {};
    for (const id of ids) {
      try {
        const computed = await this.compute(ctx, id, { ...shared, ...(many[id] ? { inputs: many[id] } : {}) });
        const { envelope } = computed;
        out[id] = {
          technicianId: envelope.recommended?.technicianId ?? null, name: envelope.recommended?.name ?? null,
          confidence: envelope.confidence, requiredAction: envelope.requiredAction,
          reasons: envelope.recommended ? [...envelope.recommended.reasons, ...envelope.warnings] : envelope.conflicts,
          ...(envelope.recommended ? { mode: 'single' as const, technicianNames: [envelope.recommended.name] } : {}),
        };
        // multi-technician routing: no single technician covers the visit → a split Best Match (every line covered)
        if (!envelope.recommended && (computed.inputs.entry.services?.length ?? 0) >= 2) {
          const visit = composeVisitPlan((await this.visitInput(ctx, id, { whole: computed })).input);
          if (visit.mode === 'split' && visit.lines.every((l) => l.technicianId)) {
            const names = [...new Set(visit.lines.map((l) => l.technicianName ?? ''))].filter(Boolean);
            const lead = visit.lines.find((l) => l.technicianId === visit.leadTechnicianId);
            out[id] = { technicianId: visit.leadTechnicianId, name: lead?.technicianName ?? names[0] ?? null, confidence: visit.confidence, requiredAction: visit.requiredAction,
              reasons: visit.warnings, mode: 'split', technicianNames: names };
          }
        }
      } catch { /* a guest the engine cannot read shows no suggestion */ }
    }
    return out;
  }
  /** Auto Balance preview: the engine over every unassigned waiting guest (longest wait first); a technician given a
   *  guest here counts that guest toward their capacity for the next one, so no one is proposed past capacity. */
  async balance(ctx: QueueAssignmentContext): Promise<BalanceResult> {
    const out: BalanceResult = { proposals: [], unassignable: [] };
    if (!(await this.boardAllowed(ctx)) || !this.deps.scan) return out;
    const entries = (await this.deps.scan.getScanEntries(ctx))
      .filter((e) => ['waiting', 'called'].includes(e.status) && !e.assignedTechnicianId)
      .sort((a, b) => b.waitMinutes - a.waitMinutes);
    const extra: Record<string, number> = {};
    for (const e of entries) {
      let env: RecommendationEnvelope;
      try { env = (await this.compute(ctx, e.queueEntryId, { extraLoad: extra })).envelope; }
      catch { out.unassignable.push({ queueItemId: e.queueEntryId, reason: 'This guest could not be read.' }); continue; }
      const r = env.recommended;
      if (!r && (e.serviceIds?.length ?? 0) >= 2) {
        // multi-technician routing: Auto Balance assigns one technician per guest — a split visit is planned on the guest
        let split = false;
        try { const v = composeVisitPlan((await this.visitInput(ctx, e.queueEntryId, { extraLoad: extra })).input); split = v.mode === 'split' && v.lines.every((l) => l.technicianId); } catch { /* no plan */ }
        if (split) { out.unassignable.push({ queueItemId: e.queueEntryId, reason: 'Needs a multi-technician plan — open the guest' }); continue; }
      }
      if (!r) { out.unassignable.push({ queueItemId: e.queueEntryId, reason: env.conflicts[0] ?? 'No eligible technician right now.' }); continue; }
      const askedFor = env.requestedTechnicianId && env.requestedTechnicianId !== r.technicianId;
      if (askedFor) { out.unassignable.push({ queueItemId: e.queueEntryId, reason: env.warnings.find((w) => w.startsWith('The guest asked for')) ?? 'The guest asked for another technician.' }); continue; }
      out.proposals.push({ queueItemId: e.queueEntryId, technicianId: r.technicianId, technicianName: r.name, confidence: env.confidence, reasons: [...r.reasons, ...env.warnings] });
      extra[r.technicianId] = (extra[r.technicianId] ?? 0) + 1;
    }
    return out;
  }

  // ── settings plumbing ────────────────────────────────────────────────────────────────────────────────────────
  private async saveSettings(ctx: QueueAssignmentContext, patch: SettingsPatch, opts: { expectedVersion?: number; reason?: string | null; change: string }) {
    const eff = await this.wrap(() => this.settings.update(this.scope(ctx), patch, this.actor(ctx), opts));
    this.emitter?.emit(ctx, 'queue.assignment_settings_changed', { scope: 'branch', change: opts.change, configVersion: eff.configVersion });
    return eff;
  }
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if (e instanceof QueueSettingsValidationError) throw new QueueAssignmentValidationError(e.message);
      if (e instanceof QueueSettingsConflictError) throw new QueueAssignmentStaleError(null, e.message);
      throw e;
    }
  }
}

/** The technician who got a guest most recently, by the queue's own lastServedAt (manual assignments included). */
function lastServedOf(cands: QueueCandidateInput[]): string | null {
  let best: { id: string; t: number } | null = null;
  for (const c of cands) { const t = c.lastServedAt ? Date.parse(c.lastServedAt) : NaN; if (isFinite(t) && (!best || t > best.t)) best = { id: c.technicianId, t }; }
  return best?.id ?? null;
}
function stripReplay(d: DecisionRecord & { replayed?: boolean }): DecisionRecord { const { replayed: _r, ...rest } = d; return rest; }
function requireReason(r: unknown): string {
  const s = typeof r === 'string' ? r.trim() : '';
  if (s.length < 3) throw withCode(new QueueAssignmentValidationError('Say why (a short reason is required).'), 'SHORT_REASON_REQUIRED');
  return s.slice(0, 500);
}
function autoView(e: EffectiveQueueAssignmentSettings): AutoConfigView {
  return {
    enabled: e.autoEnabled, confidenceFloor: e.autoConfidenceFloor, maxPerRun: e.autoMaxPerRun, delaySeconds: e.autoDelaySeconds,
    exclusions: e.autoExclusions ?? {}, autoAllowed: e.autoAllowed, autoBlockedBy: e.autoBlockedBy, salonAutoKilled: e.salonAutoKilled,
    salonAutoKilledReason: e.salonAutoKilledReason, platformAutoActionsDisabled: e.platformAutoActionsDisabled,
    configVersion: e.configVersion, branchVersion: e.branchVersion,
  };
}
function parseExclusions(v: unknown): AutoExclusions {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new QueueAssignmentValidationError('exclusions must be an object.');
  const o = v as Record<string, unknown>; const out: AutoExclusions = {};
  for (const k of ['vip', 'appointments', 'requested', 'groups'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'boolean') throw new QueueAssignmentValidationError(`exclusions.${k} must be true or false.`);
    out[k] = o[k] as boolean;
  }
  for (const k of ['technicianIds', 'serviceIds'] as const) {
    if (o[k] === undefined) continue;
    if (!Array.isArray(o[k]) || !(o[k] as unknown[]).every((x) => typeof x === 'string' && x)) throw new QueueAssignmentValidationError(`exclusions.${k} must be a list of ids.`);
    out[k] = [...new Set(o[k] as string[])];
  }
  return out;
}
/** Why the auto-run must leave this guest to staff (null = it may act). Locks always win. */
function exclusionReason(e: Pick<ScanEntryData, 'lock' | 'isVip' | 'isAppointment' | 'requestedTechnicianId' | 'groupId' | 'serviceIds'>, x: AutoExclusions): string | null {
  if (e.lock) return 'locked';
  if (x.vip && e.isVip) return 'excluded_vip';
  if (x.appointments && e.isAppointment) return 'excluded_appointment';
  if (x.requested && e.requestedTechnicianId) return 'excluded_requested';
  if (x.groups && e.groupId) return 'excluded_group';
  if (x.serviceIds?.length && (e.serviceIds ?? []).some((s) => x.serviceIds!.includes(s))) return 'excluded_service';
  return null;
}
function toEligibilityInput(c: QueueCandidateInput, requiredCategories: string[], queueBranchId: string | null, wholeVisit = true, lineServiceId: string | null = null): EligibilityInput {
  // Oct 28 2026 (Remaining Production audit §24 / §25 / §61 — "one rule"): a plan LINE used the category rule — a technician
  // approved only for Gel was ranked for an Acrylic line in the same category, and one with no services set up (bookable
  // through the category fallback) had no skills and was dropped. With the authority's per-service answer, the line uses it.
  const lineAnswer = !wholeVisit && lineServiceId && Array.isArray(c.eligibleServiceIds) ? c.eligibleServiceIds.includes(lineServiceId) : null;
  return {
    // clockedIn is REAL when the queue domain carries the workforce clock state (merge Oct 12 2026); legacy callers still derive it from `available`
    technicianId: c.technicianId, name: c.name, branchId: c.branchId, clockedIn: c.clockedIn ?? c.available, skills: c.skills,
    requiredCategories, activeAssignments: c.activeAssignments, maxConcurrent: c.maxConcurrent ?? 1,
    onBreak: c.onBreak ?? false, blocked: c.blocked ?? false, reservedForAppointment: c.reservedForAppointment ?? false,
    stationAvailable: c.stationAvailable ?? true, manualLock: c.manualLock ?? false, queueBranchId,
    // the exact answer covers the WHOLE visit; a one-line recommendation (multi-technician routing) keeps that line's categories
    ...(wholeVisit && typeof c.serviceEligible === 'boolean' ? { serviceEligible: c.serviceEligible } : {}),
    ...(lineAnswer !== null ? { serviceEligible: lineAnswer } : {}),
  };
}
function toSignals(c: QueueCandidateInput, requestedTechnicianId: string | null): AssignmentSignals {
  return {
    technicianId: c.technicianId, name: c.name, available: c.available, skills: c.skills, activeLoad: c.activeAssignments,
    isRequested: !!requestedTechnicianId && c.technicianId === requestedTechnicianId, isPrevious: c.isPrevious,
    rotationIndex: c.rotationIndex ?? null, assignedMinutes: c.assignedMinutes ?? null,
    availableInMinutes: c.availableInMinutes ?? null, shiftEndsInMinutes: c.shiftEndsInMinutes ?? null,
    nextAppointmentInMinutes: c.nextAppointmentInMinutes ?? null,
  };
}
function summarizeConflicts(fails: HardFailReason[], eligibleCount: number): string[] {
  if (eligibleCount > 0 || fails.length === 0) return [];
  const counts = new Map<HardFailReason, number>();
  for (const f of fails) counts.set(f, (counts.get(f) ?? 0) + 1);
  const parts = [...counts.entries()].map(([f, n]) => `${n} ${FAIL_LABEL[f]}`);
  return [`No eligible technician (${parts.join(', ')})`];
}
/** A line's ranked ELIGIBLE technicians: the envelope's order (best + alternates, with reasons), then every other
 *  eligible technician by score — the composer needs them all (a technician busy on another line may be the 4th). */
function rankedOf(c: Computed): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  // each candidate's shift end travels with it: the composer judges the line at its PLANNED window, not from now
  const shiftOf = (id: string) => c.candidates.find((x) => x.technicianId === id)?.shiftEndsInMinutes ?? null;
  for (const r of [c.envelope.recommended, ...c.envelope.alternates]) if (r) out.push({ technicianId: r.technicianId, name: r.name, matchScore: r.matchScore, startInMinutes: r.estimatedStartInMinutes, reasons: r.reasons, warnings: r.warnings, shiftEndsInMinutes: shiftOf(r.technicianId) });
  for (const p of c.candidates.filter((x) => x.eligible && x.matchScore != null).sort((a, b) => (b.matchScore as number) - (a.matchScore as number))) {
    if (out.some((o) => o.technicianId === p.technicianId)) continue;
    out.push({ technicianId: p.technicianId, name: p.name, matchScore: p.matchScore as number, startInMinutes: p.availableInMinutes == null ? null : Math.max(0, p.availableInMinutes), reasons: [], warnings: [], shiftEndsInMinutes: p.shiftEndsInMinutes });
  }
  return out;
}
/** A short stable digest of the decided lines (the default idempotency key) — not a security hash. */
function hashLines(lines: { queueItemId: string; serviceId: string; technicianId: string }[]): string {
  const str = [...lines].map((l) => `${l.queueItemId}|${l.serviceId}|${l.technicianId}`).sort().join(';');
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = ((h2 << 5) + h2 + c) >>> 0; }
  return h1.toString(36) + h2.toString(36);
}

/** §67: the skips to record when `assigneeId` gets the guest — everyone ranked ahead of her in the rotation keeps her
 *  place, with her hard-rule reason, or MANUAL_OVERRIDE when staff passed over an eligible technician. */
export function turnSkipsFor(ft: { candidates: { technicianId: string; turnRank: number | null; eligible: boolean; hardFails?: string[]; skipReason: string | null }[]; requested?: boolean }, assigneeId: string): { technicianId: string; reason: string }[] {
  const me = ft.candidates.find((c) => c.technicianId === assigneeId);
  const myRank = me?.turnRank ?? Number.POSITIVE_INFINITY;
  return ft.candidates.filter((c) => c.technicianId !== assigneeId && c.turnRank != null && c.turnRank < myRank).map((c) => {
    if (!c.eligible) return { technicianId: c.technicianId, reason: c.skipReason ?? (c.hardFails?.length ? HARD_FAIL_TO_SKIP[c.hardFails[0]] ?? 'NOT_ON_SHIFT' : 'NOT_ON_SHIFT') };
    return { technicianId: c.technicianId, reason: (ft.requested ? 'CUSTOMER_REQUEST' : 'MANUAL_OVERRIDE') as SkipReason };
  });
}
