// webhook-delivery-core.ts — PURE delivery primitives. HMAC-SHA256 signing is deterministic given inputs (testable);
// retry/backoff are pure policy. The actual HTTP send lives in the service behind an injectable sender, so nothing
// here performs IO.
import { createHmac } from 'crypto';

export const MAX_DELIVERY_ATTEMPTS = 5;

// Stripe-style signing: HMAC-SHA256 over "<timestamp>.<body>" with the webhook's signing secret.
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
export function signatureHeader(timestamp: number, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

export function buildEnvelope(eventType: string, id: string, timestamp: number, data: unknown): string {
  return JSON.stringify({ id, type: eventType, created: timestamp, data });
}

// Exponential backoff (1s, 2s, 4s, …) capped at 60s. attempt is 1-based.
export function backoffMs(attempt: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(base, 60_000);
}

// Retry on network errors (status null), 429, and 5xx — but not other 4xx, and never past the attempt cap.
export function shouldRetry(status: number | null, attempt: number, maxAttempts: number = MAX_DELIVERY_ATTEMPTS): boolean {
  if (attempt >= maxAttempts) return false;
  if (status == null) return true;
  if (status === 429) return true;
  return status >= 500;
}
