// twilio-inbound.vitest.spec.ts — the security-critical inbound path. Verifies the Twilio signature algorithm and
// timing-safe comparison, the opt-out/opt-in keyword parsing, and that handleInbound only acts on a genuine, verified,
// tenant-owned message — recording STOP/START through the existing NotificationsService.
import { testProviderSecrets } from '@aipowersalon/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeTwilioSignature, verifyTwilioSignature, classifyInboundKeyword } from '@aipowersalon/notifications';
import { TwilioInboundService } from './twilio-inbound.service';

const TOKEN = 'test_auth_token';
const URL = 'https://api.example.com/webhooks/twilio/sms/inbound';

describe('twilio signature', () => {
  it('verifies a correctly-signed request and rejects a tampered one', () => {
    const params = { From: '+15551234567', To: '+18565550000', Body: 'STOP' };
    const sig = computeTwilioSignature(TOKEN, URL, params);
    expect(verifyTwilioSignature(TOKEN, URL, params, sig)).toBe(true);
    expect(verifyTwilioSignature(TOKEN, URL, { ...params, Body: 'START' }, sig)).toBe(false);  // tampered param
    expect(verifyTwilioSignature(TOKEN, URL, params, 'wrong')).toBe(false);
    expect(verifyTwilioSignature('', URL, params, sig)).toBe(false);                            // no token
    expect(verifyTwilioSignature(TOKEN, URL, params, undefined)).toBe(false);                   // no signature
  });
});

describe('classifyInboundKeyword', () => {
  it('maps standard keywords case-insensitively', () => {
    for (const w of ['STOP', 'stop', 'Unsubscribe', 'CANCEL', 'quit', 'END']) expect(classifyInboundKeyword(w)).toBe('stop');
    for (const w of ['START', 'yes', 'UNSTOP']) expect(classifyInboundKeyword(w)).toBe('start');
    expect(classifyInboundKeyword('HELP')).toBe('help');
    expect(classifyInboundKeyword('see you at 2')).toBeNull();
    expect(classifyInboundKeyword('')).toBeNull();
  });
});

describe('TwilioInboundService.handleInbound', () => {
  const notifications = { recordOptOut: vi.fn(async () => ({ ok: true })), recordOptIn: vi.fn(async () => ({ ok: true })) };
  function svc(tenantForNumber: string | null) {
    const s = new TwilioInboundService({} as any, notifications as any, testProviderSecrets);
    (s as any).tenantForNumber = vi.fn(async () => tenantForNumber);
    return s;
  }
  const params = { From: '+15551234567', To: '+18565550000', Body: 'STOP' };
  const signed = (p: Record<string, string>) => computeTwilioSignature(TOKEN, URL, p);
  beforeEach(() => { process.env.TWILIO_AUTH_TOKEN = TOKEN; notifications.recordOptOut.mockClear(); notifications.recordOptIn.mockClear(); });
  afterEach(() => { delete process.env.TWILIO_AUTH_TOKEN; });

  it('records an opt-out for a verified STOP from a known number', async () => {
    const s = svc('ten_1');
    const r = await s.handleInbound({ from: params.From, to: params.To, body: 'STOP', signature: signed(params), url: URL, params });
    expect(r).toEqual({ status: 'opted_out', tenantId: 'ten_1' });
    expect(notifications.recordOptOut).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), 'sms', params.From, 'inbound_stop');
  });
  it('records an opt-in for a verified START', async () => {
    const p = { ...params, Body: 'START' };
    const s = svc('ten_1');
    const r = await s.handleInbound({ from: p.From, to: p.To, body: 'START', signature: signed(p), url: URL, params: p });
    expect(r).toEqual({ status: 'opted_in', tenantId: 'ten_1' });
    expect(notifications.recordOptIn).toHaveBeenCalled();
  });
  it('ignores a bad signature and never writes', async () => {
    const s = svc('ten_1');
    const r = await s.handleInbound({ from: params.From, to: params.To, body: 'STOP', signature: 'forged', url: URL, params });
    expect(r).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect(notifications.recordOptOut).not.toHaveBeenCalled();
  });
  it('ignores an unknown receiving number', async () => {
    const s = svc(null);
    const r = await s.handleInbound({ from: params.From, to: params.To, body: 'STOP', signature: signed(params), url: URL, params });
    expect(r).toEqual({ status: 'ignored', reason: 'unknown_number' });
    expect(notifications.recordOptOut).not.toHaveBeenCalled();
  });
  it('refuses when no auth token is configured (security-first)', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const s = svc('ten_1');
    const r = await s.handleInbound({ from: params.From, to: params.To, body: 'STOP', signature: signed(params), url: URL, params });
    expect(r).toEqual({ status: 'ignored', reason: 'no_signature_config' });
  });
  it('verification token falls back to the shared token when no per-tenant account matches', async () => {
    process.env.TWILIO_AUTH_TOKEN = 'GLOBAL_TOKEN';
    const s = new TwilioInboundService(null as any, notifications as any, testProviderSecrets);   // no DB → always the shared token
    expect(await (s as any).verificationTokenFor('ten_1', undefined)).toEqual({ token: 'GLOBAL_TOKEN' });
    expect(await (s as any).verificationTokenFor('ten_1', 'ACunknown')).toEqual({ token: 'GLOBAL_TOKEN' });
    delete process.env.TWILIO_AUTH_TOKEN;
  });
});

describe('TwilioInboundService.handleStatus (delivery receipts)', () => {
  const notifications = { recordDeliveryStatus: vi.fn(async () => ({ updated: 1 })) };
  // E2: the tenant comes from the stored message row (stubbed here; the pgtest covers the real lookup)
  const statusSvc = () => { const s = new TwilioInboundService({} as any, notifications as any, testProviderSecrets); (s as any).tenantForMessage = vi.fn(async () => ({ tenantId: 'ten_1', kind: 'notification' })); return s; };
  const p = { MessageSid: 'SM123', MessageStatus: 'delivered' };
  const sig = () => computeTwilioSignature(TOKEN, URL, p);
  beforeEach(() => { process.env.TWILIO_AUTH_TOKEN = TOKEN; notifications.recordDeliveryStatus.mockClear(); });
  afterEach(() => { delete process.env.TWILIO_AUTH_TOKEN; });
  it('records the delivery status for a verified callback', async () => {
    const s = statusSvc();
    const r = await s.handleStatus({ sid: 'SM123', status: 'delivered', signature: sig(), url: URL, params: p });
    expect(r).toEqual({ status: 'recorded', updated: 1 });
    expect(notifications.recordDeliveryStatus).toHaveBeenCalledWith('SM123', 'delivered', { errorCode: null, segments: null }, { tenantId: 'ten_1' });
  });
  it('wave 3 PAYI §87: the provider error code and segment count ride along to the ledger (support-only facts)', async () => {
    const q = { MessageSid: 'SM124', MessageStatus: 'undelivered', ErrorCode: '30007', NumSegments: '2' };
    const s = statusSvc();
    const r = await s.handleStatus({ sid: 'SM124', status: 'undelivered', signature: computeTwilioSignature(TOKEN, URL, q), url: URL, params: q });
    expect(r).toEqual({ status: 'recorded', updated: 1 });
    expect(notifications.recordDeliveryStatus).toHaveBeenCalledWith('SM124', 'undelivered', { errorCode: '30007', segments: 2 }, { tenantId: 'ten_1' });
  });
  it('ignores a forged status callback', async () => {
    const s = statusSvc();
    const r = await s.handleStatus({ sid: 'SM123', status: 'delivered', signature: 'forged', url: URL, params: p });
    expect(r).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect(notifications.recordDeliveryStatus).not.toHaveBeenCalled();
  });
});
