// security-headers.vitest.spec — Constitution 12 §68, §251–252 (finding H2): every API response carries them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { SecurityHeadersMiddleware, securityHeadersFor } from './security-headers.middleware';

const PROD = { production: true };
describe('the header set', () => {
  it('production API responses: HSTS, nosniff, deny framing, no-page CSP, strict referrer, no capabilities', () => {
    const h = securityHeadersFor(PROD, {});
    expect(h['Strict-Transport-Security']).toMatch(/^max-age=\d{7,}; includeSubDomains$/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Content-Security-Policy']).toMatch(/default-src 'none'.*frame-ancestors 'none'/);
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\)/);
    expect(h).not.toHaveProperty('X-XSS-Protection');
  });
  it('HSTS is NOT set outside production — it would poison a developer\'s browser for the whole host', () => {
    expect(securityHeadersFor({ production: false }, {})).not.toHaveProperty('Strict-Transport-Security');
  });
  it('an authenticated response is never cacheable in between; a public one is left to its route', () => {
    expect(securityHeadersFor(PROD, { ctx: { tenantId: 't' } })['Cache-Control']).toBe('no-store');
    expect(securityHeadersFor(PROD, {})).not.toHaveProperty('Cache-Control');
  });
});

describe('through a REAL http response (the middleware hooks writeHead)', () => {
  const roundTrip = (prime: (req: any, res: any) => void) => new Promise<Record<string, string | string[] | undefined>>((resolve) => {
    const mw = new SecurityHeadersMiddleware();
    const srv = createServer((req: any, res) => { prime(req, res); mw.use(req, res, () => { res.setHeader('Content-Type', 'application/json'); res.statusCode = 404; res.end('{}'); }); });
    srv.listen(0, () => { const port = (srv.address() as any).port; fetch(`http://127.0.0.1:${port}/nope`).then((r) => { const o: any = {}; r.headers.forEach((v, k) => (o[k] = v)); srv.close(); resolve(o); }); });
  });
  it('headers land on the wire — even on a 404', async () => {
    const h = await roundTrip(() => undefined);
    expect(h['x-content-type-options']).toBe('nosniff'); expect(h['x-frame-options']).toBe('DENY'); expect(h['content-security-policy']).toMatch(/default-src 'none'/);
  });
  it('a header a route set itself is respected (public caching), the rest still added', async () => {
    const h = await roundTrip((_req, res) => res.setHeader('Cache-Control', 'public, max-age=60'));
    expect(h['cache-control']).toBe('public, max-age=60'); expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
  it('Cache-Control: no-store when the request had a session (ctx set by the later middleware)', async () => {
    const h = await roundTrip((req) => { req.ctx = { tenantId: 't' }; });
    expect(h['cache-control']).toBe('no-store');
  });
});

describe('wiring', () => {
  it('applied to every route in AppModule, right after RequestContextMiddleware', () => {
    const app = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    expect(app).toMatch(/consumer\.apply\(SecurityHeadersMiddleware\)\.forRoutes\('\*'\)/);
  });
});
