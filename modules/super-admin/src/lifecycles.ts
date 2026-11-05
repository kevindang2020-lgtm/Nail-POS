// lifecycles.ts — BUILD_PLAN Phase 12 (#27): the Super Admin module's status lifecycles, ONE state machine each
// (packages/database/src/state-machine.ts). Every writer of these columns goes through its machine: canMoveToSql(M, to)
// inside the UPDATE (the conditional update — a row in a state the machine does not move from is left alone, and the
// caller sees no row / a 409), or assertTransition / transitionStatus where the target is chosen at run time.
//
// Each table reproduces the moves the code made before Phase 12, derived from every writer of the column and the
// service-side checks that guarded them (several services already had a pure transition table — those are reused, not
// copied). Where a writer used to allow something that revives a finished record, the machine refuses it and the
// comment says so. A lifecycle that is a pure admin-chosen setting (any listed value → any other) is declared with
// toAny(): the machine then only pins the vocabulary, but the write still runs through it.
//
// Machines for tables owned by another module (subscriptions/add-ons → @aipowersalon/platform; users / sessions /
// deals / chargebacks / tech profiles … → their own modules) are NOT re-declared here — one machine per lifecycle.
import { defineStateMachine } from '@aipowersalon/database';
import { TRANSITIONS as DELIVERY_FLOW } from './super-admin-ai-reports/report-delivery-core';
import { VERSION_TRANSITIONS } from './super-admin-ai-reports/narrative-provenance-core';
import { STATUS_TRANSITIONS as SCHEDULE_FLOW } from './super-admin-ai-reports/report-schedule-core';
import { TRANSITIONS as LEGAL_FLOW } from './super-admin-legal/legal-document-core';
import { TRANSITIONS as GRANT_FLOW } from './super-admin-security/grant-core';
import { TRANSITIONS as INCIDENT_FLOW } from './super-admin-security/incident-core';
import { TRANSITIONS as LOCKDOWN_FLOW } from './super-admin-security/lockdown-core';
import { STATUS_TRANSITIONS as IP_BLOCK_FLOW } from './super-admin-security/ip-block-core';
import { LEGAL_TRANSITIONS as TENANT_FLOW } from './super-admin-tenants/super-admin-tenants-core';

/** every state may move to every listed target (including staying put: an admin re-saving the same value) */
export const toAny = <S extends string>(states: readonly S[], targets: readonly S[] = states): { [K in S]?: readonly S[] } =>
  Object.fromEntries(states.map((s) => [s, [...targets]])) as unknown as { [K in S]?: readonly S[] };

// ── onboarding ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** onboarding_approvals: a pending approval is decided once (approve / reject / return / cancel / expire); the first
 *  half of a two-person approval re-writes 'pending' (pending → pending) until a distinct second approver approves. */
export const ONBOARDING_APPROVAL = defineStateMachine({
  name: 'onboarding_approval', table: 'onboarding_approvals', column: 'status',
  states: ['pending', 'approved', 'rejected', 'returned', 'cancelled', 'expired'],
  transitions: { pending: ['pending', 'approved', 'rejected', 'returned', 'cancelled', 'expired'] },
  initial: ['pending'],
});
/** onboarding_documents: only a pending / under-review document is reviewed (evaluateDocumentReview). */
export const ONBOARDING_DOCUMENT = defineStateMachine({
  name: 'onboarding_document', table: 'onboarding_documents', column: 'status',
  states: ['pending', 'under_review', 'approved', 'rejected', 'expired', 'replaced', 'missing'],
  transitions: { pending: ['under_review', 'approved', 'rejected'], under_review: ['under_review', 'approved', 'rejected'] },
  initial: ['pending', 'missing'],
});

// ── AI insights / reports / usage ──────────────────────────────────────────────────────────────────────────────────
const INSIGHT_OPEN = ['new', 'open', 'in_review', 'monitoring', 'escalated', 'action_recommended', 'follow_up_assigned'] as const;
/** ai_insights: the bulk review / assign / dismiss actions move an OPEN insight. Before Phase 12 they moved any insight,
 *  so "mark reviewed" on a selection silently re-opened dismissed / resolved / archived ones — now those are skipped. */
export const AI_INSIGHT = defineStateMachine({
  name: 'ai_insight', table: 'ai_insights', column: 'status',
  states: ['new', 'open', 'in_review', 'monitoring', 'escalated', 'action_recommended', 'follow_up_assigned', 'dismissed', 'resolved', 'archived', 'expired', 'superseded'],
  transitions: Object.fromEntries(INSIGHT_OPEN.map((s) => [s, ['in_review', 'follow_up_assigned', 'dismissed']])),
  initial: ['new', 'open'],
});
/** ai_narrative_model_versions — exactly VERSION_TRANSITIONS (narrative-provenance-core). */
export const AI_NARRATIVE_MODEL_VERSION = defineStateMachine({
  name: 'ai_narrative_model_version', table: 'ai_narrative_model_versions', column: 'status',
  states: ['draft', 'active', 'retired'],
  transitions: VERSION_TRANSITIONS as any,
  initial: ['draft'],
});
/** ai_report_deliveries — exactly the delivery TRANSITIONS (report-delivery-core; failed / bounced are retryable). */
export const AI_REPORT_DELIVERY = defineStateMachine({
  name: 'ai_report_delivery', table: 'ai_report_deliveries', column: 'status',
  states: ['pending', 'queued', 'in_progress', 'delivered', 'failed', 'bounced', 'suppressed', 'excluded', 'cancelled'],
  transitions: DELIVERY_FLOW as any,
  initial: ['pending', 'excluded', 'suppressed'],
});
/** ai_report_schedules — exactly STATUS_TRANSITIONS (report-schedule-core). */
export const AI_REPORT_SCHEDULE = defineStateMachine({
  name: 'ai_report_schedule', table: 'ai_report_schedules', column: 'status',
  states: ['draft', 'active', 'paused', 'disabled', 'completed', 'archived'],
  transitions: SCHEDULE_FLOW as any,
  initial: ['active', 'draft'],
});
/** ai_report_templates: draft → published (the prior published version of the report → archived); draft / published → archived. */
export const AI_REPORT_TEMPLATE = defineStateMachine({
  name: 'ai_report_template', table: 'ai_report_templates', column: 'status',
  states: ['draft', 'published', 'archived'],
  transitions: { draft: ['published', 'archived'], published: ['archived'] },
  initial: ['draft'],
});
/** ai_providers: an admin setting (active / inactive / error / disabled), re-saved by the provider upsert. */
export const AI_PROVIDER = defineStateMachine({
  name: 'ai_provider', table: 'ai_providers', column: 'status',
  states: ['active', 'inactive', 'error', 'disabled'],
  transitions: toAny(['active', 'inactive', 'error', 'disabled'] as const),
  initial: ['active', 'inactive', 'error', 'disabled'],
});

// ── audit logs ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** audit_export_flags: a reviewer marks a flag reviewed or dismissed (and may revise that decision). */
export const AUDIT_EXPORT_FLAG = defineStateMachine({
  name: 'audit_export_flag', table: 'audit_export_flags', column: 'status',
  states: ['open', 'reviewed', 'dismissed'],
  transitions: toAny(['open', 'reviewed', 'dismissed'] as const, ['reviewed', 'dismissed'] as const),
  initial: ['open'],
});
/** audit_investigations: the investigator sets any of the seven states (the service's STATUSES). */
const INVESTIGATION = ['open', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'] as const;
export const AUDIT_INVESTIGATION = defineStateMachine({
  name: 'audit_investigation', table: 'audit_investigations', column: 'status',
  states: ['open', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'],
  transitions: toAny(INVESTIGATION),
  initial: ['open'],
});
/** audit_legal_holds: an active hold is released once. */
export const AUDIT_LEGAL_HOLD = defineStateMachine({
  name: 'audit_legal_hold', table: 'audit_legal_holds', column: 'status',
  states: ['active', 'released', 'expired'],
  transitions: { active: ['released', 'expired'] },
  initial: ['active'],
});
/** audit_retention_policies: append-only versions — a new version supersedes the active one. */
export const AUDIT_RETENTION_POLICY = defineStateMachine({
  name: 'audit_retention_policy', table: 'audit_retention_policies', column: 'status',
  states: ['active', 'superseded'],
  transitions: { active: ['superseded'] },
  initial: ['active'],
});
/** audit_tamper_controls: a verification result, re-written by every check (any state → any state). */
const TAMPER = ['not_configured', 'enabled', 'active', 'compliant', 'degraded', 'failed'] as const;
export const AUDIT_TAMPER_CONTROL = defineStateMachine({
  name: 'audit_tamper_control', table: 'audit_tamper_controls', column: 'status',
  states: ['not_configured', 'enabled', 'active', 'compliant', 'degraded', 'failed'],
  transitions: toAny(TAMPER),
});

// ── billing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** billing_invoices: draft → open (finalize); an outstanding invoice (open / past_due / failed / partially_paid) → paid
 *  (credit covers it, a retry succeeds, the processor webhook says paid) or → failed (the webhook says the payment
 *  failed). Before Phase 12 the webhook marked ANY non-paid invoice paid — a void (or refunded / uncollectible) invoice
 *  came back as paid — and any non-paid, non-void invoice failed (a refunded one included): both are refused now. */
export const BILLING_INVOICE = defineStateMachine({
  name: 'billing_invoice', table: 'billing_invoices', column: 'status',
  states: ['draft', 'open', 'past_due', 'failed', 'partially_paid', 'paid', 'void', 'refunded', 'uncollectible'],
  transitions: {
    draft: ['open'],
    open: ['paid', 'failed'], past_due: ['paid', 'failed'], failed: ['paid', 'failed'], partially_paid: ['paid', 'failed'],
  },
  initial: ['draft', 'open'],
});
/** billing_credits: applying part of a credit keeps it active; the last cent makes it applied (never re-activated). */
export const BILLING_CREDIT = defineStateMachine({
  name: 'billing_credit', table: 'billing_credits', column: 'status',
  states: ['active', 'applied', 'expired', 'void'],
  transitions: { active: ['active', 'applied'] },
  initial: ['active'],
});
/** billing_export_jobs: pending → processing (the worker's skip-locked claim) → ready | failed; ready → expired (sweep). */
export const BILLING_EXPORT_JOB = defineStateMachine({
  name: 'billing_export_job', table: 'billing_export_jobs', column: 'status',
  states: ['pending', 'processing', 'ready', 'failed', 'expired'],
  transitions: { pending: ['processing'], processing: ['ready', 'failed'], ready: ['expired'] },
  initial: ['pending'],
});

// ── catalog / customer data / booking check-in ────────────────────────────────────────────────────────────────────
/** service_templates: published once from a draft (assertPublishable); any non-retired template may be retired. */
export const SERVICE_TEMPLATE = defineStateMachine({
  name: 'service_template', table: 'service_templates', column: 'status',
  states: ['draft', 'published', 'retired'],
  transitions: { draft: ['published', 'retired'], published: ['retired'] },
  initial: ['draft'],
});
/** customer_deletion_requests: requested → approved (a second reviewer) → executed; an open one may be rejected. */
export const CUSTOMER_DELETION_REQUEST = defineStateMachine({
  name: 'customer_deletion_request', table: 'customer_deletion_requests', column: 'status',
  states: ['requested', 'approved', 'rejected', 'executed', 'cancelled'],
  transitions: { requested: ['approved', 'rejected'], approved: ['rejected', 'executed'] },
  initial: ['requested'],
});
/** customer_import_jobs: pending → approved | rejected; approved → processing (the worker's claim) → completed;
 *  a completed / failed job is retried (→ processing). Two workers can no longer both claim the same approved job. */
export const CUSTOMER_IMPORT_JOB = defineStateMachine({
  name: 'customer_import_job', table: 'customer_import_jobs', column: 'status',
  states: ['pending', 'approved', 'rejected', 'processing', 'completed', 'failed'],
  transitions: { pending: ['approved', 'rejected'], approved: ['processing'], processing: ['completed', 'failed'], completed: ['processing'], failed: ['processing'] },
  initial: ['pending'],
});
/** customer_import_rows: a valid (or previously failed) row is imported once or fails. Before Phase 12 two overlapping
 *  runs (the worker and a manual retry) could both import the same row — two customers from one CSV line. The
 *  'imported' write now commits in the same transaction as the customer insert and only from valid / failed. */
export const CUSTOMER_IMPORT_ROW = defineStateMachine({
  name: 'customer_import_row', table: 'customer_import_rows', column: 'status',
  states: ['valid', 'invalid', 'imported', 'failed'],
  transitions: { valid: ['imported', 'failed'], failed: ['imported', 'failed'] },
  initial: ['valid', 'invalid'],
});
/** booking_checkin_failed_events.retry_status: a controlled retry (only of a retry_available event — the service checks)
 *  moves it to retrying, or — at the cap — to not_retryable (escalated). Two concurrent retries cannot both bump it. */
export const BOOKING_CHECKIN_FAILED_EVENT = defineStateMachine({
  name: 'booking_checkin_failed_event', table: 'booking_checkin_failed_events', column: 'retry_status',
  states: ['failed', 'retry_available', 'retrying', 'not_retryable', 'resolved'],
  transitions: { retry_available: ['retrying', 'not_retryable'] },
  initial: ['failed', 'retry_available'],
});

// ── disputes (chargebacks.status itself belongs to the payments module's lifecycle) ───────────────────────────────
/** chargebacks.evidence_status: requested (from not_requested / incomplete / rejected), collecting once the first file
 *  lands (from not_requested / requested), submitted with a processor submission (from any open evidence state — a
 *  resubmission with a new idempotency key included; never from expired). */
export const CHARGEBACK_EVIDENCE = defineStateMachine({
  name: 'chargeback_evidence', table: 'chargebacks', column: 'evidence_status',
  states: ['not_requested', 'requested', 'collecting', 'ready_for_review', 'incomplete', 'submitted', 'accepted', 'rejected', 'expired'],
  transitions: {
    not_requested: ['requested', 'collecting', 'submitted'], requested: ['collecting', 'submitted'], collecting: ['submitted'],
    ready_for_review: ['submitted'], incomplete: ['requested', 'submitted'], rejected: ['requested', 'submitted'],
    accepted: ['submitted'], submitted: ['submitted'],
  },
  initial: ['not_requested'],
});
/** dispute_evidence.review_status: a reviewer accepts / rejects / marks incomplete (and may revise the decision). */
export const DISPUTE_EVIDENCE_REVIEW = defineStateMachine({
  name: 'dispute_evidence_review', table: 'dispute_evidence', column: 'review_status',
  states: ['uploaded', 'accepted', 'rejected', 'incomplete'],
  transitions: toAny(['uploaded', 'accepted', 'rejected', 'incomplete'] as const, ['accepted', 'rejected', 'incomplete'] as const),
  initial: ['uploaded'],
});

// ── gift card programs + cross-salon settlement ────────────────────────────────────────────────────────────────────
/** gift_card_programs: an admin setting (active / paused / archived). */
export const GIFT_CARD_PROGRAM = defineStateMachine({
  name: 'gift_card_program', table: 'gift_card_programs', column: 'status',
  states: ['active', 'paused', 'archived'],
  transitions: toAny(['active', 'paused', 'archived'] as const),
  initial: ['active'],
});
/** gift_card_program_members: an admin setting; re-adding a member re-activates it. */
export const GIFT_CARD_PROGRAM_MEMBER = defineStateMachine({
  name: 'gift_card_program_member', table: 'gift_card_program_members', column: 'status',
  states: ['active', 'suspended', 'left'],
  transitions: toAny(['active', 'suspended', 'left'] as const),
  initial: ['active'],
});
/** gift_card_settlement_batches — exactly SETTLEMENT_NEXT (gift-cards/gift-card-clearing-core canTransitionSettlement,
 *  which the service checks): a person advances a batch through review → approval → settled. The UPDATE is now
 *  conditional on the state the service checked, so two reviewers cannot both move it. */
export const GIFT_CARD_SETTLEMENT_BATCH = defineStateMachine({
  name: 'gift_card_settlement_batch', table: 'gift_card_settlement_batches', column: 'status',
  states: ['open', 'pending_review', 'approved', 'settled', 'disputed', 'reversed', 'failed'],
  transitions: {
    open: ['pending_review', 'failed'], pending_review: ['approved', 'disputed', 'failed'], approved: ['settled', 'disputed', 'failed'],
    settled: ['reversed'], disputed: ['pending_review', 'reversed', 'failed'], failed: ['pending_review'],
  },
  initial: ['open'],
});
/** gift_card_clearing_entries: a pending entry is claimed into a batch (ready) once; then it follows its batch
 *  (BATCH_TO_ENTRY_STATUS) — the moves below are exactly the ones a batch move can cause. */
export const GIFT_CARD_CLEARING_ENTRY = defineStateMachine({
  name: 'gift_card_clearing_entry', table: 'gift_card_clearing_entries', column: 'status',
  states: ['pending', 'validated', 'ready', 'approved', 'settled', 'disputed', 'reversed', 'failed'],
  transitions: {
    pending: ['ready'], ready: ['approved', 'disputed', 'failed'], approved: ['settled', 'disputed', 'failed'], settled: ['reversed'],
    disputed: ['approved', 'disputed', 'reversed', 'failed'], failed: ['approved', 'disputed', 'failed'],
  },
  initial: ['pending'],
});

// ── integrations / legal / membership templates ───────────────────────────────────────────────────────────────────
/** integration_credential_references: an active credential is rotated (superseded by a new one) or revoked — once. */
export const INTEGRATION_CREDENTIAL = defineStateMachine({
  name: 'integration_credential', table: 'integration_credential_references', column: 'status',
  states: ['active', 'rotated', 'revoked'],
  transitions: { active: ['rotated', 'revoked'] },
  initial: ['active'],
});
/** integration_oauth_states: single use — a pending, unexpired state is consumed once. */
export const INTEGRATION_OAUTH_STATE = defineStateMachine({
  name: 'integration_oauth_state', table: 'integration_oauth_states', column: 'status',
  states: ['pending', 'consumed', 'expired'],
  transitions: { pending: ['consumed', 'expired'] },
  initial: ['pending'],
});
/** legal_document_versions — exactly TRANSITIONS (legal-document-core assertLegalTransition); publishing a version
 *  supersedes the published one of the same document type in the same transaction. */
export const LEGAL_DOCUMENT_VERSION = defineStateMachine({
  name: 'legal_document_version', table: 'legal_document_versions', column: 'status',
  states: ['draft', 'under_review', 'approved', 'scheduled', 'published', 'superseded', 'retired', 'archived'],
  transitions: LEGAL_FLOW as any,
  initial: ['draft'],
});
/** membership_templates: the platform template editor sets draft / published / archived freely. */
export const MEMBERSHIP_TEMPLATE = defineStateMachine({
  name: 'membership_template', table: 'membership_templates', column: 'status',
  states: ['draft', 'published', 'archived'],
  transitions: toAny(['draft', 'published', 'archived'] as const),
  initial: ['draft'],
});

// ── product catalog ────────────────────────────────────────────────────────────────────────────────────────────────
const PRODUCT_IMPORT_OPEN = ['pending', 'validating', 'ready', 'processing', 'failed'] as const;
/** product_import_jobs: approving an open job completes it (imported / partially_imported / failed by the row counts);
 *  a completed (or rolled back) job is never re-approved. Before Phase 12 a CANCELLED job could still be approved and
 *  imported — refused now. */
export const PRODUCT_IMPORT_JOB = defineStateMachine({
  name: 'product_import_job', table: 'product_import_jobs', column: 'status',
  states: ['pending', 'validating', 'ready', 'processing', 'failed', 'imported', 'partially_imported', 'rolled_back', 'cancelled'],
  transitions: Object.fromEntries(PRODUCT_IMPORT_OPEN.map((s) => [s, ['imported', 'partially_imported', 'failed']])),
  initial: ['ready', 'failed'],
});
/** product_import_errors: a retryable error is resolved once. */
export const PRODUCT_IMPORT_ERROR = defineStateMachine({
  name: 'product_import_error', table: 'product_import_errors', column: 'status',
  states: ['open', 'retrying', 'failed', 'resolved'],
  transitions: { open: ['resolved'], retrying: ['resolved'], failed: ['resolved'] },
  initial: ['open'],
});
/** product_master: any live product (not already retired / discontinued / archived) may be retired. */
export const PRODUCT_MASTER = defineStateMachine({
  name: 'product_master', table: 'product_master', column: 'status',
  states: ['draft', 'pending_review', 'active', 'inactive', 'rejected', 'retired', 'discontinued', 'archived'],
  transitions: { draft: ['retired'], pending_review: ['retired'], active: ['retired'], inactive: ['retired'], rejected: ['retired'] },
  initial: ['draft'],
});

// ── revenue & residuals (money: every move that posts a ledger entry is conditional and rolls the entry back on a race) ──
/** residual_statements.review_status: the reviewer sets any of the five review states; a matched reconciliation marks
 *  the statement reconciled. */
const RESIDUAL_REVIEW = ['pending', 'in_review', 'reviewed', 'flagged', 'reconciled'] as const;
export const RESIDUAL_STATEMENT_REVIEW = defineStateMachine({
  name: 'residual_statement_review', table: 'residual_statements', column: 'review_status',
  states: ['pending', 'in_review', 'reviewed', 'flagged', 'reconciled'],
  transitions: toAny(RESIDUAL_REVIEW),
  initial: ['pending'],
});
/** partner_payouts: a calculated / draft / pending payout is approved once. */
export const PARTNER_PAYOUT = defineStateMachine({
  name: 'partner_payout', table: 'partner_payouts', column: 'status',
  states: ['draft', 'calculated', 'pending_approval', 'approved', 'scheduled', 'processing', 'paid', 'failed', 'reversed', 'cancelled'],
  transitions: { draft: ['approved'], calculated: ['approved'], pending_approval: ['approved'] },
  initial: ['draft', 'calculated'],
});
/** tenant_incentives: a calculated / draft / pending incentive is approved once. */
export const TENANT_INCENTIVE = defineStateMachine({
  name: 'tenant_incentive', table: 'tenant_incentives', column: 'status',
  states: ['draft', 'calculated', 'pending_approval', 'approved', 'paid', 'reversed', 'cancelled'],
  transitions: { draft: ['approved'], calculated: ['approved'], pending_approval: ['approved'] },
  initial: ['draft', 'calculated'],
});
/** revenue_adjustments: pending_approval → pending_second_approval (dual approval) → applied (a ledger entry is posted)
 *  → reversed (a compensating entry is posted); a pending one may be rejected. Before Phase 12 two approvals racing on
 *  the same adjustment both posted a ledger entry (and two reversals two compensating entries) — the status write is
 *  now conditional on the state read and the entry rolls back when it loses. */
export const REVENUE_ADJUSTMENT = defineStateMachine({
  name: 'revenue_adjustment', table: 'revenue_adjustments', column: 'status',
  states: ['draft', 'pending_approval', 'pending_second_approval', 'applied', 'rejected', 'reversed'],
  transitions: { pending_approval: ['pending_second_approval', 'applied', 'rejected'], pending_second_approval: ['applied', 'rejected'], applied: ['reversed'] },
  initial: ['pending_approval', 'draft'],
});
/** revenue_accounting_periods: any unlocked period may be locked (when no adjustment is pending); a locked one reopened. */
export const REVENUE_ACCOUNTING_PERIOD = defineStateMachine({
  name: 'revenue_accounting_period', table: 'revenue_accounting_periods', column: 'status',
  states: ['open', 'review', 'ready_to_lock', 'reconciled', 'reopened', 'locked'],
  transitions: { open: ['locked'], review: ['locked'], ready_to_lock: ['locked'], reconciled: ['locked'], reopened: ['locked'], locked: ['reopened'] },
  initial: ['open'],
});
/** revenue_export_jobs: queued → running → completed | failed (a job that fails before it starts fails from queued). */
export const REVENUE_EXPORT_JOB = defineStateMachine({
  name: 'revenue_export_job', table: 'revenue_export_jobs', column: 'status',
  states: ['queued', 'running', 'completed', 'failed'],
  transitions: { queued: ['running', 'failed'], running: ['completed', 'failed'] },
  initial: ['queued'],
});

// ── security center ────────────────────────────────────────────────────────────────────────────────────────────────
/** security_audit_runs: running → completed | failed (a completed run that then errors is recorded failed). */
export const SECURITY_AUDIT_RUN = defineStateMachine({
  name: 'security_audit_run', table: 'security_audit_runs', column: 'status',
  states: ['running', 'completed', 'failed'],
  transitions: { running: ['completed', 'failed'], completed: ['failed'] },
  initial: ['running'],
});
/** security_audit_findings: an open (or reopened) finding resolves when a run no longer sees it; a resolved one reopens. */
export const SECURITY_AUDIT_FINDING = defineStateMachine({
  name: 'security_audit_finding', table: 'security_audit_findings', column: 'status',
  states: ['open', 'resolved', 'reopened'],
  transitions: { open: ['resolved'], reopened: ['resolved'], resolved: ['reopened'] },
  initial: ['open'],
});
/** privileged_access_grants — exactly TRANSITIONS (grant-core canGrantTransition); the sweep expires an active grant. */
export const PRIVILEGED_ACCESS_GRANT = defineStateMachine({
  name: 'privileged_access_grant', table: 'privileged_access_grants', column: 'status',
  states: ['pending', 'active', 'denied', 'revoked', 'expired', 'completed'],
  transitions: GRANT_FLOW as any,
  initial: ['pending'],
});
/** security_incidents — exactly TRANSITIONS (incident-core buildTransition). */
export const SECURITY_INCIDENT = defineStateMachine({
  name: 'security_incident', table: 'security_incidents', column: 'status',
  states: ['detected', 'investigating', 'contained', 'remediating', 'monitoring', 'closed', 'reopened'],
  transitions: INCIDENT_FLOW as any,
  initial: ['detected'],
});
/** ip_block_rules — exactly STATUS_TRANSITIONS (ip-block-core canBlockTransition). */
export const IP_BLOCK_RULE = defineStateMachine({
  name: 'ip_block_rule', table: 'ip_block_rules', column: 'status',
  states: ['blocked', 'under_review', 'expired', 'allowed', 'whitelisted'],
  transitions: IP_BLOCK_FLOW as any,
  initial: ['blocked', 'whitelisted', 'under_review'],
});
/** emergency_lockdowns — exactly TRANSITIONS (lockdown-core): proposed → confirmed → active → lifted; cancel before active. */
export const EMERGENCY_LOCKDOWN = defineStateMachine({
  name: 'emergency_lockdown', table: 'emergency_lockdowns', column: 'status',
  states: ['proposed', 'confirmed', 'active', 'lifted', 'cancelled'],
  transitions: LOCKDOWN_FLOW as any,
  initial: ['proposed'],
});
/** security_policies: append-only versions — a new version archives the active one. */
export const SECURITY_POLICY = defineStateMachine({
  name: 'security_policy', table: 'security_policies', column: 'status',
  states: ['draft', 'active', 'archived'],
  transitions: { active: ['archived'] },
  initial: ['active'],
});
/** data_retention_rules: append-only versions — a new version archives the active one. */
export const DATA_RETENTION_RULE = defineStateMachine({
  name: 'data_retention_rule', table: 'data_retention_rules', column: 'status',
  states: ['active', 'paused', 'archived'],
  transitions: { active: ['archived'] },
  initial: ['active'],
});

// ── smart reminders ────────────────────────────────────────────────────────────────────────────────────────────────
const FLOW = ['active', 'paused', 'disabled', 'under_review', 'problematic', 'retired'] as const;
/** reminder_flow_state: the platform enables / disables / pauses a reminder flow (an admin setting). */
export const REMINDER_FLOW_STATE = defineStateMachine({
  name: 'reminder_flow_state', table: 'reminder_flow_state', column: 'status',
  states: ['active', 'paused', 'disabled', 'under_review', 'problematic', 'retired'],
  transitions: toAny(FLOW),
  initial: ['active', 'disabled'],
});
const PLAN_FEATURE = ['enabled', 'disabled', 'add_on', 'trial', 'approval', 'grandfathered'] as const;
/** reminder_plan_features.state: the per-plan availability of a reminder feature (an admin setting, upserted). */
export const REMINDER_PLAN_FEATURE = defineStateMachine({
  name: 'reminder_plan_feature', table: 'reminder_plan_features', column: 'state',
  states: ['enabled', 'disabled', 'add_on', 'trial', 'approval', 'grandfathered'],
  transitions: toAny(PLAN_FEATURE),
});
/** reminder_template_versions: publishing a version retires the previously published one (republishing is a no-op move). */
export const REMINDER_TEMPLATE_VERSION = defineStateMachine({
  name: 'reminder_template_version', table: 'reminder_template_versions', column: 'status',
  states: ['draft', 'pending_review', 'published', 'retired'],
  transitions: { draft: ['published'], pending_review: ['published'], published: ['published', 'retired'], retired: ['published'] },
  initial: ['draft'],
});
/** reminder_templates: a template becomes published when one of its versions is. */
export const REMINDER_TEMPLATE = defineStateMachine({
  name: 'reminder_template', table: 'reminder_templates', column: 'status',
  states: ['draft', 'pending_review', 'published', 'retired', 'archived'],
  transitions: toAny(['draft', 'pending_review', 'published', 'retired', 'archived'] as const, ['published'] as const),
  initial: ['draft'],
});

// ── tenants / staff / warnings ─────────────────────────────────────────────────────────────────────────────────────
/** tenants.status — exactly LEGAL_TRANSITIONS (super-admin-tenants-core canTransition): pending → active | cancelled;
 *  active ⇄ suspended; anything → cancelled (terminal). The UPDATE is conditional, so a suspend and a cancel racing on
 *  the same salon cannot both land (and cannot both emit their platform event). */
export const TENANT = defineStateMachine({
  name: 'tenant', table: 'tenants', column: 'status',
  states: ['pending', 'active', 'suspended', 'cancelled'],
  transitions: TENANT_FLOW as any,
  initial: ['pending', 'active'],
});
/** worker_transfer_requests: a requested transfer is decided once. Before Phase 12 the repository moved the worker's
 *  branch on ANY approve call — a rejected request approved later still moved them (the service's check and the write
 *  were separate statements): the move now runs only when the request row itself moves requested → approved. */
export const WORKER_TRANSFER_REQUEST = defineStateMachine({
  name: 'worker_transfer_request', table: 'worker_transfer_requests', column: 'status',
  states: ['requested', 'approved', 'rejected', 'cancelled'],
  transitions: { requested: ['approved', 'rejected', 'cancelled'] },
  initial: ['requested'],
});
/** worker_cross_tenant_transfer_requests: a requested cross-salon transfer is decided once. */
export const WORKER_CROSS_TENANT_TRANSFER_REQUEST = defineStateMachine({
  name: 'worker_cross_tenant_transfer_request', table: 'worker_cross_tenant_transfer_requests', column: 'status',
  states: ['requested', 'approved', 'rejected', 'cancelled'],
  transitions: { requested: ['approved', 'rejected', 'cancelled'] },
  initial: ['requested'],
});
/** payroll_sync_events: a failed (or already retrying) event is re-queued (retryEligibility's RETRYABLE_STATUSES). */
export const PAYROLL_SYNC_EVENT = defineStateMachine({
  name: 'payroll_sync_event', table: 'payroll_sync_events', column: 'status',
  states: ['pending', 'processing', 'synced', 'failed', 'retrying', 'not_required', 'not_configured'],
  transitions: { failed: ['retrying'], retrying: ['retrying'] },
  initial: ['pending'],
});
/** tenant_warnings.delivery_status: a pending warning is dispatched once (sent / skipped / failed / recorded). */
export const TENANT_WARNING_DELIVERY = defineStateMachine({
  name: 'tenant_warning_delivery', table: 'tenant_warnings', column: 'delivery_status',
  states: ['pending', 'sent', 'skipped', 'failed', 'recorded'],
  transitions: { pending: ['sent', 'skipped', 'failed', 'recorded'] },
  initial: ['pending'],
});

// ── AI plan bundles (the per-package tenant_ai_subscriptions lifecycle belongs to modules/ai) ─────────────────────
/** tenant_ai_plan_subscriptions: the platform assigns a plan (active or trialing, re-assigning included), converts a
 *  trial, or cancels; a salon starts a trial or cancels. A salon's "start trial" used to re-write an ACTIVE (paid)
 *  plan subscription to trialing — its trial upsert now leaves an active plan alone. */
export const TENANT_AI_PLAN_SUBSCRIPTION = defineStateMachine({
  name: 'tenant_ai_plan_subscription', table: 'tenant_ai_plan_subscriptions', column: 'status',
  states: ['active', 'trialing', 'cancelled'],
  transitions: { active: ['active', 'trialing', 'cancelled'], trialing: ['active', 'trialing', 'cancelled'], cancelled: ['active', 'trialing'] },
  initial: ['active', 'trialing'],
});

// ── platform: access requests + customer privacy requests (users / sessions belong to the identity module) ─────────
/** access_requests — exactly decideTransition (access-request-core): submitted → under_review; an open request
 *  (submitted / under_review) → approved | rejected | cancelled; an approved temporary grant → expired. The approval used
 *  to change the user's role BEFORE its conditional status write and return (not throw) when that write lost a race —
 *  the role stayed granted with no approval recorded. The role now changes only after the request row has moved. */
export const ACCESS_REQUEST = defineStateMachine({
  name: 'access_request', table: 'access_requests', column: 'status',
  states: ['submitted', 'under_review', 'approved', 'rejected', 'cancelled', 'expired'],
  transitions: { submitted: ['under_review', 'approved', 'rejected', 'cancelled'], under_review: ['approved', 'rejected', 'cancelled'], approved: ['expired'] },
  initial: ['submitted'],
});
const PRIVACY_OPEN = ['new', 'identity_verification_required', 'verified', 'in_review', 'processing', 'tenant_action_required'] as const;
const PRIVACY_ALL = [...PRIVACY_OPEN, 'completed', 'rejected', 'cancelled'] as const;
/** customer_privacy_requests: support advances an OPEN request to any status (with a note). A completed / rejected /
 *  cancelled request used to be re-openable the same way — those are terminal now (file a new request instead). */
export const CUSTOMER_PRIVACY_REQUEST = defineStateMachine({
  name: 'customer_privacy_request', table: 'customer_privacy_requests', column: 'status',
  states: ['new', 'identity_verification_required', 'verified', 'in_review', 'processing', 'tenant_action_required', 'completed', 'rejected', 'cancelled'],
  transitions: toAny<string>(PRIVACY_OPEN, PRIVACY_ALL) as any,
  initial: ['new'],
});

// ── global technician accounts (tech_salon_memberships / tech_portfolio_photos belong to modules/workforce) ────────
/** global_tech_profiles.status — only the Super Admin moves it: suspend (anything but anonymized / merged) ⇄ restore;
 *  pause (active) ⇄ reactivate; lock (active / paused) ⇄ unlock; anonymize (an approved deletion request; terminal);
 *  merge a duplicate into its canonical profile. Each write is conditional on the state the service read. */
export const GLOBAL_TECH_PROFILE = defineStateMachine({
  name: 'global_tech_profile', table: 'global_tech_profiles', column: 'status',
  states: ['active', 'paused', 'locked', 'suspended', 'merged', 'anonymized'],
  transitions: {
    active: ['suspended', 'paused', 'locked', 'anonymized', 'merged'],
    paused: ['active', 'suspended', 'locked', 'anonymized', 'merged'],
    locked: ['active', 'suspended', 'anonymized', 'merged'],
    suspended: ['active', 'suspended', 'anonymized', 'merged'],
    merged: ['anonymized'],
  },
  initial: ['active'],
});
/** global_tech_delete_requests: a pending request is decided once; an approved one completes when the account is anonymized. */
export const GLOBAL_TECH_DELETE_REQUEST = defineStateMachine({
  name: 'global_tech_delete_request', table: 'global_tech_delete_requests', column: 'status',
  states: ['pending', 'approved', 'rejected', 'completed'],
  transitions: { pending: ['approved', 'rejected'], approved: ['completed'] },
  initial: ['pending'],
});

// ── shared with apps/api (BUILD_PLAN Phase 12 round 2 integration) ─────────────────────────────────────────────────
// alerts and tenant_webhooks are written by Super Admin AND by apps/api (the health aggregator, the noisy-neighbour
// watch, the salon's own webhook settings). apps/api may import modules, never the reverse, so the ONE machine for each
// lives here and apps/api imports it from @aipowersalon/super-admin.

/** alerts.status: the platform alert inbox. Super Admin may set any of the four on any alert (re-open included — today's
 *  behaviour); the health aggregator re-surfaces an acknowledged alert as unread when it gets WORSE and resolves it on
 *  recovery; mark-all-read moves unread → read. The machine pins the vocabulary and makes every write conditional. */
export const ALERT = defineStateMachine({
  name: 'alert', table: 'alerts', column: 'status',
  states: ['unread', 'read', 'resolved', 'dismissed'],
  transitions: toAny(['unread', 'read', 'resolved', 'dismissed'] as const),
  initial: ['unread'],
});

/** tenant_webhooks.status: an endpoint switched on, paused or disabled — by the salon (API Webhooks) or by Super Admin
 *  (Integrations). A pure setting: any value → any value, as today. */
export const TENANT_WEBHOOK = defineStateMachine({
  name: 'tenant_webhook', table: 'tenant_webhooks', column: 'status',
  states: ['active', 'paused', 'disabled'],
  transitions: toAny(['active', 'paused', 'disabled'] as const),
  initial: ['active'],
});
