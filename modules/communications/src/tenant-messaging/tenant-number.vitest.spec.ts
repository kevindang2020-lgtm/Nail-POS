// tenant-number.vitest.spec.ts — number search/purchase client shaping + service honesty. The buy/register that touch
// the DB (account resolution, from-number sync) are proven via the real-PG smoke.
import { testProviderSecrets as providerSecrets } from '@aipowersalon/testing';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwilioNumbersClient } from './twilio-numbers-client';
import { TenantNumberService } from './tenant-number.service';

describe('TwilioNumbersClient request shaping', () => {
  function stub(rows: any = { available_phone_numbers: [{ phone_number: '+18565550001', friendly_name: '(856) 555-0001', locality: 'Camden', region: 'NJ' }] }) {
    const calls: { url: string; method: string; body: string }[] = [];
    const http = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), method: init?.method || 'GET', body: String(init?.body ?? '') }); return { ok: true, json: async () => (String(url).includes('IncomingPhoneNumbers') ? { sid: 'PNx', phone_number: '+18565550001' } : rows) } as any; });
    return { calls, client: new TwilioNumbersClient({ accountSid: 'AC1', authToken: 'tok' }, http as any) };
  }
  it('searches SMS-enabled local numbers by area code', async () => {
    const { calls, client } = stub();
    const out = await client.searchLocal({ country: 'US', areaCode: '856' });
    expect(calls[0].url).toContain('/AvailablePhoneNumbers/US/Local.json');
    expect(calls[0].url).toContain('SmsEnabled=true');
    expect(calls[0].url).toContain('AreaCode=856');
    expect(out[0].phoneNumber).toBe('+18565550001');
  });
  it('purchases a number and sets the inbound SMS webhook', async () => {
    const { calls, client } = stub();
    const out = await client.purchase('+18565550001', { smsUrl: 'https://api.x.com/webhooks/twilio/sms/inbound' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/IncomingPhoneNumbers.json');
    expect(calls[0].body).toContain('PhoneNumber=');
    expect(decodeURIComponent(calls[0].body)).toContain('SmsUrl=https://api.x.com/webhooks/twilio/sms/inbound');
    expect(out.sid).toBe('PNx');
  });
  it('throws a readable error on Twilio failure', async () => {
    const http = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'no numbers available' }) } as any));
    const c = new TwilioNumbersClient({ accountSid: 'AC1', authToken: 'tok' }, http as any);
    await expect(c.searchLocal({ areaCode: '856' })).rejects.toThrow(/no numbers available/);
  });
});

describe('TenantNumberService honesty (no account configured)', () => {
  const audit = { record: vi.fn(async () => ({})) };
  beforeEach(() => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });
  afterEach(() => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });
  it('search returns configured=false and no numbers without an account', async () => {
    const svc = new TenantNumberService(null as any, audit as any, providerSecrets);
    expect(await svc.search('ten_1', {})).toEqual({ available: [], configured: false });
  });
  it('buyAndRegister refuses (no fabricated number) without an account', async () => {
    const svc = new TenantNumberService(null as any, audit as any, providerSecrets);
    expect(await svc.buyAndRegister('admin', 'ten_1', '+18565550001')).toEqual({ ok: false, reason: 'not_configured' });
  });
  it('validates E.164 before doing anything', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 'tok';
    const svc = new TenantNumberService(null as any, audit as any, providerSecrets);
    expect(await svc.buyAndRegister('admin', 'ten_1', '5551234')).toEqual({ ok: false, error: 'A valid E.164 number is required.' });
  });
});
