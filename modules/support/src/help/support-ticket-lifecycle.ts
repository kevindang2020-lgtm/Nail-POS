// support-ticket-lifecycle.ts — BUILD_PLAN Phase 12 (#27): the support ticket lifecycle as ONE transition table — the
// triage table support-tickets.service always had (ALLOWED_TRANSITIONS), now the state machine every status write runs
// through (triage status changes and the assign-moves-to-assigned write), with the conditional update so two triagers
// moving the same ticket at once cannot both land.
import { defineStateMachine } from '@aipowersalon/database';

export const SUPPORT_TICKET = defineStateMachine({
  name: 'support_ticket', table: 'support_tickets', column: 'status',
  states: ['draft', 'submitted', 'open', 'assigned', 'waiting_support', 'waiting_customer', 'in_progress', 'escalated', 'resolved', 'closed', 'reopened', 'canceled'],
  transitions: {
    submitted: ['open', 'in_progress', 'assigned', 'canceled'],
    open: ['in_progress', 'assigned', 'waiting_customer', 'resolved', 'canceled'],
    assigned: ['in_progress', 'waiting_customer', 'waiting_support', 'resolved', 'canceled'],
    in_progress: ['waiting_customer', 'waiting_support', 'escalated', 'resolved', 'canceled'],
    waiting_customer: ['in_progress', 'resolved', 'canceled'],
    waiting_support: ['in_progress', 'resolved', 'canceled'],
    escalated: ['in_progress', 'resolved', 'canceled'],
    resolved: ['closed', 'reopened'],
    reopened: ['in_progress', 'assigned', 'resolved', 'canceled'],
    closed: ['reopened'],
    canceled: ['reopened'],
    draft: ['submitted', 'canceled'],
  },
  initial: ['submitted', 'draft'],
});
