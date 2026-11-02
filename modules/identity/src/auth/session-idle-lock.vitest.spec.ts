// session-idle-lock.vitest.spec.ts — Kevin, Oct 12 2026: the POS auto-lock is enforced by the SERVER. A POS session (signed in
// with X-Client-Type: pos) that nobody used for the salon's minutes is locked — whatever the browser did — from last activity
// + minutes; a correct PIN unlocks it and restarts the idle clock; only a person's activity (not reads / polling) moves it.
import { describe, it, expect } from 'vitest';
import { InMemorySessionStore } from './session-store';

const T0 = Date.parse('2026-10-12T09:00:00Z');
const MIN = 60_000;
const TENANT = '22222222-2222-2222-2222-222222222222';
const USER = '11111111-1111-1111-1111-111111111111';

function setup(policy = { enabled: true, minutes: 60 }) {
  let now = T0;
  const store = new InMemorySessionStore({ now: () => now, idleLockPolicy: async () => policy });
  return { store, at: (ms: number) => { now = ms; }, get now() { return now; } };
}

describe('server idle lock (POS sessions)', () => {
  it('a POS session idle for 60 minutes is locked at last activity + 60, not before', async () => {
    const s = setup();
    const sid = await s.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    s.at(T0 + 60 * MIN - 1);
    expect(await s.store.lockedAt(sid)).toBeNull();
    s.at(T0 + 61 * MIN);
    expect(await s.store.lockedAt(sid)).toBe(T0 + 60 * MIN);
  });

  it('activity moves the idle clock; a correct PIN (unlock) restarts it, so the session is not re-locked at once', async () => {
    const s = setup();
    const sid = await s.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    s.at(T0 + 50 * MIN); await s.store.touchActivity(sid);
    s.at(T0 + 100 * MIN);
    expect(await s.store.lockedAt(sid)).toBeNull();                  // 50 idle minutes since the last activity
    s.at(T0 + 111 * MIN);
    expect(await s.store.lockedAt(sid)).toBe(T0 + 110 * MIN);
    await s.store.touchActivity(sid);                                 // activity cannot rescue a locked session
    expect(await s.store.lockedAt(sid)).toBe(T0 + 110 * MIN);
    await s.store.unlock(sid);
    expect(await s.store.lockedAt(sid)).toBeNull();
    s.at(T0 + 170 * MIN);
    expect(await s.store.lockedAt(sid)).toBeNull();                   // 59 minutes after the unlock
  });

  it('the salon minutes apply; a salon that switched auto-lock off is never idle-locked by the server', async () => {
    const a = setup({ enabled: true, minutes: 15 });
    const sa = await a.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    a.at(T0 + 15 * MIN);
    expect(await a.store.lockedAt(sa)).toBe(T0 + 15 * MIN);
    const b = setup({ enabled: false, minutes: 60 });
    const sb = await b.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    b.at(T0 + 10 * 3_600_000);
    expect(await b.store.lockedAt(sb)).toBeNull();
  });

  it('sessions that are not POS sessions are never idle-locked (apps, native, scripts, no salon)', async () => {
    const s = setup();
    const ids = [
      await s.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400 }),
      await s.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: null }),
      await s.store.create({ userId: USER, tenantId: null, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' }),
    ];
    s.at(T0 + 10 * 3_600_000);
    for (const id of ids) expect(await s.store.lockedAt(id)).toBeNull();
  });

  it('lockFacts reports what the lock-status read needs', async () => {
    const s = setup({ enabled: true, minutes: 30 });
    const sid = await s.store.create({ userId: USER, tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    expect(await s.store.lockFacts(sid)).toEqual({ facts: { clientApp: 'pos', tenantId: TENANT, lastActivityAt: T0, lockedAt: null }, policy: { enabled: true, minutes: 30 }, now: T0 });
  });
});
