// maintenance-break-glass.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §139): MAINTENANCE_BREAK_GLASS answers
// WITHOUT the database. The proof boots a real Express server whose only route behaves like a dead Postgres (it never
// answers), mounts the break-glass middleware in front, and shows every blocked request gets its 503 at once while
// health / sign-out / reads still reach the app. main.ts must mount it before Nest's middleware (asserted below).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { breakGlassDecision, breakGlassMiddleware, breakGlassMode, breakGlassConfigProblem, breakGlassStatus } from './maintenance-break-glass';

describe('breakGlassMode / problems', () => {
  it('off by default; read_only / full and their spellings; a typo stays OPEN but is reported', () => {
    expect(breakGlassMode({})).toBe('off');
    expect(breakGlassMode({ MAINTENANCE_BREAK_GLASS: 'read-only' })).toBe('read_only');
    expect(breakGlassMode({ MAINTENANCE_BREAK_GLASS: 'READ_ONLY' })).toBe('read_only');
    expect(breakGlassMode({ MAINTENANCE_BREAK_GLASS: 'full' })).toBe('full');
    expect(breakGlassMode({ MAINTENANCE_BREAK_GLASS: 'fulll' })).toBe('off');
    expect(breakGlassConfigProblem({ MAINTENANCE_BREAK_GLASS: 'fulll' })).toMatch(/not off \| read_only \| full/);
    expect(breakGlassConfigProblem({ MAINTENANCE_BREAK_GLASS: 'off' })).toBeNull();
    expect(breakGlassStatus({ MAINTENANCE_BREAK_GLASS: 'full', MAINTENANCE_BREAK_GLASS_MESSAGE: 'DB restore in progress' })).toEqual({ mode: 'full', message: 'DB restore in progress', problem: null });
  });
});

describe('breakGlassDecision', () => {
  it('read_only: reads pass; writes 503 MAINTENANCE_READ_ONLY; health, sign-out and preflight pass; webhooks 503 (providers retry)', () => {
    expect(breakGlassDecision('read_only', 'GET', '/pos/checkout/state').allow).toBe(true);
    const w = breakGlassDecision('read_only', 'POST', '/pos/checkout/tickets/t1/pay/card');
    expect(w).toMatchObject({ allow: false, status: 503, body: { code: 'MAINTENANCE_READ_ONLY', breakGlass: true } });
    expect(breakGlassDecision('read_only', 'POST', '/auth/logout').allow).toBe(true);
    expect(breakGlassDecision('read_only', 'POST', '/auth/login').allow).toBe(false);
    expect(breakGlassDecision('read_only', 'POST', '/health/ready').allow).toBe(true);
    expect(breakGlassDecision('read_only', 'OPTIONS', '/pos/anything').allow).toBe(true);
    expect(breakGlassDecision('read_only', 'POST', '/webhooks/payments/cardpointe')).toMatchObject({ allow: false, status: 503 });
    expect(breakGlassDecision('read_only', 'DELETE', '/pos/customers/1').allow).toBe(false);
  });
  it('full: only health and /metrics answer', () => {
    expect(breakGlassDecision('full', 'GET', '/health/live').allow).toBe(true);
    expect(breakGlassDecision('full', 'GET', '/health').allow).toBe(true);
    expect(breakGlassDecision('full', 'GET', '/metrics').allow).toBe(true);
    expect(breakGlassDecision('full', 'GET', '/pos/checkout/state', 'Restoring the database')).toMatchObject({ allow: false, status: 503, body: { code: 'MAINTENANCE_FULL', message: 'Restoring the database' } });
    expect(breakGlassDecision('full', 'POST', '/auth/logout').allow).toBe(false);
  });
  it('off: everything passes', () => {
    expect(breakGlassDecision('off', 'POST', '/pos/x').allow).toBe(true);
  });
});

describe('break-glass on a live server whose database is down', () => {
  const env: NodeJS.ProcessEnv = {};
  let base = ''; let close: () => void = () => undefined; let appHits = 0;
  beforeAll(async () => {
    const app = express();
    app.use(breakGlassMiddleware(env));
    // Every app route behaves like a request waiting on a dead Postgres: it never answers on its own.
    app.use((req, res) => { appHits++; if (/^\/(health|auth\/logout)/.test(req.path)) { res.json({ ok: true }); return; } setTimeout(() => res.status(500).json({ error: 'db timeout' }), 5_000); });
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  const call = async (method: string, path: string) => {
    const t0 = Date.now();
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => null), ms: Date.now() - t0 };
  };

  it('full: a POS read is answered 503 immediately with the message and Retry-After; health still answers; the app is never reached', async () => {
    env.MAINTENANCE_BREAK_GLASS = 'full'; env.MAINTENANCE_BREAK_GLASS_MESSAGE = 'Database restore in progress';
    appHits = 0;
    const r = await call('GET', '/pos/checkout/state');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'MAINTENANCE_FULL', message: 'Database restore in progress', breakGlass: true });
    expect(r.retryAfter).toBe('120');
    expect(r.ms).toBeLessThan(1_000);
    expect(appHits).toBe(0);
    expect((await call('GET', '/health/live')).status).toBe(200);
  });

  it('read_only: a payment POST is refused at once; sign-out still works; flipping the env back to off opens it (read per request)', async () => {
    env.MAINTENANCE_BREAK_GLASS = 'read_only';
    const w = await call('POST', '/pos/checkout/tickets/t1/pay/cash');
    expect(w.status).toBe(503); expect(w.body.code).toBe('MAINTENANCE_READ_ONLY'); expect(w.ms).toBeLessThan(1_000);
    expect((await call('POST', '/auth/logout')).status).toBe(200);
    env.MAINTENANCE_BREAK_GLASS = 'off';
    expect((await call('POST', '/health/ready')).status).toBe(200);
  });
});

describe('main.ts wiring', () => {
  it('mounts the break-glass middleware on the HTTP server, before Nest routes/middleware are initialised (app.listen)', () => {
    const src = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const mount = src.indexOf('breakGlassMiddleware()');
    expect(mount, 'main.ts mounts breakGlassMiddleware()').toBeGreaterThan(-1);
    expect(mount).toBeLessThan(src.indexOf('app.listen('));
    expect(mount, 'after CORS so a browser can read the 503').toBeGreaterThan(src.indexOf('app.enableCors('));
  });
});
