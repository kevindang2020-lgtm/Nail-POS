// retell-voice.adapter.vitest.spec.ts — verifies the Retell adapter against its documented webhook scheme
// (X-Retell-Signature: v=<ts>,d=<hmac_sha256(rawBody+ts, apiKey)>, 5-min replay window, constant-time).
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { RetellVoiceAdapter } from './retell-voice.adapter';

const KEY = 'key_test_webhook_badge';

// Build a valid signature exactly as Retell does, so the test proves interop, not just self-consistency.
function sign(rawBody: string, key = KEY, ts = Date.now()): string {
  const digest = createHmac('sha256', key).update(rawBody + ts).digest('hex');
  return `v=${ts},d=${digest}`;
}
const hdr = (sig: string) => ({ 'X-Retell-Signature': sig });

describe('RetellVoiceAdapter.verifyWebhook', () => {
  const a = new RetellVoiceAdapter();

  it('accepts a correctly-signed, fresh request', () => {
    const body = JSON.stringify({ name: 'get_services', call: { call_id: 'c1' } });
    expect(a.verifyWebhook(body, hdr(sign(body)), KEY).ok).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const body = JSON.stringify({ name: 'get_services' });
    const sig = sign(body);
    const tampered = JSON.stringify({ name: 'cancel_appointment' });
    expect(a.verifyWebhook(tampered, hdr(sig), KEY).ok).toBe(false);
  });

  it('rejects a wrong signing key', () => {
    const body = '{"name":"get_services"}';
    expect(a.verifyWebhook(body, hdr(sign(body, 'wrong_key')), KEY).ok).toBe(false);
  });

  it('rejects a stale timestamp (replay protection, >5 min)', () => {
    const body = '{"name":"get_services"}';
    const old = Date.now() - 6 * 60 * 1000;
    expect(a.verifyWebhook(body, hdr(sign(body, KEY, old)), KEY).ok).toBe(false);
  });

  it('rejects a missing or malformed signature header', () => {
    const body = '{"name":"get_services"}';
    expect(a.verifyWebhook(body, {}, KEY).ok).toBe(false);
    expect(a.verifyWebhook(body, hdr('garbage'), KEY).ok).toBe(false);
  });

  it('rejects when no signing key is configured', () => {
    const body = '{"name":"get_services"}';
    expect(a.verifyWebhook(body, hdr(sign(body)), '').ok).toBe(false);
  });

  it('is case-insensitive on the header name', () => {
    const body = '{"name":"get_services"}';
    expect(a.verifyWebhook(body, { 'x-retell-signature': sign(body) }, KEY).ok).toBe(true);
  });
});

describe('RetellVoiceAdapter.parseToolCall', () => {
  const a = new RetellVoiceAdapter();

  it('parses name + args + call id from a Retell custom-function body', () => {
    const body = JSON.stringify({ name: 'get_availability', args: { service_id: 'svc_gel', date: '2026-05-12' }, call: { call_id: 'call_9' }, invocation_id: 'inv_1' });
    const parsed = a.parseToolCall(body)!;
    expect(parsed.name).toBe('get_availability');
    expect(parsed.args).toEqual({ service_id: 'svc_gel', date: '2026-05-12' });
    expect(parsed.callId).toBe('call_9');
    expect(parsed.invocationId).toBe('inv_1');
  });

  it('accepts alternate field shapes (arguments as a JSON string)', () => {
    const body = JSON.stringify({ function_name: 'get_services', arguments: '{"x":1}', call_id: 'c2' });
    const parsed = a.parseToolCall(body)!;
    expect(parsed.name).toBe('get_services');
    expect(parsed.args).toEqual({ x: 1 });
    expect(parsed.callId).toBe('c2');
  });

  it('returns null for a non-tool-call body', () => {
    expect(a.parseToolCall(JSON.stringify({ event: 'call_started' }))).toBeNull();
    expect(a.parseToolCall('not json')).toBeNull();
  });
});

describe('RetellVoiceAdapter.formatToolResult', () => {
  const a = new RetellVoiceAdapter();
  const call = { name: 'get_services', args: {}, callId: 'c1', invocationId: 'inv_1' };

  it('formats a success result the agent can read', () => {
    const out: any = a.formatToolResult(call, { data: [{ name: 'Gel Manicure' }], say: 'We offer gel manicure.' });
    expect(out).toMatchObject({ invocation_id: 'inv_1', success: true, message: 'We offer gel manicure.' });
    expect(out.data).toEqual([{ name: 'Gel Manicure' }]);
  });

  it('formats an error result honestly (no exception leaked)', () => {
    const out: any = a.formatToolResult(call, { data: null, error: 'I could not reach the schedule right now.' });
    expect(out).toEqual({ invocation_id: 'inv_1', success: false, message: 'I could not reach the schedule right now.' });
  });
});
