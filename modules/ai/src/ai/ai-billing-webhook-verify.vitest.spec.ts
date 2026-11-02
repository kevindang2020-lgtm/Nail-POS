import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyWebhookSignature, mapRawBillingEvent } from './ai-billing-webhook-verify';
import { InMemoryAiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import { AiSubscriptionBillingService } from './ai-subscription-billing.service';

const SECRET = 'whsec_test';
const stripeHeader = (payload: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex')}`;

describe('verifyWebhookSignature (stripe-style)', () => {
  const payload = '{"id":"evt_1"}';
  const now = 1_700_000_000;
  it('accepts a correct signature within tolerance', () => {
    expect(verifyWebhookSignature({ payload, header: stripeHeader(payload, now), secret: SECRET, now })).toMatchObject({ ok: true });
  });
  it('rejects a tampered payload', () => {
    expect(verifyWebhookSignature({ payload: payload + 'x', header: stripeHeader(payload, now), secret: SECRET, now })).toMatchObject({ ok: false, reason: 'signature_mismatch' });
  });
  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature({ payload, header: stripeHeader(payload, now, 'other'), secret: SECRET, now }).ok).toBe(false);
  });
  it('rejects a replay outside tolerance', () => {
    expect(verifyWebhookSignature({ payload, header: stripeHeader(payload, now), secret: SECRET, now: now + 10_000 })).toMatchObject({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });
  it('rejects a malformed header and a missing secret', () => {
    expect(verifyWebhookSignature({ payload, header: 'nope', secret: SECRET, now }).reason).toBe('malformed_header');
    expect(verifyWebhookSignature({ payload, header: stripeHeader(payload, now), secret: '', now }).reason).toBe('no_secret');
  });
});

describe('verifyWebhookSignature (hmac-hex)', () => {
  it('verifies a plain hex HMAC of the body', () => {
    const payload = 'body';
    const sig = createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex');
    expect(verifyWebhookSignature({ payload, header: sig, secret: SECRET, scheme: 'hmac-hex' })).toMatchObject({ ok: true });
    expect(verifyWebhookSignature({ payload, header: sig.replace(/.$/, '0'), secret: SECRET, scheme: 'hmac-hex' }).ok).toBe(false);
  });
});

describe('mapRawBillingEvent', () => {
  const raw = (over: any = {}) => ({ id: 'evt_9', type: 'invoice.payment_succeeded', data: { object: { subscription: 'sub_1', customer: 'cus_1', status: 'paid', metadata: { tenant_id: 't1', package_code: 'ai_booking_assistant' } } }, ...over });
  it('maps a recognized provider event', () => {
    const r = mapRawBillingEvent(raw());
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ eventId: 'evt_9', eventType: 'payment_succeeded', tenantId: 't1', packageCode: 'ai_booking_assistant', provider: 'stripe', paymentSubscriptionId: 'sub_1' });
  });
  it('rejects an unmapped type and missing tenant/package', () => {
    expect(mapRawBillingEvent(raw({ type: 'whatever' })).reason).toBe('unmapped_event_type');
    expect(mapRawBillingEvent(raw({ data: { object: { metadata: {} } } })).reason).toBe('missing_tenant_or_package');
  });
});

describe('ingestRawWebhook (verify → map → apply)', () => {
  const OLD = process.env.AI_BILLING_WEBHOOK_SECRET;
  it('applies a signed, mapped event end-to-end', async () => {
    process.env.AI_BILLING_WEBHOOK_SECRET = SECRET; delete process.env.AI_BILLING_WEBHOOK_SCHEME;
    const repo = new InMemoryAiSubscriptionBillingRepo();
    repo.subs.set('t1:ai_booking_assistant', 'past_due');
    const svc = new AiSubscriptionBillingService(repo, null);
    const body = JSON.stringify({ id: 'evt_live', type: 'invoice.payment_succeeded', data: { object: { metadata: { tenant_id: 't1', package_code: 'ai_booking_assistant' } } } });
    const t = Math.floor(Date.now() / 1000);
    const res = await svc.ingestRawWebhook(body, stripeHeader(body, t));
    expect(res).toMatchObject({ applied: true, fromStatus: 'past_due', toStatus: 'active' });
    expect(repo.subs.get('t1:ai_booking_assistant')).toBe('active');
    // bad signature → rejected before any state change
    const bad = await svc.ingestRawWebhook(body, 't=1,v1=deadbeef');
    expect(bad.applied).toBe(false); expect(bad.reason).toMatch(/^signature_/);
    process.env.AI_BILLING_WEBHOOK_SECRET = OLD;
  });
});
