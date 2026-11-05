// session-lock.vitest.spec.ts — Functional Decision 35, server side. The POS idle lock used to live only in the
// browser: clearing localStorage or opening a second tab skipped the PIN while the session kept full access. Now a
// locked SESSION reaches only the unlock paths (423 SESSION_LOCKED elsewhere), a correct PIN unlocks it, and a lock older
// than 8 hours revokes the session.
import { InMemorySessionStore, signSession, SESSION_LOCK_MAX_MS } from '@aipowersalon/identity';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TenantContextMiddleware, isUnlockPath, LOCKED_SESSION_ALLOWLIST } from './tenant-context.middleware';

const SECRET = 'test-session-secret-value-32-chars-long';
const claims = (sid: string) => ({ userId: '11111111-1111-1111-1111-111111111111', tenantId: '22222222-2222-2222-2222-222222222222', branchId: null, role: 'RECEPTIONIST', permissions: ['pos.checkout'], subscriptionStatus: 'active', sid });
const req = (token: string, url: string) => ({ headers: { cookie: `aps_session=${token}` }, body: {}, query: {}, originalUrl: url, method: 'GET' });
const pass = async (mw: TenantContextMiddleware, r: any) => { let called = false; await mw.use(r, {}, () => { called = true; }); return called; };

describe('server-side session lock (Decision 35)', () => {
  let store: InMemorySessionStore; let sid: string; let token: string; let mw: TenantContextMiddleware;
  const prev = process.env.AUTH_SESSION_SECRET;
  beforeEach(async () => {
    process.env.AUTH_SESSION_SECRET = SECRET;
    store = new InMemorySessionStore();
    sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    token = signSession(claims(sid) as any, { secret: SECRET });
    mw = new TenantContextMiddleware(store);
  });
  afterEach(() => { vi.useRealTimers(); process.env.AUTH_SESSION_SECRET = prev; });

  it('only the unlock paths count as unlock paths', () => {
    for (const u of ['/auth/verify-pin', '/api/auth/verify-pin', '/api/v1/auth/verify-pin', '/auth/me?x=1', '/auth/logout', '/auth/lock/', '/auth/lock-status', '/api/v1/auth/lock-status?t=1']) expect(isUnlockPath(u)).toBe(true);
    for (const u of ['/pos/checkout/tickets/t1/pay/card', '/pos/booking/state', '/auth/set-pin', '/auth/verify-pin-bypass', '/pos/customers?q=/auth/me',
      '/auth/session-activity', '/auth/lock-status/x', '/realtime/pos/stream', '/auth/activity']) expect(isUnlockPath(u)).toBe(false);
  });

  // Oct 12 2026: the locked-session allowlist is security configuration — pinned here, a change must be reviewed. Health, sign-in,
  // refresh and logout are outside the session middleware altogether (auth-boundary.vitest.spec.ts pins that list).
  it('the locked-session allowlist is exactly: unlock with the PIN, who am I, the lock status, sign out, lock', () => {
    expect([...LOCKED_SESSION_ALLOWLIST].sort()).toEqual(['/auth/lock', '/auth/lock-status', '/auth/logout', '/auth/me', '/auth/verify-pin']);
  });

  it('an unlocked session passes everywhere', async () => {
    expect(await pass(mw, req(token, '/pos/booking/state'))).toBe(true);
  });

  it('a locked session gets 423 everywhere but the unlock paths — the same cookie from ANY tab', async () => {
    await store.lock(sid);
    for (const u of ['/pos/booking/state', '/pos/checkout/tickets/t1/pay/card', '/pos/customers/c1']) {
      await expect(mw.use(req(token, u) as any, {}, () => {})).rejects.toMatchObject({ status: 423, response: { code: 'SESSION_LOCKED' } });
    }
    expect(await pass(mw, req(token, '/auth/verify-pin'))).toBe(true);
    expect(await pass(mw, req(token, '/auth/me'))).toBe(true);
  });

  it('unlocking (a correct PIN) restores access', async () => {
    await store.lock(sid);
    await store.unlock(sid);
    expect(await pass(mw, req(token, '/pos/booking/state'))).toBe(true);
  });

  it('a lock older than 8 hours revokes the session — even the unlock path is refused, and it stays revoked', async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-02T22:00:00Z'));
    token = signSession(claims(sid) as any, { secret: SECRET, ttlSeconds: 30 * 86_400 });   // a "remember me" cookie, still valid
    await store.lock(sid);
    vi.setSystemTime(Date.now() + SESSION_LOCK_MAX_MS - 60_000);
    expect(await pass(mw, req(token, '/auth/verify-pin'))).toBe(true);                       // just inside: PIN still works
    vi.setSystemTime(Date.now() + 61_000 + 1000);
    await expect(mw.use(req(token, '/auth/verify-pin') as any, {}, () => {})).rejects.toMatchObject({ status: 401 });
    expect(await store.isRevoked(sid)).toBe(true);
    await store.unlock(sid);
    await expect(mw.use(req(token, '/pos/booking/state') as any, {}, () => {})).rejects.toThrow(/revoked/i);
  });

  it('re-locking keeps the ORIGINAL lock time (a stream of lock calls cannot extend the 8 hours)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-02T22:00:00Z'));
    await store.lock(sid);
    const first = await store.lockedAt(sid);
    vi.setSystemTime(Date.now() + 3_600_000);
    await store.lock(sid);
    expect(await store.lockedAt(sid)).toBe(first);
  });
});

// Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8 hours
// locked." The SERVER locks a POS session nobody used — no browser involved (a cleared tab, a direct API call).
describe('server idle lock through the middleware (fixed clock)', () => {
  const T0 = Date.parse('2026-10-12T09:00:00Z'); const MIN = 60_000;
  const TENANT = '22222222-2222-2222-2222-222222222222';
  let now = T0; let store: InMemorySessionStore; let mw: TenantContextMiddleware;
  const prev = process.env.AUTH_SESSION_SECRET;
  beforeEach(() => { process.env.AUTH_SESSION_SECRET = SECRET; now = T0; store = new InMemorySessionStore({ now: () => now, idleLockPolicy: async () => ({ enabled: true, minutes: 60 }) }); mw = new TenantContextMiddleware(store); });
  afterEach(() => { process.env.AUTH_SESSION_SECRET = prev; });
  const tokenFor = (sid: string) => signSession(claims(sid) as any, { secret: SECRET, ttlSeconds: 30 * 86_400 });

  it('a POS session idle 60 minutes gets 423 SESSION_LOCKED (with the lock time) on every route but the allowlist', async () => {
    const sid = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    const t = tokenFor(sid);
    now = T0 + 59 * MIN;
    expect(await pass(mw, req(t, '/pos/booking/state'))).toBe(true);     // reads never count as activity, but 59 < 60
    now = T0 + 60 * MIN;
    await expect(mw.use(req(t, '/pos/booking/state') as any, {}, () => {})).rejects.toMatchObject({ status: 423, response: { code: 'SESSION_LOCKED', lockedAt: new Date(T0 + 60 * MIN).toISOString() } });
    await expect(mw.use(req(t, '/auth/session-activity') as any, {}, () => {})).rejects.toMatchObject({ status: 423 });   // activity cannot unlock
    expect(await pass(mw, req(t, '/auth/lock-status'))).toBe(true);
    expect(await pass(mw, req(t, '/auth/verify-pin'))).toBe(true);
  });

  it('locked for more than 8 hours (counted from the idle lock, not the next request) → revoked → full sign-in', async () => {
    const sid = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    const t = tokenFor(sid);
    now = T0 + 60 * MIN + 8 * 3_600_000;                                  // exactly 8 h locked: PIN still works
    expect(await pass(mw, req(t, '/auth/verify-pin'))).toBe(true);
    now += 1;
    await expect(mw.use(req(t, '/auth/verify-pin') as any, {}, () => {})).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_LOCK_EXPIRED' } });
    expect(await store.isRevoked(sid)).toBe(true);
  });

  it('sessions that are not POS device sessions are never idle-locked — however long they sit', async () => {
    const native = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'native' });
    const none = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400 });
    now = T0 + 20 * 3_600_000;
    for (const sid of [native, none]) expect(await pass(mw, req(tokenFor(sid), '/pos/booking/state'))).toBe(true);
  });
});
