// operation-lifecycle.ts — BUILD_PLAN Phase 12 (#27, #32): the async operation (api_operations.status) as a state machine.
// queued → running (the worker claims it; a retry of the same job may re-take a running one) → succeeded | failed, or back
// to queued (a retryable failure); a succeeded result expires after its TTL. Every writer (operations.repository,
// operations-expiry.repository) moves rows only from a state this table allows (canMoveToSql in the conditional update).
import { defineStateMachine } from '@aipowersalon/database';

export const API_OPERATION = defineStateMachine({
  name: 'api_operation', table: 'api_operations', column: 'status',
  states: ['queued', 'running', 'succeeded', 'failed', 'expired', 'canceled'],
  transitions: { queued: ['running', 'failed', 'canceled'], running: ['running', 'succeeded', 'failed', 'queued', 'canceled'], succeeded: ['expired'] },
  initial: ['queued'],
});
