// redis-down.vitest.spec.ts — Smooth Refresh spec §65/§66/§112 in ONE place: "If Redis is unavailable, PostgreSQL
// operations remain authoritative. Realtime may degrade, while the 15-second API refresh recovers state."
// Every Redis consumer on a request path is exercised with a Redis whose EVERY call throws, and a static guard proves
// the business write paths do not depend on Redis at all (so a Redis outage cannot refuse a booking or a payment).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RedisTenantCache } from '@aipowersalon/cache';
import { RedisKeyedRateLimiter } from '@aipowersalon/security';
import { RedisTenantRateLimiter } from './tenant-rate-limit';

/** A Redis client that is down: every method rejects. */
const down: any = new Proxy({}, { get: () => () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:6379')) });

describe('§112 Redis unavailable — nothing on the request path fails', () => {
  it('tenant cache: read, write and invalidate all fail OPEN — the request gets PostgreSQL\'s answer', async () => {
    const cache = new RedisTenantCache(down);
    const ctx = { tenantId: 't1', branchId: 'b1' } as any;
    let loads = 0;
    const v = await cache.getOrSet(ctx, 'services', 60, async () => { loads++; return { from: 'postgres' }; });
    expect(v).toEqual({ from: 'postgres' });
    expect(loads).toBe(1);
    await expect(cache.invalidate(ctx, 'services')).resolves.toBeUndefined();
    await expect(cache.invalidateTenant(ctx)).resolves.toBeUndefined();
  });

  it('rate limiters fail OPEN — a limiter outage never refuses a booking or a payment', async () => {
    expect((await new RedisKeyedRateLimiter(down).hit('login:+15555550142')).allowed).toBe(true);
    expect(await new RedisKeyedRateLimiter(down).isBlocked('login:+15555550142')).toBe(false);
    expect((await new RedisTenantRateLimiter(down).hit('t1')).allowed).toBe(true);
  });

  it('§66: the booking / queue / customer / appointment / inventory / checkout write paths never touch Redis', () => {
    // Static guard. The ONE allowed exception is the AI upsell suggestion cache (not a money or booking path).
    const root = path.resolve(__dirname, '../../../../modules');
    const REDIS = /\bioredis\b|REDIS_URL|makeIoredis|RedisTenantCache|TENANT_CACHE|RedisKeyedRateLimiter/;
    const ALLOWED = new Set(['checkout/src/ai-checkout-upsell/ai-checkout-upsell.module.ts']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'dist' && e.name !== 'node_modules') walk(p); continue; }
        if (!/\.ts$/.test(e.name) || /\.(spec|test)\.ts$|\.vitest\.spec\.ts$/.test(e.name)) continue;
        const rel = path.relative(root, p).split(path.sep).join('/');
        if (!ALLOWED.has(rel) && REDIS.test(fs.readFileSync(p, 'utf8'))) offenders.push(rel);
      }
    };
    for (const m of ['booking', 'queue', 'customers', 'appointments', 'inventory', 'checkout']) walk(path.join(root, m, 'src'));
    expect(offenders).toEqual([]);
  });
});
