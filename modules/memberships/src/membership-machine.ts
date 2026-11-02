// membership-machine.ts — BUILD_PLAN Phase 12 (#27): customer_memberships.status as ONE state machine — the transition map
// memberships-core.ts has always validated against (TRANSITIONS), with its idempotent self-move (assertTransition treats
// from === to as a no-op, e.g. a renewal that keeps an active membership active). Every status write now runs it in the
// SQL: a renewal can no longer turn a membership canceled meanwhile back into active, a dunning step cannot revive an
// expired one.
import { defineStateMachine } from '@aipowersalon/database';
import { TRANSITIONS } from './memberships-core';

const withSelf = Object.fromEntries(Object.entries(TRANSITIONS).map(([from, tos]) => [from, [...new Set([from, ...tos])]]));
export const CUSTOMER_MEMBERSHIP = defineStateMachine({
  name: 'customer_membership', table: 'customer_memberships', column: 'status',
  states: ['pending', 'trial', 'active', 'grace', 'past_due', 'paused', 'canceling', 'comped', 'suspended', 'canceled', 'expired', 'completed'],
  transitions: withSelf as any,
  initial: ['pending', 'trial', 'active', 'comped'],
});

/** membership_plans.status — publishing a version makes a plan active; an owner pauses / deactivates / archives it, the
 *  platform disables it. An ARCHIVED plan is never published again (a new plan is created instead). */
export const MEMBERSHIP_PLAN = defineStateMachine({
  name: 'membership_plan', table: 'membership_plans', column: 'status',
  states: ['draft', 'active', 'paused', 'inactive', 'disabled', 'archived'],
  transitions: {
    draft: ['draft', 'active', 'archived'],
    active: ['active', 'paused', 'inactive', 'disabled', 'archived'],
    paused: ['active', 'paused', 'inactive', 'disabled', 'archived'],
    inactive: ['active', 'paused', 'inactive', 'disabled', 'archived'],
    disabled: ['active', 'disabled', 'archived'],
    archived: ['archived'],
  },
  initial: ['draft', 'active'],
});
