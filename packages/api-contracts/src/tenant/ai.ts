// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface ReceiptItem { name: string; quantity: number; unitPriceCents: number; totalCents: number }

export interface ParsedReceipt {
  vendor: string | null; date: string | null; items: ReceiptItem[];
  subtotalCents: number; taxCents: number; totalCents: number; currency: string | null;
}

/** The six AI automation levels, least to most autonomous (a runtime contract beside its type, §13). */
export const AUTOMATION_LEVELS = ['OFF', 'SUGGEST_ONLY', 'DRAFT', 'APPROVAL_REQUIRED', 'LIMITED_AUTOMATION', 'AUTOMATIC'] as const;
export type AutomationLevel = typeof AUTOMATION_LEVELS[number];

export interface DecisionAnalytics {
  total: number;
  accepted: number; rejected: number; overridden: number; keptUnassigned: number;
  acceptanceRate: number | null; overrideRate: number | null; rejectionRate: number | null;
  topRejectionReasons: { reason: string; count: number }[];
  byDay: { date: string; total: number; accepted: number; overridden: number }[];
  byChosenTechnician: { technicianId: string; count: number }[];
  /** BUILD_PLAN Phase 6 (audit bug 13): the auto-run's own decisions, kept OUT of the acceptance / override / rejection
   *  rates — those are over `staffTotal` (the decisions a person made). */
  autoAssigned: number;
  staffTotal: number;
  /** structured rejection reasons (feedbackCode), most frequent first */
  topFeedbackCodes: { code: string; count: number }[];
  /** decisions by hour of the day (0–23) */
  byHour: { hour: number; total: number; accepted: number; autoAssigned: number }[];
}

export type RequiredAction = 'assignable' | 'staff_review' | 'no_eligible_technician';
export interface RecommendationCandidate {
  technicianId: string;
  name: string;
  eligible: boolean;
  matchScore: number;
  reasons: string[];
  warnings: string[];
  estimatedStartInMinutes: number | null;
  estimatedCompletionInMinutes: number | null;
}
export interface RecommendationEnvelope {
  queueEntryId: string;
  recommended: RecommendationCandidate | null;
  alternates: RecommendationCandidate[];
  confidence: number;               // 0..1, derived from score separation (0 when only one/zero eligible)
  conflicts: string[];              // hard reasons no/limited assignment is possible
  warnings: string[];               // soft cautions on the recommended pick (shift-end, appointment-soon, etc.)
  requiredAction: RequiredAction;
  ruleVersion: string;
  recoVersion: string;
  generatedAt: string;
  /** BUILD_PLAN Phase 6: the settings version ("<salon>.<branch>") and the guest's queue version it was made on */
  configVersion?: string | null;
  queueVersion?: number | null;
  /** the technician the guest asked for (null = any available) */
  requestedTechnicianId?: string | null;
  /** technicians the hard rules removed, with plain reasons (for an override) */
  ineligible?: { technicianId: string; name: string; reasons: string[] }[];
  /** Fair Turn Engine (wave 2): present when the salon's rotation is a fairness mode — "Why Lisa?" / "Why was Mary skipped?" */
  fairTurn?: FairTurnExplanation | null;
}
/** Fair Turn Engine — the deterministic explanation of a recommendation (mandate §7, §161, §163). Never money. */
export interface FairTurnExplanation {
  mode: string;                 // traditional_weighted_rotation | lowest_turn_units | workload_balanced | hybrid_fairness | manual_order
  assignmentMode: 'AUTOMATIC' | 'RECOMMEND_AND_CONFIRM' | 'MANUAL';
  policyVersion: string;
  recommendedTechnicianId: string | null;
  requested: boolean;
  why: string[];
  /** `why` as code + vars, line by line (Vietnamese POS §21: srv.FAIR_WHY.*) */
  whyCoded?: import('../text/coded-text').CodedText[];
  skipped: { technicianId: string; name: string; reason: string; text: string; textCoded?: import('../text/coded-text').CodedText }[];
  skips: { technicianId: string; reason: string }[];
  candidates: { technicianId: string; name: string; turnRank: number | null; eligible: boolean; reasons: string[]; hardFails?: string[]; skipReason: string | null; effectiveUnits: number | null; readyMinutes: number | null; basis: string | null }[];
  eligiblePool: string[];
}

// ── AI queue assignment: decisions, the per-customer panel, rotation, auto-run (BUILD_PLAN Phase 6) ──────────────
export type QueueAssignmentDecisionType = 'accepted' | 'rejected' | 'overridden' | 'kept_unassigned';
export type QueueAssignmentStoredDecisionType = QueueAssignmentDecisionType | 'auto_assigned';
export interface QueueAssignmentDecisionRequest {
  decision: QueueAssignmentDecisionType;
  /** overridden: the technician staff chose instead */
  chosenTechnicianId?: string | null;
  /** required for rejected and overridden */
  reason?: string | null;
  /** structured rejection reason (e.g. 'customer_preference', 'skill', 'workload', 'timing', 'other') */
  feedbackCode?: string | null;
  /** the same key replays the same answer — no second assignment */
  idempotencyKey?: string | null;
}
export interface QueueAssignmentDecisionRecord {
  id: string; recommendationId: string; queueEntryId: string; decision: QueueAssignmentStoredDecisionType;
  chosenTechnicianId: string | null; previousTechnicianId: string | null; reason: string | null; feedbackCode: string | null;
  /** the queue really assigned */
  applied: boolean; idempotencyKey: string | null; decidedBy: string; createdAt: string;
}
export interface QueueAssignmentDecisionResponse {
  decision: QueueAssignmentDecisionRecord;
  applied: boolean;
  /** the queue item after the decision (the queue's item detail) — null when it could not be read */
  queueItem: Record<string, unknown> | null;
  /** true when this was a replay of an earlier request with the same idempotency key */
  replayed?: boolean;
}
export interface QueueAssignmentPanelEntry {
  queueEntryId: string; branchId: string | null; version: number | null; requiredCategories: string[]; serviceDurationMinutes: number;
  requestedTechnicianId: string | null; previousTechnicianId?: string | null; isVip?: boolean; isAppointment?: boolean;
  appointmentStartAt?: string | null; lateMinutes?: number | null; groupId?: string | null; groupSize?: number | null;
  lock?: { technicianId: string | null; reason: string | null } | null; serviceIds?: string[];
}
/** One technician in the per-customer panel: the engine's live view (not persisted), eligibility and the plain reasons a
 *  hard rule removed them (e.g. 'on break', 'at capacity', 'wrong branch', 'assignment locked'). */
export interface QueueAssignmentPanelCandidate {
  technicianId: string; name: string; branchId: string | null; available: boolean;
  eligible: boolean; reasons: string[];
  /** the engine's score (null when not eligible) */
  matchScore: number | null;
  activeAssignments: number; maxConcurrent: number; availableInMinutes: number | null; shiftEndsInMinutes: number | null;
  nextAppointmentInMinutes: number | null; onBreak: boolean; blocked: boolean; isPrevious: boolean; isRequested: boolean; skills: string[];
}
export interface QueueAssignmentPanel {
  entry: QueueAssignmentPanelEntry;
  /** every candidate technician, eligible or not (the override list) */
  candidates: QueueAssignmentPanelCandidate[];
  recommendation: QueueAssignmentRecommendation | null;
  decisions: QueueAssignmentDecisionRecord[];
  lock: { technicianId: string | null; reason: string | null } | null;
}
export type QueueRotationPolicy = 'traditional_weighted_rotation' | 'lowest_turn_units' | 'workload_balanced' | 'hybrid_fairness' | 'manual_order' | 'hybrid' | 'least_minutes' | 'least_customers' | 'first_available' | 'fixed_order';   // Fair Turn Engine: the five fairness modes + the legacy scoring policies
export interface QueueRotationPolicyResponse { policy: QueueRotationPolicy; fixedOrder: string[] }
export interface QueueAutoExclusions { vip?: boolean; appointments?: boolean; requested?: boolean; groups?: boolean; technicianIds?: string[]; serviceIds?: string[] }
export interface QueueAutoConfig {
  enabled: boolean; confidenceFloor: number; maxPerRun: number; delaySeconds: number; exclusions: QueueAutoExclusions;
  /** may an auto-run act right now (platform switch, salon kill switch, this branch) — and if not, what stops it */
  autoAllowed: boolean; autoBlockedBy: null | 'platform' | 'salon_kill_switch' | 'disabled' | 'mode';   // 'mode': the assignment mode is not AUTOMATIC (Fair Turn §9)
  salonAutoKilled: boolean; salonAutoKilledReason: string | null; platformAutoActionsDisabled: boolean;
  configVersion: string; branchVersion: number;
}
export interface QueueAutoConfigUpdate {
  enabled?: boolean; confidenceFloor?: number; maxPerRun?: number; delaySeconds?: number; exclusions?: QueueAutoExclusions;
  expectedVersion?: number; reason?: string | null;
}
export interface QueueAutoRunResult {
  enabled: boolean; allowed: boolean; blockedBy: null | 'platform' | 'salon_kill_switch' | 'disabled';
  assigned: number; considered: number; skipped: { queueEntryId: string; reason: string }[];
}
export interface QueueAutoKillRequest { scope: 'branch' | 'salon'; reason: string }
/** The names the AI layer uses for the same shapes (GET/PUT auto-config, POST auto/run, POST recommendations/:id/decision). */
export type QueueAutoConfigView = QueueAutoConfig;
export type QueueAutoRunResponse = QueueAutoRunResult;
export type QueueRotationPolicyUpdate = { policy: QueueRotationPolicy; fixedOrder?: string[]; expectedVersion?: number; reason?: string | null };
/** 409 body when a decision / settings save meets a guest or settings that changed meanwhile */
export interface QueueAssignmentConflictBody { statusCode: 409; code: 'VERSION_CONFLICT'; message: string; currentTechnicianId: string | null }

/** What POST /ai-queue-assignment/entries/:id/recommend and GET .../recommendation return: the envelope plus the id it
 *  was stored under. A distinct name from the scheduling optimizer's Recommendation (a different concept). */
export type QueueAssignmentRecommendation = RecommendationEnvelope & { recommendationId?: string };

// ── Multi-technician routing: visit + party plans (engine ai-queue-assignment-plan.ts, PLAN_VERSION 'qa-plan-1') ──
export type VisitPlanMode = 'single' | 'split';
export interface VisitPlanLineCandidate { technicianId: string; name: string; matchScore: number; estimatedStartInMinutes: number | null; reasons: string[]; warnings: string[] }
export interface VisitPlanLine {
  queueItemId: string; serviceId: string; serviceName: string; category: string | null; durationMinutes: number; sequence: number;
  technicianId: string | null; technicianName: string | null; expectedTechnicianId: string | null;
  timing: import('./queue').PlanLineTiming; afterServiceId: string | null;
  estimatedStartInMinutes: number | null; estimatedEndInMinutes: number | null; confidence: number;
  reasons: string[]; warnings: string[]; alternates: VisitPlanLineCandidate[]; ineligible: { technicianId: string; name: string; reasons: string[] }[];
}
export interface VisitPlan {
  queueItemId: string; customerName: string; queueVersion: number | null; expectedTechnicianId: string | null; mode: VisitPlanMode; leadTechnicianId: string | null;
  lines: VisitPlanLine[]; technicianCount: number; estimatedStartInMinutes: number | null; estimatedFinishInMinutes: number | null;
  singleTechnicianAlternative: { technicianId: string; name: string; estimatedFinishInMinutes: number | null } | null;
  confidence: number; warnings: string[]; conflicts: string[]; requiredAction: RequiredAction;
}
export interface PartyPlan {
  groupId: string; label: string; together: boolean; members: VisitPlan[];
  sharedStartInMinutes: number | null; estimatedFinishInMinutes: number | null; anyOrderFinishInMinutes: number | null;
  confidence: number; warnings: string[]; conflicts: string[]; requiredAction: RequiredAction;
}
export interface PlanRecommendationView { recommendationId: string; kind: 'visit' | 'party'; visit: VisitPlan | null; party: PartyPlan | null;
  planVersion: string; ruleVersion: string; recoVersion: string; configVersion: string | null; generatedAt: string }
export type PlanDecisionType = 'accepted' | 'adjusted' | 'rejected' | 'kept_unassigned';
export interface PlanDecisionRequest { decision: PlanDecisionType; lines?: { queueItemId: string; serviceId: string; technicianId: string }[]; reason?: string | null; feedbackCode?: string | null; idempotencyKey?: string | null }
export interface PlanDecisionResponse { decision: QueueAssignmentDecisionRecord; applied: boolean; result: import('./queue').AssignPlanResult | null; replayed?: boolean }

// ── A6 AI Queue guide (Nov 4 2026): history search, guest overlay facts, Check AI Queue System ──
export type AqHealthStatus = 'READY' | 'ATTENTION_REQUIRED' | 'FAILED' | 'DISABLED' | 'NOT_CONFIGURED' | 'UNKNOWN';
export interface AqHealthCheck { key: string; label: string; status: AqHealthStatus; evidence: string; failure: string | null; fix: string | null; facts: Record<string, string | number>; checkedAt: string }
export interface AqHealthRun { runId: string | null; overall: AqHealthStatus; checkedAt: string; checks: AqHealthCheck[]; note: string }
export interface AqHistoryItem {
  decisionId: string; queueEntryId: string; recommendationId: string | null; decision: string; applied: boolean; reason: string | null; feedbackCode: string | null; decidedBy: string | null; createdAt: string | null;
  customerName: string | null; maskedPhone: string | null; customerId: string | null; ticketId: string | null; appointmentId: string | null; entryStatus: string | null;
  technicianId: string | null; technicianName: string | null; previousTechnicianId: string | null; previousTechnicianName: string | null;
}
export interface AqHistoryPage { period: { preset: string; from: string | null; to: string | null; tz: string; today: string }; page: number; pageSize: number; totalItems: number; totalPages: number; order: 'newest'; items: AqHistoryItem[] }
export interface AqEntryDetail {
  queueEntryId: string; status: string; source: string; priority: string; isVip: boolean; checkedInAt: string | null; calledAt: string | null; startedAt: string | null; waitMinutes: number | null;
  ticketId: string | null; appointmentId: string | null; assignedTechnicianId: string | null; requestedServices: Array<{ serviceId: string | null; name: string | null }>; notes: string | null;
  customer: { customerId: string | null; name: string | null; maskedPhone: string | null; preferredTechnicianId: string | null; customerSince: string | null; paidVisits: number; lastVisitAt: string | null };
  appointments: Array<{ appointmentId: string; date: string; startAt: string | null; endAt: string | null; status: string; source: string; technicianId: string | null; technicianName: string | null }>;
  events: Array<{ eventType: string; deliveryStatus: string; attempts: number; occurredAt: string | null; publishedAt: string | null }>;
}

// ── A7 AI Booking Assistant guide (Nov 4 2026): the operations center over the existing booking records ──
export type AibHealthStatus = 'READY' | 'ATTENTION_REQUIRED' | 'FAILED' | 'DISABLED' | 'NOT_CONFIGURED' | 'UNKNOWN';
export interface AibHealthCheck { key: string; status: AibHealthStatus; evidence: string; failure: string | null; fix: string | null; owner: string; facts: Record<string, string | number>; checkedAt: string }
export interface AibHealthRun { runId: string | null; overall: AibHealthStatus; checkedAt: string; checks: AibHealthCheck[]; note: string }
export interface AibPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
export interface AibOverview { period: AibPeriod; requests: number; prepared: number; pendingVerification: number; pendingConfirmation: number; confirmed: number; failed: number; liveHolds: number; expiredHolds: number; definitions: Record<string, string> }
export interface AibActivityRow {
  requestId: string; status: string; source: string; createdAt: string | null; updatedAt: string | null; customerName: string | null; maskedPhone: string | null; customerId: string | null;
  appointmentId: string | null; appointmentDate: string | null; appointmentTime: string | null; appointmentStatus: string | null; services: string[]; technicianId: string | null; technicianName: string | null;
  failureReason: string | null; attempts: number; events: number;
}
export interface AibActivityPage { period: AibPeriod; basis: string; page: number; pageSize: number; totalItems: number; totalPages: number; order: 'newest'; items: AibActivityRow[] }
export interface AibRequestDetail extends AibActivityRow {
  branchId: string | null;
  customer: { customerId: string | null; name: string | null; maskedPhone: string | null; verified: boolean; appointments: Array<{ appointmentId: string; date: string | null; time: string | null; status: string; source: string }> };
  serviceLines: Array<{ name: string | null; priceCents: number | null; durationMinutes: number | null }>;
  timeline: Array<{ stage: string; outcome: string | null; failureReason: string | null; appointmentId: string | null; latencyMs: number | null; at: string | null }>;
  verification: Array<{ status: string; channel: string; maskedPhone: string; attempts: number; resends: number; expiresAt: string | null; verifiedAt: string | null; failureReason: string | null; at: string | null }>;
  communications: Array<{ kind: string; provider: string; providerReference: string | null; sentAt: string | null; status: string }>;
  holds: Array<{ holdId: string; status: string; channel: string; startAt: string | null; endAt: string | null; expiresAt: string | null; releasedAt: string | null; releaseReason: string | null; convertedAppointmentId: string | null }>;
  tools: Array<{ tool: string; kind: string; status: string; result: string | null; error: string | null; requests: number; at: string | null; finishedAt: string | null }>;
}
export interface AibRecoveryCase { key: string; type: string; urgency: 'high' | 'medium' | 'low'; requestId: string | null; at: string | null; customerName: string | null; maskedPhone: string | null; appointmentId: string | null; date: string | null; reason: string | null; source: string; attempts: number;
  /** A7 guide §10: the latest manager-approval request about this case (POS Approvals), if one was made */
  approval?: { id: string; status: string; at: string | null } | null }
export interface AibRecoveryList { cases: AibRecoveryCase[]; dismissedCount: number; note: string }
/** A7 guide §10 "Review Alternative": POS Booking's real open starts for the case day — suggestions only */
export interface AibAlternatives { key: string; date: string; serviceIds: string[]; preferredTechnicianId: string | null; alternatives: Array<{ technicianId: string; technicianName: string; start: string; preferred: boolean }>; totalOpen: number; note: string | null; safety: string }
export interface AqLastHealth { run: AqHealthRun | null }
export interface AibLastHealth { run: AibHealthRun | null }
export interface AibDismissResult { dismissed: boolean; key: string }
