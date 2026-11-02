// ai-scheduling.store.ts — BUILD_PLAN Phase 7: the optimizer engine's persistence seam. Every method takes the tenant id
// first (scope comes from the session ctx, never the client). Status changes are CONDITIONAL — `casRec` updates only when
// (tenant, id, version, status ∈ from) still match and bumps version, so two writers can never both win. Kysely
// (ai-scheduling.kysely.repository.ts) in production; in-memory (ai-scheduling.memory.repository.ts) for dev / unit tests.
import type {
  SchedRecommendation, SchedRecStatus, SchedAppointmentSnapshot, SchedProposedChange, SchedViolation, SchedSimulation,
  SchedVersions, SchedDataQuality, SchedRecType, SchedRun, SchedRunScope, SchedGap, SchedConflict, SchedMetrics,
  SchedSettingsLayer, SchedRuleVersion, SchedTimeOff, SchedLock, SchedServiceProfile, SchedConfig,
} from '@aipowersalon/api-contracts/tenant';

export interface RecInsert {
  branchId: string | null; runId: string | null; type: SchedRecType; status: SchedRecStatus;
  currentState: SchedAppointmentSnapshot; proposedState: SchedProposedChange;
  affectedAppointmentIds: string[]; affectedTechnicianIds: string[];
  violations: SchedViolation[]; simulation: SchedSimulation; softObjectivesImproved: string[];
  expectedBenefit: string[]; possibleDownside: string[]; confidence: number; dataQuality: SchedDataQuality;
  touchesConfirmedAppointment: boolean; requiresCustomerApproval: boolean; versions: SchedVersions;
  expiresAt: string; automated: boolean;
}
/** Fields a conditional status update may also set. */
export interface RecPatch {
  status: SchedRecStatus; decidedByUserId?: string | null; decidedAt?: string | null; appliedAt?: string | null;
  applyAttempt?: number; expiresAt?: string | null; automated?: boolean;
}
export interface RecFilters {
  branchId?: string | null; status?: string | null; statuses?: string[] | null; type?: string | null; runId?: string | null;
  technicianId?: string | null; appointmentId?: string | null; date?: string | null; limit?: number;
}
export interface ApplicationRow {
  idempotencyKey: string; recommendationId: string; appointmentId: string | null; attempt: number;
  status: 'pending' | 'applied' | 'failed' | 'stale' | 'rolled_back'; appliedVia: string | null; externalRef: string | null; errorCode: string | null;
}
export interface RunInsert {
  branchId: string | null; scope: SchedRunScope; date: string; technicianId: string | null; trigger: 'manual' | 'job' | 'automation';
  idempotencyKey: string | null; requestedByUserId: string | null; versions: SchedVersions; correlationId: string | null;
}
export interface RunFinish { status: 'completed' | 'failed'; metrics: SchedMetrics | null; recommendationCount: number; gapCount: number; conflictCount: number; latencyMs: number; errorCode: string | null }
export interface GapInsert { technicianId: string | null; startMin: number; endMin: number; durationMin: number; cause: string | null; servicesThatFit: string[]; confidence: number | null }
export interface ConflictInsert { type: string; severity: 'info' | 'warning' | 'critical'; appointmentIds: string[]; technicianId: string | null; message: string | null }
export interface LayerWrite { level: 'tenant' | 'branch'; branchId: string | null; expectedVersion: number; enabled: boolean | null; killSwitch: boolean | null; config: Partial<SchedConfig> | null; userId: string | null }

export interface SchedStore {
  /** Run `fn` inside one transaction (Kysely) — `handle` is the transaction for the outbox writer. In memory: no-op wrap. */
  tx<T>(fn: (store: SchedStore, handle: unknown) => Promise<T>): Promise<T>;

  insertRec(tenantId: string, r: RecInsert): Promise<SchedRecommendation>;
  getRec(tenantId: string, id: string): Promise<SchedRecommendation | null>;
  listRecs(tenantId: string, f: RecFilters): Promise<{ items: SchedRecommendation[]; total: number }>;
  /** UPDATE … SET status, version = version + 1 WHERE tenant AND id AND version = expected AND status IN from. null = lost. */
  casRec(tenantId: string, id: string, expectedVersion: number, from: SchedRecStatus[], patch: RecPatch): Promise<SchedRecommendation | null>;
  /** language (Vietnamese POS §120, migration 702): the language the text is in; omitted = English. */
  setExplanation(tenantId: string, id: string, text: string, source: 'llm' | 'template', language?: 'en' | 'vi'): Promise<void>;
  insertDecision(tenantId: string, d: { recommendationId: string; action: string; actorUserId: string | null; reason: string | null; before: unknown; after: unknown }): Promise<void>;
  listDecisions(tenantId: string, recommendationId: string): Promise<{ action: string; actorUserId: string | null; reason: string | null; before: any; after: any }[]>;
  insertImpact(tenantId: string, recommendationId: string, sim: SchedSimulation): Promise<void>;
  dueForExpiry(tenantId: string, nowIso: string, statuses: SchedRecStatus[], limit: number): Promise<SchedRecommendation[]>;

  findApplication(tenantId: string, key: string): Promise<ApplicationRow | null>;
  /** INSERT a 'pending' application row; false when the key already exists (unique index decides). */
  claimApplication(tenantId: string, row: { key: string; recommendationId: string; appointmentId: string | null; attempt: number; userId: string | null; scheduleVersion: number | null }): Promise<boolean>;
  finishApplication(tenantId: string, key: string, r: { status: 'applied' | 'failed' | 'stale'; appliedVia: string | null; externalRef: string | null; errorCode: string | null }): Promise<void>;
  markApplicationRolledBack(tenantId: string, key: string): Promise<void>;

  findRunByKey(tenantId: string, key: string): Promise<string | null>;
  /** null when (tenant, idempotency_key) already exists. */
  insertRun(tenantId: string, r: RunInsert): Promise<string | null>;
  finishRun(tenantId: string, id: string, f: RunFinish): Promise<void>;
  getRun(tenantId: string, id: string): Promise<SchedRun | null>;
  listRuns(tenantId: string, f: { branchId?: string | null; date?: string | null; limit?: number }): Promise<SchedRun[]>;
  latestCompletedRun(tenantId: string, branchId: string | null, date: string): Promise<SchedRun | null>;
  insertGaps(tenantId: string, runId: string, branchId: string | null, date: string, gaps: GapInsert[]): Promise<void>;
  listGaps(tenantId: string, runId: string): Promise<SchedGap[]>;
  resolveOpenConflicts(tenantId: string, branchId: string | null, date: string): Promise<void>;
  insertConflicts(tenantId: string, runId: string, branchId: string | null, date: string, rows: ConflictInsert[]): Promise<void>;
  listConflicts(tenantId: string, runId: string): Promise<SchedConflict[]>;

  layers(tenantId: string): Promise<SchedSettingsLayer[]>;
  /** Conditional on expectedVersion (0 = the layer must not exist yet). null = version conflict. */
  writeLayer(tenantId: string, w: LayerWrite): Promise<SchedSettingsLayer | null>;
  insertRuleVersion(tenantId: string, layer: SchedSettingsLayer, userId: string | null): Promise<void>;
  listRuleVersions(tenantId: string, limit: number): Promise<SchedRuleVersion[]>;

  listTimeOff(tenantId: string, f: { technicianId?: string | null; branchId?: string | null; from?: string | null; to?: string | null }): Promise<SchedTimeOff[]>;
  insertTimeOff(tenantId: string, t: { technicianId: string; branchId: string | null; startsAt: string; endsAt: string; reason: string | null; userId: string | null }): Promise<SchedTimeOff>;
  cancelTimeOff(tenantId: string, id: string): Promise<boolean>;
  listLocks(tenantId: string, branchId: string | null): Promise<SchedLock[]>;
  putLock(tenantId: string, l: { appointmentId: string; branchId: string | null; reason: string | null; userId: string | null }): Promise<SchedLock>;
  deleteLock(tenantId: string, appointmentId: string): Promise<boolean>;
  listServiceProfiles(tenantId: string): Promise<SchedServiceProfile[]>;
  putServiceProfile(tenantId: string, p: SchedServiceProfile, userId: string | null): Promise<SchedServiceProfile>;
}

/** Live (non-terminal, not yet applied) statuses — what calendar badges, supersede and expiry look at. */
export const LIVE_STATUSES: SchedRecStatus[] = ['generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'needs_revision', 'customer_approval_required', 'customer_approved', 'application_pending', 'application_failed'];
/** What the expiry sweep may expire (the workflow's `expire` edges). */
export const EXPIRABLE_STATUSES: SchedRecStatus[] = ['generated', 'review_required', 'review_in_progress', 'partially_accepted', 'customer_approval_required', 'accepted', 'customer_approved', 'needs_revision'];
