// idempotency-lifecycle.ts — BUILD_PLAN Phase 12 (#27): the ONE state machine for api_idempotency.state (migration 502),
// shared by every module that keeps an idempotent reply in the platform store (the AI voice gateway, checkout's AI
// upsell; the HTTP @Idempotent interceptor inserts finished rows). It lives with the state-machine primitive because the
// table is platform infrastructure, not any one domain's.
//
// inflight → done once: the first finisher stores the reply. A second "done" for the same key would OVERWRITE the reply a
// retrying client may already have received, so done is final; a failed attempt deletes its inflight row instead.
import { defineStateMachine } from './state-machine';

export const API_IDEMPOTENCY = defineStateMachine({
  name: 'api_idempotency', table: 'api_idempotency', column: 'state',
  states: ['inflight', 'done'],
  transitions: { inflight: ['done'] },
  initial: ['inflight', 'done'],
});
