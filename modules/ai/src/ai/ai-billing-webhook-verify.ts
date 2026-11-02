// ai-billing-webhook-verify.ts — the security-critical half of the provider webhook adapter, kept pure so it's fully
// testable. Two pieces:
//   1. verifyWebhookSignature — HMAC-SHA256 verification with constant-time compare + timestamp replay protection.
//      Supports the common "t=<unix>,v1=<hex>" scheme (Stripe-style) and a plain hex-HMAC-of-body scheme.
//   2. mapRawBillingEvent — maps a raw provider payload to our NormalizedBillingEvent using an editable field mapping +
//      an event-type translation table. The DEFAULTS below are a Stripe-shaped starting point; edit the paths and the
//      typeMap to match your provider (the field names are the only provider-specific thing).
import { createHmac, timingSafeEqual } from 'crypto';
import type { NormalizedBillingEvent } from './ai-subscription-billing.repository';

export interface VerifyResult { ok: boolean; reason: string }
export interface VerifyOptions { payload: string; header: string; secret: string; toleranceSec?: number; now?: number; scheme?: 'stripe' | 'hmac-hex' }

function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try { return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}

export function verifyWebhookSignature(opts: VerifyOptions): VerifyResult {
  const { payload, header, secret } = opts;
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!header) return { ok: false, reason: 'no_signature' };
  if (opts.scheme === 'hmac-hex') {
    const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    return safeEqualHex(expected, header.trim().toLowerCase()) ? { ok: true, reason: 'verified' } : { ok: false, reason: 'signature_mismatch' };
  }
  // stripe-style: "t=<unix>,v1=<hex>[,v1=<hex>]"
  const parts: Record<string, string[]> = Object.create(null);
  for (const seg of header.split(',')) { const i = seg.indexOf('='); if (i < 0) continue; const k = seg.slice(0, i).trim(); const v = seg.slice(i + 1).trim(); (parts[k] ||= []).push(v); }
  const t = parts['t']?.[0]; const sigs = parts['v1'] || [];
  if (!t || !sigs.length) return { ok: false, reason: 'malformed_header' };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > (opts.toleranceSec ?? 300)) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return sigs.some((s) => safeEqualHex(expected, s.toLowerCase())) ? { ok: true, reason: 'verified' } : { ok: false, reason: 'signature_mismatch' };
}

// ---- raw → normalized mapping ----
export interface RawEventMapping {
  eventId: string; eventType: string; tenantId: string; packageCode: string;
  provider?: string; paymentSubscriptionId?: string; paymentCustomerId?: string; paymentStatus?: string;
  providerName?: string; typeMap: Record<string, string>;
}
export interface MapResult { ok: boolean; reason: string; value?: NormalizedBillingEvent }

const get = (o: any, path?: string): any => (!path ? undefined : path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o));

/** Stripe-shaped default. Edit the paths + typeMap to match your provider's payload and event names. */
export const DEFAULT_BILLING_MAPPING: RawEventMapping = {
  eventId: 'id', eventType: 'type',
  tenantId: 'data.object.metadata.tenant_id', packageCode: 'data.object.metadata.package_code',
  paymentSubscriptionId: 'data.object.subscription', paymentCustomerId: 'data.object.customer', paymentStatus: 'data.object.status',
  providerName: 'stripe',
  typeMap: {
    'invoice.payment_succeeded': 'payment_succeeded',
    'invoice.payment_failed': 'payment_failed',
    'invoice.paid': 'payment_succeeded',
    'customer.subscription.created': 'trial_converted',
    'customer.subscription.deleted': 'subscription_cancelled',
    'customer.subscription.paused': 'paused',
    'customer.subscription.resumed': 'resumed',
    'charge.refunded': 'refunded',
    'charge.dispute.created': 'chargeback',
  },
};

export function mapRawBillingEvent(raw: any, mapping: RawEventMapping = DEFAULT_BILLING_MAPPING): MapResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_an_object' };
  const eventId = get(raw, mapping.eventId);
  const rawType = get(raw, mapping.eventType);
  const eventType = mapping.typeMap[rawType];
  if (!eventId) return { ok: false, reason: 'missing_event_id' };
  if (!eventType) return { ok: false, reason: 'unmapped_event_type' };
  const tenantId = get(raw, mapping.tenantId); const packageCode = get(raw, mapping.packageCode);
  if (!tenantId || !packageCode) return { ok: false, reason: 'missing_tenant_or_package' };
  return {
    ok: true, reason: 'mapped',
    value: {
      eventId: String(eventId), tenantId: String(tenantId), packageCode: String(packageCode), eventType,
      provider: get(raw, mapping.provider) ?? mapping.providerName ?? null,
      paymentSubscriptionId: get(raw, mapping.paymentSubscriptionId) ?? null,
      paymentCustomerId: get(raw, mapping.paymentCustomerId) ?? null,
      paymentStatus: get(raw, mapping.paymentStatus) ?? null,
      raw,
    },
  };
}
