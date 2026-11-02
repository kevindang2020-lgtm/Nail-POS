// anon-rate-limit.vitest.spec.ts — Security Deep Scan §28 / §43 / §44: @AnonRateLimit in a REAL Nest app behind one
// trusted proxy hop (production's shape), plus the coverage rule: no PUBLIC route is left "limiter or none".
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import 'reflect-metadata';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnonRateLimit, AnonRateLimitGuard } from '@aipowersalon/security/nest';
import { ANON_RATE_LIMIT_STORE, InMemoryAnonRateLimitStore } from '@aipowersalon/security';
import { makeAnonRateLimitStore } from './keyed-rate-limit';

@AnonRateLimit(5, 60_000, { bucket: 'cls' })
@Controller('pub')
class PubController {
  @Post('refresh') @AnonRateLimit(3, 60_000) refresh() { return { ok: true }; }
  @Get('plain') plain() { return { ok: true }; }
}
@Controller('free') class FreeController { @Get() free() { return { ok: true }; } }
@Module({ controllers: [PubController, FreeController], providers: [{ provide: ANON_RATE_LIMIT_STORE, useValue: new InMemoryAnonRateLimitStore() }, AnonRateLimitGuard] })
class TestModule {}

let app: any; let base = '';
const prevEnv = process.env.NODE_ENV;
beforeAll(async () => {
  process.env.NODE_ENV = 'production';   // loopback is exempt outside production; this app sees real (proxied) addresses anyway
  const server = express(); server.set('trust proxy', 1);
  app = await NestFactory.create(TestModule, new ExpressAdapter(server), { logger: false });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
afterAll(async () => { process.env.NODE_ENV = prevEnv; await app?.close(); });
const call = (method: string, path: string, xff: string) => fetch(`${base}${path}`, { method, headers: { 'x-forwarded-for': xff } });

describe('@AnonRateLimit', () => {
  it('refuses past the method budget with 429 RATE_LIMITED + Retry-After; another address is unaffected', async () => {
    for (let i = 0; i < 3; i++) expect((await call('POST', '/pub/refresh', '198.51.100.1')).status).toBe(201);
    const r = await call('POST', '/pub/refresh', '198.51.100.1');
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await r.json()).code).toBe('RATE_LIMITED');
    expect((await call('POST', '/pub/refresh', '198.51.100.2')).status).toBe(201);
  });
  it('a client-prepended X-Forwarded-For value does not buy a fresh budget (the trusted hop decides the address)', async () => {
    for (let i = 0; i < 3; i++) await call('POST', '/pub/refresh', '198.51.100.3');
    expect((await call('POST', '/pub/refresh', `10.9.9.${Math.floor(Math.random() * 200)}, 198.51.100.3`)).status).toBe(429);
  });
  it('a class budget covers every route in the class, counted once per request even when a method adds its own', async () => {
    // 198.51.100.4: 3 refresh (class 3/5 + method 3/3), then 2 plain (class 5/5), then plain → class refuses
    for (let i = 0; i < 3; i++) expect((await call('POST', '/pub/refresh', '198.51.100.4')).status).toBe(201);
    for (let i = 0; i < 2; i++) expect((await call('GET', '/pub/plain', '198.51.100.4')).status).toBe(200);
    expect((await call('GET', '/pub/plain', '198.51.100.4')).status).toBe(429);
  });
  it('routes without the decorator are never limited', async () => {
    for (let i = 0; i < 10; i++) expect((await call('GET', '/free', '198.51.100.5')).status).toBe(200);
  });
  it('store selection: in-process without Redis, or when RATE_LIMIT_STORE=memory', () => {
    expect(makeAnonRateLimitStore({} as any).kind).toBe('memory');
    expect(makeAnonRateLimitStore({ REDIS_URL: 'redis://x:6379', RATE_LIMIT_STORE: 'memory' } as any).kind).toBe('memory');
  });
});

describe('coverage — every public route has a stated limit (S-A10: the attack surface reads the decorators)', () => {
  const csv = readFileSync(join(process.cwd(), '../../docs/security/attack-surface-routes.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
  it('no row is left "route-specific limiter or none"', () => {
    const open = csv.filter((l) => /route-specific limiter or none/.test(l));
    expect(open, open.join('\n')).toEqual([]);
  });
  it('the routes the audit named carry @AnonRateLimit', () => {
    for (const route of ['POST,/auth/refresh,', 'POST,/auth/biometric/login,', 'POST,/auth/webauthn/authenticate/begin,', 'POST,/auth/webauthn/authenticate/finish,',
      'POST,/customer/auth/register,', 'POST,/customer-display/pairing,', 'POST,/customer-display/device/heartbeat,', 'GET,/customer/deals/nearby,',
      'GET,/customer/techs/nearby,', 'POST,/api/ai-booking/v1/public/availability/search,']) {
      const row = csv.find((l) => l.startsWith(route));
      expect(row, route).toBeTruthy();
      expect(row, route).toMatch(/AnonRateLimit \d+ \/ /);
    }
  });
});
