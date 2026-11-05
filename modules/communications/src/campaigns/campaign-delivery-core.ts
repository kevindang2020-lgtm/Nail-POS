// Pure, DB-free engine for campaign delivery: compute Delivery Rate + Opt-out Rate from rollups, summarize failures
// into the reference display buckets, and classify retry-eligibility. Permanent failures are never retryable.

export interface DeliveryTotals { attempted: number; delivered: number; optedOut: number }

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function computeDeliveryKpis(t: DeliveryTotals): { deliveryRate: number | null; optOutRate: number | null } {
  if (t.attempted <= 0) return { deliveryRate: null, optOutRate: null };
  return { deliveryRate: pct(t.delivered, t.attempted), optOutRate: pct(t.optedOut, Math.max(1, t.delivered)) };
}

export type FailureCategory =
  | 'invalid_phone_email' | 'opted_out' | 'spam_reported' | 'blocked_destination' | 'provider_rejection'
  | 'channel_error' | 'rate_limit' | 'network_failure' | 'expired_token' | 'other';

// Permanent categories must never be auto-retried.
const NON_RETRYABLE = new Set<FailureCategory>(['invalid_phone_email', 'opted_out', 'spam_reported', 'blocked_destination', 'expired_token']);
export const isRetryable = (category: FailureCategory): boolean => !NON_RETRYABLE.has(category);

// Reference display buckets for the Delivery Failures module.
const DISPLAY_BUCKET: Record<string, string> = {
  invalid_phone_email: 'Invalid Phone/Email',
  opted_out: 'Opt-out / Unsubscribed',
  spam_reported: 'Spam Reported',
  channel_error: 'Channel Error',
};
const bucketFor = (category: string): string => DISPLAY_BUCKET[category] ?? 'Other';

export interface FailureCount { category: string; label: string; count: number; pct: number }
export interface FailureSummary { available: boolean; total: number; byCategory: FailureCount[] }

export function summarizeFailures(rows: { failureCategory: string; count: number }[]): FailureSummary {
  const buckets = new Map<string, number>();
  let total = 0;
  for (const r of rows) { const b = bucketFor(r.failureCategory); buckets.set(b, (buckets.get(b) || 0) + r.count); total += r.count; }
  // Stable reference ordering; Other last.
  const order = ['Invalid Phone/Email', 'Opt-out / Unsubscribed', 'Spam Reported', 'Channel Error', 'Other'];
  const byCategory = order.filter((b) => buckets.has(b)).map((label) => ({ category: label, label, count: buckets.get(label)!, pct: pct(buckets.get(label)!, total) }));
  return { available: true, total, byCategory };
}
