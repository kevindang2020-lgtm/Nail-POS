// platform-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the platform module's status lifecycles as ONE state machine each
// (packages/database/src/state-machine.ts). Every writer of these columns — here AND in modules/super-admin (Billing &
// Subscriptions writes the same subscription rows) — goes through the machine: canMoveToSql(M, to) in the UPDATE (the
// conditional update: a row in any other state is not moved) or assertTransition / transitionStatus for a dynamic target.
// Each table reproduces the moves the code made before Phase 12 (derived from every writer); the few it now refuses are
// listed on the machine.
import { defineStateMachine } from '@aipowersalon/database';
import { RULE_FLOW } from './super-admin-automation/automation-core';

/** platform_approvals (maker/checker): pending → approved → executed | failed; pending → rejected | expired. */
export const PLATFORM_APPROVAL = defineStateMachine({
  name: 'platform_approval', table: 'platform_approvals', column: 'status',
  states: ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed', 'cancelled'],
  transitions: { pending: ['approved', 'rejected', 'expired'], approved: ['executed', 'failed'] },
  initial: ['pending'],
});

/** automation_rules — exactly RULE_FLOW (automation-core), which setStatus has always checked; now the write is
 *  conditional on the state it read, so two concurrent status changes cannot both land. */
export const AUTOMATION_RULE = defineStateMachine({
  name: 'automation_rule', table: 'automation_rules', column: 'status',
  states: ['draft', 'pending_review', 'approved', 'active', 'paused', 'disabled', 'error', 'retired', 'archived'],
  transitions: RULE_FLOW,
  initial: ['draft'],
});

/** automation_failures: retried (temporary failures only — the service checks) from any state but resolved. */
export const AUTOMATION_FAILURE = defineStateMachine({
  name: 'automation_failure', table: 'automation_failures', column: 'status',
  states: ['waiting', 'retrying', 'resolved', 'abandoned'],
  transitions: { waiting: ['retrying'], retrying: ['retrying'], abandoned: ['retrying'] },
  initial: ['waiting'],
});

/** automation_executions: the engine inserts the row (idempotency claim) as 'success' and finalizes it once — to
 *  success / failed / suppressed. A finalized row is never re-finalized by another engine pass (the conditional update). */
export const AUTOMATION_EXECUTION = defineStateMachine({
  name: 'automation_execution', table: 'automation_executions', column: 'status',
  states: ['success', 'failed', 'suppressed', 'skipped'],
  transitions: { success: ['success', 'failed', 'suppressed'] },
  initial: ['success', 'skipped'],
});

/** platform_features (feature registry §33): an admin moves a feature between the four ordinary states; EMERGENCY_DISABLED
 *  belongs to the kill-switch centre and is neither entered nor left here. */
const FEATURE_ORDINARY = ['AVAILABLE', 'BETA', 'DISABLED', 'DEPRECATED'] as const;
export const PLATFORM_FEATURE = defineStateMachine({
  name: 'platform_feature', table: 'platform_features', column: 'status',
  states: ['AVAILABLE', 'BETA', 'DISABLED', 'DEPRECATED', 'EMERGENCY_DISABLED'],
  transitions: Object.fromEntries(FEATURE_ORDINARY.map((s) => [s, FEATURE_ORDINARY.filter((t) => t !== s)])),
});

/** subscription_plan_versions: a pricing change supersedes the active version (a new active one is inserted). */
export const SUBSCRIPTION_PLAN_VERSION = defineStateMachine({
  name: 'subscription_plan_version', table: 'subscription_plan_versions', column: 'status',
  states: ['scheduled', 'active', 'superseded'],
  transitions: { scheduled: ['active', 'superseded'], active: ['superseded'] },
  initial: ['active', 'scheduled'],
});

/** tenant_subscriptions — written by Plans (a plan change makes the subscription active) and by Billing & Subscriptions
 *  (pause / resume / cancel / renewal / request review / the admin status edit). Today's moves, minus the no-op
 *  self-moves the code used to re-write (cancelling an already-cancelled subscription, pausing a paused one): those are
 *  now refused with 409 instead of re-stamping the dates. */
export const TENANT_SUBSCRIPTION = defineStateMachine({
  name: 'tenant_subscription', table: 'tenant_subscriptions', column: 'status',
  states: ['active', 'trialing', 'past_due', 'paused', 'pending_cancellation', 'cancelled', 'expired'],
  transitions: {
    active: ['trialing', 'past_due', 'paused', 'pending_cancellation', 'cancelled', 'expired'],
    trialing: ['active', 'past_due', 'paused', 'pending_cancellation', 'cancelled', 'expired'],
    past_due: ['active', 'trialing', 'paused', 'pending_cancellation', 'cancelled', 'expired'],
    paused: ['active', 'trialing', 'past_due', 'pending_cancellation', 'cancelled', 'expired'],
    pending_cancellation: ['active', 'trialing', 'past_due', 'cancelled', 'expired'],
    // a Super Admin plan change / status edit re-activates a lapsed salon (an explicit platform decision, audited)
    cancelled: ['active', 'trialing', 'past_due', 'expired'],
    expired: ['active', 'trialing', 'past_due', 'cancelled'],
  },
  initial: ['active', 'trialing'],
});

/** subscription_changes: a scheduled change is applied once; a pending request is approved (completed) or rejected. */
export const SUBSCRIPTION_CHANGE = defineStateMachine({
  name: 'subscription_change', table: 'subscription_changes', column: 'status',
  states: ['pending', 'scheduled', 'applied', 'completed', 'rejected', 'cancelled', 'failed'],
  transitions: { scheduled: ['applied'], pending: ['completed', 'rejected'] },
  initial: ['pending', 'scheduled', 'applied', 'completed'],
});

/** tenant_add_ons: active ⇄ cancelled (re-assigning a cancelled add-on re-activates the same row). */
export const TENANT_ADD_ON = defineStateMachine({
  name: 'tenant_add_on', table: 'tenant_add_ons', column: 'status',
  states: ['active', 'cancelled'],
  transitions: { active: ['cancelled', 'active'], cancelled: ['active'] },
  initial: ['active'],
});
