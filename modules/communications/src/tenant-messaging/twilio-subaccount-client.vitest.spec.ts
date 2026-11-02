// twilio-subaccount-client.vitest.spec — B-16 (Oct 20 2026): the REST calls a platform-managed salon needs, against a fake
// Twilio: find-or-create the salon's subaccount (by its friendly name, so a retry after a lost answer never makes a second
// one), create its Messaging Service (inbound webhook set), attach a purchased number to it. Errors surface, never succeed.
import { describe, it, expect } from 'vitest';
import { TwilioSubaccountClient } from './twilio-subaccount-client';

const MASTER = { accountSid: 'AC' + 'm'.repeat(32), authToken: 'master-token' };
const SUB = { accountSid: 'AC' + 's'.repeat(32), authToken: 'sub-token' };
function fake(routes: Record<string, (url: string, init: any) => { status: number; body: any }>) {
  const calls: Array<{ method: string; url: string; auth: string; body: URLSearchParams | null }> = [];
  const http = (async (url: string, init: any = {}) => {
    calls.push({ method: init.method || 'GET', url, auth: init.headers?.Authorization || '', body: init.body ? new URLSearchParams(init.body) : null });
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(' '); return (init.method || 'GET') === m && url.startsWith(p); });
    const { status, body } = key ? routes[key](url, init) : { status: 404, body: { message: 'no route' } };
    return { ok: status >= 200 && status < 300, status, json: async () => body } as any;
  }) as typeof fetch;
  return { http, calls };
}
const basic = (c: { accountSid: string; authToken: string }) => 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64');
const T = '11111111-1111-4111-8111-111111111111';

describe('TwilioSubaccountClient', () => {
  it('findOrCreateSubaccount: an existing subaccount with the salon\'s name is REUSED (a retry never makes a second one)', async () => {
    const { http, calls } = fake({ 'GET https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 200, body: { accounts: [{ sid: SUB.accountSid, auth_token: SUB.authToken, status: 'active', friendly_name: `AIPowerSalon ${T}` }] } }) });
    const r = await new TwilioSubaccountClient(MASTER, http).findOrCreateSubaccount(`AIPowerSalon ${T}`);
    expect(r).toEqual({ accountSid: SUB.accountSid, authToken: SUB.authToken, created: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('FriendlyName=AIPowerSalon+' + T);
    expect(calls[0].auth).toBe(basic(MASTER));
  });
  it('findOrCreateSubaccount: none yet → POST /Accounts.json with the friendly name, under the master account', async () => {
    const { http, calls } = fake({
      'GET https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 200, body: { accounts: [] } }),
      'POST https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 201, body: { sid: SUB.accountSid, auth_token: SUB.authToken, status: 'active' } }),
    });
    const r = await new TwilioSubaccountClient(MASTER, http).findOrCreateSubaccount(`AIPowerSalon ${T}`);
    expect(r).toEqual({ accountSid: SUB.accountSid, authToken: SUB.authToken, created: true });
    expect(calls[1].method).toBe('POST'); expect(calls[1].body?.get('FriendlyName')).toBe(`AIPowerSalon ${T}`); expect(calls[1].auth).toBe(basic(MASTER));
  });
  it('a closed / suspended subaccount with the name is not reused silently — it is an error', async () => {
    const { http } = fake({ 'GET https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 200, body: { accounts: [{ sid: SUB.accountSid, auth_token: 'x', status: 'suspended' }] } }) });
    await expect(new TwilioSubaccountClient(MASTER, http).findOrCreateSubaccount('n')).rejects.toThrow(/suspended/);
  });
  it('createMessagingService: under the SUBACCOUNT, inbound webhook POST', async () => {
    const { http, calls } = fake({ 'POST https://messaging.twilio.com/v1/Services': () => ({ status: 201, body: { sid: 'MG' + 'a'.repeat(32) } }) });
    const sid = await new TwilioSubaccountClient(SUB, http).createMessagingService('AIPowerSalon salon', 'https://api.example/webhooks/twilio/sms/inbound');
    expect(sid).toBe('MG' + 'a'.repeat(32));
    expect(calls[0].auth).toBe(basic(SUB));
    expect(calls[0].body?.get('InboundRequestUrl')).toBe('https://api.example/webhooks/twilio/sms/inbound');
    expect(calls[0].body?.get('InboundMethod')).toBe('POST');
  });
  it('attachNumber: POST Services/<MG>/PhoneNumbers; an already-attached number (21710) counts as attached', async () => {
    const ok = fake({ 'POST https://messaging.twilio.com/v1/Services/MGx/PhoneNumbers': () => ({ status: 201, body: { sid: 'PNx' } }) });
    await new TwilioSubaccountClient(SUB, ok.http).attachNumber('MGx', 'PNx');
    expect(ok.calls[0].body?.get('PhoneNumberSid')).toBe('PNx');
    const dup = fake({ 'POST https://messaging.twilio.com/v1/Services/MGx/PhoneNumbers': () => ({ status: 409, body: { code: 21710, message: 'already in the service' } }) });
    await expect(new TwilioSubaccountClient(SUB, dup.http).attachNumber('MGx', 'PNx')).resolves.toBeUndefined();
    const bad = fake({ 'POST https://messaging.twilio.com/v1/Services/MGx/PhoneNumbers': () => ({ status: 400, body: { code: 21712, message: 'wrong account' } }) });
    await expect(new TwilioSubaccountClient(SUB, bad.http).attachNumber('MGx', 'PNx')).rejects.toThrow(/wrong account/);
  });

  // §149 (Oct 28 2026): offboarding a cancelled salon
  it('releaseNumber: DELETE in the SUBACCOUNT with its own credentials; an already-gone number (404) is done; anything else throws', async () => {
    const PN = 'PN' + 'a'.repeat(32);
    const ok = fake({ [`DELETE https://api.twilio.com/2010-04-01/Accounts/${SUB.accountSid}/IncomingPhoneNumbers/${PN}.json`]: () => ({ status: 204, body: {} }) });
    expect(await new TwilioSubaccountClient(SUB, ok.http).releaseNumber(PN)).toEqual({ released: true, alreadyGone: false });
    expect(ok.calls[0]).toMatchObject({ method: 'DELETE', auth: basic(SUB) });
    const gone = fake({});   // no route → 404
    expect(await new TwilioSubaccountClient(SUB, gone.http).releaseNumber(PN)).toEqual({ released: false, alreadyGone: true });
    const down = fake({ 'DELETE https://api.twilio.com': () => ({ status: 500, body: { message: 'boom' } }) });
    await expect(new TwilioSubaccountClient(SUB, down.http).releaseNumber(PN)).rejects.toThrow(/twilio_failed:boom/);
  });
  it('closeSubaccount: POST Status=closed with the MASTER credentials; never the master account itself', async () => {
    const { http, calls } = fake({ [`POST https://api.twilio.com/2010-04-01/Accounts/${SUB.accountSid}.json`]: () => ({ status: 200, body: { sid: SUB.accountSid, status: 'closed' } }) });
    expect(await new TwilioSubaccountClient(MASTER, http).closeSubaccount(SUB.accountSid)).toEqual({ closed: true, alreadyClosed: false });
    expect(calls[0].auth).toBe(basic(MASTER));
    expect(calls[0].body?.get('Status')).toBe('closed');
    await expect(new TwilioSubaccountClient(MASTER, http).closeSubaccount(MASTER.accountSid)).rejects.toThrow(/master/);
    expect(calls).toHaveLength(1);
  });
  it('findOrCreateSubaccount: a CLOSED subaccount (an offboarded salon that came back) is ignored — a new one is opened', async () => {
    const { http, calls } = fake({
      'GET https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 200, body: { accounts: [{ sid: SUB.accountSid, auth_token: 'x', status: 'closed' }] } }),
      'POST https://api.twilio.com/2010-04-01/Accounts.json': () => ({ status: 201, body: { sid: 'AC' + 'n'.repeat(32), auth_token: 'new-token' } }),
    });
    expect(await new TwilioSubaccountClient(MASTER, http).findOrCreateSubaccount(`AIPowerSalon ${T}`)).toMatchObject({ created: true, accountSid: 'AC' + 'n'.repeat(32) });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });
});
