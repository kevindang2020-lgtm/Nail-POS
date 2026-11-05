import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { schemeForProcessor, verifyProcessorSignature } from './payment-webhook.service';

const secret = 'whsec_live_xyz';
const raw = '{ "event": "settlement.batch", "data": { "amount": 4200, "id": "txn_9" } }';
const hex = (data: string, key = secret) => createHmac('sha256', key).update(data, 'utf8').digest('hex');

describe('schemeForProcessor', () => {
  it('every supported processor uses the generic HMAC-SHA256 hex scheme', () => {
    expect(schemeForProcessor('fiserv')).toBe('hmac_sha256_hex');
    expect(schemeForProcessor('cardpointe')).toBe('hmac_sha256_hex');
    expect(schemeForProcessor('clover')).toBe('hmac_sha256_hex');
    expect(schemeForProcessor('whatever')).toBe('hmac_sha256_hex');
  });
});

describe('verifyProcessorSignature — generic HMAC hex (fiserv / cardpointe / clover) + legacy fallback', () => {
  it('verifies via the header map (x-webhook-signature / x-cardpointe-signature)', () => {
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'fiserv', headers: { 'x-webhook-signature': hex(raw) } }).valid).toBe(true);
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'cardpointe', headers: { 'x-cardpointe-signature': 'sha256=' + hex(raw) } }).valid).toBe(true);
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'clover', headers: { 'x-webhook-signature': hex(raw) } }).valid).toBe(true);
  });
  it('still verifies via the legacy single-header fallback (back-compat)', () => {
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'fiserv', fallbackHeader: hex(raw) }).valid).toBe(true);
  });
  it('reports missing/mismatch/no_secret distinctly', () => {
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'fiserv', headers: {} }).reason).toBe('missing_header');
    expect(verifyProcessorSignature({ rawBody: raw, secret, processor: 'fiserv', headers: { 'x-webhook-signature': hex('other') } }).reason).toBe('signature_mismatch');
    expect(verifyProcessorSignature({ rawBody: raw, secret: null, processor: 'fiserv', headers: { 'x-webhook-signature': hex(raw) } }).reason).toBe('no_secret');
  });
});
