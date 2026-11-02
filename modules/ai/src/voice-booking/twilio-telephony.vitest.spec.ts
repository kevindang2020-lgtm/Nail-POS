// twilio-telephony.vitest.spec.ts — the live Twilio adapter, tested with a mocked fetch (no real account, no spend).
// Verifies it builds the correct Twilio REST requests, parses responses, maps errors, and that resolveTelephonyProvider
// returns the live adapter only when credentials are present.
import { describe, it, expect, vi } from 'vitest';
import { TwilioTelephonyProvider, TwilioApiError } from './twilio-telephony.provider';
import { resolveTelephonyProvider } from './provider-ports';

function mockFetch(handler: (url: string, init: any) => { status: number; body: any }) {
  return vi.fn(async (url: string, init: any) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
  });
}
const cfg = { accountSid: 'AC' + '0'.repeat(32), authToken: 'tok_secret', voiceWebhookUrl: 'https://api.example.com/voice/inbound' };

describe('TwilioTelephonyProvider', () => {
  it('status is connected and never leaks the full account sid', () => {
    const p = new TwilioTelephonyProvider(cfg, mockFetch(() => ({ status: 200, body: {} })));
    const s = p.status();
    expect(s.state).toBe('connected');
    expect(s.detail).not.toContain(cfg.authToken);
  });

  it('searches available numbers with the right URL + Basic auth and maps the result', async () => {
    let seenUrl = '', seenAuth = '';
    const f = mockFetch((url, init) => { seenUrl = url; seenAuth = init.headers.Authorization; return { status: 200, body: { available_phone_numbers: [{ phone_number: '+18565550100', locality: 'Camden', capabilities: { voice: true, SMS: true } }] } }; });
    const p = new TwilioTelephonyProvider(cfg, f);
    const nums = await p.searchNumbers({ areaCode: '856' });
    expect(seenUrl).toContain('/AvailablePhoneNumbers/US/Local.json');
    expect(seenUrl).toContain('AreaCode=856');
    expect(seenUrl).toContain('VoiceEnabled=true');
    expect(seenAuth.startsWith('Basic ')).toBe(true);
    expect(nums).toEqual([{ phoneNumber: '+18565550100', locality: 'Camden', capabilities: { voice: true, sms: true } }]);
  });

  it('purchases a number (POST form) and returns the sid', async () => {
    let seenBody = '';
    const f = mockFetch((_url, init) => { seenBody = init.body; return { status: 201, body: { sid: 'PN' + '1'.repeat(32), phone_number: '+18565550100' } }; });
    const p = new TwilioTelephonyProvider(cfg, f);
    const res = await p.purchaseNumber('+18565550100');
    expect(seenBody).toContain('PhoneNumber=%2B18565550100');
    expect(seenBody).toContain('VoiceUrl=');           // inbound voice webhook set at purchase
    expect(res).toEqual({ phoneNumber: '+18565550100', providerNumberId: 'PN' + '1'.repeat(32) });
  });

  it('assigns by tagging the voice webhook with the agent id', async () => {
    let seenUrl = '', seenBody = '';
    const f = mockFetch((url, init) => { seenUrl = url; seenBody = init.body; return { status: 200, body: { sid: 'PN' + '1'.repeat(32) } }; });
    await new TwilioTelephonyProvider(cfg, f).assignNumber('PN' + '1'.repeat(32), 'agent_abc');
    expect(seenUrl).toContain(`/IncomingPhoneNumbers/PN${'1'.repeat(32)}.json`);
    expect(decodeURIComponent(seenBody)).toContain('agentId=agent_abc');
  });

  it('releases via DELETE', async () => {
    let seenMethod = '';
    const f = mockFetch((_url, init) => { seenMethod = init.method; return { status: 204, body: null }; });
    await new TwilioTelephonyProvider(cfg, f).releaseNumber('PN' + '1'.repeat(32));
    expect(seenMethod).toBe('DELETE');
  });

  it('maps a Twilio error body to TwilioApiError', async () => {
    const f = mockFetch(() => ({ status: 400, body: { code: 21421, message: 'Invalid PhoneNumber' } }));
    await expect(new TwilioTelephonyProvider(cfg, f).purchaseNumber('bad')).rejects.toMatchObject({ name: 'TwilioApiError', status: 400, code: 21421 });
  });

  it('refuses to assign without a configured VoiceUrl', async () => {
    const p = new TwilioTelephonyProvider({ ...cfg, voiceWebhookUrl: null }, mockFetch(() => ({ status: 200, body: {} })));
    await expect(p.assignNumber('PN', 'agent')).rejects.toBeInstanceOf(TwilioApiError);
  });
});

describe('transferCall — B-14: the live-call redirect is THIS adapter\'s (the copilot takeover no longer calls Twilio itself)', () => {
  it('POSTs TwiML that dials the destination to /Calls/<sid>.json, escaped, with Basic auth', async () => {
    let seen: { url: string; init: any } | null = null;
    const p = new TwilioTelephonyProvider(cfg, mockFetch((url, init) => { seen = { url, init }; return { status: 200, body: { sid: 'CA123', status: 'in-progress' } }; }));
    await p.transferCall({ providerCallId: 'CA123', destination: '+18565551234' });
    expect(seen!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/CA123.json`);
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.headers.Authorization).toMatch(/^Basic /);
    const twiml = new URLSearchParams(seen!.init.body).get('Twiml')!;
    expect(twiml).toContain('<Dial>+18565551234</Dial>');
    const q = new TwilioTelephonyProvider(cfg, mockFetch((url, init) => { seen = { url, init }; return { status: 200, body: {} }; }));
    await q.transferCall({ providerCallId: 'CA 1/2', destination: 'sip:a&b@x' });
    expect(seen!.url).toContain('/Calls/CA%201%2F2.json');
    expect(new URLSearchParams(seen!.init.body).get('Twiml')).toContain('<Dial>sip:a&amp;b@x</Dial>');
  });
  it('a Twilio error (e.g. the call already ended) surfaces as TwilioApiError, never a success', async () => {
    const p = new TwilioTelephonyProvider(cfg, mockFetch(() => ({ status: 404, body: { code: 20404, message: 'The requested resource /Calls/CA1.json was not found' } })));
    await expect(p.transferCall({ providerCallId: 'CA1', destination: '+1' })).rejects.toMatchObject({ name: 'TwilioApiError', status: 404, code: 20404 });
  });
});

describe('resolveTelephonyProvider', () => {
  it('returns the live adapter when creds are present, NotConnected otherwise', () => {
    expect(resolveTelephonyProvider({} as any).status().state).toBe('not_connected');
    const live = resolveTelephonyProvider({ TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 'tok' } as any);
    expect(live.status().state).toBe('connected');
    expect(live).toBeInstanceOf(TwilioTelephonyProvider);
  });
});
