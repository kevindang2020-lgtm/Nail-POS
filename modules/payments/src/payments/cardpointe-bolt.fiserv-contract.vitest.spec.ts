// Fiserv master build §6 (Nov 4 2026) — Bolt / Clover Compact contract: amount encoding (no 100x), no session stealing,
// response amount parsing, lifecycle verbs. Transport is a fake; the physical Compact leg is NOT_RUN (hardware-only).
import { describe, it, expect } from 'vitest';
import { CardPointeBoltClient, boltWireAmount, boltResponseAmountCents } from './cardpointe-bolt.client';
import type { FetchLike } from './cardpointe.client';

const cfg = { baseUrl: 'https://bolt-uat.cardpointe.com/api', apiKey: 'k', merchantId: '177000000238' };

function fake(handlers: Record<string, (body: any) => { status?: number; body?: any; sessionKey?: string }>) {
  const calls: { path: string; body: any; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname; const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, headers: init.headers });
    const h = handlers[path];
    if (!h) return { status: 404, ok: false, json: async () => ({}), text: async () => 'nf' };
    const r = h(body);
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}),
      headers: { get: (n: string) => (n.toLowerCase() === 'x-cardconnect-sessionkey' ? r.sessionKey ?? null : null) } };
  };
  return { fetch, calls };
}

describe('Bolt amount encoding — Fiserv scenario amounts, no 100x error', () => {
  it.each([[100, '100'], [900, '900'], [100012, '100012'], [110025, '110025'], [12556, '12556']])('%i cents → "%s" (implied decimals)', (cents, wire) => {
    expect(boltWireAmount(cents)).toBe(wire);
  });
  it('the decimal escape hatch renders major units', () => { expect(boltWireAmount(100012, 'decimal')).toBe('1000.12'); });
  it.each([0, -1, 1.5, NaN])('refuses %s', (c) => { expect(() => boltWireAmount(c as number)).toThrow(/positive whole number/); });
  it('response amounts: decimal → major units, bare integer → cents, junk → undefined', () => {
    expect(boltResponseAmountCents('1000.12')).toBe(100012);
    expect(boltResponseAmountCents('9.00')).toBe(900);
    expect(boltResponseAmountCents('0.00')).toBe(0);
    expect(boltResponseAmountCents('100012')).toBe(100012);
    expect(boltResponseAmountCents('1e3')).toBeUndefined();
    expect(boltResponseAmountCents('')).toBeUndefined();
  });
});

describe('Bolt session and lifecycle', () => {
  it('connect sends force:false — never steals another register’s session', async () => {
    const t = fake({ '/api/v2/connect': () => ({ sessionKey: 'S' }), '/api/v3/authCard': () => ({ body: { respstat: 'A', retref: 'R', amount: '1.00' } }) });
    await new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'H', amountCents: 100 });
    expect(t.calls[0]).toMatchObject({ path: '/api/v2/connect', body: { merchantId: '177000000238', hsn: 'H', force: false } });
    expect(t.calls[1]).toMatchObject({ path: '/api/v3/authCard', body: { amount: '100' } });
    expect(t.calls[1].headers['X-CardConnect-SessionKey']).toBe('S');
  });
  it('a busy terminal (connect error) surfaces as an error, no authCard is sent', async () => {
    const t = fake({ '/api/v2/connect': () => ({ status: 500, body: { errorCode: 7, errorMessage: 'Terminal in use' } }) });
    await expect(new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'H', amountCents: 100 })).rejects.toThrow(/Terminal in use/);
    expect(t.calls.map((c) => c.path)).toEqual(['/api/v2/connect']);
  });
  it('an invalid amount is refused before any network call', async () => {
    const t = fake({});
    await expect(new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'H', amountCents: 0 })).rejects.toThrow();
    expect(t.calls).toHaveLength(0);
  });
  it('listTerminals returns the provisioned HSNs', async () => {
    const t = fake({ '/api/v2/listTerminals': () => ({ body: { terminals: ['C043UQ12345678'] } }) });
    expect(await new CardPointeBoltClient(cfg, t.fetch).listTerminals()).toEqual(['C043UQ12345678']);
  });
  it('cancel / disconnect are no-ops without our session, and carry it when we have one', async () => {
    const t = fake({ '/api/v2/connect': () => ({ sessionKey: 'S' }), '/api/v2/ping': () => ({ body: { connected: true } }), '/api/v2/cancel': () => ({}), '/api/v2/disconnect': () => ({}) });
    const c = new CardPointeBoltClient(cfg, t.fetch);
    await c.cancel('H'); await c.disconnect('H');
    expect(t.calls).toHaveLength(0);
    await c.ping('H'); await c.cancel('H'); await c.disconnect('H');
    expect(t.calls.map((x) => x.path)).toEqual(['/api/v2/connect', '/api/v2/ping', '/api/v2/cancel', '/api/v2/disconnect']);
  });
  it('authCardVersion v4 (Postman starter) is opt-in; v3 is the default', async () => {
    const t = fake({ '/api/v2/connect': () => ({ sessionKey: 'S' }), '/api/v4/authCard': () => ({ body: { respstat: 'A', retref: 'R', amount: '1.00' } }) });
    await new CardPointeBoltClient({ ...cfg, authCardVersion: 'v4' }, t.fetch).authCard({ hsn: 'H', amountCents: 100 });
    expect(t.calls[1].path).toBe('/api/v4/authCard');
  });
});
