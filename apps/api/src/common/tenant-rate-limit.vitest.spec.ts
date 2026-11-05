// Verifies per-tenant rate limiting (Roadmap Phase 3): the sliding-window limiter counts within a window, blocks over
// the max, isolates tenants, and FAILS OPEN on a Redis error; the guard passes through when disabled, skips requests
// with no tenant and SUPER_ADMIN, and throws 429 once a tenant exceeds its budget.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RedisTenantRateLimiter, InMemoryTenantRateLimiter, makeTenantRateLimiter, tenantRateLimitEnabled, rateLimitKey, DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS, type RateLimitRedis } from './tenant-rate-limit';
import { readFileSync } from 'node:fs';
import { sourcePath } from '../../test-support/code-roots';
import { TenantRateLimitGuard } from './tenant-rate-limit.guard';

// In-memory fake of the sorted-set surface, shared across limiter instances to simulate multiple API nodes.
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const redis: RateLimitRedis = {
    zadd(key, score, member) { const m = sets.get(key) ?? new Map(); m.set(member, score); sets.set(key, m); return 1; },
    zremrangebyscore(key, min, max) {
      const m = sets.get(key); if (!m) return 0;
      const lo = Number(min), hi = max === '+inf' ? Infinity : Number(max);
      for (const [mem, sc] of m) if (sc >= lo && sc <= hi) m.delete(mem);
      return 0;
    },
    zcard(key) { return sets.get(key)?.size ?? 0; },
    pexpire() { return 1; },
  };
  return { redis, sets };
}

const ctx = (req: any) => ({
  switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: () => undefined }) }),
}) as any;

describe('RedisTenantRateLimiter', () => {
  it('allows up to max, then blocks within the window', async () => {
    const { redis } = fakeRedis();
    const lim = new RedisTenantRateLimiter(redis, { windowMs: 60_000, max: 3 });
    expect((await lim.hit('t1')).allowed).toBe(true);   // 1
    expect((await lim.hit('t1')).allowed).toBe(true);   // 2
    expect((await lim.hit('t1')).allowed).toBe(true);   // 3
    const over = await lim.hit('t1');                    // 4 → over
    expect(over.allowed).toBe(false);
    expect(over.limit).toBe(3);
    expect(over.retryAfterMs).toBe(60_000);
  });

  it('budgets are per-tenant (one busy tenant does not affect another)', async () => {
    const { redis } = fakeRedis();
    const lim = new RedisTenantRateLimiter(redis, { windowMs: 60_000, max: 2 });
    await lim.hit('busy'); await lim.hit('busy');
    expect((await lim.hit('busy')).allowed).toBe(false); // busy exhausted
    expect((await lim.hit('quiet')).allowed).toBe(true); // quiet unaffected
  });

  it('reports remaining budget', async () => {
    const { redis } = fakeRedis();
    const lim = new RedisTenantRateLimiter(redis, { windowMs: 60_000, max: 5 });
    expect((await lim.hit('t1')).remaining).toBe(4);
    expect((await lim.hit('t1')).remaining).toBe(3);
  });

  it('FAILS OPEN when Redis throws', async () => {
    const broken: RateLimitRedis = {
      zadd() { throw new Error('down'); },
      zremrangebyscore() { throw new Error('down'); },
      zcard() { throw new Error('down'); },
      pexpire() { throw new Error('down'); },
    };
    const lim = new RedisTenantRateLimiter(broken, { max: 1 });
    const d = await lim.hit('t1');
    expect(d.allowed).toBe(true); // never reject on limiter failure
  });
});

describe('makeTenantRateLimiter (Phase 11: ON by default)', () => {
  it('no Redis → an ENABLED in-memory limiter (not a no-op)', async () => {
    const lim = makeTenantRateLimiter({});
    expect(lim).toBeInstanceOf(InMemoryTenantRateLimiter);
    expect(lim.enabled).toBe(true);
  });
  it('TENANT_RATE_LIMIT=off (or the older TENANT_RATE_LIMIT_GUARD_DISABLED=true) → no-op', async () => {
    expect(makeTenantRateLimiter({ TENANT_RATE_LIMIT: 'off' }).enabled).toBe(false);
    expect(makeTenantRateLimiter({ TENANT_RATE_LIMIT_GUARD_DISABLED: 'true' }).enabled).toBe(false);
    expect(tenantRateLimitEnabled({})).toBe(true);
    expect(tenantRateLimitEnabled({ TENANT_RATE_LIMIT: 'OFF' })).toBe(false);
  });
  it('REDIS_URL → the shared Redis limiter; RATE_LIMIT_STORE=memory forces in-memory', async () => {
    const lim = makeTenantRateLimiter({ REDIS_URL: 'redis://127.0.0.1:1', RATE_LIMIT_MAX_PER_TENANT: '7' });
    try { expect(lim).toBeInstanceOf(RedisTenantRateLimiter); } finally { (lim as any).redis?.disconnect?.(); }
    expect(makeTenantRateLimiter({ REDIS_URL: 'redis://127.0.0.1:1', RATE_LIMIT_STORE: 'memory' })).toBeInstanceOf(InMemoryTenantRateLimiter);
  });
});

describe('InMemoryTenantRateLimiter', () => {
  it('sliding window: max allowed, the next is refused with the time until the oldest leaves; then allowed again', async () => {
    let now = 1_000_000;
    const lim = new InMemoryTenantRateLimiter({ windowMs: 60_000, max: 3 }, () => now);
    for (let i = 0; i < 3; i++) { expect((await lim.hit('a')).allowed).toBe(true); now += 1_000; }
    const over = await lim.hit('a');
    expect(over).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
    expect(over.retryAfterMs).toBe(57_000);           // first hit at 1,000,000 leaves the window at 1,060,000
    now = 1_060_001;
    expect((await lim.hit('a')).allowed).toBe(true);
  });
  it('keys are independent and idle keys are dropped (bounded memory)', async () => {
    let now = 0;
    const lim = new InMemoryTenantRateLimiter({ windowMs: 1_000, max: 1 }, () => now);
    expect((await lim.hit('busy')).allowed).toBe(true);
    expect((await lim.hit('busy')).allowed).toBe(false);
    expect((await lim.hit('quiet')).allowed).toBe(true);
    for (let i = 0; i < 2_000; i++) await lim.hit('k' + i);
    now = 10_000;
    for (let i = 0; i < 1_000; i++) await lim.hit('fresh');
    expect(lim.size()).toBeLessThan(10);
  });
});

// ── The budget against the POS's real load ────────────────────────────────────────────────────────────────────────
// A busy Saturday at ONE location, derived from the platform's own refresh cadences (read from source below so a
// cadence change re-runs this sum). Requests per minute:
const repoFile = (p: string) => readFileSync(sourcePath('../../' + p), 'utf8');   // repo-relative, read through the shared resolver
const msConst = (text: string, re: RegExp) => Number((re.exec(text)?.[1] ?? 'NaN').replace(/_/g, ''));
const CADENCE = {
  operationalMs: msConst(repoFile('packages/realtime-client/src/sync-policy.ts'), /operationalMs:\s*([\d_]+)/),
  displayHeartbeatMs: msConst(repoFile('packages/api-contracts/src/display-device-rules.ts'), /DISPLAY_HEARTBEAT_MS\s*=\s*([\d_]+)/),
  kioskHeartbeatMs: msConst(repoFile('apps/customer-display/src/useGoCheckIn.ts'), /SESSION_HEARTBEAT_MS\s*=\s*([\d_]+)/),
  techThreadsMs: msConst(repoFile('apps/tech-web/src/screens/TechMessagesScreen.tsx'), /setInterval\(loadThreads,\s*([\d_]+)\)/),
  techMessagesMs: msConst(repoFile('apps/tech-web/src/screens/TechMessagesScreen.tsx'), /loadMessages\(open\.threadId\),\s*([\d_]+)\)/),
  ownerLiveOpsMs: msConst(repoFile('apps/owner-web/src/screens/LiveOperationsScreen.tsx'), /setInterval\(load,\s*([\d_]+)\)/),
};
const perMin = (ms: number) => 60_000 / ms;
export function busyLocationRequestsPerMinute(): { total: number; parts: Record<string, number> } {
  const posStations = 3, displays = 3, kiosks = 1, techs = 20, managers = 2;
  const parts = {
    posSafetySync: posStations * perMin(CADENCE.operationalMs) * 8,          // a board refetch ≈ 8 GETs
    displaySync: displays * (perMin(CADENCE.operationalMs) * 2 + perMin(CADENCE.displayHeartbeatMs)),
    kioskHeartbeat: kiosks * perMin(CADENCE.kioskHeartbeatMs),
    techSync: techs * perMin(CADENCE.operationalMs) * 3,
    techMessaging: 5 * (perMin(CADENCE.techThreadsMs) + perMin(CADENCE.techMessagesMs)),   // 5 techs with Messages open
    managerLiveOps: managers * perMin(CADENCE.ownerLiveOpsMs) * 4,
    // realtime fan-out: 10 domain events/min; POS + managers refetch the board (8), techs / displays refetch their own
    // view for roughly a third of events (3)
    realtimeRefetch: 10 * ((posStations + managers) * 8 + (techs + displays) * 3 / 3),
    frontDeskActions: posStations * 4 * 6,                                   // 4 check-ins/checkouts a minute each, ~6 calls
    techActions: techs * 0.5 * 4,
  };
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

describe('the default budget vs a busy location (Phase 11 — turning the limiter on must not 429 a real salon)', () => {
  it('every cadence was found in source', () => {
    for (const [k, v] of Object.entries(CADENCE)) expect(Number.isFinite(v) && v > 0, k).toBe(true);
  });
  it('the default per-location budget leaves at least 2× headroom over the modelled busy load', () => {
    const { total } = busyLocationRequestsPerMinute();
    expect(total).toBeGreaterThan(600);                                       // the old 600/min/tenant default would have throttled it
    expect(DEFAULT_RATE_LIMIT_MAX * (60_000 / DEFAULT_RATE_LIMIT_WINDOW_MS)).toBeGreaterThanOrEqual(2 * total);
  });
  it('the modelled busy minute replayed through the guard: no 429 for the busy salon', async () => {
    const lim = new InMemoryTenantRateLimiter({});
    const total = Math.ceil(busyLocationRequestsPerMinute().total);
    let refused = 0;
    for (let i = 0; i < total; i++) if (!(await lim.hit(rateLimitKey('salon-busy', 'branch-1'))).allowed) refused++;
    expect(refused).toBe(0);
  });
});

describe('TenantRateLimitGuard', () => {
  it('passes through when the limiter is disabled', async () => {
    const guard = new TenantRateLimitGuard({ enabled: false, hit: vi.fn() } as any, { isEnabled: async () => true } as any);
    expect(await guard.canActivate(ctx({ ctx: { tenantId: 't1', role: 'OWNER' } }))).toBe(true);
  });

  it('skips requests with no tenant (public/pre-session routes)', async () => {
    const hit = vi.fn();
    const guard = new TenantRateLimitGuard({ enabled: true, hit } as any, { isEnabled: async () => true } as any);
    expect(await guard.canActivate(ctx({ ctx: {} }))).toBe(true);
    expect(hit).not.toHaveBeenCalled();
  });

  it('never limits SUPER_ADMIN', async () => {
    const hit = vi.fn();
    const guard = new TenantRateLimitGuard({ enabled: true, hit } as any, { isEnabled: async () => true } as any);
    expect(await guard.canActivate(ctx({ ctx: { tenantId: 't1', role: 'SUPER_ADMIN' } }))).toBe(true);
    expect(hit).not.toHaveBeenCalled();
  });

  it('allows an in-budget tenant request', async () => {
    const guard = new TenantRateLimitGuard({ enabled: true, hit: async () => ({ allowed: true, remaining: 5, limit: 10, retryAfterMs: 0 }) } as any, { isEnabled: async () => true } as any);
    expect(await guard.canActivate(ctx({ ctx: { tenantId: 't1', role: 'OWNER' } }))).toBe(true);
  });

  it('throws 429 when a tenant exceeds its budget', async () => {
    const guard = new TenantRateLimitGuard({ enabled: true, hit: async () => ({ allowed: false, remaining: 0, limit: 10, retryAfterMs: 60_000 }) } as any, { isEnabled: async () => true } as any);
    await expect(guard.canActivate(ctx({ ctx: { tenantId: 't1', role: 'OWNER' } }))).rejects.toMatchObject({ status: 429 });
  });
});

import { TenantRateLimitGuard } from './tenant-rate-limit.guard';
describe('TenantRateLimitGuard — Super Admin toggle + kill-switch', () => {
  const denyLimiter = { enabled: true, hit: async () => ({ allowed: false, remaining: 0, limit: 1, retryAfterMs: 1000 }) } as any;
  const flags = (enabled: boolean) => ({ isEnabled: async () => enabled }) as any;
  const ctxFor = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: () => undefined }) }) } as any);
  const REQ = { ctx: { tenantId: 'ten_A', role: 'MANAGER' } };
  afterEach(() => { delete process.env.TENANT_RATE_LIMIT_GUARD_DISABLED; });

  it('passes through when the Super Admin toggle is explicitly OFF, even if the limiter would deny', async () => {
    const g = new TenantRateLimitGuard(denyLimiter, flags(false));
    expect(await g.canActivate(ctxFor(REQ))).toBe(true);
  });
  it('throttles when the toggle is ON and the tenant is over budget', async () => {
    const g = new TenantRateLimitGuard(denyLimiter, flags(true));
    await expect(g.canActivate(ctxFor(REQ))).rejects.toBeDefined();
  });
  it('env TENANT_RATE_LIMIT_GUARD_DISABLED=true overrides the toggle to OFF', async () => {
    process.env.TENANT_RATE_LIMIT_GUARD_DISABLED = 'true';
    const g = new TenantRateLimitGuard(denyLimiter, flags(true));   // toggle ON, but env forces off
    expect(await g.canActivate(ctxFor(REQ))).toBe(true);
  });
});

describe('TenantRateLimitGuard — ON by default: a burst gets 429 + Retry-After, other salons are unaffected', () => {
  const realReq = (tenantId: string, branchId = 'b1', role = 'FRONT_DESK') => ({ ctx: { tenantId, branchId, role } });
  const capture = () => { const headers: Record<string, string> = {}; return { headers, res: { header: (k: string, v: string) => { headers[k] = v; } } }; };
  const run = (g: TenantRateLimitGuard, req: any, res: any) => g.canActivate({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any);
  // A flag service with NO stored value: the default decides (now true).
  const unsetFlags = { isEnabled: async (_k: string, def: boolean) => def } as any;
  afterEach(() => { delete process.env.TENANT_RATE_LIMIT; });

  it('salon A bursts past its budget → 429 RATE_LIMITED with Retry-After; salon B and A\'s other location still pass', async () => {
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({ windowMs: 60_000, max: 5 }), unsetFlags);
    for (let i = 0; i < 5; i++) expect(await run(g, realReq('salonA'), capture().res)).toBe(true);
    const c = capture();
    const err: any = await run(g, realReq('salonA'), c.res).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.response).toMatchObject({ code: 'RATE_LIMITED', limit: 5 });
    expect(Number(c.headers['Retry-After'])).toBeGreaterThan(0);
    expect(await run(g, realReq('salonB'), capture().res)).toBe(true);
    expect(await run(g, realReq('salonA', 'b2'), capture().res)).toBe(true);
  });
  it('TENANT_RATE_LIMIT=off → the burst passes', async () => {
    process.env.TENANT_RATE_LIMIT = 'off';
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({ windowMs: 60_000, max: 1 }), unsetFlags);
    for (let i = 0; i < 5; i++) expect(await run(g, realReq('salonA'), capture().res)).toBe(true);
  });
  it('a per-tenant rollout (isEnabledFor) can exempt one salon', async () => {
    const flags = { isEnabled: async () => true, isEnabledFor: async (_k: string, t: string) => t !== 'exempt' } as any;
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({ windowMs: 60_000, max: 1 }), flags);
    for (let i = 0; i < 3; i++) expect(await run(g, realReq('exempt'), capture().res)).toBe(true);
    await run(g, realReq('limited'), capture().res);
    await expect(run(g, realReq('limited'), capture().res)).rejects.toMatchObject({ status: 429 });
  });
});
