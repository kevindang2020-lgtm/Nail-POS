// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { DonutSlice, OnboardingKpis } from '@aipowersalon/api-contracts/platform';
import type { DonutSlice, OnboardingKpis } from '@aipowersalon/api-contracts/platform';
// ONBOARDING_STAGES / OUTCOME_STATES live in the platform contract with their types (Constitution 13 §15).
import { ONBOARDING_STAGES, OUTCOME_STATES, type PagedRows } from '@aipowersalon/api-contracts/platform';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { OnboardingStage, OutcomeState, OnboardingState } from '@aipowersalon/api-contracts/platform';
import type { OnboardingStage, OutcomeState, OnboardingState } from '@aipowersalon/api-contracts/platform';
export { ONBOARDING_STAGES, OUTCOME_STATES };
// onboarding-core.ts — pure, I/O-free logic for the Super-Admin "Onboarding & Approvals" subsystem.
//
// This is the persistence-agnostic spine: the 14-stage onboarding state machine (canonical order, linear
// transitions, gated skips, outcome/terminal states), completion math, the 12 dashboard KPIs, stage-distribution
// reconciliation, and health/alert severity. It mirrors the project's established pattern (cf. website-leads-core.ts,
// workflow-core): everything here is a pure function, unit-tested, and reused by the service over either the
// in-memory or Postgres repo. No fixture/demo data lives here; callers pass real records in.
//
// Compliance intent (enforced by the service that consumes this): no stage may be skipped without an approved skip
// rule + reason + audit event; rejection / cancellation / return-for-correction require a reason; activation must
// validate every mandatory prerequisite. This module exposes the *rules*; the service applies permission + audit.

// ----------------------------------------------------------------------------------------------------------------
// Stages
// ----------------------------------------------------------------------------------------------------------------




/** Human labels (UI badges). Kept here so backend reconciliation and frontend stay in lockstep. */
export const STAGE_LABELS: Record<OnboardingState, string> = {
  application_received: 'Application Received',
  business_info_submitted: 'Business Info Submitted',
  identity_verification: 'Identity Verification',
  legal_documents_submitted: 'Legal Documents Submitted',
  subscription_selected: 'Subscription Selected',
  merchant_application_submitted: 'Merchant Application Submitted',
  merchant_account_approved: 'Merchant Approved',
  bank_account_verified: 'Bank Verified',
  hardware_assigned: 'Hardware Assigned',
  data_imported: 'Data Imported',
  users_invited: 'Users Invited',
  training_completed: 'Training Completed',
  final_review: 'Final Review',
  tenant_activated: 'Tenant Activated',
  returned_for_correction: 'Returned for Correction',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
  paused: 'Paused',
  blocked: 'Blocked',
};

/**
 * Stages that may be skipped *only* under an approved skip rule (+ permission + reason + audit, enforced by the
 * service). Identity, legal documents, final review, and activation are never skippable. The merchant/bank pair is
 * skippable for "existing merchant account"; hardware for "no hardware required"; data import for "no data import";
 * training for "training waived"; users-invited for branch-only flows.
 */
export const SKIPPABLE_STAGES: ReadonlySet<OnboardingStage> = new Set<OnboardingStage>([
  'merchant_application_submitted',
  'merchant_account_approved',
  'bank_account_verified',
  'hardware_assigned',
  'data_imported',
  'users_invited',
  'training_completed',
]);

/** States from which no forward onboarding work continues (reactivation is a separate, permissioned path). */
export const TERMINAL_STATES: ReadonlySet<OnboardingState> = new Set<OnboardingState>(['tenant_activated', 'cancelled', 'expired']);

const STAGE_INDEX = new Map<OnboardingStage, number>(ONBOARDING_STAGES.map((s, i) => [s, i]));

export const isStage = (s: string): s is OnboardingStage => STAGE_INDEX.has(s as OnboardingStage);
export const isOutcome = (s: string): s is OutcomeState => (OUTCOME_STATES as readonly string[]).includes(s);
export const isTerminal = (s: OnboardingState): boolean => TERMINAL_STATES.has(s);
export const stageIndex = (s: OnboardingStage): number => STAGE_INDEX.get(s)!;
export const nextStage = (s: OnboardingStage): OnboardingStage | null => {
  if (!isStage(s)) return ONBOARDING_STAGES[0]; // from rejected or holding state, restart from first stage
  const i = STAGE_INDEX.get(s);
  return i == null || i >= ONBOARDING_STAGES.length - 1 ? null : ONBOARDING_STAGES[i + 1];
};

// ----------------------------------------------------------------------------------------------------------------
// Transitions
// ----------------------------------------------------------------------------------------------------------------

export interface TransitionOptions {
  /** Caller has supplied an approved skip rule (permission + reason verified at the service layer). */
  allowSkip?: boolean;
  /** A reason string was supplied (required for rejections, returns, cancellations, blocks, and any skip). */
  hasReason?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  /** Machine-readable rejection code when `ok` is false. */
  code?: 'terminal' | 'not_forward' | 'requires_skip_rule' | 'unskippable_stage' | 'requires_reason' | 'invalid_target' | 'no_resume_target';
  reason?: string;
  /** Stages bypassed by this transition (each must be skippable + carry an approved skip rule). */
  skips: OnboardingStage[];
  /** True when the service must capture a reason before committing (rejection/return/cancel/block/skip). */
  requiresReason: boolean;
}

const OUTCOMES_REQUIRING_REASON: ReadonlySet<OutcomeState> = new Set<OutcomeState>(['returned_for_correction', 'rejected', 'cancelled', 'blocked']);

/**
 * Evaluate whether `from → to` is a permitted onboarding transition. Pure rules only — the service still applies
 * permission checks, captures the reason text, and writes the audit event. `resumeTarget` is the active stage a
 * `returned_for_correction` / `paused` / `blocked` application resumes to.
 */
export function evaluateTransition(from: OnboardingState, to: OnboardingState, opts: TransitionOptions = {}, resumeTarget?: OnboardingStage): TransitionResult {
  const base: TransitionResult = { ok: false, skips: [], requiresReason: false };

  // Resuming from a holding/return/rejected state back into an active stage.
  if (from === 'returned_for_correction' || from === 'paused' || from === 'blocked' || from === 'rejected') {
    if (isStage(to)) {
      // Developer (Sep 2026): a REJECTED application may be reopened — but only from the FIRST stage, with a reason
      // (every check runs again). Sep 2026 merge: their version also dropped the resume-target check, so a paused or
      // returned application could jump to ANY stage — past document review straight to final review. Restored: a
      // holding state resumes exactly where it stopped.
      if (from === 'rejected') {
        if (to !== ONBOARDING_STAGES[0]) return { ...base, code: 'invalid_target', reason: 'A rejected application restarts from the first stage' };
        return { ok: true, skips: [], requiresReason: true };
      }
      const target = resumeTarget ?? to;
      if (target !== to) return { ...base, code: 'invalid_target', reason: 'Resume target mismatch' };
      return { ok: true, skips: [], requiresReason: false };
    }
    if (to === 'cancelled' || to === 'rejected' || to === 'expired') {
      return { ok: true, skips: [], requiresReason: OUTCOMES_REQUIRING_REASON.has(to as OutcomeState), code: undefined };
    }
    return { ...base, code: 'no_resume_target', reason: `Cannot move from ${from} to ${to}` };
  }

  if (isTerminal(from)) return { ...base, code: 'terminal', reason: `${STAGE_LABELS[from]} is terminal` };

  // Active stage → an outcome state (reject / return / cancel / pause / block / expire).
  if (isOutcome(to)) {
    const needsReason = OUTCOMES_REQUIRING_REASON.has(to);
    if (needsReason && !opts.hasReason) return { ...base, code: 'requires_reason', reason: `${STAGE_LABELS[to]} requires a reason`, requiresReason: true };
    return { ok: true, skips: [], requiresReason: needsReason };
  }

  // Active stage → another stage. Must be strictly forward.
  if (!isStage(from) || !isStage(to)) return { ...base, code: 'invalid_target' };
  const fi = stageIndex(from);
  const ti = stageIndex(to);
  if (ti <= fi) return { ...base, code: 'not_forward', reason: 'Onboarding stages only advance forward' };

  // Stages strictly between `from` and `to` are bypassed and must each be skippable + carry an approved skip rule.
  const skips = ONBOARDING_STAGES.slice(fi + 1, ti);
  if (skips.length > 0) {
    const unskippable = skips.find((s) => !SKIPPABLE_STAGES.has(s));
    if (unskippable) return { ...base, skips, code: 'unskippable_stage', reason: `${STAGE_LABELS[unskippable]} cannot be skipped` };
    if (!opts.allowSkip) return { ...base, skips, code: 'requires_skip_rule', reason: 'Skipping stages requires an approved skip rule', requiresReason: true };
    if (!opts.hasReason) return { ...base, skips, code: 'requires_reason', reason: 'A skip requires a reason', requiresReason: true };
    return { ok: true, skips, requiresReason: true };
  }

  // Immediate forward step.
  return { ok: true, skips: [], requiresReason: false };
}

// ----------------------------------------------------------------------------------------------------------------
// Completion
// ----------------------------------------------------------------------------------------------------------------

/** Completion % = unique completed canonical stages / 14, rounded. Honest checklist math — not a per-stage fixture. */
export function completionPct(completedStages: readonly OnboardingStage[]): number {
  const uniq = new Set(completedStages.filter(isStage));
  return Math.round((uniq.size / ONBOARDING_STAGES.length) * 100);
}

/**
 * The default completed-stage set implied by being *at* a given current stage on the normal forward path: every
 * earlier stage is done; reaching `tenant_activated` means all 14 are done. Outcome states carry no implicit set
 * (the service supplies the real per-application checklist).
 */
export function defaultCompletedStages(current: OnboardingState): OnboardingStage[] {
  if (current === 'tenant_activated') return [...ONBOARDING_STAGES];
  if (!isStage(current)) return [];
  return ONBOARDING_STAGES.slice(0, stageIndex(current));
}

// ----------------------------------------------------------------------------------------------------------------
// Sub-workflow status vocabularies (kept central so KPIs, table badges, and reconciliation agree)
// ----------------------------------------------------------------------------------------------------------------

export const MERCHANT_UNDERWRITING = ['not_submitted', 'submitted', 'under_review', 'additional_info_required', 'approved', 'declined', 'expired'] as const;
export const HARDWARE_SHIPMENT = ['not_ordered', 'pending', 'assigned', 'preparing', 'shipped', 'in_transit', 'delivered', 'delayed', 'cancelled'] as const;
export const DATA_IMPORT = ['not_started', 'uploaded', 'validating', 'in_progress', 'completed', 'completed_with_warnings', 'failed', 'returned_for_correction'] as const;
export const TRAINING = ['not_started', 'scheduled', 'in_progress', 'completed', 'overdue', 'waived'] as const;
export const IDENTITY = ['not_started', 'pending', 'in_progress', 'verified', 'additional_info_required', 'failed', 'expired', 'manually_reviewed', 'rejected'] as const;
export const BANK = ['not_started', 'pending', 'verified', 'failed', 'expired'] as const;

export type MerchantUnderwriting = (typeof MERCHANT_UNDERWRITING)[number];
export type HardwareShipment = (typeof HARDWARE_SHIPMENT)[number];
export type DataImport = (typeof DATA_IMPORT)[number];
export type Training = (typeof TRAINING)[number];
export type Identity = (typeof IDENTITY)[number];
export type Bank = (typeof BANK)[number];

// ----------------------------------------------------------------------------------------------------------------
// KPI rollup + reconciliation
// ----------------------------------------------------------------------------------------------------------------

/** Normalized per-application summary the rollups operate on. The repo maps DB rows → this shape. */
export interface OnboardingAppSummary {
  id: string;
  state: OnboardingState;
  identity: Identity;
  merchant: MerchantUnderwriting;
  bank: Bank;
  hardware: HardwareShipment;
  dataImport: DataImport;
  training: Training;
  usersInvited: boolean;
}

/** An application is "in progress" when it is in an active stage that is not the terminal activation. */
export function isInProgress(s: OnboardingState): boolean {
  return isStage(s) && s !== 'tenant_activated';
}


const IDENTITY_PENDING: ReadonlySet<Identity> = new Set<Identity>(['pending', 'in_progress', 'additional_info_required']);
const HARDWARE_ASSIGNED_SET: ReadonlySet<HardwareShipment> = new Set<HardwareShipment>(['assigned', 'preparing', 'shipped', 'in_transit', 'delivered']);
const IMPORT_DONE: ReadonlySet<DataImport> = new Set<DataImport>(['completed', 'completed_with_warnings']);

/** Compute the 12 dashboard KPIs from real application summaries. `pendingApprovals` reconciles to the queue. */
export function rollupKpis(apps: readonly OnboardingAppSummary[], pendingApprovals: number): OnboardingKpis {
  let inProgress = 0, idPending = 0, merchantApproved = 0, bankVerified = 0, hwAssigned = 0, importsDone = 0, invited = 0, trainingDone = 0, finalReviewPending = 0, activated = 0;
  for (const a of apps) {
    if (isInProgress(a.state)) inProgress++;
    if (IDENTITY_PENDING.has(a.identity)) idPending++;
    if (a.merchant === 'approved') merchantApproved++;
    if (a.bank === 'verified') bankVerified++;
    if (HARDWARE_ASSIGNED_SET.has(a.hardware)) hwAssigned++;
    if (IMPORT_DONE.has(a.dataImport)) importsDone++;
    if (a.usersInvited) invited++;
    if (a.training === 'completed') trainingDone++;
    if (a.state === 'final_review') finalReviewPending++;
    if (a.state === 'tenant_activated') activated++;
  }
  return {
    applicationsReceived: apps.length,
    inProgress,
    pendingApprovals,
    identityVerificationPending: idPending,
    merchantApproved,
    bankVerified,
    hardwareAssigned: hwAssigned,
    dataImportsCompleted: importsDone,
    usersInvited: invited,
    trainingCompleted: trainingDone,
    finalReviewsPending: finalReviewPending,
    tenantsActivated: activated,
  };
}

export interface StageBucket { stage: OnboardingState; label: string; count: number; }

/** Stage distribution over the active pipeline (excludes terminal-failure outcomes). Sum reconciles to the total. */
export function stageDistribution(apps: readonly OnboardingAppSummary[]): { buckets: StageBucket[]; total: number } {
  const counts = new Map<OnboardingState, number>();
  let total = 0;
  for (const a of apps) {
    if (a.state === 'rejected' || a.state === 'cancelled' || a.state === 'expired') continue; // not part of the active pipeline
    counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
    total++;
  }
  const buckets: StageBucket[] = [];
  for (const stage of ONBOARDING_STAGES) {
    const count = counts.get(stage) ?? 0;
    if (count > 0) buckets.push({ stage, label: STAGE_LABELS[stage], count });
  }
  return { buckets, total };
}

/** True only when the per-bucket counts sum exactly to the reported total — used to assert reconciliation. */
export function reconciles(buckets: readonly { count: number }[], total: number): boolean {
  return buckets.reduce((s, b) => s + b.count, 0) === total;
}

// ----------------------------------------------------------------------------------------------------------------
// Health & alerts severity
// ----------------------------------------------------------------------------------------------------------------

export type Severity = 'critical' | 'warning' | 'info' | 'ok';

// ----------------------------------------------------------------------------------------------------------------
// Pipeline list: record row + filter / sort / paginate (pure; shared by in-memory and Postgres repos and the service)
// ----------------------------------------------------------------------------------------------------------------

/** The full pipeline row the table renders. Joined fields (salon/owner/specialist names) come from the spine + users. */
export interface OnboardingRecordRow {
  id: string;
  applicationId: string;
  applicationType: 'new_tenant' | 'new_branch';
  parentTenantId: string | null;
  tenantId: string | null;
  salonName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  branchCount: number;
  currentStage: OnboardingState;
  resumeStage: OnboardingStage | null;
  completionPct: number;
  stageEnteredAt: string;
  stageAgeHours: number;
  slaBand: SlaBand;
  specialistUserId: string | null;
  specialistName: string | null;
  identity: Identity;
  merchant: MerchantUnderwriting;
  bank: Bank;
  hardware: HardwareShipment;
  dataImport: DataImport;
  training: Training;
  usersInvited: boolean;
  missingDocsCount: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  targetActivationDate: string | null;
  activatedAt: string | null;
  activationType: 'new' | 'upgraded' | 'reactivated' | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListParams {
  search?: string;
  applicationType?: 'new_tenant' | 'new_branch';
  stage?: OnboardingState;
  specialistId?: string;
  merchantStatus?: MerchantUnderwriting;
  hardwareStatus?: HardwareShipment;
  importStatus?: DataImport;
  trainingStatus?: Training;
  hasMissingDocuments?: boolean;
  sort?: SortField;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export type SortField = 'tenant' | 'branches' | 'stage' | 'completion' | 'specialist' | 'missingDocs' | 'merchant' | 'hardware' | 'dataImport' | 'training' | 'updated' | 'created' | 'stageAge';

/** Apply the directory filters. Pure and order-stable; the Postgres repo mirrors these predicates in SQL. */
export function filterRecords(rows: readonly OnboardingRecordRow[], p: ListParams): OnboardingRecordRow[] {
  const q = (p.search ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = `${r.salonName ?? ''} ${r.ownerName ?? ''} ${r.ownerEmail ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (p.applicationType && r.applicationType !== p.applicationType) return false;
    if (p.stage && r.currentStage !== p.stage) return false;
    if (p.specialistId && r.specialistUserId !== p.specialistId) return false;
    if (p.merchantStatus && r.merchant !== p.merchantStatus) return false;
    if (p.hardwareStatus && r.hardware !== p.hardwareStatus) return false;
    if (p.importStatus && r.dataImport !== p.importStatus) return false;
    if (p.trainingStatus && r.training !== p.trainingStatus) return false;
    if (p.hasMissingDocuments === true && r.missingDocsCount <= 0) return false;
    if (p.hasMissingDocuments === false && r.missingDocsCount > 0) return false;
    return true;
  });
}

const SORT_KEY: Record<SortField, (r: OnboardingRecordRow) => string | number> = {
  tenant: (r) => (r.salonName ?? '').toLowerCase(),
  branches: (r) => r.branchCount,
  stage: (r) => (isStage(r.currentStage) ? stageIndex(r.currentStage) : -1),
  stageAge: (r) => new Date(r.stageEnteredAt).getTime(),
  completion: (r) => r.completionPct,
  specialist: (r) => (r.specialistName ?? '').toLowerCase(),
  missingDocs: (r) => r.missingDocsCount,
  merchant: (r) => r.merchant,
  hardware: (r) => r.hardware,
  dataImport: (r) => r.dataImport,
  training: (r) => r.training,
  updated: (r) => r.updatedAt,
  created: (r) => r.createdAt,
};

export function sortRecords(rows: readonly OnboardingRecordRow[], sort: SortField = 'updated', direction: 'asc' | 'desc' = 'desc'): OnboardingRecordRow[] {
  const key = SORT_KEY[sort];
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = key(a), bv = key(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function paginate<T>(rows: readonly T[], page = 1, pageSize = 10): PagedRows<T> {
  const total = rows.length;
  const ps = Math.max(1, Math.min(pageSize, 100));
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const pg = Math.max(1, Math.min(page, totalPages));
  const start = (pg - 1) * ps;
  return { rows: rows.slice(start, start + ps), total, page: pg, pageSize: ps, totalPages };
}

/** Convenience: filter → sort → paginate in one pass (used by the in-memory repo and reused in service tests). */
export function listRecords(rows: readonly OnboardingRecordRow[], p: ListParams) {
  const filtered = sortRecords(filterRecords(rows, p), p.sort, p.direction);
  return paginate(filtered, p.page, p.pageSize);
}

// ----------------------------------------------------------------------------------------------------------------
// Overview metrics (pure): health counts, donut breakdowns, workflow stage counts
// ----------------------------------------------------------------------------------------------------------------

export interface HealthMetrics {
  missingDocuments: number; expiredIdentityVerification: number; merchantUnderwritingPending: number;
  bankVerificationFailures: number; hardwareShipmentDelays: number; dataImportIssues: number;
  trainingOverdue: number; finalReviewQueue: number;
}

/** Health & Alerts panel counts. Status-derived metrics come from summaries; `missingDocs` is the doc-count sum. */
export function healthMetrics(apps: readonly OnboardingAppSummary[], missingDocs: number): HealthMetrics {
  const count = (pred: (a: OnboardingAppSummary) => boolean) => apps.reduce((n, a) => n + (pred(a) ? 1 : 0), 0);
  return {
    missingDocuments: missingDocs,
    expiredIdentityVerification: count((a) => a.identity === 'expired'),
    merchantUnderwritingPending: count((a) => a.merchant === 'submitted' || a.merchant === 'under_review'),
    bankVerificationFailures: count((a) => a.bank === 'failed'),
    hardwareShipmentDelays: count((a) => a.hardware === 'delayed'),
    dataImportIssues: count((a) => a.dataImport === 'failed' || a.dataImport === 'returned_for_correction'),
    trainingOverdue: count((a) => a.training === 'overdue'),
    finalReviewQueue: count((a) => a.state === 'final_review'),
  };
}

function donut<T extends string>(apps: readonly OnboardingAppSummary[], sel: (a: OnboardingAppSummary) => T, labels: Record<string, string>): { slices: DonutSlice[]; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const a of apps) { const k = sel(a); counts.set(k, (counts.get(k) ?? 0) + 1); total++; }
  const slices = [...counts.entries()].map(([key, count]) => ({ key, label: labels[key] ?? key, count })).sort((a, b) => b.count - a.count);
  return { slices, total };
}

const labelize = (v: string) => v.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const labelsFor = (vals: readonly string[]) => Object.fromEntries(vals.map((v) => [v, labelize(v)]));

export const merchantDonut = (apps: readonly OnboardingAppSummary[]) => donut(apps, (a) => a.merchant, labelsFor(MERCHANT_UNDERWRITING));
export const hardwareDonut = (apps: readonly OnboardingAppSummary[]) => donut(apps, (a) => a.hardware, labelsFor(HARDWARE_SHIPMENT));
export const dataImportDonut = (apps: readonly OnboardingAppSummary[]) => donut(apps, (a) => a.dataImport, labelsFor(DATA_IMPORT));
export const trainingDonut = (apps: readonly OnboardingAppSummary[]) => donut(apps, (a) => a.training, labelsFor(TRAINING));

/** Counts per canonical stage across the active pipeline (the 14-stage workflow strip). Reconciles to active total. */
export function workflowCounts(apps: readonly OnboardingAppSummary[]): { stage: OnboardingStage; label: string; count: number }[] {
  const counts = new Map<OnboardingStage, number>();
  for (const a of apps) if (isStage(a.state)) counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  return ONBOARDING_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage], count: counts.get(stage) ?? 0 }));
}

export interface TrendPoint { date: string; applications: number; completions: number }

/** Completion Trend: applications received vs completions (activations) per UTC day over the last `days` days.
 *  Pure + gap-filled (every day in the window appears, even with zero). "Completion" means tenant activation, not an
 *  intermediate step. The repo's in-memory impl uses this directly; the Postgres impl mirrors it in SQL. */
export function completionTrend(rows: readonly { createdAt: string; activatedAt: string | null }[], days = 7, now: Date = new Date()): TrendPoint[] {
  const dayKey = (iso: string) => iso.slice(0, 10);
  const apps = new Map<string, number>();
  const comps = new Map<string, number>();
  for (const r of rows) {
    apps.set(dayKey(r.createdAt), (apps.get(dayKey(r.createdAt)) ?? 0) + 1);
    if (r.activatedAt) comps.set(dayKey(r.activatedAt), (comps.get(dayKey(r.activatedAt)) ?? 0) + 1);
  }
  const out: TrendPoint[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, applications: apps.get(d) ?? 0, completions: comps.get(d) ?? 0 });
  }
  return out;
}

/** Map a health-alert metric to a severity band. Thresholds are documented and conservative; tune via config later. */
export function alertSeverity(metric: string, count: number): Severity {
  if (count <= 0) return 'ok';
  switch (metric) {
    case 'bank_verification_failures':
    case 'data_import_issues':
      return count >= 1 ? 'critical' : 'ok';
    case 'expired_identity_verification':
    case 'hardware_shipment_delays':
    case 'training_overdue':
      return count >= 10 ? 'critical' : 'warning';
    case 'missing_documents':
    case 'merchant_underwriting_pending':
    case 'final_review_queue':
      return count >= 25 ? 'warning' : 'info';
    default:
      return 'info';
  }
}

// ----------------------------------------------------------------------------------------------------------------
// CSV export (pure, with CSV-injection guard)
// ----------------------------------------------------------------------------------------------------------------

/** Neutralize spreadsheet formula injection: a leading =,+,-,@,tab,CR turns the cell into a formula in Excel/Sheets,
 *  so prefix those with a single quote. Then RFC-4180 quote/escape. Applied to every exported cell. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const ONBOARDING_EXPORT_COLUMNS = [
  'Tenant', 'Owner Email', 'Application Type', 'Branches', 'Current Stage', 'Days in Stage', 'SLA', 'Completion %', 'Specialist',
  'Missing Docs', 'Merchant', 'Bank', 'Hardware', 'Data Import', 'Training', 'Users Invited', 'Created', 'Last Update',
] as const;

/** Serialize pipeline rows to CSV. No secrets — identity/bank/processor fields are never columns here. */
export function onboardingRowsToCsv(rows: readonly OnboardingRecordRow[]): string {
  const lines = [ONBOARDING_EXPORT_COLUMNS.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.salonName, r.ownerEmail, STAGE_LABELS[r.currentStage] ?? r.currentStage, r.branchCount,
      STAGE_LABELS[r.currentStage] ?? r.currentStage, (r.stageAgeHours / 24).toFixed(1), r.slaBand,
      r.completionPct, r.specialistName ?? 'Unassigned',
      r.missingDocsCount, r.merchant, r.bank, r.hardware, r.dataImport, r.training, r.usersInvited ? 'yes' : 'no',
      r.createdAt, r.updatedAt,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

// ----------------------------------------------------------------------------------------------------------------
// Two-person approval workflow (pure). Sequencing + the differ-from-first rule, mirrored by the DB CHECK backstop.
// ----------------------------------------------------------------------------------------------------------------

export type ApprovalDecisionStatus = 'pending' | 'approved' | 'rejected' | 'returned' | 'cancelled' | 'expired';

export interface ApprovalStateView {
  status: ApprovalDecisionStatus;
  decidedByUserId: string | null;
  secondApproverUserId: string | null;
  requiresSecondApproval: boolean;
}

export type ApprovalAction =
  | { kind: 'finalize'; status: ApprovalDecisionStatus } // single-step approve, or any reject/return/cancel/expire
  | { kind: 'await_second' }                              // first approval of a two-person rule — stays pending
  | { kind: 'second_approve' }                            // a different approver finalizes to approved
  | { kind: 'error'; reason: string };

/** True when a two-person approval has its first approval recorded and is waiting on a distinct second approver. */
export function isAwaitingSecond(a: ApprovalStateView): boolean {
  return a.requiresSecondApproval && a.status === 'pending' && a.decidedByUserId != null && a.secondApproverUserId == null;
}

/** Decide what a decision does, enforcing the two-person sequence and the differ-from-first rule. Pure; the service
 *  persists the result and the DB CHECK is the backstop. Rejections/returns finalize immediately at either step. */
export function evaluateApprovalDecision(a: ApprovalStateView, actorUserId: string | null, target: ApprovalDecisionStatus): ApprovalAction {
  const alreadyDecided = a.status === 'approved' || a.status === 'rejected' || a.status === 'cancelled' || a.status === 'expired' || a.status === 'returned';
  if (alreadyDecided) return { kind: 'error', reason: 'This approval has already been decided.' };
  if (target === 'rejected' || target === 'returned' || target === 'cancelled' || target === 'expired') {
    return { kind: 'finalize', status: target };
  }
  if (target !== 'approved') return { kind: 'error', reason: `Unsupported decision: ${target}` };
  if (!a.requiresSecondApproval) return { kind: 'finalize', status: 'approved' };
  if (a.decidedByUserId == null) {
    if (!actorUserId) return { kind: 'error', reason: 'An identified approver is required.' };
    return { kind: 'await_second' };
  }
  if (a.secondApproverUserId != null) return { kind: 'error', reason: 'This approval has already been decided.' };
  if (!actorUserId) return { kind: 'error', reason: 'An identified second approver is required.' };
  if (actorUserId === a.decidedByUserId) return { kind: 'error', reason: 'Two-person rule: the second approval must come from a different user than the first.' };
  return { kind: 'second_approve' };
}

// ----------------------------------------------------------------------------------------------------------------
// Document review (pure). Enforces reviewable-state, reject-needs-reason, and the safety rule that a document cannot
// be approved unless its virus scan is clean. The DB CHECK on status/virus_scan_status is the backstop.
// ----------------------------------------------------------------------------------------------------------------

export type DocumentStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired' | 'replaced' | 'missing';
export type VirusScanStatus = 'pending' | 'clean' | 'infected' | 'error';

export interface DocumentReviewState { status: DocumentStatus; virusScanStatus: VirusScanStatus }
export type DocumentReviewAction =
  | { kind: 'apply'; status: DocumentStatus; rejectionReason: string | null }
  | { kind: 'error'; reason: string };

/** Decide what a review action does. Only pending/under_review docs are reviewable; approving requires a clean scan;
 *  rejecting requires a reason. Pure; the service persists and the DB CHECK constraints are the backstop. */
export function evaluateDocumentReview(doc: DocumentReviewState, target: DocumentStatus, rejectionReason: string | null | undefined): DocumentReviewAction {
  if (doc.status !== 'pending' && doc.status !== 'under_review') {
    return { kind: 'error', reason: 'This document has already been reviewed and can no longer be changed.' };
  }
  if (target === 'approved') {
    if (doc.virusScanStatus === 'infected') return { kind: 'error', reason: 'This document failed its virus scan and cannot be approved.' };
    if (doc.virusScanStatus !== 'clean') return { kind: 'error', reason: 'This document cannot be approved until its virus scan completes cleanly.' };
    return { kind: 'apply', status: 'approved', rejectionReason: null };
  }
  if (target === 'rejected') {
    if (!rejectionReason?.trim()) return { kind: 'error', reason: 'A reason is required to reject a document.' };
    return { kind: 'apply', status: 'rejected', rejectionReason: rejectionReason.trim() };
  }
  if (target === 'under_review') return { kind: 'apply', status: 'under_review', rejectionReason: null };
  return { kind: 'error', reason: `Unsupported review status: ${target}` };
}

// ----------------------------------------------------------------------------------------------------------------
// SLA / stage-aging (pure). "How long has this application sat in its current stage, and is that a problem?"
// Thresholds are documented and conservative; naturally-slow stages (underwriting, banking) get more runway.
// Only active workflow stages age — terminal/outcome states (activated, rejected, paused, …) never breach.
// ----------------------------------------------------------------------------------------------------------------

export type SlaBand = 'ok' | 'aging' | 'breached';

export const SLA_AGING_HOURS = 72;    // 3 days in a stage → aging
export const SLA_BREACH_HOURS = 168;  // 7 days in a stage → breached

/** Per-stage overrides where a longer dwell is normal (external dependencies). Hours. */
export const SLA_STAGE_OVERRIDES: Partial<Record<OnboardingStage, { aging: number; breach: number }>> = {
  merchant_application_submitted: { aging: 120, breach: 336 }, // underwriting can legitimately take days
  merchant_account_approved: { aging: 120, breach: 336 },
  bank_account_verified: { aging: 96, breach: 240 },
  hardware_assigned: { aging: 96, breach: 240 },              // shipping lead time
};

export function stageAgeHours(enteredAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(enteredAt).getTime();
  return ms <= 0 ? 0 : ms / 3_600_000;
}

export function slaBand(stage: OnboardingState, ageHours: number): SlaBand {
  // Only in-progress stages age. Non-stages (outcome states) and the completed stage (tenant_activated) never breach.
  if (!isStage(stage) || stage === 'tenant_activated') return 'ok';
  const t = SLA_STAGE_OVERRIDES[stage] ?? { aging: SLA_AGING_HOURS, breach: SLA_BREACH_HOURS };
  if (ageHours >= t.breach) return 'breached';
  if (ageHours >= t.aging) return 'aging';
  return 'ok';
}

/** Augment a record row with derived stage-age + SLA band from its stageEnteredAt. Single source of truth for both
 *  the in-memory and Postgres read paths so the badge logic can't drift between them. */
export function attachSla<T extends { currentStage: OnboardingState; stageEnteredAt: string }>(row: T, now: Date = new Date()): T & { stageAgeHours: number; slaBand: SlaBand } {
  const ageHours = stageAgeHours(row.stageEnteredAt, now);
  return { ...row, stageAgeHours: Math.round(ageHours * 10) / 10, slaBand: slaBand(row.currentStage, ageHours) };
}
