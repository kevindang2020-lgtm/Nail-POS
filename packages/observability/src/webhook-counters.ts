// webhook-counters.ts — BUILD_PLAN Phase 11 (Constitution 4 §173–175): per-provider inbound webhook counters.
//
// Every public webhook endpoint records what happened to each delivery:
//   received  — the request arrived
//   verified  — its signature checked out
//   rejected  — refused (bad / missing signature, unknown endpoint or merchant, malformed body)
//   duplicate — a verified delivery we had already processed (the provider retried)
//   processed — a verified, new delivery that was applied
//   failed    — a verified, new delivery whose business processing threw (wave 3 PAYI §158; the provider will retry)
// Latency: a histogram `aipowersalon_webhook_latency_ms{provider}` (§158) — recordWebhookLatency after the response.
// Counted in the process-wide registry (`aipowersalon_webhook_events_total{provider,outcome}`, scraped at /metrics) and
// mirrored in a small map so System Operations can show this process's totals. Providers are a bounded vocabulary.
import { registry } from './metrics';

export const WEBHOOK_OUTCOMES = ['received', 'verified', 'rejected', 'duplicate', 'processed', 'failed'] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];
export const webhookEvents = registry.counter('aipowersalon_webhook_events_total', 'Inbound provider webhooks by outcome', ['provider', 'outcome']);
export const webhookLatency = registry.histogram('aipowersalon_webhook_latency_ms', 'Inbound provider webhook handling latency (ms)', ['provider'], [5, 25, 50, 100, 250, 500, 1000, 2500, 5000]);
/** §158 latency per provider — the histogram above plus this process's last/max for System Operations. Never throws. */
export function recordWebhookLatency(provider: string, ms: number): void {
  try {
    if (!Number.isFinite(ms) || ms < 0) return;
    webhookLatency.observe(ms, { provider });
    const l = latency.get(provider) ?? { lastMs: 0, maxMs: 0, n: 0 };
    l.lastMs = ms; l.maxMs = Math.max(l.maxMs, ms); l.n += 1; latency.set(provider, l);
  } catch { /* metrics never break a webhook */ }
}
const latency = new Map<string, { lastMs: number; maxMs: number; n: number }>();

const PAYMENT_PROCESSORS = new Set(['cardpointe', 'clover', 'fiserv', 'stripe', 'square']);
/** Bounded provider label: 'payments:<known processor|other>', 'bank', 'twilio', 'twilio:booking_verification'. */
export function webhookProvider(channel: 'payments' | 'bank' | 'twilio' | 'twilio:booking_verification', processor?: string): string {
  if (channel !== 'payments') return channel;
  const p = String(processor ?? '').trim().toLowerCase();
  return `payments:${PAYMENT_PROCESSORS.has(p) ? p : 'other'}`;
}

const counts = new Map<string, Record<WebhookOutcome, number>>();
const since = { at: new Date().toISOString() };

/** Never throws into a webhook handler. */
export function recordWebhook(provider: string, outcome: WebhookOutcome): void {
  try {
    webhookEvents.inc({ provider, outcome });
    let c = counts.get(provider);
    if (!c) { if (counts.size >= 32) return; c = { received: 0, verified: 0, rejected: 0, duplicate: 0, processed: 0, failed: 0 }; counts.set(provider, c); }
    c[outcome] += 1;
  } catch { /* metrics never break a webhook */ }
}

export interface WebhookCount { provider: string; received: number; verified: number; rejected: number; duplicate: number; processed: number; failed: number; latency?: { lastMs: number; maxMs: number; n: number } }
export function webhookCounts(): WebhookCount[] {
  return [...counts.entries()].map(([provider, c]) => ({ provider, ...c, ...(latency.has(provider) ? { latency: { ...latency.get(provider)! } } : {}) })).sort((a, b) => a.provider.localeCompare(b.provider));
}
export function webhookCountsSince(): string { return since.at; }
/** Tests only. */
export function resetWebhookCountsForTests(): void { counts.clear(); latency.clear(); since.at = new Date().toISOString(); }
