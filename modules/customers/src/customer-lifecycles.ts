// customer-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the customers module's lifecycles as state machines.
import { defineStateMachine } from '@aipowersalon/database';

/** customer_recon_runs.status — the 7 PM reconciliation run: RUNNING until it finishes (once). */
export const CUSTOMER_RECON_RUN = defineStateMachine({
  name: 'customer_recon_run', table: 'customer_recon_runs', column: 'status',
  states: ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'PARTIAL', 'FAILED'],
  transitions: { RUNNING: ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'PARTIAL', 'FAILED'] },
  initial: ['RUNNING'],
});

/** global_customers.status — a global identity is merged into another at most once; a MERGED one never comes back. */
export const GLOBAL_CUSTOMER = defineStateMachine({
  name: 'global_customer', table: 'global_customers', column: 'status',
  states: ['active', 'archived', 'merged'],
  transitions: { active: ['active', 'archived', 'merged'], archived: ['active', 'archived', 'merged'] },
  initial: ['active'],
});

/** customer_identity_conflicts.status — NEW → REVIEWING → a decision; a decided conflict may be re-opened for review
 *  (the Super Admin screen has always allowed it), never silently re-decided without passing REVIEWING. */
const DECIDED = ['RESOLVED', 'MERGED', 'KEEP_SEPARATE', 'IGNORED', 'FALSE_POSITIVE'] as const;
export const CUSTOMER_IDENTITY_CONFLICT = defineStateMachine({
  name: 'customer_identity_conflict', table: 'customer_identity_conflicts', column: 'status',
  states: ['NEW', 'REVIEWING', 'RESOLVED', 'MERGED', 'KEEP_SEPARATE', 'IGNORED', 'FALSE_POSITIVE'],
  transitions: {
    NEW: ['NEW', 'REVIEWING', ...DECIDED], REVIEWING: ['NEW', 'REVIEWING', ...DECIDED],
    RESOLVED: ['REVIEWING'], MERGED: ['REVIEWING'], KEEP_SEPARATE: ['REVIEWING'], IGNORED: ['REVIEWING'], FALSE_POSITIVE: ['REVIEWING'],
  },
  initial: ['NEW'],
});

/** customer_legal_holds.status — active → released, once. */
export const CUSTOMER_LEGAL_HOLD = defineStateMachine({
  name: 'customer_legal_hold', table: 'customer_legal_holds', column: 'status',
  states: ['active', 'released'],
  transitions: { active: ['released'] },
  initial: ['active'],
});

/** referral_redemptions.status — a referral is rewarded ONCE (marking it rewarded again used to re-write the reward). */
export const REFERRAL_REDEMPTION = defineStateMachine({
  name: 'referral_redemption', table: 'referral_redemptions', column: 'status',
  states: ['pending', 'rewarded', 'void'],
  transitions: { pending: ['rewarded', 'void'] },
  initial: ['pending'],
});
