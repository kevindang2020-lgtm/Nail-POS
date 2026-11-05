import { describe, it, expect } from 'vitest';
import { CardPointeClient, FetchLike, FetchResponseLike } from './cardpointe.client';
import { ProcessorError } from './payment-processor.port';

// A programmable fake transport: records the last request and returns a queued response (or throws).
function fakeTransport(handler: (url: string, init: any) => FetchResponseLike | Promise<FetchResponseLike>) {
  const calls: { url: string; init: any; body: any }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}
const ok = (json: any): FetchResponseLike => ({ status: 200, ok: true, json: async () => json, text: async () => JSON.stringify(json) });
const cfg = { baseUrl: 'https://fts-uat.cardconnect.com', merchid: '496160873888', username: 'apiuser', password: 's3cret' };

describe('CardPointeClient', () => {
  it('authorizeAndCapture builds a correct /auth request and maps an approval', async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: '343005123456', authcode: 'OK123', amount: '12.50', resptext: 'Approval' }));
    const client = new CardPointeClient(cfg, t.fetchImpl);
    const res = await client.authorizeAndCapture({ account: '9418594164541111', expiry: '1229', amountCents: 1250, orderId: 'tk_1' });

    expect(res).toMatchObject({ approved: true, declined: false, retref: '343005123456', authCode: 'OK123', respstat: 'A', amountCents: 1250 });
    const c = t.calls[0];
    expect(c.url).toBe('https://fts-uat.cardconnect.com/cardconnect/rest/auth');
    expect(c.init.method).toBe('PUT');
    expect(c.init.headers.Authorization).toMatch(/^Basic /);
    // Basic header decodes to user:pass
    expect(Buffer.from(c.init.headers.Authorization.slice(6), 'base64').toString()).toBe('apiuser:s3cret');
    expect(c.body).toMatchObject({ merchid: '496160873888', account: '9418594164541111', expiry: '1229', amount: '12.50', currency: 'USD', capture: 'Y', orderid: 'tk_1' });
  });

  it('formats cents to a 2dp dollar string', async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: 'r', amount: '100.05' }));
    await new CardPointeClient(cfg, t.fetchImpl).authorizeAndCapture({ account: 'tok', amountCents: 10005 });
    expect(t.calls[0].body.amount).toBe('100.05');
  });

  it('maps a decline (respstat C)', async () => {
    const t = fakeTransport(() => ok({ respstat: 'C', retref: 'r2', resptext: 'Declined' }));
    const res = await new CardPointeClient(cfg, t.fetchImpl).authorizeAndCapture({ account: 'tok', amountCents: 500 });
    expect(res.approved).toBe(false);
    expect(res.declined).toBe(true);
    expect(res.respText).toBe('Declined');
  });

  it('refund posts merchid+retref+amount to /refund', async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: 'rfnd1', resptext: 'Approval' }));
    const res = await new CardPointeClient(cfg, t.fetchImpl).refund({ retref: '343005123456', amountCents: 1250 });
    expect(res.ok).toBe(true);
    expect(t.calls[0].url).toMatch(/\/cardconnect\/rest\/refund$/);
    expect(t.calls[0].body).toMatchObject({ merchid: '496160873888', retref: '343005123456', amount: '12.50' });
  });

  it('void posts merchid+retref (no amount) to /void', async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: 'void1' }));
    const res = await new CardPointeClient(cfg, t.fetchImpl).voidTransaction({ retref: '343005123456' });
    expect(res.ok).toBe(true);
    expect(t.calls[0].url).toMatch(/\/cardconnect\/rest\/void$/);
    expect(t.calls[0].body).toEqual({ merchid: '496160873888', retref: '343005123456' });
  });

  it('throws ProcessorError on a non-2xx response', async () => {
    const t = fakeTransport(() => ({ status: 401, ok: false, json: async () => ({}), text: async () => 'Unauthorized' }));
    await expect(new CardPointeClient(cfg, t.fetchImpl).authorizeAndCapture({ account: 'tok', amountCents: 100 }))
      .rejects.toBeInstanceOf(ProcessorError);
  });

  it('throws ProcessorError when the transport itself fails', async () => {
    const t = fakeTransport(() => { throw new Error('ECONNREFUSED'); });
    await expect(new CardPointeClient(cfg, t.fetchImpl).voidTransaction({ retref: 'x' }))
      .rejects.toBeInstanceOf(ProcessorError);
  });
});

describe('CardPointeClient — Fiserv onboarding requirements (Aug 27 2026)', () => {
  it("a base URL pasted with the /cardconnect/rest suffix (as Fiserv hands it out) is not doubled", async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: '1', amount: '1.00' }));
    const client = new CardPointeClient({ ...cfg, baseUrl: 'https://isv-uat.cardconnect.com/cardconnect/rest/' }, t.fetchImpl);
    await client.authorizeAndCapture({ account: '9418594164541111', amountCents: 100 });
    expect(t.calls[0].url).toBe('https://isv-uat.cardconnect.com/cardconnect/rest/auth');
  });
  it("every charge is card-not-present by default: ecomind 'E' is always sent (Fiserv processes CNP without it as card present)", async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: '1', amount: '1.00' }));
    const client = new CardPointeClient(cfg, t.fetchImpl);
    await client.authorizeAndCapture({ account: '9418594164541111', amountCents: 100 });
    expect(t.calls[0].body.ecomind).toBe('E');
    await client.authorizeAndCapture({ account: '9418594164541111', amountCents: 100, ecomind: 'R' });
    expect(t.calls[1].body.ecomind).toBe('R');
  });
  it('cardholder name, AVS and the stored-credential (COF) fields are sent exactly as stated, and never invented', async () => {
    const t = fakeTransport(() => ok({ respstat: 'A', retref: '1', amount: '1.00', profileid: '16700000000001', avsresp: 'Y', cvvresp: 'M' }));
    const client = new CardPointeClient(cfg, t.fetchImpl);
    const res = await client.authorizeAndCapture({ account: '9418594164541111', amountCents: 100, name: 'Ava Kim', address: '12 Main St', postal: '08109',
      cof: 'M', cofscheduled: 'Y', profile: 'Y' });
    expect(t.calls[0].body).toMatchObject({ name: 'Ava Kim', address: '12 Main St', postal: '08109', cof: 'M', cofscheduled: 'Y', profile: 'Y' });
    expect(t.calls[0].body).not.toHaveProperty('cofpermission');
    expect(res).toMatchObject({ profileId: '16700000000001', avsResp: 'Y', cvvResp: 'M' });
    await client.authorizeAndCapture({ account: '9418594164541111', amountCents: 100 });
    for (const k of ['name', 'address', 'postal', 'cof', 'cofscheduled', 'cofpermission', 'profile']) expect(t.calls[1].body).not.toHaveProperty(k);
  });
  it('testConnection is a charge-free GET inquireMerchant that reports what the merchant supports', async () => {
    const t = fakeTransport(() => ok({ site: 'isv', merchid: '496160873888', enabled: true, cardproc: 'RPCT', avs: 'N', cvv: 'N' }));
    const client = new CardPointeClient(cfg, t.fetchImpl);
    const r = await client.testConnection();
    expect(t.calls[0].url).toBe('https://fts-uat.cardconnect.com/cardconnect/rest/inquireMerchant/496160873888');
    expect(t.calls[0].init.method).toBe('GET');
    expect(t.calls[0].init.body).toBeUndefined();
    expect(r).toMatchObject({ ok: true, merchantEnabled: true, cardProcessor: 'RPCT', avsSupported: false, cvvSupported: false });
    expect(r.message).toContain('496160873888');
  });
  it('testConnection reports a bad credential or host honestly instead of throwing', async () => {
    const t = fakeTransport(() => ({ status: 401, ok: false, json: async () => ({}), text: async () => 'Unauthorized' }));
    const r = await new CardPointeClient(cfg, t.fetchImpl).testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/401/);
  });
});
