// The Twilio Verify base URL: Twilio itself, except a LOOPBACK fake for the live proofs — and never in production.
import { describe, it, expect, vi } from 'vitest';
import { TwilioVerifyProvider, twilioVerifyBase } from './booking-verification-provider';

describe('twilioVerifyBase', () => {
  it('is Twilio by default', () => expect(twilioVerifyBase({})).toBe('https://verify.twilio.com'));
  it('a loopback fake is honoured outside production', () => {
    expect(twilioVerifyBase({ TWILIO_VERIFY_BASE_URL: 'http://127.0.0.1:3091', NODE_ENV: 'development' })).toBe('http://127.0.0.1:3091');
    expect(twilioVerifyBase({ TWILIO_VERIFY_BASE_URL: 'http://localhost:3091' })).toBe('http://localhost:3091');
  });
  it('is ignored in production — a stray env var must not send a salon’s credentials elsewhere', () => {
    expect(twilioVerifyBase({ TWILIO_VERIFY_BASE_URL: 'http://127.0.0.1:3091', NODE_ENV: 'production' })).toBe('https://verify.twilio.com');
  });
  it('anything but a loopback address is ignored', () => {
    for (const u of ['https://evil.example.com', 'http://10.0.0.5:80', 'http://127.0.0.1.evil.com:80', 'http://127.0.0.1:3091/x']) {
      expect(twilioVerifyBase({ TWILIO_VERIFY_BASE_URL: u, NODE_ENV: 'development' })).toBe('https://verify.twilio.com');
    }
  });
  it('the provider sends to the chosen base and still lets the service decide the code', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ status: 'pending', valid: false }), { status: 200 }));
    const p = new TwilioVerifyProvider(http as any, 'http://127.0.0.1:3091');
    const creds = { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1', fromNumber: null };
    expect((await p.check(creds, '+18565550199', '000000')).ok).toBe(false);
    expect(String((http.mock.calls[0] as any)[0])).toBe('http://127.0.0.1:3091/v2/Services/VA1/VerificationCheck');
  });
});

describe('send failures carry the provider error CODE (never the message) for triage — Extras BPV-12', () => {
  const creds = { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1', fromNumber: null };
  it('Twilio JSON code, else http_<status>; 429 is rate_limited; a network error is "network"', async () => {
    const p1 = new TwilioVerifyProvider((async () => new Response(JSON.stringify({ code: 20003, message: 'Authenticate ACxxxx' }), { status: 401 })) as any, 'http://127.0.0.1:3091');
    expect(await p1.send(creds, '+18565550199')).toMatchObject({ ok: false, reason: 'provider_error', providerCode: '20003' });
    const p2 = new TwilioVerifyProvider((async () => new Response('busy', { status: 429 })) as any, 'http://127.0.0.1:3091');
    expect(await p2.send(creds, '+18565550199')).toMatchObject({ ok: false, reason: 'rate_limited', providerCode: 'http_429' });
    const p3 = new TwilioVerifyProvider((async () => { throw new Error('ECONNRESET'); }) as any, 'http://127.0.0.1:3091');
    expect(await p3.send(creds, '+18565550199')).toMatchObject({ ok: false, reason: 'provider_error', providerCode: 'network' });
  });
});

describe('Phone & Messaging 12 — booking codes are transactional and NOT blocked by STOP (Kevin, Nov 12 2026)', () => {
  it('the Verify provider has no opt-out input: a number that texted STOP still gets its six-digit code', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ sid: 'VE1', status: 'pending' }), { status: 201 }));
    expect(TwilioVerifyProvider.length).toBeLessThanOrEqual(2);              // (http, base) — no opt-out store can be passed in
    const p = new TwilioVerifyProvider(http as any, 'http://127.0.0.1:3091');
    const r = await p.send({ accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1', fromNumber: null }, '+16095550301');
    expect(r).toMatchObject({ ok: true, providerVerificationSid: 'VE1' });
    expect(String((http.mock.calls[0] as any)[0])).toBe('http://127.0.0.1:3091/v2/Services/VA1/Verifications');
  });
});
