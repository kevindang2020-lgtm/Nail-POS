// webhook-dispatch-core.ts — PURE planning + retry state machine for the event dispatcher. Reuses the delivery
// policy primitives (shouldRetry/backoffMs/MAX_DELIVERY_ATTEMPTS). No IO.
import { shouldRetry, backoffMs, MAX_DELIVERY_ATTEMPTS } from './webhook-delivery-core';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export interface PlannableWebhook { id: string; status: string; events: string[] }
// Active webhooks whose subscription matches the event type (or the '*' wildcard) get a delivery.
export function planDeliveries(eventType: string, webhooks: PlannableWebhook[]): string[] {
  return webhooks.filter((w) => w.status === 'active' && (w.events.includes(eventType) || w.events.includes('*'))).map((w) => w.id);
}

export interface AttemptOutcome { ok: boolean; status: number | null }
export interface DeliveryStateLike { attemptCount: number; maxAttempts: number }
export interface NextState { status: DeliveryStatus; attemptCount: number; nextAttemptAtMs: number | null; lastStatusCode: number | null }

// Given the current delivery and one send outcome, compute the next persisted state:
//  - ok               → delivered (terminal)
//  - retryable + room → pending, scheduled at now + backoff(attempt)
//  - attempts exhausted→ dead (terminal)
//  - non-retryable 4xx→ failed (terminal)
export function nextAttemptState(d: DeliveryStateLike, outcome: AttemptOutcome, nowMs: number): NextState {
  const attemptCount = d.attemptCount + 1;
  if (outcome.ok) return { status: 'delivered', attemptCount, nextAttemptAtMs: null, lastStatusCode: outcome.status };
  if (shouldRetry(outcome.status, attemptCount, d.maxAttempts)) {
    return { status: 'pending', attemptCount, nextAttemptAtMs: nowMs + backoffMs(attemptCount), lastStatusCode: outcome.status };
  }
  return { status: attemptCount >= d.maxAttempts ? 'dead' : 'failed', attemptCount, nextAttemptAtMs: null, lastStatusCode: outcome.status };
}

export function isDue(d: { status: string; nextAttemptAtMs: number | null }, nowMs: number): boolean {
  if (d.status !== 'pending') return false;
  return d.nextAttemptAtMs == null || d.nextAttemptAtMs <= nowMs;
}

export { MAX_DELIVERY_ATTEMPTS };
