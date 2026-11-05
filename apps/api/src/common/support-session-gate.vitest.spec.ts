// support-session-gate.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12 "Support Mode expires", Constitution 9
// §225). A request whose session carries a support grant (claim `ssid`) passes TenantContextMiddleware only while that
// support session is live, the caller's own and for the salon the session is in; a stream opened under one ends when it
// expires or is ended. Fixed clock throughout.
import { InMemorySessionStore, signSession } from '@aipowersalon/identity';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Subject, firstValueFrom, toArray } from 'rxjs';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { assertLiveSupportSession, untilSupportSessionDead, type SupportSessionLookup } from './support-session-gate';

const SECRET = 'test-session-secret-value-32-chars-long';
const NOW = Date.parse('2026-03-10T14:00:00Z');
const ADMIN = '11111111-1111-4111-8111-111111111111', T = '22222222-2222-4222-8222-222222222222', T2 = '33333333-3333-4333-8333-333333333333';
const SS = '44444444-4444-4444-8444-444444444444';
type Row = { sessionId: string; tenantId: string; adminUserId: string; expiresAt: string; endedAt: string | null };
const row = (o: Partial<Row> = {}): Row => ({ sessionId: SS, tenantId: T, adminUserId: ADMIN, expiresAt: new Date(NOW + 30 * 60_000).toISOString(), endedAt: null, ...o });
const lookupOf = (r: Row | null | 'boom'): SupportSessionLookup => ({ byId: async (id) => { if (r === 'boom') throw new Error('db down'); return r && r.sessionId === id ? r : null; } });

describe('assertLiveSupportSession — the one check a support grant passes', () => {
  const at = new Date(NOW);
  it('a live session of the caller, for this salon, passes', async () => {
    expect((await assertLiveSupportSession(lookupOf(row()), SS, ADMIN, T, at)).sessionId).toBe(SS);
  });
  it.each([
    ['expired', row({ expiresAt: new Date(NOW - 1).toISOString() }), ADMIN, T, 'support_session_expired'],
    ['ended', row({ endedAt: new Date(NOW - 60_000).toISOString() }), ADMIN, T, 'support_session_ended'],
    ['another salon', row(), ADMIN, T2, 'support_session_wrong_tenant'],
    ['another admin', row(), '55555555-5555-4555-8555-555555555555', T, 'support_session_not_yours'],
    ['unknown id', null, ADMIN, T, 'support_session_required'],
    ['lookup error (fail closed)', 'boom', ADMIN, T, 'support_session_unverifiable'],
  ] as const)('%s → refused', async (_n, r, admin, tenant, code) => {
    await expect(assertLiveSupportSession(lookupOf(r as any), SS, admin, tenant, at)).rejects.toMatchObject({ status: 403, code });
  });
  it('no lookup at all (no database) refuses', async () => {
    await expect(assertLiveSupportSession(null, SS, ADMIN, T, at)).rejects.toMatchObject({ code: 'support_session_unverifiable' });
  });
});

describe('TenantContextMiddleware admits a support grant only while the session is live', () => {
  const prev = process.env.AUTH_SESSION_SECRET;
  let store: InMemorySessionStore; let sid: string;
  const token = (extra: Record<string, unknown>) => signSession({ userId: ADMIN, tenantId: T, branchId: null, role: 'OWNER', permissions: ['pos.checkout.view'], subscriptionStatus: 'active', sid, ...extra } as any, { secret: SECRET });
  const req = (tok: string) => ({ headers: { cookie: `aps_session=${tok}` }, body: {}, query: {}, originalUrl: '/pos/booking/state', method: 'GET' } as any);
  beforeEach(async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    process.env.AUTH_SESSION_SECRET = SECRET;
    store = new InMemorySessionStore();
    sid = await store.create({ userId: ADMIN, tenantId: T, branchId: null, ttlSeconds: 3600 });
  });
  afterEach(() => { vi.useRealTimers(); process.env.AUTH_SESSION_SECRET = prev; });
  const mw = (r: Row | null) => new TenantContextMiddleware(store, undefined, undefined, undefined, undefined, undefined, lookupOf(r));

  it('a live support session: passes, and req.ctx.supportSessionId is the VERIFIED id', async () => {
    const r = req(token({ ssid: SS })); let called = false;
    await mw(row()).use(r, {}, () => { called = true; });
    expect(called).toBe(true);
    expect(r.ctx.supportSessionId).toBe(SS);
  });
  it('the same token one second after the support session expired: 403, the controller never runs', async () => {
    const r = req(token({ ssid: SS })); let called = false;
    vi.setSystemTime(NOW + 30 * 60_000 + 1000);
    await expect(mw(row()).use(r, {}, () => { called = true; })).rejects.toMatchObject({ status: 403, response: { code: 'support_session_expired' } });
    expect(called).toBe(false);
  });
  it('an ended support session: 403', async () => {
    await expect(mw(row({ endedAt: new Date(NOW - 1).toISOString() })).use(req(token({ ssid: SS })), {}, () => {})).rejects.toMatchObject({ status: 403 });
  });
  it('an ordinary session (no ssid) is unchanged, and a client cannot name a support session', async () => {
    const r = req(token({})); r.body = { supportSessionId: SS }; r.headers['x-support-session'] = SS;
    let called = false;
    await mw(null).use(r, {}, () => { called = true; });
    expect(called).toBe(true);
    expect(r.ctx.supportSessionId).toBeUndefined();
  });
});

describe('a stream opened under a support session ends when the session expires', () => {
  afterEach(() => vi.useRealTimers());
  it('completes on the first poll after expiry; an ordinary stream is untouched', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    let now = NOW;
    const src = new Subject<number>();
    const ended: string[] = [];
    const out = firstValueFrom(src.pipe(untilSupportSessionDead(lookupOf(row({ expiresAt: new Date(NOW + 20_000).toISOString() })), SS, () => ended.push('end'), 15_000, () => new Date(now)), toArray()));
    src.next(1);
    await vi.advanceTimersByTimeAsync(15_000);   // first poll: still live
    src.next(2);
    now = NOW + 30_000;
    await vi.advanceTimersByTimeAsync(15_000);   // second poll: expired → the stream completes
    src.next(3);                                 // never delivered
    expect(await out).toEqual([1, 2]);
    expect(ended).toEqual(['end']);
    const plain = new Subject<number>();
    const p = firstValueFrom(plain.pipe(untilSupportSessionDead(lookupOf(null), null), toArray()));
    plain.next(1); await vi.advanceTimersByTimeAsync(60_000); plain.next(2); plain.complete();
    expect(await p).toEqual([1, 2]);
  });
});

import { InProcessEmitter } from '../realtime/realtime.gateway';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { SUPPORT_SESSION_GATE } from './support-session-gate';
import { rooms } from '@aipowersalon/realtime-contracts';
describe('the real stream factory ends a support-session stream at expiry', () => {
  afterEach(() => vi.useRealTimers());
  it('a stream whose req.ctx carries a support session completes once the session expires; one without keeps going', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const lookup = lookupOf(row({ expiresAt: new Date(NOW + 20_000).toISOString() }));
    const moduleRef: any = { get: (tok: unknown) => (tok === SUPPORT_SESSION_GATE ? lookup : undefined) };
    const f = new RealtimeStreamFactory(new InProcessEmitter(), undefined, undefined, undefined, moduleRef);
    const ctx = { tenantId: T, branchId: 'b-1', userId: ADMIN, role: 'OWNER', permissions: [] };
    let doneSupport = false, donePlain = false;
    f.open({ ctx: { ...ctx, supportSessionId: SS }, headers: {} }, () => [rooms.tenantBranch(T, 'b-1')], { frame: 'full' }).subscribe({ complete: () => { doneSupport = true; } });
    f.open({ ctx: { ...ctx, userId: '66666666-6666-4666-8666-666666666666' }, headers: {} }, () => [rooms.tenantBranch(T, 'b-1')], { frame: 'full' }).subscribe({ complete: () => { donePlain = true; } });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(doneSupport).toBe(false);              // still live at the first poll
    await vi.advanceTimersByTimeAsync(15_000);    // NOW + 30 s: expired
    expect(doneSupport).toBe(true);
    expect(donePlain).toBe(false);
  });
});
