// event-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the event pipeline's two lifecycles as state machines.
//   outbox_events.publish_status — the publisher claims pending rows, publishes them or puts them back (retry / a stale
//     claim reaped) until the attempts run out (failed). A published row is never claimed again.
//   event_dead_letters.status — a consumer failure parks the event (open, or retrying while attempts remain); an operator
//     retries or discards it; a successful retry resolves it. A NEW failure of the same event re-opens the row (the
//     upsert in consumer-runner), which is why resolved / discarded lead back to open / retrying.
import { defineStateMachine } from '@aipowersalon/database';

export const OUTBOX_EVENT = defineStateMachine({
  name: 'outbox_event', table: 'outbox_events', column: 'publish_status',
  states: ['pending', 'claimed', 'published', 'failed'],
  transitions: { pending: ['claimed'], claimed: ['published', 'pending', 'failed'] },
  initial: ['pending'],
});

export const EVENT_DEAD_LETTER = defineStateMachine({
  name: 'event_dead_letter', table: 'event_dead_letters', column: 'status',
  states: ['open', 'retrying', 'resolved', 'discarded'],
  transitions: {
    open: ['open', 'retrying', 'discarded'],
    retrying: ['open', 'retrying', 'resolved', 'discarded'],
    resolved: ['open', 'retrying'],
    discarded: ['open', 'retrying'],
  },
  initial: ['open', 'retrying'],
});
