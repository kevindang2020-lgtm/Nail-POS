// Verifies per-tenant rate limiting (Roadmap Phase 3): the sliding-window limiter counts within a window, blocks over
// the max, isolates tenants, and FAILS OPEN on a Redis error; the guard passes through when disabled, skips requests
// with no tenant and SUPER_ADMIN, and throws 429 once a tenant exceeds its budget.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RedisTenantRateLimiter, InMemoryTenantRateLimiter, makeTenantRateLimiter, makeClientRateLimiter, tenantRateLimitEnabled, rateLimitClientKey, clientRateLimitOptionsFromEnv, rateLimitOptionsFromEnv, DEFAULT_RATE_LIMIT_MAX, DEFAULT_CLIENT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_WINDOW_MS, type RateLimitRedis } from './tenant-rate-limit';
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

// ── The budgets against the POS's real load ───────────────────────────────────────────────────────────────────────
// A busy minute at ONE location, derived from the platform's own refresh cadences (read from source below so a cadence
// change re-runs this sum). Requests per minute. Two shapes: the 20-technician salon the budget was first sized for
// (Phase 11) and the 200-technician large salon (M4, Oct 24 2026).
const repoFile = (p: string) => readFileSync(sourcePath('../../' + p), 'utf8');   // repo-relative, read through the shared resolver
const msConst = (text: string, re: RegExp) => Number((re.exec(text)?.[1] ?? 'NaN').replace(/_/g, ''));
const CADENCE = {
  operationalMs: msConst(repoFile('packages/realtime-client/src/sync-policy.ts'), /operationalMs:\s*([\d_]+)/),
  displayHeartbeatMs: msConst(repoFile('packages/api-contracts/src/display-device-rules.ts'), /DISPLAY_HEARTBEAT_MS\s*=\s*([\d_]+)/),
  kioskHeartbeatMs: msConst(repoFile('apps/customer-display/src/useGoCheckIn.ts'), /SESSION_HEARTBEAT_MS\s*=\s*([\d_]+)/),
  techThreadsMs: msConst(repoFile('apps/tech-web/src/screens/TechMessagesScreen.tsx'), /setInterval\(loadThreads,\s*([\d_]+)\)/),
  techMessagesMs: msConst(repoFile('apps/tech-web/src/screens/TechMessagesScreen.tsx'), /loadMessages\(open\.threadId\),\s*([\d_]+)\)/),
  ownerLiveOpsMs: msConst(repoFile('apps/owner-web/src/screens/LiveOperationsScreen.tsx'), /setInterval\(load,\s*([\d_]+)\)/),
  /** M4: a Tech App card re-reads on relevant BRANCH frames at most once per this window (apps/tech-web techRelevance). */
  techBranchRefetchMinMs: msConst(repoFile('apps/tech-web/src/lib/techRelevance.ts'), /BRANCH_REFETCH_MIN_MS\s*=\s*([\d_]+)/),
};
/** The Tech App home screen's realtime readers (each one GET per refetch): the dashboard, the time clock, help requests. */
const TECH_HOME_READERS = ['screens/TechDashboardScreen.tsx', 'components/TimeClockCard.tsx', 'components/HelpRequestsCard.tsx']
  .filter((f) => /useTechStream\(/.test(repoFile('apps/tech-web/src/' + f))).length;
const perMin = (ms: number) => 60_000 / ms;
export interface LocationShape { techs: number; posStations: number; displays: number; kiosks: number; managers: number; techsInMessages: number;
  /** salon visits a minute at the busy hour */ visitsPerMin: number; }
/** Branch-room frames one visit produces (booked → checked in → assigned → served → paid on the display): the list in
 *  apps/tech-web/src/lib/techRelevance.test.ts (VISIT_BRANCH_EVENTS), 25 frames. */
const FRAMES_PER_VISIT = 25;
/** …of which the POS booking board / a manager screen refetches on ~8 (appointment / queue / service changes). */
const POS_RELEVANT_PER_VISIT = 8;
/** …and a Tech App home card on 12 (dashboard) / 2 (time clock) / 0 (help) — techRelevance.test.ts pins these. */
const TECH_RELEVANT_PER_VISIT = { today: 12, timeClock: 2, help: 0 };
export function locationRequestsPerMinute(L: LocationShape): { total: number; parts: Record<string, number>; posDeskPerMin: number; techPhonePerMin: number } {
  const events = L.visitsPerMin * FRAMES_PER_VISIT;
  const boardRefetch = 8;                                                   // a POS board refetch ≈ 8 GETs (upper bound)
  const posDeskPerMin = perMin(CADENCE.operationalMs) * boardRefetch        // safety sync
    + L.visitsPerMin * POS_RELEVANT_PER_VISIT * boardRefetch                // realtime refetches
    + 4 * 6;                                                                // 4 check-ins / checkouts a minute, ~6 calls each
  // A Tech App phone: the safety sync re-reads every home card; a relevant branch frame re-reads a card at most once per
  // techBranchRefetchMinMs (own-room frames — the technician's own assignments — are a few a day, counted in techActions).
  const capPerCard = perMin(CADENCE.techBranchRefetchMinMs);
  const techRealtime = Math.min(capPerCard, L.visitsPerMin * TECH_RELEVANT_PER_VISIT.today) + Math.min(capPerCard, L.visitsPerMin * TECH_RELEVANT_PER_VISIT.timeClock) + Math.min(capPerCard, L.visitsPerMin * TECH_RELEVANT_PER_VISIT.help);
  const techPhonePerMin = perMin(CADENCE.operationalMs) * TECH_HOME_READERS + techRealtime + 0.5 * 4;
  const parts = {
    posDesks: L.posStations * posDeskPerMin,
    managers: L.managers * (posDeskPerMin - 24 + perMin(CADENCE.ownerLiveOpsMs) * 4),
    displaySync: L.displays * (perMin(CADENCE.operationalMs) * 2 + perMin(CADENCE.displayHeartbeatMs) + L.visitsPerMin * 3),
    kioskHeartbeat: L.kiosks * perMin(CADENCE.kioskHeartbeatMs),
    techSafetySync: L.techs * perMin(CADENCE.operationalMs) * TECH_HOME_READERS,
    techRealtime: L.techs * techRealtime,
    techMessaging: L.techsInMessages * (perMin(CADENCE.techThreadsMs) + perMin(CADENCE.techMessagesMs)),
    techActions: L.techs * 0.5 * 4,                                         // accept / start / done, ~4 calls, every 2 min
  };
  void events;
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts, posDeskPerMin, techPhonePerMin };
}
/** The Phase 11 shape: a busy 20-technician salon (~40 visits an hour at the peak). */
export const BUSY_20: LocationShape = { techs: 20, posStations: 3, displays: 3, kiosks: 1, managers: 2, techsInMessages: 5, visitsPerMin: 0.7 };
/** M4: a 200-technician salon at its busy hour — the pilot's busy day had 1,113 appointments (+ walk-ins) across a ~10 h
 *  day ≈ 2 visits a minute; the peak hour is taken at 2× (4 a minute — 200 chairs turning once an hour). */
export const LARGE_200: LocationShape = { techs: 200, posStations: 6, displays: 6, kiosks: 2, managers: 3, techsInMessages: 20, visitsPerMin: 4 };
export function busyLocationRequestsPerMinute() { return locationRequestsPerMinute(BUSY_20); }

describe('the default budgets vs a busy location (Phase 11 + M4 — the limiter must not 429 a real salon)', () => {
  it('every cadence was found in source', () => {
    for (const [k, v] of Object.entries(CADENCE)) expect(Number.isFinite(v) && v > 0, k).toBe(true);
    expect(TECH_HOME_READERS).toBe(3);
  });
  it('the location budget leaves ≥ 2× headroom over a busy 20-technician salon AND a 200-technician salon at its peak', () => {
    const perWindow = DEFAULT_RATE_LIMIT_MAX * (60_000 / DEFAULT_RATE_LIMIT_WINDOW_MS);
    expect(busyLocationRequestsPerMinute().total).toBeGreaterThan(600);     // the old 600/min/tenant default would have throttled it
    const large = locationRequestsPerMinute(LARGE_200).total;
    expect(large).toBeGreaterThan(3_000);                                     // the old 3,000 default 429'd a 200-technician salon
    expect(perWindow).toBeGreaterThanOrEqual(2 * large);
    expect(perWindow).toBeGreaterThanOrEqual(2 * busyLocationRequestsPerMinute().total);
  });
  it('the per-client budget leaves ≥ 2× headroom over the busiest single device (a POS desk at the 200-technician peak), and cuts one client below the old whole-location budget', () => {
    const large = locationRequestsPerMinute(LARGE_200);
    expect(DEFAULT_CLIENT_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(2 * large.posDeskPerMin);
    expect(DEFAULT_CLIENT_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(2 * large.techPhonePerMin);
    expect(DEFAULT_CLIENT_RATE_LIMIT_MAX).toBeLessThan(3_000);               // one runaway client: refused before it could take what the whole location had before M4
  });
  it('the modelled 200-technician busy minute replayed through the guard: no 429 for the location or any device', async () => {
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({}), { isEnabled: async () => true } as any, new InMemoryTenantRateLimiter({ max: DEFAULT_CLIENT_RATE_LIMIT_MAX, prefix: 'c:' }));
    const L = locationRequestsPerMinute(LARGE_200);
    const devices: { sid: string; n: number }[] = [
      ...Array.from({ length: LARGE_200.posStations }, (_, i) => ({ sid: 'pos' + i, n: Math.ceil(L.posDeskPerMin) })),
      ...Array.from({ length: LARGE_200.techs }, (_, i) => ({ sid: 'tech' + i, n: Math.ceil(L.techPhonePerMin) })),
    ];
    const rest = Math.ceil(L.total - devices.reduce((a, d) => a + d.n, 0));
    devices.push(...Array.from({ length: 10 }, (_, i) => ({ sid: 'other' + i, n: Math.ceil(rest / 10) })));
    let refused = 0;
    for (const d of devices) for (let i = 0; i < d.n; i++) {
      const req = { ctx: { tenantId: 'salon-200', branchId: 'b1', userId: d.sid, role: 'FRONT_DESK' }, rateLimitClient: 's:' + d.sid };
      try { await g.canActivate(ctx(req)); } catch { refused++; }
    }
    expect(refused).toBe(0);
  });
  it('records the model (PERFORMANCE_REPORT.md "Rate limit (M4)")', () => {
    const a = locationRequestsPerMinute(BUSY_20), b = locationRequestsPerMinute(LARGE_200);
    console.log(`[rate-limit model] 20 techs: ${Math.round(a.total)}/min; 200 techs: ${Math.round(b.total)}/min (POS desk ${Math.round(b.posDeskPerMin)}, tech phone ${Math.round(b.techPhonePerMin)}) ${JSON.stringify(Object.fromEntries(Object.entries(b.parts).map(([k, v]) => [k, Math.round(v)])))}`);
    expect(b.total).toBeGreaterThan(a.total);
  });
});

describe('TenantRateLimitGuard — the per-client budget (M4)', () => {
  const allowAll = { enabled: true, hit: async () => ({ allowed: true, remaining: 1, limit: 1, retryAfterMs: 0 }) } as any;
  const flags = { isEnabled: async () => true } as any;
  const req = (sid: string, branchId = 'b1') => ({ ctx: { tenantId: 'salonA', branchId, userId: 'user-' + sid, role: 'FRONT_DESK' }, rateLimitClient: 's:' + sid });
  it('a runaway client is refused (429, scope client) while another device of the same salon keeps working', async () => {
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({ max: 1_000 }), flags, new InMemoryTenantRateLimiter({ max: 3 }));
    for (let i = 0; i < 3; i++) expect(await g.canActivate(ctx(req('runaway')))).toBe(true);
    const err: any = await g.canActivate(ctx(req('runaway'))).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.response).toMatchObject({ code: 'RATE_LIMITED', scope: 'client', limit: 3 });
    expect(await g.canActivate(ctx(req('desk-2')))).toBe(true);
  });
  it('a refused client does not spend the location budget', async () => {
    const location = new InMemoryTenantRateLimiter({ max: 5 });
    const g = new TenantRateLimitGuard(location, flags, new InMemoryTenantRateLimiter({ max: 1 }));
    await g.canActivate(ctx(req('x')));
    for (let i = 0; i < 10; i++) await g.canActivate(ctx(req('x'))).catch(() => undefined);
    for (let i = 0; i < 4; i++) expect(await g.canActivate(ctx(req('y' + i)))).toBe(true);   // 1 + 4 = the location's 5
  });
  it('the location ceiling still applies across many clients (noisy-neighbour protection), scope location', async () => {
    const g = new TenantRateLimitGuard(new InMemoryTenantRateLimiter({ max: 4 }), flags, new InMemoryTenantRateLimiter({ max: 100 }));
    for (let i = 0; i < 4; i++) expect(await g.canActivate(ctx(req('d' + i)))).toBe(true);
    const err: any = await g.canActivate(ctx(req('d9'))).catch((e) => e);
    expect(err.response).toMatchObject({ code: 'RATE_LIMITED', scope: 'location' });
  });
  it('keys the client per location and falls back to the user id when the principal has no session id', async () => {
    const hits: string[] = [];
    const rec = { enabled: true, hit: async (k: string) => { hits.push(k); return { allowed: true, remaining: 1, limit: 1, retryAfterMs: 0 }; } } as any;
    const g = new TenantRateLimitGuard(allowAll, flags, rec);
    await g.canActivate(ctx(req('abc', 'b2')));
    await g.canActivate(ctx({ ctx: { tenantId: 'salonA', branchId: 'b1', userId: 'u1', role: 'MANAGER' } }));
    expect(hits).toEqual([rateLimitClientKey('salonA', 'b2', 's:abc'), rateLimitClientKey('salonA', 'b1', 'u:u1')]);
  });
  it('defaults: 24,000 / min per location, 2,000 / min per client; env overrides each', () => {
    expect(DEFAULT_RATE_LIMIT_MAX).toBe(24_000);
    expect(DEFAULT_CLIENT_RATE_LIMIT_MAX).toBe(2_000);
    expect(clientRateLimitOptionsFromEnv({ RATE_LIMIT_MAX_PER_CLIENT: '250' } as any).max).toBe(250);
    expect(rateLimitOptionsFromEnv({ RATE_LIMIT_MAX_PER_TENANT: '9000' } as any).max).toBe(9000);
    expect(makeClientRateLimiter({ TENANT_RATE_LIMIT: 'off' } as any).enabled).toBe(false);
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
