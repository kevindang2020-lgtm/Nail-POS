// communications-lifecycles.ts — BUILD_PLAN Phase 12 / Constitution 5 §74–§78 (#27): the communications module's status
// lifecycles, ONE transition table each, used by every writer (transitionStatus for one row, canMoveToSql for a sweep /
// raw-SQL write). The campaign and platform-announcement tables are the ones their services already enforced
// (campaigns.dto canTransition / platform-announcement-core canTransition now read these machines — one table, not two).
// Deliberate refusals (each was allowed by an unconditional write before):
//   • notification: a late / out-of-order provider callback can no longer move a DELIVERED or FAILED message back to
//     `sent` (the Twilio status callback overwrote whatever arrived last);
//   • campaign_compliance_flag: a resolved flag (cleared / actioned) is not re-resolved the other way;
//   • service_follow_up_task: a SENT follow-up can no longer be marked skipped / dismissed / not-available by a write
//     that raced the send (the services checked a stale read, the update had no status condition);
//   • message_templates: an ARCHIVED template head is not re-published.
import { defineStateMachine } from '@aipowersalon/database';

export const CAMPAIGN = defineStateMachine({
  name: 'campaign', table: 'campaigns', column: 'status',
  states: ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'],
  transitions: { draft: ['scheduled', 'in_progress', 'cancelled'], scheduled: ['in_progress', 'draft', 'cancelled'], in_progress: ['completed', 'cancelled'] },
  initial: ['draft', 'scheduled'],
});

export const PLATFORM_ANNOUNCEMENT = defineStateMachine({
  name: 'platform_announcement', table: 'platform_announcements', column: 'status',
  states: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'],
  transitions: { draft: ['scheduled', 'sending', 'cancelled'], scheduled: ['sending', 'cancelled', 'draft'], sending: ['sent', 'cancelled'] },
  initial: ['draft', 'scheduled'],
});

/** campaign_templates.status — publish (draft / published → published); a new version keeps the status (self-move). */
export const CAMPAIGN_TEMPLATE = defineStateMachine({
  name: 'campaign_template', table: 'campaign_templates', column: 'status',
  states: ['draft', 'published', 'archived'],
  transitions: { draft: ['draft', 'published', 'archived'], published: ['published', 'archived'], archived: ['archived'] },
  initial: ['draft'],
});

export const CAMPAIGN_COMPLIANCE_FLAG = defineStateMachine({
  name: 'campaign_compliance_flag', table: 'campaign_compliance_flags', column: 'status',
  states: ['open', 'reviewing', 'cleared', 'actioned'],
  transitions: { open: ['reviewing', 'cleared', 'actioned'], reviewing: ['cleared', 'actioned'] },
  initial: ['open'],
});

/** tenant_messaging_limits.status — a Super Admin switch (active ↔ suspended), written by an upsert. */
export const TENANT_MESSAGING_LIMIT = defineStateMachine({
  name: 'tenant_messaging_limit', table: 'tenant_messaging_limits', column: 'status',
  states: ['active', 'suspended'], transitions: { active: ['active', 'suspended'], suspended: ['active', 'suspended'] }, initial: ['active', 'suspended'],
});

/** communication_providers.status — set by the Super Admin config and by the health check; every state may follow every
 *  other (an operational status, not a one-way lifecycle) — the machine makes the vocabulary and the writers explicit. */
const PROVIDER_STATES = ['test', 'active', 'degraded', 'down', 'misconfigured', 'inactive', 'suspended'] as const;
export const COMMUNICATION_PROVIDER = defineStateMachine({
  name: 'communication_provider', table: 'communication_providers', column: 'status',
  states: ['test', 'active', 'degraded', 'down', 'misconfigured', 'inactive', 'suspended'],
  transitions: Object.fromEntries(PROVIDER_STATES.map((s) => [s, [...PROVIDER_STATES]])) as any,
  initial: ['test'],
});

/** message_template_versions.status — append-only versions: a draft is published; publishing another retires it. */
export const MESSAGE_TEMPLATE_VERSION = defineStateMachine({
  name: 'message_template_version', table: 'message_template_versions', column: 'status',
  states: ['draft', 'pending_review', 'published', 'retired'],
  transitions: { draft: ['published'], pending_review: ['published'], published: ['retired'] },
  initial: ['draft'],
});
export const MESSAGE_TEMPLATE = defineStateMachine({
  name: 'message_template', table: 'message_templates', column: 'status',
  states: ['draft', 'pending_review', 'published', 'retired', 'archived'],
  transitions: { draft: ['published'], pending_review: ['published'], published: ['published'], retired: ['published'] },
  initial: ['draft'],
});

/** communication_threads.status — staff set a thread's status from the inbox; any state may follow any other (reopen). */
const THREAD_STATES = ['open', 'pending', 'replied', 'missed', 'closed'] as const;
export const COMMUNICATION_THREAD = defineStateMachine({
  name: 'communication_thread', table: 'communication_threads', column: 'status',
  states: ['open', 'pending', 'replied', 'missed', 'closed'],
  transitions: Object.fromEntries(THREAD_STATES.map((s) => [s, [...THREAD_STATES]])) as any,
  initial: ['open'],
});

/** communication_messages.status — Communications / SMS Inbox guide (Oct 30 2026, migration 730): a staff reply is RESERVED as
 *  `pending` before the provider call, then becomes `sent` (handed off), `failed` or `blocked` (refused before any provider
 *  call); delivery itself is read from the SMS ledger, never written here. An inbound text is written as `delivered`. */
export const COMMUNICATION_MESSAGE = defineStateMachine({
  name: 'communication_message', table: 'communication_messages', column: 'status',
  states: ['pending', 'sent', 'delivered', 'read', 'failed', 'blocked'],
  transitions: { pending: ['sent', 'failed', 'blocked'], sent: ['delivered', 'read', 'failed'], delivered: ['read'] },
  initial: ['pending', 'sent', 'delivered'],
});

/** service_follow_up_tasks.status — the end-of-day follow-up (end-of-day-followups.service). */
export const FOLLOW_UP_TASK = defineStateMachine({
  name: 'service_follow_up_task', table: 'service_follow_up_tasks', column: 'status',
  // 'rejected' (migration 745, EOD guide §9): a manager refused the draft — the technician may edit and resubmit. Every
  // UNSENT state (pending / awaiting approval / rejected) can expire; expiry keeps the row (no deleted_at, no purge).
  states: ['pending', 'pending_manager_approval', 'rejected', 'customer_not_available', 'skipped', 'dismissed', 'expired', 'sent', 'customer_replied', 'rebooked', 'failed'],
  transitions: {
    pending: ['pending_manager_approval', 'sent', 'customer_not_available', 'skipped', 'dismissed', 'expired'],
    pending_manager_approval: ['pending_manager_approval', 'rejected', 'sent', 'customer_not_available', 'skipped', 'dismissed', 'expired'],
    rejected: ['pending_manager_approval', 'skipped', 'dismissed', 'expired'],
    customer_not_available: ['pending_manager_approval', 'sent', 'customer_not_available', 'skipped', 'dismissed'],
    skipped: ['pending_manager_approval', 'sent', 'customer_not_available', 'skipped', 'dismissed'],
    dismissed: ['skipped', 'dismissed'],
    sent: ['customer_replied'],
    customer_replied: ['customer_replied'],
    rebooked: ['customer_replied'],
  },
  initial: ['pending'],
});

/** daily_follow_up_generation_runs.run_status — one run row per branch-day, re-run by the scheduler or a manager. */
export const FOLLOW_UP_GENERATION_RUN = defineStateMachine({
  name: 'follow_up_generation_run', table: 'daily_follow_up_generation_runs', column: 'run_status',
  states: ['started', 'completed', 'failed'],
  transitions: { started: ['completed', 'failed'], completed: ['completed', 'failed'], failed: ['completed', 'failed'] },
  initial: ['started', 'completed', 'failed'],
});

/** notifications.status — provider delivery: sent → delivered / failed; a repeat callback is a no-op self-move.
 *  'simulated' (P-11, migration 663): the development mock's "send" — terminal, no provider will ever call back. */
export const NOTIFICATION = defineStateMachine({
  name: 'notification', table: 'notifications', column: 'status',
  states: ['sent', 'delivered', 'failed', 'blocked', 'simulated'],
  transitions: { sent: ['sent', 'delivered', 'failed'], delivered: ['delivered'], failed: ['failed'] },
  initial: ['sent', 'failed', 'blocked', 'simulated'],
});

export const SMS_RECONCILIATION_FINDING = defineStateMachine({
  name: 'sms_reconciliation_finding', table: 'sms_reconciliation_findings', column: 'status',
  states: ['open', 'resolved', 'dismissed'], transitions: { open: ['resolved', 'dismissed'] }, initial: ['open'],
});

/** tenant_messaging_credentials.status — saved credentials are `configured`; a save re-validates (self-move). */
export const TENANT_MESSAGING_CREDENTIALS = defineStateMachine({
  name: 'tenant_messaging_credentials', table: 'tenant_messaging_credentials', column: 'status',
  states: ['not_configured', 'configured'],
  transitions: { not_configured: ['configured', 'not_configured'], configured: ['configured', 'not_configured'] },
  initial: ['configured', 'not_configured'],
});

/** wave 3 PAYI §59 (migration 639): tenant_messaging_numbers.status. Re-registering your own number re-activates it
 *  (active → active, released / suspended → active); a released number is never handed to another salon (the service
 *  refuses that before any write — one salon per number). */
export const TENANT_MESSAGING_NUMBER = defineStateMachine({
  name: 'tenant_messaging_number', table: 'tenant_messaging_numbers', column: 'status',
  states: ['pending', 'active', 'suspended', 'released'],
  transitions: { pending: ['active', 'suspended', 'released'], active: ['active', 'suspended', 'released'], suspended: ['active', 'released'], released: ['active'] },
  initial: ['pending', 'active'],
});

/** sms_test_events.status (migration 721, state-machine sweep Oct 30 2026): one Test SMS. Inserted 'sending'; the send
 *  moves it to accepted (Twilio took it) or rejected (refused / token unreadable); signed status callbacks then move it
 *  forward only. Deliberate refusals (the callback writer already refused these with a hand-written WHERE — now the
 *  machine says it): a final state (delivered / failed / undelivered / rejected) is never overwritten by a late or
 *  out-of-order callback, and a 'sent' test never falls back to 'accepted' (a late queued/sending callback). */
export const SMS_TEST_EVENT = defineStateMachine({
  name: 'sms_test_event', table: 'sms_test_events', column: 'status',
  states: ['sending', 'accepted', 'sent', 'delivered', 'failed', 'undelivered', 'rejected'],
  transitions: {
    sending: ['accepted', 'rejected', 'sent', 'delivered', 'failed', 'undelivered'],
    accepted: ['accepted', 'sent', 'delivered', 'failed', 'undelivered'],
    sent: ['sent', 'delivered', 'failed', 'undelivered'],
  },
  initial: ['sending'],
});

/** tenant_number_purchase_quotes.result_status (migrations 721 + 731): a confirmed purchase's outcome, written ONCE.
 *  quoted → purchased | failed. Deliberate refusal: a finished outcome is never overwritten (before, a second write of
 *  the result had no status condition; the consumed_at claim made it unlikely, the machine makes it impossible). */
export const TENANT_NUMBER_PURCHASE_QUOTE = defineStateMachine({
  name: 'tenant_number_purchase_quote', table: 'tenant_number_purchase_quotes', column: 'result_status',
  states: ['quoted', 'purchased', 'failed'],
  transitions: { quoted: ['purchased', 'failed'] },
  initial: ['quoted'],
});

/** pos_message_templates.status (740, Message Templates & Automation Center guide §06): the salon's own templates.
 *  draft → active (activation validation passed) · active ⇄ inactive · draft/active/inactive → archived · archived → inactive
 *  (restore; it must be activated again on purpose). Only ACTIVE templates are offered for new sending (Inbox composer,
 *  automation bindings); archived ones stay readable for history. A self-move (active → active) is an edit of an active
 *  template — a new version, same status. Deactivating / archiving a template an ACTIVE automation uses is refused by the
 *  service unless a replacement is chosen (guide §14). */
export const SALON_MESSAGE_TEMPLATE = defineStateMachine({
  name: 'salon_message_template', table: 'pos_message_templates', column: 'status',
  states: ['draft', 'active', 'inactive', 'archived'],
  transitions: { draft: ['draft', 'active', 'archived'], active: ['active', 'inactive', 'archived'], inactive: ['inactive', 'active', 'archived'], archived: ['inactive'] },
  initial: ['draft', 'active'],
});

/** pos_message_template_tests.status (740): one confirmed Test Send. submitting → submitted | simulated | blocked | failed,
 *  written ONCE after the provider answers (the idempotency key reserves the row first; a retry returns the same row). The
 *  delivery result after submission is read from the notifications row (provider callbacks), never written here. */
export const MESSAGE_TEMPLATE_TEST = defineStateMachine({
  name: 'message_template_test', table: 'pos_message_template_tests', column: 'status',
  states: ['submitting', 'submitted', 'simulated', 'blocked', 'failed'],
  transitions: { submitting: ['submitted', 'simulated', 'blocked', 'failed'] },
  initial: ['submitting'],
});

/** appointment_reminders_sent.state (747) — one reminder occurrence (appointment × rung × appointment time). Claimed
 *  atomically BEFORE the provider call; submitted = the provider accepted it (sent / delivered come from the provider's
 *  own status on the linked notification). failed → claimed is the guarded retry (automatic for transient reasons, or a
 *  staff retry); deferred → claimed when quiet hours end; skipped → claimed only for a staff retry after the cause was
 *  fixed (e.g. a phone added) — never for an opt-out. submitted is terminal: nothing ever re-sends a submitted reminder. */
export const REMINDER_DISPATCH = defineStateMachine({
  name: 'reminder_dispatch', table: 'appointment_reminders_sent', column: 'state',
  states: ['claimed', 'submitted', 'failed', 'skipped', 'cancelled', 'deferred'],
  transitions: { claimed: ['submitted', 'failed', 'skipped', 'cancelled'], failed: ['claimed', 'cancelled'], deferred: ['claimed', 'cancelled', 'skipped'], skipped: ['claimed'] },
  initial: ['claimed', 'skipped', 'cancelled', 'deferred'],
});
