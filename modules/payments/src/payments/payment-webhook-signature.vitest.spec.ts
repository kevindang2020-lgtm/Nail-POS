import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './payment-webhook.service';

const secret = 'whsec_test_abc123';
// Raw bytes exactly as a processor would send them — note the WHITESPACE; these bytes are what gets signed.
const rawBody = '{ "event": "payment.refunded", "data": { "amount": 100, "id": "txn_1" } }';
const sign = (body: string, key = secret) => createHmac('sha256', key).update(body, 'utf8').digest('hex');

describe('verifyWebhookSignature (raw-body HMAC-SHA256)', () => {
  it('accepts a signature computed over the exact raw bytes', () => {
    expect(verifyWebhookSignature(rawBody, sign(rawBody), secret)).toBe(true);
  });

  it('accepts the sha256= prefixed form', () => {
    expect(verifyWebhookSignature(rawBody, 'sha256=' + sign(rawBody), secret)).toBe(true);
  });

  it('REJECTS the same payload re-serialized — this is why raw-body capture matters', () => {
    const reSerialized = JSON.stringify(JSON.parse(rawBody)); // compact: different bytes than the spaced original
    expect(reSerialized).not.toBe(rawBody);
    // A signature over the RAW bytes must not validate against the re-serialized body, and vice-versa.
    expect(verifyWebhookSignature(reSerialized, sign(rawBody), secret)).toBe(false);
    expect(verifyWebhookSignature(rawBody, sign(reSerialized), secret)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const good = sign(rawBody);
    const tampered = (good[0] === 'a' ? 'b' : 'a') + good.slice(1);
    expect(verifyWebhookSignature(rawBody, tampered, secret)).toBe(false);
  });

  it('rejects a mutated body under a signature made for the original', () => {
    const sigForOriginal = sign(rawBody);
    const mutated = rawBody.replace('"amount": 100', '"amount": 999');
    expect(verifyWebhookSignature(mutated, sigForOriginal, secret)).toBe(false);
  });

  it('rejects when the secret is missing or wrong', () => {
    expect(verifyWebhookSignature(rawBody, sign(rawBody), null)).toBe(false);
    expect(verifyWebhookSignature(rawBody, sign(rawBody), '')).toBe(false);
    expect(verifyWebhookSignature(rawBody, sign(rawBody, 'other_secret'), secret)).toBe(false);
  });

  it('rejects an empty or malformed signature header without throwing', () => {
    expect(verifyWebhookSignature(rawBody, '', secret)).toBe(false);
    expect(verifyWebhookSignature(rawBody, 'not-hex-!!!', secret)).toBe(false);
    expect(verifyWebhookSignature(rawBody, 'sha256=', secret)).toBe(false);
  });
});
