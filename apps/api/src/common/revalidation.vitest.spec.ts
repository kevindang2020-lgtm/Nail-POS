// revalidation.vitest.spec.ts — Smooth Refresh spec §90: a few stable authenticated reads are REVALIDATED (ETag →
// 304 Not Modified) instead of downloaded again; everything else stays no-store. Over a REAL Express server with the
// real SecurityHeadersMiddleware and Express's own ETag handling — no mocks.
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SecurityHeadersMiddleware, securityHeadersFor, isRevalidatableGet } from './security-headers.middleware';
import { apiCompression } from './http-compression';

let server: http.Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

let catalogVersion = 1;
function app() {
  const a = express();
  a.use(apiCompression());                                         // as in production (main.ts): compression runs first
  const mw = new SecurityHeadersMiddleware();
  a.use((req: any, res, next) => { req.ctx = { tenantId: 't_A', userId: String(req.headers['x-user'] || 'u1') }; mw.use(req, res, next); });
  a.get('/pos/services', (_req, res) => { res.json({ services: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, name: 'Gel Manicure', v: catalogVersion })) }); });   // > 1 KB, so it is compressed
  a.get('/pos/customers', (_req, res) => { res.json({ customers: [{ id: 'c1', name: 'Lia Ng' }] }); });
  return a;
}
const start = (a: express.Express) => new Promise<number>((r) => { server = a.listen(0, () => r((server!.address() as AddressInfo).port)); });
const get = (port: number, path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  http.get({ port, path, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: b })); }).on('error', reject);
});

describe('revalidatable reads (spec §90)', () => {
  it('policy: only the listed GETs revalidate; any other method or path stays no-store', () => {
    expect(isRevalidatableGet({ method: 'GET', path: '/pos/services' })).toBe(true);
    expect(isRevalidatableGet({ method: 'GET', path: '/pos/settings/booking-appointments' })).toBe(true);
    expect(isRevalidatableGet({ method: 'POST', path: '/pos/services' })).toBe(false);
    expect(isRevalidatableGet({ method: 'GET', path: '/pos/services/s1/commission' })).toBe(false);
    expect(isRevalidatableGet({ method: 'GET', path: '/pos/settings/payments-checkout' })).toBe(false);
    expect(isRevalidatableGet({ method: 'GET', path: '/pos/customers' })).toBe(false);
    expect(securityHeadersFor({ production: true }, { ctx: {}, method: 'GET', path: '/pos/services' })['Cache-Control']).toBe('private, no-cache');
    expect(securityHeadersFor({ production: true }, { ctx: {}, method: 'GET', path: '/pos/customers' })['Cache-Control']).toBe('no-store');
    expect(securityHeadersFor({ production: true }, { method: 'GET', path: '/pos/services' })['Cache-Control']).toBeUndefined();   // unauthenticated: unchanged
  });

  it('an unchanged services catalog answers 304 with NO body; a changed one answers 200 with the new body', async () => {
    catalogVersion = 1;
    const port = await start(app());
    const first = await get(port, '/pos/services', { 'accept-encoding': 'gzip' });
    expect(first.headers['content-encoding']).toBe('gzip');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const again = await get(port, '/pos/services', { 'if-none-match': etag, 'accept-encoding': 'gzip' });
    expect(again.status).toBe(304);
    expect(again.body).toBe('');                                   // nothing downloaded
    catalogVersion = 2;                                            // an owner edits a service
    const changed = await get(port, '/pos/services', { 'if-none-match': etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it('a non-listed read (customers) stays no-store, so no browser ever keeps a copy to revalidate', async () => {
    const port = await start(app());
    const r = await get(port, '/pos/customers');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
