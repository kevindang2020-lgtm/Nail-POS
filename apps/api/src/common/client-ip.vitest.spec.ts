// client-ip.vitest.spec — Constitution 12 §50–58: the client IP cannot be forged, and every IP-keyed control gets it.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientIp } from '@aipowersalon/security';
import { trustProxyHops } from '@aipowersalon/config';

describe('trust proxy is a HOP COUNT, never "true"', () => {
  it('production defaults to 1 (Railway\'s edge); elsewhere 0', () => {
    expect(trustProxyHops({ NODE_ENV: 'production' })).toBe(1); expect(trustProxyHops({ NODE_ENV: 'development' })).toBe(0);
  });
  it('configurable, bounded; nonsense falls back to 0 (trust nothing), not to "trust everything"', () => {
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: 'true', NODE_ENV: 'production' })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '99' })).toBe(0);
  });
});

describe('through a REAL Express server behind one proxy hop', () => {
  const serve = async (hops: number, headers: Record<string, string>) => {
    const express = (await import('express')).default;
    const app = express(); app.set('trust proxy', hops);
    app.get('/ip', (req, res) => res.json({ ip: clientIp(req) }));
    return new Promise<string | null>((resolve) => {
      const srv = app.listen(0, '127.0.0.1', async () => {
        const r = await fetch(`http://127.0.0.1:${(srv.address() as any).port}/ip`, { headers });
        resolve((await r.json()).ip); srv.close();
      });
    });
  };
  it('the address Railway\'s edge appended is the client — the one real hop', async () => {
    expect(await serve(1, { 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7');
  });
  it('a client that PREPENDS its own fake entry does not change the answer', async () => {
    // The client sends "X-Forwarded-For: 1.2.3.4"; Railway's edge appends the real address → "1.2.3.4, 203.0.113.7".
    expect(await serve(1, { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })).toBe('203.0.113.7');
  });
  it('with no proxy trusted (dev), the header is ignored entirely', async () => {
    expect(await serve(0, { 'x-forwarded-for': '1.2.3.4' })).toBe('127.0.0.1');
  });
  it('("trust proxy: true" would have returned the attacker\'s value — the reason it is a hop count)', async () => {
    const express = (await import('express')).default; const app = express(); app.set('trust proxy', true);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const got = await new Promise<string>((resolve) => { const srv = app.listen(0, '127.0.0.1', async () => { const r = await fetch(`http://127.0.0.1:${(srv.address() as any).port}/ip`, { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' } }); resolve((await r.json()).ip); srv.close(); }); });
    expect(got).toBe('1.2.3.4');
  });
});

describe('every IP-keyed control uses clientIp — nothing reads the header itself', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"`]*$/gm, '');
  it('no source file reads x-forwarded-for directly', () => {
    const hits = codeRoots().flatMap((r) => walk(r)).filter((f) => !f.endsWith('redaction.ts') && /x-forwarded-for/i.test(strip(readFileSync(f, 'utf8'))));
    expect(hits.map((h) => h.replace(process.cwd() + '/', ''))).toEqual([]);
  });
  it('main.ts sets trust proxy from trustProxyHops()', () => {
    expect(readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8')).toMatch(/\.set\?\.\('trust proxy', trustProxyHops\(\)\)/);
  });
  it('the login handler gives the throttle the real IP, and records the session IP from the request — not the body', () => {
    const src = readFileSync(join(process.cwd(), '../../modules/identity/src/auth/auth.controller.ts'), 'utf8');
    expect(src).toMatch(/ip: clientIp\(req\) \?\? undefined,/); expect(src).toMatch(/\n\s+ip: clientIp\(req\),\n/);   // the session row (Phase 13 split this line when adding device fields) expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/b\?\.ip/);
  });
});
