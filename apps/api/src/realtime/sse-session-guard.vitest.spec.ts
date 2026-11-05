// sse-session-guard.vitest.spec.ts — an OPEN realtime stream must die when its session is revoked.
//
// SSE authenticates ONCE, at connect, then stays open for hours. So revoking a compromised session would 401 the
// attacker's ordinary HTTP calls while their live stream kept pushing salon data — queue changes, check-ins,
// checkouts — indefinitely. Revocation that doesn't reach the streams isn't really revocation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { untilSessionRevoked } from './sse-session-guard';
import { InMemorySessionStore } from '@aipowersalon/identity';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const collect = <T>(src: any) => {
  const got: T[] = [];
  let done = false;
  src.subscribe({ next: (v: T) => got.push(v), complete: () => { done = true; } });
  return { got, isDone: () => done };
};

describe('an open SSE stream dies when its session is revoked', () => {
  it('keeps streaming while the session is live', async () => {
    const store = new InMemorySessionStore();
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const events = new Subject<string>();
    const { got, isDone } = collect<string>(events.pipe(untilSessionRevoked({ sessionId: sid }, store)));

    events.next('queue_changed');
    await vi.advanceTimersByTimeAsync(20_000);   // a poll happens; not revoked
    events.next('checkout_completed');

    expect(got).toEqual(['queue_changed', 'checkout_completed']);
    expect(isDone()).toBe(false);
  });

  it('THE FIX: the stream COMPLETES once the session is revoked, and stops delivering data', async () => {
    const store = new InMemorySessionStore();
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const events = new Subject<string>();
    const { got, isDone } = collect<string>(events.pipe(untilSessionRevoked({ sessionId: sid }, store)));

    events.next('before_revoke');

    await store.revoke(sid);                     // admin kills the compromised session
    await vi.advanceTimersByTimeAsync(20_000);   // the stream's next poll notices

    expect(isDone()).toBe(true);                 // the connection is terminated…
    events.next('after_revoke');
    expect(got).toEqual(['before_revoke']);      // …and no further salon data is delivered
  });

  it('a token with NO session id (minted before revocation support) streams exactly as before', async () => {
    const store = new InMemorySessionStore();
    const events = new Subject<string>();
    const { got, isDone } = collect<string>(events.pipe(untilSessionRevoked({ sessionId: null }, store)));
    events.next('a');
    await vi.advanceTimersByTimeAsync(60_000);
    events.next('b');
    expect(got).toEqual(['a', 'b']);
    expect(isDone()).toBe(false);
  });

  it('with no store wired, behaviour is unchanged', async () => {
    const events = new Subject<string>();
    const { got } = collect<string>(events.pipe(untilSessionRevoked({ sessionId: 's1' }, undefined)));
    events.next('a');
    await vi.advanceTimersByTimeAsync(60_000);
    events.next('b');
    expect(got).toEqual(['a', 'b']);
  });

  it('a DB blip does NOT disconnect the salon (fails open, like the request path)', async () => {
    const broken: any = { async isRevoked() { throw new Error('db down'); }, async create() { return 's'; }, async revoke() {} };
    const events = new Subject<string>();
    const { got, isDone } = collect<string>(events.pipe(untilSessionRevoked({ sessionId: 's1' }, broken)));
    events.next('a');
    await vi.advanceTimersByTimeAsync(40_000);
    events.next('b');
    expect(isDone()).toBe(false);                // a transient error must not kick every user off
    expect(got).toEqual(['a', 'b']);
  });
});

// Kevin, Oct 12 2026: POS auto-lock enforced by the server — a LOCKED session's live stream ends too (the reconnect then gets
// 423 until the PIN), so a locked POS stops receiving salon data. Sessions that are not POS sessions never lock.
describe('an open SSE stream ends when its session is locked', () => {
  const T0 = Date.parse('2026-10-12T09:00:00Z');
  const TENANT = '22222222-2222-2222-2222-222222222222';
  it('a POS session that goes idle-locked ends its stream; a non-POS session keeps streaming', async () => {
    vi.setSystemTime(T0);
    const store = new InMemorySessionStore({ idleLockPolicy: async () => ({ enabled: true, minutes: 60 }) });
    const pos = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' });
    const app = await store.create({ userId: 'u', tenantId: TENANT, branchId: null, ttlSeconds: 86_400 });
    const a = new Subject<string>(), b = new Subject<string>();
    const sa = collect<string>(a.pipe(untilSessionRevoked({ sessionId: pos }, store)));
    const sb = collect<string>(b.pipe(untilSessionRevoked({ sessionId: app }, store)));
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    a.next('still'); b.next('still');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(sa.isDone()).toBe(true);
    a.next('after'); b.next('after');
    expect(sa.got).toEqual(['still']);
    expect(sb.isDone()).toBe(false);
    expect(sb.got).toEqual(['still', 'after']);
  });
  it('an explicit lock (the POS locked itself) ends the stream within a poll', async () => {
    const store = new InMemorySessionStore();
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const ev = new Subject<string>();
    const s = collect<string>(ev.pipe(untilSessionRevoked({ sessionId: sid }, store)));
    await store.lock(sid);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(s.isDone()).toBe(true);
  });
});
