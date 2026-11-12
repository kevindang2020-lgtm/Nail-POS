// ai-scheduling.ts — BUILD_PLAN Phase 7: the AI Scheduling Optimizer's wire contract (tenant realm). The server, the POS
// screen, the owner / tech apps and the AI receptionist all speak these shapes; nothing else describes them.
// Times: `date` = 'YYYY-MM-DD' in the branch's zone, `startTime` / `endTime` = 'HH:MM' (24h) in the branch's zone,
// `*At` = ISO-8601 instants. Every route lives under /pos/ai-scheduling-optimizer and is tenant/branch-scoped by session.

import { coded, type CodedText } from '../text/coded-text';

export type SchedRecStatus =
  | 'generated' | 'review_required' | 'review_in_progress'
  | 'accepted' | 'partially_accepted' | 'rejected' | 'needs_revision'
  | 'customer_approval_required' | 'customer_approved'
  | 'application_pending' | 'applied' | 'application_failed'
  | 'expired' | 'superseded' | 'rolled_back';

export type SchedRecType =
  | 'move_appointment' | 'change_technician' | 'offer_alternate_time' | 'open_availability' | 'close_availability'
  | 'add_buffer' | 'adjust_duration' | 'add_staffing' | 'move_break' | 'fill_gap' | 'resolve_overbooking' | 'preserve_schedule';

export type SchedDataQuality = 'good' | 'partial' | 'insufficient';
export type SchedViolationCode =
  | 'OUTSIDE_HOURS' | 'TECH_NOT_AT_BRANCH' | 'TECH_NOT_SCHEDULED' | 'BEYOND_SHIFT_END'
  | 'MISSING_SKILL' | 'ON_TIME_OFF' | 'BREAK_CONFLICT' | 'APPOINTMENT_OVERLAP'
  | 'STATION_UNAVAILABLE' | 'PREFERENCE_VIOLATION' | 'MULTI_SERVICE_ORDER' | 'GROUP_CAPACITY_EXCEEDED' | 'LOCK_VIOLATION';
export interface SchedViolation { code: SchedViolationCode; message: string; /** the data in `message` (Vietnamese POS §21: the POS words `code` itself) */ vars?: Record<string, string | number> }

/** The canonical day measures (one utilization formula: booked ÷ (scheduled − breaks), workforce/tech-utilization). */
export interface SchedMetrics { idleMin: number; waitMin: number; utilizationPct: number; gapCount: number; latenessRiskPct: number }
export interface SchedDeltas { idleSavedMin: number; waitSavedMin: number; utilizationGainPct: number; gapsRemoved: number; latenessReducedPct: number }
export interface SchedSimulation { before: SchedMetrics; after: SchedMetrics; deltas: SchedDeltas; improved: boolean }

/** The appointment as it was when the recommendation was computed — `apply` refuses (409 STALE_SCHEDULE) if it moved. */
export interface SchedAppointmentSnapshot {
  appointmentId: string; date: string; startTime: string; endTime: string;
  technicianId: string | null; status: string; version: number; customerId: string | null;
}
/** What the recommendation would change. Stored server-side; `apply` uses THIS, never a client-supplied target. */
export interface SchedProposedChange {
  kind: 'reschedule' | 'assign_technician';
  appointmentId: string; date: string; startTime: string; endTime: string; technicianId: string | null;
}
export interface SchedVersions { forecastVersion: string | null; ruleVersion: string; engineVersion: string; configVersion: number }

export type SchedProposalStatus = 'proposed' | 'customer_notified' | 'customer_approved' | 'customer_rejected' | 'expired' | 'applied' | 'withdrawn';
export interface SchedProposalSummary {
  id: string; status: SchedProposalStatus; customerId: string | null;
  proposedDate: string; proposedStartTime: string; proposedTechnicianId: string | null;
  originalDate: string; originalStartTime: string; originalTechnicianId: string | null;
  notifiedAt: string | null; decidedAt: string | null; decisionChannel: string | null; expiresAt: string | null;
}

export interface SchedRecommendation {
  id: string; branchId: string | null; runId: string | null;
  type: SchedRecType; status: SchedRecStatus;
  currentState: SchedAppointmentSnapshot | null;
  proposedState: SchedProposedChange | null;
  affectedAppointmentIds: string[]; affectedTechnicianIds: string[];
  hardConstraintsChecked: boolean; violations: SchedViolation[];
  simulation: SchedSimulation | null;
  expectedBenefit: string[]; possibleDownside: string[];
  confidence: number; dataQuality: SchedDataQuality;
  touchesConfirmedAppointment: boolean; requiresCustomerApproval: boolean;
  versions: SchedVersions;
  version: number;                       // optimistic lock: every decision / apply sends it back as expectedVersion
  applyAttempt: number;
  automated: boolean;
  expiresAt: string | null;
  explanation: string | null; explanationSource: 'llm' | 'template' | null;
  /** Vietnamese POS §120 (migration 702): the language `explanation` is written in — the model writes in the reader's POS
   *  language (a job: the salon's default). null = no explanation yet. The POS labels it only when it differs from the screen. */
  explanationLanguage?: 'en' | 'vi' | null;
  proposal: SchedProposalSummary | null;
  decidedByUserId: string | null; decidedAt: string | null; appliedAt: string | null;
  createdAt: string; updatedAt: string;
}

// ── options (AI receptionist, Reception Copilot, POS "find a time") ──────────────────────────────────────────────────
export interface SchedOptionsRequest {
  date: string; serviceIds: string[];
  preferredTime?: string | null;            // 'HH:MM'
  technicianId?: string | null;             // only this technician
  preferredTechnicianId?: string | null;    // soft
  requiredTechnicianId?: string | null;     // hard
  groupSize?: number | null;
  excludeAppointmentId?: string | null;     // when finding a new time for an existing appointment
  limit?: number | null;                    // default 5, max 20
  hold?: { channel: 'pos' | 'ai_receptionist' | 'reception_copilot' | 'customer_web'; customerId?: string | null; bookingSessionId?: string | null; seconds?: number | null } | null;
}
export interface SchedOptionBlock { serviceId: string; startTime: string; endTime: string }
export interface SchedOption {
  id: string;                               // `${technicianId}@${date}T${startTime}`
  technicianId: string; technicianName: string;
  date: string; startTime: string; endTime: string;
  score: number; breakdown: Record<string, number>;
  blocks: SchedOptionBlock[];               // one block per service, in order, buffers excluded
  reasons: string[];                        // short deterministic labels ("your preferred technician", "no wait")
  /** the same labels as codes (srv.SCHED_REASON.*), same order — Vietnamese POS §21 */
  reasonCodes?: string[];
  fallback: boolean;                        // true = rule-based fallback (thin signal), not weighted scoring
}
export interface SchedHold { holdId: string; optionId: string; expiresAt: string }
export interface SchedOptionsResponse { options: SchedOption[]; forecastAvailable: boolean; hold: SchedHold | null }

// ── recommendations ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface SchedGenerateRequest {
  appointmentId: string;
  /** Optional target. Omitted → the engine picks the best feasible alternative for the appointment. The server always
   *  re-runs the hard-constraint gate and the simulation itself; nothing here is trusted as a result. */
  target?: { date?: string | null; startTime?: string | null; technicianId?: string | null } | null;
}
export interface SchedGenerateResponse { recommendation: SchedRecommendation }
export interface SchedDecisionRequest { expectedVersion: number; reason?: string | null }
export interface SchedRecommendationResponse { recommendation: SchedRecommendation }
export interface SchedApplyRequest { expectedVersion: number }
export interface SchedApplication { status: 'applied' | 'failed' | 'stale'; appliedVia: string | null; externalRef: string | null; errorCode: string | null; attempt: number }
export interface SchedApplyResponse { recommendation: SchedRecommendation; application: SchedApplication }
export interface SchedRecommendationFilters { status?: SchedRecStatus | null; type?: SchedRecType | null; runId?: string | null; technicianId?: string | null; date?: string | null; limit?: number | null }
export interface SchedRecommendationList { items: SchedRecommendation[]; total: number }

// ── runs (branch day / technician day) ─────────────────────────────────────────────────────────────────────────────
export type SchedRunScope = 'technician_day' | 'branch_day';
export interface SchedRunRequest { scope: SchedRunScope; date: string; technicianId?: string | null; idempotencyKey?: string | null }
export interface SchedGap { id: string; technicianId: string | null; date: string; startTime: string; endTime: string; durationMin: number; cause: string | null; servicesThatFit: string[] }
export interface SchedConflict { id: string; type: string; severity: 'info' | 'warning' | 'critical'; appointmentIds: string[]; technicianId: string | null; date: string | null; message: string | null; resolved: boolean; /** `message` as code + vars (srv.SCHED_CONFLICT.*) */ messageCoded?: CodedText | null }
export interface SchedRun {
  id: string; branchId: string | null; scope: SchedRunScope; status: 'started' | 'completed' | 'failed';
  date: string | null; technicianId: string | null; trigger: 'manual' | 'job' | 'automation';
  metrics: SchedMetrics | null; recommendationCount: number; gapCount: number; conflictCount: number;
  versions: SchedVersions; latencyMs: number | null; errorCode: string | null; startedAt: string; completedAt: string | null;
}
export interface SchedRunDetail { run: SchedRun; gaps: SchedGap[]; conflicts: SchedConflict[]; recommendations: SchedRecommendation[] }

// ── settings (tri-state: platform → salon → location; disabled / killed wins downward) ──────────────────────────────
export type SchedSafeAutoAction = 'open_empty_slot' | 'close_unavailable_tech' | 'recalc_estimated_end' | 'add_internal_warning' | 'update_internal_capacity' | 'apply_preapproved_gap_rule';
export interface SchedScoringWeights {
  preferredTimeProximity: number; waitReduction: number; gapFit: number; preferencePreservation: number;
  utilization: number; fragmentation: number; overtimeAvoidance: number; workloadBalance: number; idleReduction: number;
}
export interface SchedConfig {
  automationEnabled: boolean; allowedAutoActions: SchedSafeAutoAction[]; confidenceThreshold: number;
  weights: SchedScoringWeights; gapMinServiceMin: number; largeBlockMin: number; utilizationTargetPct: number;
  bookingIntervalMin: number; minLeadTimeMin: number; maxHorizonDays: number; humanReviewRequired: true;
  recommendationTtlMin: number; proposalTtlHours: number;
}
export interface SchedSettingsLayer { level: 'tenant' | 'branch'; branchId: string | null; enabled: boolean | null; killSwitch: boolean | null; config: Partial<SchedConfig> | null; version: number; updatedAt: string | null; updatedByUserId: string | null }
export interface SchedSettingsView {
  effective: { enabled: boolean; killed: boolean; platformKilled: boolean; automationAllowed: boolean; config: SchedConfig };
  tenant: SchedSettingsLayer | null; branch: SchedSettingsLayer | null;
}
export interface SchedSettingsUpdate {
  level: 'tenant' | 'branch';
  expectedVersion: number;                  // 0 when the layer does not exist yet
  enabled?: boolean | null; killSwitch?: boolean | null;
  config?: Partial<Omit<SchedConfig, 'humanReviewRequired'>> | null;
}
export interface SchedRuleVersion { version: number; level: 'tenant' | 'branch'; branchId: string | null; enabled: boolean | null; killSwitch: boolean | null; config: Partial<SchedConfig> | null; changedByUserId: string | null; createdAt: string }

// ── insights: learned durations, staffing coverage, open / close availability (approval required) ──────────────────
export type SchedInsightKind = 'duration' | 'staffing' | 'availability';
export type SchedInsightStatus = 'review_required' | 'approved' | 'rejected' | 'superseded';
export interface SchedDurationInsight { kind: 'duration'; id: string; branchId: string | null; serviceId: string; technicianId: string | null; action: string; currentMin: number | null; suggestedMin: number | null; sampleSize: number; reason: string | null; /** `reason` as code + vars (srv.SCHED_INSIGHT.*) */ reasonCoded?: CodedText | null; confidence: number | null; status: SchedInsightStatus; version: number; createdAt: string;
  /** Service Duration Confidence: the observed spread behind the suggestion (latest stored statistics for the same key); null when none */
  observed?: { sampleSize: number; medianMin: number; p25Min: number; p75Min: number; p90Min: number; stddevMin: number; variability: 'too_few' | 'steady' | 'variable' | 'wide'; spreadPct: number | null } | null }
export interface SchedStaffingInsight { kind: 'staffing'; id: string; branchId: string | null; date: string | null; startTime: string | null; endTime: string | null; state: string; missingMinutes: number | null; missingSkills: string[]; recommendedAction: string | null; /** srv.SCHED_INSIGHT.* */ recommendedActionCoded?: CodedText | null; confidence: number | null; status: SchedInsightStatus; version: number; createdAt: string }
export interface SchedAvailabilityInsight { kind: 'availability'; id: string; branchId: string | null; date: string | null; startTime: string | null; endTime: string | null; technicianId: string | null; serviceId: string | null; direction: 'open' | 'close'; reason: string | null; /** srv.SCHED_INSIGHT.* */ reasonCoded?: CodedText | null; confidence: number | null; status: SchedInsightStatus; version: number; createdAt: string }
export type SchedInsight = SchedDurationInsight | SchedStaffingInsight | SchedAvailabilityInsight;
export interface SchedInsightList { items: SchedInsight[]; total: number }
export interface SchedInsightDecisionRequest { expectedVersion: number; reason?: string | null }

// ── inputs the gate reads: time off, manual locks, per-service profile ──────────────────────────────────────────────
export interface SchedTimeOff { id: string; technicianId: string; branchId: string | null; startsAt: string; endsAt: string; status: 'approved' | 'pending' | 'cancelled'; reason: string | null }
export interface SchedTimeOffCreate { technicianId: string; branchId?: string | null; startsAt: string; endsAt: string; reason?: string | null }
export interface SchedLock { appointmentId: string; reason: string | null; lockedByUserId: string | null; createdAt: string }
export interface SchedServiceProfile { serviceId: string; setupMin: number; cleanupMin: number; maxGroupSize: number | null }

// ── calendar indicators (booking calendar overlay) ──────────────────────────────────────────────────────────────────
export interface SchedCalendarIndicators {
  date: string;
  gaps: SchedGap[];
  conflicts: SchedConflict[];
  /** appointmentId → the open recommendation touching it (status + id), for the badge on the calendar card. */
  appointments: Record<string, { recommendationId: string; status: SchedRecStatus; type: SchedRecType; locked: boolean }>;
  utilizationPct: number | null;
  /** Extras "Capacity Risk Heatmap" — present only with ?capacity=1: per hour staffed vs booked minutes and per-skill demand vs qualified technicians on shift (read-only). */
  capacity?: SchedCapacityHeatmap;
}
export type SchedCapacityRisk = 'closed' | 'unstaffed' | 'over' | 'tight' | 'ok';
export interface SchedCapacityHour {
  hour: string; startMin: number; endMin: number; techsOnShift: number; staffedMin: number; bookedMin: number; unassignedMin: number; heldMin: number;
  utilizationPct: number | null; risk: SchedCapacityRisk; skillShort: boolean;
  skills: { category: string; demandMin: number; techsNeeded: number; qualifiedOnShift: number; short: boolean }[];
}
export interface SchedCapacityHeatmap {
  date: string; branchId: string; timeZone: string; tightAtPct: number; hours: SchedCapacityHour[];
  totals: { staffedMin: number; bookedMin: number; overHours: number; tightHours: number; unstaffedHours: number; skillShortHours: number };
  basis: string;
}

// ── usage + export ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface SchedUsageSummary { from: string; to: string; runs: number; recommendations: number; applied: number; explanations: number; llmCostMicroUsd: number }

// ── owner app: branch comparison (GET owner/ai-scheduling/summary?days=, owner.dashboard.view) ───────────────────────
export interface SchedOwnerBranchRow { branchId: string; name: string; utilizationPct: number | null; idleMin: number | null; openRecommendations: number; applied: number; automated: number; pendingProposals: number; openConflicts: number; lastRunAt: string | null }
export interface SchedOwnerSummary { days: number; branches: SchedOwnerBranchRow[]; generatedAt: string }

// ── tech app: proposed / applied changes that touch me (GET tech/ai-schedule/changes?date=) ──────────────────────────
export interface SchedTechChange {
  recommendationId: string; status: SchedRecStatus; type: SchedRecType;
  appointmentId: string | null; customerFirstName: string | null;
  from: { date: string; startTime: string } | null; to: { date: string; startTime: string } | null;
  movesToMe: boolean; movesAwayFromMe: boolean; updatedAt: string;
}
export interface SchedTechChangeList { items: SchedTechChange[] }

// ── Vietnamese POS §21 / §120 (Oct 27 2026): the optimizer's server-written English as code + vars ─────────────────────
// The engine writes fixed English templates (ai-scheduling-recommendation.ts BENEFIT_LABELS, ai-scheduling-explanation.ts
// templateExplanation, ai-scheduling-detection.ts conflict messages, ai-scheduling-insights.ts reasons). These pure helpers
// give the SAME facts as codes (srv.SCHED_*) so the POS words them in the cashier's language. The LLM-written explanation
// (explanationSource 'llm') is free prose and is NOT coded — it is written in the reader's language (explanationLanguage);
// the POS labels it only when that differs from the screen's language (see the engineering report).

const DELTA_KEYS = ['idleSavedMin', 'waitSavedMin', 'utilizationGainPct', 'gapsRemoved', 'latenessReducedPct'] as const;
/** expectedBenefit / possibleDownside as codes, from the simulation deltas they were built from */
export function schedBenefitsCoded(sim: SchedSimulation | null | undefined): { benefits: CodedText[]; downsides: CodedText[] } {
  const benefits: CodedText[] = [], downsides: CodedText[] = [];
  for (const [k, v] of Object.entries(sim?.deltas ?? {})) {
    if (typeof v !== 'number') continue;
    const known = (DELTA_KEYS as readonly string[]).includes(k);
    if (v > 0) benefits.push(known ? coded('SCHED_BENEFIT.' + k, { v: Math.round(v) }) : coded('SCHED_BENEFIT.OTHER', { key: k, v }));
    else if (v < 0) downsides.push(coded(known ? 'SCHED_DOWNSIDE.' + k : 'SCHED_DOWNSIDE.OTHER', { key: k, v: Math.abs(Math.round(v)) }));
  }
  return { benefits, downsides };
}

/** templateExplanation (server, ai-scheduling-explanation.ts) as code + vars, part by part (joined with a space) */
export function schedExplanationCoded(rec: Pick<SchedRecommendation, 'type' | 'currentState' | 'proposedState' | 'simulation' | 'requiresCustomerApproval' | 'confidence' | 'dataQuality'>): CodedText[] {
  const cur = rec.currentState, prop = rec.proposedState;
  const from = cur ? { date: cur.date, startTime: cur.startTime } : null;
  const to = prop ? { date: prop.date, startTime: prop.startTime } : null;
  const techChanges = !!(cur && prop && (cur.technicianId ?? null) !== (prop.technicianId ?? null));
  const parts: CodedText[] = [];
  const moved = !!(from && to && (from.date !== to.date || from.startTime !== to.startTime));
  const sameDay = !!(from && to && from.date === to.date);
  const head = 'SCHED_EXPLAIN.' + (moved ? (sameDay ? 'MOVE_SAME_DAY' : 'MOVE_OTHER_DAY') : 'CHANGE') + (techChanges ? '_TECH' : '');
  parts.push(coded(head, { type: '@srv.SCHED_TYPE.' + rec.type, from: moved ? (sameDay ? from!.startTime : `${from!.date} ${from!.startTime}`) : undefined, to: moved ? (sameDay ? to!.startTime : `${to!.date} ${to!.startTime}`) : undefined }));
  const { benefits, downsides } = schedBenefitsCoded(rec.simulation);
  const list = (xs: CodedText[], p: string) => { const v: Record<string, string | number> = { n: xs.length }; xs.slice(0, 6).forEach((x, i) => { v['p' + i] = '@srv.' + x.code + '#' + p + i; for (const [k, val] of Object.entries(x.vars ?? {})) if (val != null) v[`${p}${i}_${k}`] = val; }); return v; };
  if (benefits.length) parts.push(coded('SCHED_EXPLAIN.WHY_' + Math.min(benefits.length, 6), list(benefits, 'p')));
  else parts.push(coded('SCHED_EXPLAIN.NO_IMPROVEMENT'));
  if (downsides.length) parts.push(coded('SCHED_EXPLAIN.TRADEOFF_' + Math.min(downsides.length, 6), list(downsides, 'p')));
  if (rec.requiresCustomerApproval) parts.push(coded('SCHED_EXPLAIN.CUSTOMER_APPROVAL'));
  const pct = Math.round((Math.round(Number(rec.confidence || 0) * 100) / 100) * 100);
  parts.push(rec.dataQuality !== 'good' ? coded('SCHED_EXPLAIN.CONFIDENCE_DATA', { pct, quality: '@srv.SCHED_DATA.' + rec.dataQuality }) : coded('SCHED_EXPLAIN.CONFIDENCE', { pct }));
  return parts;
}

/** a hard-rule violation's message as code + vars */
export function schedViolationCoded(v: SchedViolation): CodedText | null {
  if (v.code === 'MISSING_SKILL') {
    const m = /qualified for: (.+)$/.exec(v.message ?? ''); const services = (v.vars?.services as string | undefined) ?? m?.[1];
    return services ? coded('SCHED_VIOLATION.MISSING_SKILL', { services }) : null;   // a message in another shape: shown as sent
  }
  return coded('SCHED_VIOLATION.' + v.code, v.vars);
}
/** a detected conflict's message as code + vars (the engine's fixed English: "station X over capacity") */
export function schedConflictCoded(type: string, message: string | null | undefined): CodedText | null {
  if (!type) return null;
  if (type === 'STATION_OVERBOOK') { const m = /^station (.+) over capacity$/.exec(message ?? ''); return coded('SCHED_CONFLICT.STATION_OVERBOOK', { station: m?.[1] ?? '' }); }
  return coded('SCHED_CONFLICT.' + type);
}
/** an insight's stored English reason as code + vars (the engine's fixed templates); null when it does not match */
export function schedInsightReasonCoded(reason: string | null | undefined): CodedText | null {
  const r = String(reason ?? '');
  let m = /^Median of (\d+) completed services is (\d+) min \(configured (\d+) min; middle half (\d+)–(\d+) min\)\.$/.exec(r);
  if (m) return coded('SCHED_INSIGHT.DURATION_MEDIAN', { n: Number(m[1]), median: Number(m[2]), configured: Number(m[3]), p25: Number(m[4]), p75: Number(m[5]) });
  m = /^Projected utilization (\d+) % — consider closing some open time\.$/.exec(r);
  if (m) return coded('SCHED_INSIGHT.CLOSE_LOW_UTILIZATION', { pct: Number(m[1]) });
  m = /^Projected demand is (\d+) % of scheduled time — a technician who is not scheduled could open availability\.$/.exec(r);
  if (m) return coded('SCHED_INSIGHT.OPEN_HIGH_DEMAND', { pct: Number(m[1]) });
  m = /^Schedule about (\d+) more technician hours?\.$/.exec(r);
  if (m) return coded(Number(m[1]) === 1 ? 'SCHED_INSIGHT.ADD_HOURS_ONE' : 'SCHED_INSIGHT.ADD_HOURS', { hours: Number(m[1]) });
  return null;
}

/** A5 (Nov 6 2026): the target technician's full day around a recommendation — before / after, the neighbouring bookings,
 *  new gaps and conflicts (server: ai-scheduling-day-context.ts). */
export interface SchedDayContextItem { appointmentId: string; start: string; end: string; services: string[]; status: string; locked: boolean; moving: boolean }
export interface SchedDayContextSide { technicianId: string | null; technicianName: string | null; shifts: { start: string; end: string }[]; breaks: { start: string; end: string }[];
  items: SchedDayContextItem[]; gaps: { start: string; end: string; minutes: number }[]; conflicts: { type: string; severity: string; message: string }[] }
export interface SchedDayContextResponse {
  date: string; timeZone: string; appointmentId: string; proposed: { start: string; end: string; technicianId: string | null };
  neighbours: { previous: SchedDayContextItem | null; next: SchedDayContextItem | null; gapBeforeMin: number | null; gapAfterMin: number | null };
  before: SchedDayContextSide; after: SchedDayContextSide; change: { newGaps: number; closedGaps: number; newConflicts: number; resolvedConflicts: number };
}
