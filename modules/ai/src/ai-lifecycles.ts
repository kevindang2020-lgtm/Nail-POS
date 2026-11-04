// ai-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the AI module's status lifecycles, ONE transition table each, used by
// every writer of the column (canMoveToSql in the conditional UPDATE / upsert, or assertTransition / transitionStatus).
// Each table reproduces the moves the code made before (derived from its writers and, where one existed, the module's
// own pure table, which now reads from here); the few dangerous moves the old unconditional writes allowed are closed
// and named on the machine.
import { defineStateMachine } from '@aipowersalon/database';
import { transition as recTransition, type RecEvent, type RecState } from './ai-scheduling-optimizer/ai-scheduling-workflow';

const ALL = <S extends string>(states: readonly S[]): { [K in S]: readonly S[] } =>
  Object.fromEntries(states.map((s) => [s, states])) as { [K in S]: readonly S[] };

// ── platform / billing ──────────────────────────────────────────────────────────────────────────────────────────────
const SUB = ['trialing', 'active', 'past_due', 'unpaid', 'suspended', 'disabled', 'cancelled', 'expired'] as const;
/** tenant_ai_subscriptions.status — a salon's AI package. Super Admin may set any status (assign / update / cancel in
 *  modules/super-admin — the same machine), so every move is listed; the billing webhook additionally runs its own
 *  event table (applyAiBillingEvent) and writes conditionally on the status it read (a concurrent event loses, never
 *  overwrites). Shared: Super Admin's writers import this machine — one table per lifecycle. */
export const TENANT_AI_SUBSCRIPTION = defineStateMachine({
  name: 'tenant_ai_subscription', table: 'tenant_ai_subscriptions', column: 'status',
  states: ['trialing', 'active', 'past_due', 'unpaid', 'suspended', 'disabled', 'cancelled', 'expired'],
  transitions: ALL(SUB),
  initial: ['trialing', 'active'],
});

/** ai_prompt_versions.status — a rollback retires the ACTIVE version and activates the chosen one (any non-active). */
export const AI_PROMPT_VERSION = defineStateMachine({
  name: 'ai_prompt_version', table: 'ai_prompt_versions', column: 'status',
  states: ['DRAFT', 'TESTING', 'ACTIVE', 'DEPRECATED', 'ROLLED_BACK'],
  transitions: { DRAFT: ['ACTIVE'], TESTING: ['ACTIVE'], DEPRECATED: ['ACTIVE'], ROLLED_BACK: ['ACTIVE'], ACTIVE: ['ROLLED_BACK'] },
  initial: ['DRAFT', 'TESTING', 'ACTIVE'],
});

// ── Reception Copilot ───────────────────────────────────────────────────────────────────────────────────────────────
/** reception_copilot_sessions.status — active → ended. */
export const RECEPTION_COPILOT_SESSION = defineStateMachine({
  name: 'reception_copilot_session', table: 'reception_copilot_sessions', column: 'status',
  states: ['active', 'ended'], transitions: { active: ['ended'] }, initial: ['active'],
});
/** reception_copilot_learning_suggestions.status — open → approved | dismissed, once. The approval used to read the
 *  open row, write a knowledge version, then flip the status unconditionally: two approvals at once wrote two versions. */
export const RECEPTION_COPILOT_LEARNING = defineStateMachine({
  name: 'reception_copilot_learning', table: 'reception_copilot_learning_suggestions', column: 'status',
  states: ['open', 'approved', 'dismissed'], transitions: { open: ['approved', 'dismissed'] }, initial: ['open'],
});

// ── inventory / marketing / money protection ────────────────────────────────────────────────────────────────────────
/** inventory_service_recipes.status — draft → approved (the previously approved one for the same scope → archived). */
export const INVENTORY_SERVICE_RECIPE = defineStateMachine({
  name: 'inventory_service_recipe', table: 'inventory_service_recipes', column: 'status',
  states: ['draft', 'approved', 'archived'], transitions: { draft: ['approved', 'archived'], approved: ['archived'] }, initial: ['draft'],
});
/** ai_marketing_campaign_sends.status — the per-recipient ledger: queued → sent | skipped | failed, final (a late
 *  failure can no longer overwrite a recorded send). */
export const AI_MARKETING_CAMPAIGN_SEND = defineStateMachine({
  name: 'ai_marketing_campaign_send', table: 'ai_marketing_campaign_sends', column: 'status',
  states: ['queued', 'sent', 'skipped', 'failed', 'blocked'], transitions: { queued: ['sent', 'skipped', 'failed'] }, initial: ['queued', 'blocked'],
});
/** money_protection_investigations.status — the §37 table (STATUS_TRANSITIONS reads from here) plus OPEN → RESOLVED, the
 *  resolve route's own move. The resolve route used to write RESOLVED from ANY state: a resolved investigation could be
 *  resolved again (its recovery amount overwritten) and a CLOSED one revived — both now 409. */
export const MONEY_PROTECTION_INVESTIGATION = defineStateMachine({
  name: 'money_protection_investigation', table: 'money_protection_investigations', column: 'status',
  states: ['OPEN', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  transitions: {
    OPEN: ['INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    INVESTIGATING: ['WAITING_FOR_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    WAITING_FOR_INFORMATION: ['INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    ESCALATED: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'INVESTIGATING'],
    CLOSED: ['INVESTIGATING'],
  },
  initial: ['OPEN'],
});
/** money_protection_alerts.status — the only status write today: a new / acknowledged alert joins an investigation. */
export const MONEY_PROTECTION_ALERT = defineStateMachine({
  name: 'money_protection_alert', table: 'money_protection_alerts', column: 'status',
  // Money Protection guides (Nov 3 2026): a person acknowledges, dismisses (reason) or reopens (reason) an alert — money-protection-center
  states: ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED', 'DISMISSED_FALSE_POSITIVE',
    'RESOLVED_EXPECTED_ACTIVITY', 'RESOLVED_SYSTEM_ERROR', 'RESOLVED_POLICY_VIOLATION', 'RESOLVED_CONFIRMED_MISUSE', 'CLOSED'],
  transitions: {
    NEW: ['ACKNOWLEDGED', 'INVESTIGATING', 'DISMISSED_FALSE_POSITIVE'], ACKNOWLEDGED: ['INVESTIGATING', 'DISMISSED_FALSE_POSITIVE'],
    INVESTIGATING: ['DISMISSED_FALSE_POSITIVE'], WAITING_FOR_INFORMATION: ['DISMISSED_FALSE_POSITIVE'], ESCALATED: ['DISMISSED_FALSE_POSITIVE'],
    DISMISSED_FALSE_POSITIVE: ['ACKNOWLEDGED'], RESOLVED_EXPECTED_ACTIVITY: ['ACKNOWLEDGED'], RESOLVED_SYSTEM_ERROR: ['ACKNOWLEDGED'],
    RESOLVED_POLICY_VIOLATION: ['ACKNOWLEDGED'], RESOLVED_CONFIRMED_MISUSE: ['ACKNOWLEDGED'], CLOSED: ['ACKNOWLEDGED'],
  }, initial: ['NEW'],
});

// ── queue assignment / review & reputation ──────────────────────────────────────────────────────────────────────────
/** queue_alerts.status — open → acknowledged → resolved (staff or the scan's auto-resolve); resolved is final. */
export const QUEUE_ALERT = defineStateMachine({
  name: 'queue_alert', table: 'queue_alerts', column: 'status',
  states: ['open', 'acknowledged', 'resolved'], transitions: { open: ['acknowledged', 'resolved'], acknowledged: ['resolved'] }, initial: ['open'],
});
/** review_escalations.status — the ESC_LEGAL table (ai-review-reputation-recovery reads from here). */
export const REVIEW_ESCALATION = defineStateMachine({
  name: 'review_escalation', table: 'review_escalations', column: 'status',
  states: ['open', 'acknowledged', 'resolved'], transitions: { open: ['acknowledged', 'resolved'], acknowledged: ['resolved'] }, initial: ['open'],
});

// ── scheduling optimizer ────────────────────────────────────────────────────────────────────────────────────────────
const REC_STATES: readonly RecState[] = ['generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'rejected', 'needs_revision',
  'customer_approval_required', 'customer_approved', 'application_pending', 'applied', 'application_failed', 'expired', 'superseded', 'rolled_back'];
const REC_EVENTS: readonly RecEvent[] = ['submit_for_review', 'start_review', 'accept', 'partial_accept', 'reject', 'return', 'customer_approve', 'customer_reject',
  'queue_application', 'apply_ok', 'apply_fail', 'retry', 'rollback', 'expire', 'supersede'];
/** The state-level moves of the recommendation workflow (ai-scheduling-workflow TABLE): every single event, the composite
 *  staff decision (a stored row is carried through submit / start_review to the decision in ONE conditional update),
 *  and the automation's direct apply of a safe, appointment-free recommendation (generated / review_required → applied),
 *  and apply's re-claim of a still-pending application. */
function recMoves(): Record<string, RecState[]> {
  const out: Record<string, Set<RecState>> = {};
  const add = (from: RecState, to: RecState) => { (out[from] ??= new Set()).add(to); };
  for (const s of REC_STATES) for (const e of REC_EVENTS) for (const rc of [true, false]) { const t = recTransition(s, e, { requiresCustomerApproval: rc }); if (t.ok) add(s, t.state); }
  for (const s of ['generated', 'needs_revision', 'review_required'] as RecState[]) {
    const pre: RecEvent[] = s === 'review_required' ? ['start_review'] : ['submit_for_review', 'start_review'];
    for (const action of ['accept', 'partial_accept', 'reject', 'return'] as RecEvent[]) for (const rc of [true, false]) {
      let cur: RecState = s; let ok = true;
      for (const ev of [...pre, action]) { const t = recTransition(cur, ev, { requiresCustomerApproval: rc }); if (!t.ok) { ok = false; break; } cur = t.state; }
      if (ok) add(s, cur);
    }
  }
  add('generated', 'applied'); add('review_required', 'applied');
  add('application_pending', 'application_pending');   // apply re-claims a pending application (a new attempt) in one conditional update
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}
export const SCHEDULE_RECOMMENDATION = defineStateMachine({
  name: 'schedule_recommendation', table: 'schedule_optimization_recommendations', column: 'status',
  states: ['generated', 'review_required', 'review_in_progress', 'accepted', 'partially_accepted', 'rejected', 'needs_revision',
    'customer_approval_required', 'customer_approved', 'application_pending', 'applied', 'application_failed', 'expired', 'superseded', 'rolled_back'],
  transitions: recMoves(),
  initial: ['generated', 'review_required'],
});
/** schedule_change_applications.status — one apply attempt: pending → applied | failed | stale; an applied one may be rolled back. */
export const SCHEDULE_CHANGE_APPLICATION = defineStateMachine({
  name: 'schedule_change_application', table: 'schedule_change_applications', column: 'status',
  states: ['pending', 'applied', 'failed', 'stale', 'rolled_back'], transitions: { pending: ['applied', 'failed', 'stale'], applied: ['rolled_back'] }, initial: ['pending'],
});
/** schedule_change_proposals.status — the customer proposal: live (proposed / customer_notified) → notified again, decided,
 *  expired or withdrawn; an approved one is applied. */
export const SCHEDULE_CHANGE_PROPOSAL = defineStateMachine({
  name: 'schedule_change_proposal', table: 'schedule_change_proposals', column: 'status',
  states: ['proposed', 'customer_notified', 'customer_approved', 'customer_rejected', 'expired', 'withdrawn', 'applied'],
  transitions: {
    proposed: ['customer_notified', 'customer_approved', 'customer_rejected', 'expired', 'withdrawn'],
    customer_notified: ['customer_notified', 'customer_approved', 'customer_rejected', 'expired', 'withdrawn'],
    customer_approved: ['applied'],
  },
  initial: ['proposed'],
});
/** schedule_optimization_runs.status — started → completed | failed. */
export const SCHEDULE_OPTIMIZATION_RUN = defineStateMachine({
  name: 'schedule_optimization_run', table: 'schedule_optimization_runs', column: 'status',
  states: ['started', 'completed', 'failed'], transitions: { started: ['completed', 'failed'] }, initial: ['started'],
});
/** technician_time_off.status — ONE machine, owned by modules/workforce since the time-off request workflow (582, merge
 *  Oct 12 2026: pending → approved | rejected | cancelled; approved → cancelled). Re-exported here for the optimizer. */
export { TECHNICIAN_TIME_OFF } from '@aipowersalon/workforce';
/** the three insight tables share one lifecycle shape (approval required): review_required → approved | rejected |
 *  superseded (a newer insight); an approved duration is superseded by the next approved one. */
export const SERVICE_DURATION_RECOMMENDATION = defineStateMachine({
  name: 'service_duration_recommendation', table: 'service_duration_recommendations', column: 'status',
  states: ['review_required', 'approved', 'rejected', 'superseded'], transitions: { review_required: ['approved', 'rejected', 'superseded'], approved: ['superseded'] }, initial: ['review_required'],
});
export const STAFFING_COVERAGE_RECOMMENDATION = defineStateMachine({
  name: 'staffing_coverage_recommendation', table: 'staffing_coverage_recommendations', column: 'status',
  states: ['review_required', 'approved', 'rejected', 'superseded'], transitions: { review_required: ['approved', 'rejected', 'superseded'] }, initial: ['review_required'],
});
export const APPOINTMENT_AVAILABILITY_RECOMMENDATION = defineStateMachine({
  name: 'appointment_availability_recommendation', table: 'appointment_availability_recommendations', column: 'status',
  states: ['review_required', 'approved', 'rejected', 'superseded'], transitions: { review_required: ['approved', 'rejected', 'superseded'] }, initial: ['review_required'],
});

// ── voice: transcription, call intelligence, receptionist ──────────────────────────────────────────────────────────
const TRANSCRIPT_LIVE = ['queued', 'processing', 'completed', 'partial', 'low_confidence', 'manual_review_required', 'failed', 'provider_error',
  'audio_unavailable', 'consent_declined', 'consent_missing', 'recording_disabled', 'transcription_disabled'] as const;
/** call_transcripts.status — a re-ingest may move a live transcript to any ingest outcome (as before); a DELETED (or
 *  retention-expired) transcript is final. The ingest upsert used to overwrite any status: a provider webhook replayed
 *  after a deletion revived the transcript and re-wrote its segments — now refused. */
export const CALL_TRANSCRIPT = defineStateMachine({
  name: 'call_transcript', table: 'call_transcripts', column: 'status',
  states: ['queued', 'processing', 'completed', 'partial', 'low_confidence', 'manual_review_required', 'failed', 'provider_error',
    'audio_unavailable', 'consent_declined', 'consent_missing', 'recording_disabled', 'transcription_disabled', 'retention_expired', 'deleted'],
  transitions: { ...Object.fromEntries(TRANSCRIPT_LIVE.map((s) => [s, [...TRANSCRIPT_LIVE, 'deleted', 'retention_expired']])), retention_expired: ['deleted'] },
  initial: ['queued', 'processing'],
});
const REDACTION = ['pending', 'processing', 'completed', 'failed', 'not_required'] as const;
/** call_transcripts.redaction_status — re-ingest / re-redaction may move it freely (today's behaviour), conditionally. */
export const CALL_TRANSCRIPT_REDACTION = defineStateMachine({
  name: 'call_transcript_redaction', table: 'call_transcripts', column: 'redaction_status',
  states: ['pending', 'processing', 'completed', 'failed', 'not_required'], transitions: ALL(REDACTION), initial: ['pending', 'not_required'],
});
const CONSENT = ['unknown', 'granted', 'declined', 'not_required'] as const;
/** call_consent_records.consent_status — the provider's latest consent evidence for the call replaces the earlier one. */
export const CALL_CONSENT = defineStateMachine({
  name: 'call_consent', table: 'call_consent_records', column: 'consent_status',
  states: ['unknown', 'granted', 'declined', 'not_required'], transitions: ALL(CONSENT), initial: ['unknown', 'granted', 'declined', 'not_required'],
});
const CALL_EVENT = ['answered_ai', 'answered_human', 'missed', 'voicemail'] as const;
/** call_intelligence_events.status — the provider's latest report of how the call ended replaces the earlier one. */
export const CALL_INTELLIGENCE_EVENT = defineStateMachine({
  name: 'call_intelligence_event', table: 'call_intelligence_events', column: 'status',
  states: ['answered_ai', 'answered_human', 'missed', 'voicemail'], transitions: ALL(CALL_EVENT), initial: ['answered_ai', 'answered_human', 'missed', 'voicemail'],
});
/** ai_receptionist_agents.status — canTransitionAgent's table (it reads from here) plus provisioning's move to ready
 *  (from any non-archived state, re-provisioning included). Provisioning used to flip an ARCHIVED agent back to ready.
 *  AI Front Desk guide (Oct 31 2026): paused → live is the owner-approved RESUME (full activation gates) and archived → draft
 *  is RESTORE; both happen only in front-desk-center.ts — canTransitionAgent (the plain status route) refuses every move
 *  into or out of live and out of archived. */
export const AI_RECEPTIONIST_AGENT = defineStateMachine({
  name: 'ai_receptionist_agent', table: 'ai_receptionist_agents', column: 'status',
  states: ['draft', 'ready', 'live', 'paused', 'error', 'archived'],
  transitions: {
    draft: ['paused', 'archived', 'ready'],
    ready: ['paused', 'archived', 'live', 'ready'],
    live: ['paused', 'archived', 'ready'],
    paused: ['draft', 'archived', 'ready', 'live'],
    error: ['draft', 'archived', 'ready'],
    archived: ['draft'],
  },
  initial: ['draft'],
});
/** ai_receptionist_follow_ups.status — STATUS_FLOW (ai-follow-up.service reads from here). Assigning used to force
 *  'assigned' from ANY status — re-opening a closed follow-up; it now moves the status only where the table allows. */
export const AI_RECEPTIONIST_FOLLOW_UP = defineStateMachine({
  name: 'ai_receptionist_follow_up', table: 'ai_receptionist_follow_ups', column: 'status',
  states: ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed'],
  transitions: {
    open: ['assigned', 'in_progress', 'waiting', 'resolved', 'closed'],
    assigned: ['in_progress', 'waiting', 'resolved', 'closed', 'open'],
    in_progress: ['waiting', 'resolved', 'closed', 'assigned'],
    waiting: ['in_progress', 'resolved', 'closed'],
    resolved: ['closed', 'open', 'in_progress'],   // AI Follow-Ups guide §10: reopen to Open or In Progress, with a reason
  },
  initial: ['open'],
});

/** ai_billing_reconciliation_runs.status (migration 728) — one read-only re-read of the provider: running → succeeded |
 *  partial | failed, once. Refused: re-finishing a finished run (a duplicate request returns the first run instead). */
export const AI_BILLING_RECONCILIATION_RUN = defineStateMachine({
  name: 'ai_billing_reconciliation_run', table: 'ai_billing_reconciliation_runs', column: 'status',
  states: ['running', 'succeeded', 'partial', 'failed'],
  transitions: { running: ['succeeded', 'partial', 'failed'] },
  initial: ['running'],
});

/** birthday_message_claims.status (migration 750, Birthday Campaigns guide) — one birthday message per customer per year per
 *  channel: claimed (the send worker owns it) → sent | released (a provider failure before any send gives it back); a released
 *  claim may be claimed again by a later campaign. Refused: un-sending a sent claim, or re-claiming a live one. */
export const BIRTHDAY_MESSAGE_CLAIM = defineStateMachine({
  name: 'birthday_message_claim', table: 'birthday_message_claims', column: 'status',
  states: ['claimed', 'sent', 'released'],
  transitions: { claimed: ['sent', 'released'], released: ['claimed'] },
  initial: ['claimed'],
});

// AI Business Setup guide (Oct 31 2026): an AI receptionist FAQ. Only 'approved' is AI-servable (its approved revision).
// An edit of an approved FAQ is a pending draft REVISION (draft_revision_id), not a status change — the live text stays.
// Reject sends a submitted FAQ to needs_review; archive keeps every revision and event; restore never re-publishes by
// itself (archived → needs_review when it had an approved text, else → draft).
export const AI_RECEPTIONIST_FAQ = defineStateMachine({
  name: 'ai_receptionist_faq', table: 'ai_receptionist_faqs', column: 'status',
  states: ['draft', 'pending_review', 'approved', 'needs_review', 'archived'],
  transitions: {
    draft: ['pending_review', 'approved', 'archived'],
    pending_review: ['approved', 'needs_review', 'archived'],
    needs_review: ['pending_review', 'approved', 'archived'],
    approved: ['archived'],
    archived: ['draft', 'needs_review'],
  },
  initial: ['draft'],
});

/** AI Receptionist guide §12 (Oct 31 2026): an approval-gated worklist action. Front Desk prepares (awaiting confirmation);
 *  an owner/manager confirms → executing → confirmed (backend result recorded) or failed; cancel/expire end it. A
 *  recommendation is never shown as executed until the backend confirms. */
// AI Calls guide (Oct 31 2026): one tool request the voice agent made. 'requested' is written BEFORE the tool runs; the
// result is recorded separately — a request is not a success, and a successful tool is not a confirmed booking.
export const VOICE_TOOL_EXECUTION = defineStateMachine({
  name: 'voice_tool_execution', table: 'voice_tool_executions', column: 'status',
  states: ['requested', 'refused', 'succeeded', 'failed'],
  transitions: { requested: ['refused', 'succeeded', 'failed'] },
  initial: ['requested'],
});

export const AI_RECEPTIONIST_ACTION = defineStateMachine({
  name: 'ai_receptionist_action', table: 'ai_receptionist_actions', column: 'status',
  states: ['recommended', 'prepared', 'awaiting_confirmation', 'executing', 'confirmed', 'failed', 'cancelled', 'expired'],
  transitions: {
    recommended: ['prepared', 'cancelled'],
    prepared: ['awaiting_confirmation', 'cancelled', 'expired'],
    awaiting_confirmation: ['executing', 'cancelled', 'expired'],
    executing: ['confirmed', 'failed'],
  },
  initial: ['recommended', 'prepared', 'awaiting_confirmation'],
});

/** Reception Copilot guide (migration 757): a confirmed Copilot action claims its idempotency key BEFORE the booking /
 *  messaging service runs ('pending'), then records the true outcome. 'unknown' = the call threw after it may have
 *  reached the provider/domain — never retried automatically, never shown as success. */
export const RECEPTION_COPILOT_ACTION = defineStateMachine({
  name: 'reception_copilot_action', table: 'reception_copilot_action_ledger', column: 'state',
  states: ['pending', 'succeeded', 'failed', 'unknown'],
  transitions: { pending: ['succeeded', 'failed', 'unknown'] },
  initial: ['pending'],
});

/** service_recommendations.status (766) — a suggestion is OPEN while the latest scan still produces it; a scan that no
 *  longer produces it SUPERSEDES it; when it returns it is open again (with a new generated date). The rescan's upsert
 *  refreshes an open one in place (open → open). */
export const SERVICE_RECOMMENDATION = defineStateMachine({
  name: 'service_recommendation', table: 'service_recommendations', column: 'status',
  states: ['open', 'superseded'],
  transitions: { open: ['open', 'superseded'], superseded: ['open'] },
  initial: ['open'],
});

/** A scan / detection run: running → completed (or succeeded) | failed. One per table, written by its own center. */
export const CUSTOMER_INTELLIGENCE_SCAN = defineStateMachine({
  name: 'customer_intelligence_scan', table: 'customer_intelligence_scans', column: 'status',
  states: ['running', 'completed', 'failed'], transitions: { running: ['completed', 'failed'] }, initial: ['running'],
});
export const SERVICE_RECOMMENDATION_SCAN = defineStateMachine({
  name: 'service_recommendation_scan', table: 'service_recommendation_scans', column: 'status',
  states: ['running', 'completed', 'failed'], transitions: { running: ['completed', 'failed'] }, initial: ['running'],
});
export const MONEY_PROTECTION_RUN = defineStateMachine({
  name: 'money_protection_run', table: 'money_protection_detection_runs', column: 'status',
  states: ['running', 'succeeded', 'failed'], transitions: { running: ['succeeded', 'failed'] }, initial: ['running'],
});
/** A manager's review mark on a customer / suggestion (reviewed, deferred, not applicable): any mark may replace any other. */
const REVIEW = ['reviewed', 'deferred'] as const;
export const CHURN_WATCH_REVIEW = defineStateMachine({
  name: 'churn_watch_review', table: 'churn_watch_reviews', column: 'status', states: ['reviewed', 'deferred'], transitions: ALL(REVIEW), initial: ['reviewed', 'deferred'],
});
export const REBOOKING_REVIEW = defineStateMachine({
  name: 'rebooking_review', table: 'rebooking_reviews', column: 'status', states: ['reviewed', 'deferred'], transitions: ALL(REVIEW), initial: ['reviewed', 'deferred'],
});
const SR_REVIEW = ['reviewed', 'deferred', 'not_applicable'] as const;
export const SERVICE_RECOMMENDATION_REVIEW = defineStateMachine({
  name: 'service_recommendation_review', table: 'service_recommendation_reviews', column: 'status',
  states: ['reviewed', 'deferred', 'not_applicable'], transitions: ALL(SR_REVIEW), initial: ['reviewed', 'deferred', 'not_applicable'],
});
