// platform-network-policy.vitest.spec.ts — Security Deep Scan §136 / §29: the Super Admin network policy in a REAL Nest
// app, registered exactly as AppModule registers it (pre-session on /super-admin + POST /auth/login, then on every path
// after the session middleware). The client address comes from Express's trusted-proxy resolution (hops = 1 here, as in
// production), so a client-written X-Forwarded-For prefix is ignored.
import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import 'reflect-metadata';
import { Body, Controller, Get, Injectable, MiddlewareConsumer, Module, NestMiddleware, NestModule, Post, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { PlatformNetworkPolicy } from '@aipowersalon/super-admin';
import { SecurityEvents } from '@aipowersalon/security-center';
import { AuditService } from '@aipowersalon/audit';
import { PlatformNetworkPolicyMiddleware, platformNetworkScope } from './platform-network-policy.middleware';

const rules = { blocks: [] as Array<{ target: string; expiresAt: string | null }>, allowlist: [] as string[] };
const env: Record<string, string | undefined> = {};
const policy = new PlatformNetworkPolicy({ networkRules: async () => rules }, env);
const events: any[] = []; const audits: any[] = [];
const fakeEvents = { record: async (e: any) => { events.push(e); return true; } };
const fakeAudit = { recordPlatform: async (a: any) => { audits.push(a); } };

/** Stands in for TenantContextMiddleware: a session's role from a test header. */
@Injectable() class FakeSession implements NestMiddleware { use(req: any, _res: any, next: () => void) { const r = req.headers['x-test-role']; if (r) req.ctx = { role: r, userId: 'u-' + r, tenantId: r === 'SUPER_ADMIN' ? null : 't1' }; next(); } }
@Controller() class Routes {
  @Get('super-admin/tenants') sa() { return { ok: true }; }
  @Post('auth/login') login(@Body() b: any) { return { ok: true, portal: b?.portal ?? null }; }
  @Get('pos/customers') pos() { return { ok: true }; }
  @Get('audit/mine') shared() { return { ok: true }; }
}
@Module({ controllers: [Routes], providers: [
  { provide: PlatformNetworkPolicy, useValue: policy }, { provide: SecurityEvents, useValue: fakeEvents }, { provide: AuditService, useValue: fakeAudit },
] })
class TestModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(PlatformNetworkPolicyMiddleware).forRoutes({ path: 'super-admin', method: RequestMethod.ALL }, { path: 'super-admin/(.*)', method: RequestMethod.ALL }, { path: 'auth/login', method: RequestMethod.POST });
    c.apply(FakeSession).forRoutes('*');
    c.apply(PlatformNetworkPolicyMiddleware).forRoutes('*');
  }
}

let app: any; let base = '';
beforeAll(async () => {
  const server = express(); server.use(express.json()); server.set('trust proxy', 1);
  app = await NestFactory.create(TestModule, new ExpressAdapter(server), { logger: false, bodyParser: false });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
afterAll(async () => { await app?.close(); });
beforeEach(() => { rules.blocks = []; rules.allowlist = []; delete env.SUPER_ADMIN_NETWORK_POLICY; events.length = 0; audits.length = 0; policy.invalidate(); });

const call = (path: string, ip: string, init: { role?: string; body?: unknown } = {}) => fetch(`${base}${path}`, {
  method: init.body ? 'POST' : 'GET',
  headers: { 'x-forwarded-for': ip, ...(init.role ? { 'x-test-role': init.role } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
  body: init.body ? JSON.stringify(init.body) : undefined,
});

describe('§136 blocked addresses', () => {
  it('a blocked IP → 403 NETWORK_POLICY_DENIED on the /super-admin realm (even before any session) and on platform login', async () => {
    rules.blocks = [{ target: '198.51.100.0/24', expiresAt: null }];
    const r = await call('/super-admin/tenants', '198.51.100.7');
    expect(r.status).toBe(403); expect((await r.json()).code).toBe('NETWORK_POLICY_DENIED');
    expect((await call('/auth/login', '198.51.100.7', { body: { portal: 'super-admin', identifier: 'x', password: 'y' } })).status).toBe(403);
    expect((await call('/super-admin/tenants', '192.0.2.1')).status).toBe(200);
  });
  it('a salon login / tenant route from the same blocked IP is unaffected (the platform policy only)', async () => {
    rules.blocks = [{ target: '198.51.100.7', expiresAt: null }];
    expect((await call('/auth/login', '198.51.100.7', { body: { portal: 'tenant', identifier: 'x', password: 'y' } })).status).toBe(201);
    expect((await call('/pos/customers', '198.51.100.7', { role: 'OWNER' })).status).toBe(200);
  });
  it('refusal → one HIGH NETWORK_POLICY_DENIED security event + one platform audit row (throttled per address)', async () => {
    rules.blocks = [{ target: '198.51.100.8', expiresAt: null }];
    await call('/super-admin/tenants', '198.51.100.8'); await call('/super-admin/tenants', '198.51.100.8');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'NETWORK_POLICY_DENIED', ip: '198.51.100.8', resourceId: 'realm' });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ module: 'security', action: 'network_policy_denied', ip: '198.51.100.8' });
  });
});

describe('§136 allowlist', () => {
  it('allow-listed-only platform login from outside the list → refused; inside → passes', async () => {
    rules.allowlist = ['203.0.113.0/24'];
    expect((await call('/auth/login', '192.0.2.10', { body: { portal: 'super-admin' } })).status).toBe(403);
    expect((await call('/auth/login', '203.0.113.10', { body: { portal: 'super-admin' } })).status).toBe(201);
  });
  it('a SUPER_ADMIN session is refused from outside the allowlist on ANY path; a salon session on the same path is not', async () => {
    rules.allowlist = ['203.0.113.0/24'];
    expect((await call('/audit/mine', '192.0.2.10', { role: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await call('/audit/mine', '203.0.113.10', { role: 'SUPER_ADMIN' })).status).toBe(200);
    expect((await call('/audit/mine', '192.0.2.10', { role: 'OWNER' })).status).toBe(200);
    expect((await call('/pos/customers', '192.0.2.10', { role: 'MANAGER' })).status).toBe(200);
  });
  it('the address is the TRUSTED proxy\'s entry: a client-prepended X-Forwarded-For value is ignored', async () => {
    rules.allowlist = ['203.0.113.0/24'];
    expect((await call('/super-admin/tenants', '203.0.113.10, 192.0.2.10')).status).toBe(403);   // spoofed left entry, real client right
    expect((await call('/super-admin/tenants', '192.0.2.10, 203.0.113.10')).status).toBe(200);
  });
  it('fail-safe: no rules → nobody is locked out', async () => {
    expect((await call('/super-admin/tenants', '192.0.2.10')).status).toBe(200);
  });
});

describe('§136 break-glass and report mode', () => {
  it('SUPER_ADMIN_NETWORK_POLICY=off disables enforcement; =report records but never refuses', async () => {
    rules.allowlist = ['203.0.113.0/24'];
    env.SUPER_ADMIN_NETWORK_POLICY = 'off';
    expect((await call('/super-admin/tenants', '192.0.2.77')).status).toBe(200);
    expect(events).toHaveLength(0);
    env.SUPER_ADMIN_NETWORK_POLICY = 'report';
    expect((await call('/super-admin/tenants', '192.0.2.78')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
  });
});

describe('platformNetworkScope', () => {
  it('classifies realm / login / session / none', () => {
    expect(platformNetworkScope({ originalUrl: '/super-admin/x?y=1' })).toBe('realm');
    expect(platformNetworkScope({ originalUrl: '/api/v1/super-admin/x' })).toBe('realm');
    expect(platformNetworkScope({ originalUrl: '/auth/login', method: 'POST', body: { portal: 'super-admin' } })).toBe('login');
    expect(platformNetworkScope({ originalUrl: '/auth/login', method: 'POST', body: { portal: 'owner' } })).toBeNull();
    expect(platformNetworkScope({ originalUrl: '/pos/x', ctx: { role: 'SUPER_ADMIN' } })).toBe('session');
    expect(platformNetworkScope({ originalUrl: '/super-adminx' })).toBeNull();
  });
});
