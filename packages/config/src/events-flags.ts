// events-flags.ts — the event publisher switch, and whether realtime reaches clients through the domain-event
// projection (Constitution 8 / 13 §343).
//
// A domain write records its domain event in the outbox; the outbox PUBLISHER (only when EVENT_PUBLISHER_ENABLED) hands it
// to consumers, one of which projects it to the client realtime vocabulary. Services used to skip their direct realtime
// emission whenever an outbox WRITER existed — which is always, with a database — so with the publisher OFF those events
// were recorded and never delivered: the screens that waited for them went stale. The decision belongs to this one
// function: deliver through the projection only when the publisher is actually on.
export function eventPublisherEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.EVENT_PUBLISHER_ENABLED ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  // Unset (Kevin's decision, Oct 3 2026): ON in production — the outbox claims rows with SKIP LOCKED, so every replica
  // may run it and nothing depends on an operator remembering a variable; OFF in development and tests, which opt in
  // explicitly. An explicit EVENT_PUBLISHER_ENABLED=off still switches it off in production.
  return env.NODE_ENV === 'production';
}

/** Will a recorded domain event reach clients through the realtime projection? Only if this write HAS an outbox and the
 *  publisher is on. When it returns false the service emits directly, so a screen never waits on a publisher that
 *  isn't running. */
export function projectionDeliversRealtime(hasOutbox: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasOutbox && eventPublisherEnabled(env);
}
