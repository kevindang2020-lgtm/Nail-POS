// cardpointe-bolt.client.vitest.spec.ts — verifies the Bolt (Integrated Terminal API) client builds requests to the
// documented contract and parses responses correctly. Transport is a fake; the physical-device leg is hardware-only.
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { CardPointeBoltClient, terminalSignatureDataUrl } from './cardpointe-bolt.client';
import type { FetchLike } from './cardpointe.client';

const cfg = { baseUrl: 'https://mysite.bolt.cardpointe.com/', apiKey: 'bolt-key-123', merchantId: '496160873888' };

function transport(handlers: Record<string, (body: any, headers: Record<string, string>) => { status?: number; body?: any; sessionKey?: string }>): { fetch: FetchLike; calls: { url: string; body: any; headers: Record<string, string> }[] } {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init.headers });
    const path = new URL(url).pathname;
    const h = handlers[path];
    if (!h) return { status: 404, ok: false, json: async () => ({}), text: async () => 'not found' };
    const r = h(body, init.headers);
    return {
      status: r.status ?? 200, ok: (r.status ?? 200) < 300,
      json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}),
      headers: { get: (n: string) => (n.toLowerCase() === 'x-cardconnect-sessionkey' ? r.sessionKey ?? null : null) },
    };
  };
  return { fetch, calls };
}

describe('CardPointeBoltClient', () => {
  it('connects first, carries the session key, and sends authCard per the documented contract', async () => {
    const t = transport({
      '/api/v2/connect': () => ({ body: {}, sessionKey: 'SK123;10.0.0.5' }),
      '/api/v3/authCard': (body) => {
        expect(body.merchantId).toBe(cfg.merchantId);          // Bolt uses camelCase merchantId (gateway uses merchid)
        expect(body.hsn).toBe('1234567890');
        expect(body.amount).toBe('11098');                      // Fiserv docs: two implied decimals ("1000" = $10.00)
        expect(body.force).toBeUndefined();
        expect(body.capture).toBe('true');
        expect(body.includeSignature).toBe('true');               // Kevin, Oct 6 2026: the cardholder signs on the Clover
        expect(body.orderId).toBe('tkt_1');
        return { body: { respstat: 'A', retref: 'RR1', authcode: 'OK123', resptext: 'Approval', amount: '110.98' } };
      },
    });
    const c = new CardPointeBoltClient(cfg, t.fetch);
    const r = await c.authCard({ hsn: '1234567890', amountCents: 11098, orderId: 'tkt_1' });
    expect(r.approved).toBe(true);
    expect(r.retref).toBe('RR1');
    expect(r.amountCents).toBe(11098);
    // contract details on the wire:
    expect(t.calls[0].url).toBe('https://mysite.bolt.cardpointe.com/api/v2/connect'); // trailing slash trimmed
    expect(t.calls[0].headers.Authorization).toBe('bolt-key-123');                    // raw api key, NOT Basic
    expect(t.calls[1].headers['X-CardConnect-SessionKey']).toBe('SK123');             // ;ip suffix stripped
  });

  it('maps respstat C to a decline (never an exception)', async () => {
    const t = transport({
      '/api/v2/connect': () => ({ body: {}, sessionKey: 'SK1' }),
      '/api/v3/authCard': () => ({ body: { respstat: 'C', resptext: 'Insufficient funds' } }),
    });
    const r = await new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'h', amountCents: 500 });
    expect(r.approved).toBe(false);
    expect(r.declined).toBe(true);
    expect(r.respText).toBe('Insufficient funds');
  });

  it('throws ProcessorError when connect yields no session key (a real Bolt failure mode)', async () => {
    const t = transport({ '/api/v2/connect': () => ({ body: {} }) });
    await expect(new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'h', amountCents: 100 })).rejects.toThrow(/session key/i);
  });

  it('throws ProcessorError on HTTP failure with status + body excerpt', async () => {
    const t = transport({ '/api/v2/connect': () => ({ status: 401, body: { error: 'bad key' } }) });
    await expect(new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'h', amountCents: 100 })).rejects.toThrow(/HTTP 401/);
  });

  it('ping returns false instead of throwing when the terminal is unreachable', async () => {
    const t = transport({});
    expect(await new CardPointeBoltClient(cfg, t.fetch).ping('h')).toBe(false);
  });
});

// a tiny 2×1 bitmap: the "BM" header is what matters to the decoder
const BMP = Buffer.concat([Buffer.from('BM'), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);

describe('the signature the Clover terminal takes (Kevin, Oct 6 2026: sign once, on the terminal)', () => {
  it('authCard hands back the signature the terminal returned, untouched; none when it sent none', async () => {
    const sig = gzipSync(BMP).toString('base64');
    const t = transport({ '/api/v2/connect': () => ({ body: {}, sessionKey: 'SK1' }), '/api/v3/authCard': () => ({ body: { respstat: 'A', retref: 'R', signature: sig } }) });
    expect((await new CardPointeBoltClient(cfg, t.fetch).authCard({ hsn: 'h', amountCents: 100 })).signature).toBe(sig);
    const t2 = transport({ '/api/v2/connect': () => ({ body: {}, sessionKey: 'SK1' }), '/api/v3/authCard': () => ({ body: { respstat: 'A', retref: 'R' } }) });
    expect((await new CardPointeBoltClient(cfg, t2.fetch).authCard({ hsn: 'h', amountCents: 100 })).signature).toBeUndefined();
  });
  it('terminalSignatureDataUrl: a gzip-compressed bitmap (CardPointe\'s format), a plain bitmap, PNG or JPEG become a viewable image', () => {
    expect(terminalSignatureDataUrl(gzipSync(BMP).toString('base64'))).toBe('data:image/bmp;base64,' + BMP.toString('base64'));
    expect(terminalSignatureDataUrl(BMP.toString('base64'))).toBe('data:image/bmp;base64,' + BMP.toString('base64'));
    expect(terminalSignatureDataUrl(gzipSync(PNG).toString('base64'))).toBe('data:image/png;base64,' + PNG.toString('base64'));
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    expect(terminalSignatureDataUrl(jpg.toString('base64'))).toBe('data:image/jpeg;base64,' + jpg.toString('base64'));
  });
  it('anything else is not stored: empty, not base64 of an image, a broken gzip, or too big', () => {
    for (const bad of [undefined, null, '', '   ', 12, Buffer.from('<svg onload=alert(1)>').toString('base64'), Buffer.from([0x1f, 0x8b, 1, 2, 3]).toString('base64')]) expect(terminalSignatureDataUrl(bad)).toBeNull();
    const huge = gzipSync(Buffer.concat([Buffer.from('BM'), Buffer.alloc(3_000_000)])).toString('base64');
    expect(terminalSignatureDataUrl(huge)).toBeNull();
    // and an uncompressed one over 2 MB (the gzip limit does not apply to it)
    expect(terminalSignatureDataUrl(Buffer.concat([Buffer.from('BM'), Buffer.alloc(2_100_000)]).toString('base64'))).toBeNull();
  });
});

describe('CardPointeBoltClient — the base URL exactly as Fiserv hands it out', () => {
  it("'https://bolt-uat.cardpointe.com/api/' is not doubled into /api/api/v2/… (found live: HTTP 404)", async () => {
    const calls: string[] = [];
    const fetchImpl: any = async (url: string) => { calls.push(url); return { status: 200, ok: true, json: async () => ({}), text: async () => '{"connected":true}', headers: { get: (n: string) => (n.toLowerCase() === 'x-cardconnect-sessionkey' ? 'sess;1.2.3.4' : null) } }; };
    const c = new CardPointeBoltClient({ baseUrl: 'https://bolt-uat.cardpointe.com/api/', apiKey: 'k', merchantId: 'm' } as any, fetchImpl);
    await c.ping('HSN1');
    expect(calls[0]).toBe('https://bolt-uat.cardpointe.com/api/v2/connect');
    expect(calls[1]).toBe('https://bolt-uat.cardpointe.com/api/v2/ping');
  });
});
