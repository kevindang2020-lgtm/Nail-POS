// journal.test.ts — Constitution 6 §15, §19–23, §254–257: the pending-mutation journal. A mutation is written BEFORE it is
// sent, keeps ONE Idempotency-Key for its whole life, replays exactly once on reconnect / next launch, expires per
// operation, reports what happened (APPLIED / CONFLICT / EXPIRED / PERMISSION_REVOKED / RESOURCE_CHANGED / STALE) and is
// never used for a payment.
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryKvStore } from './storage';
import { createMutationJournal, JournalRefusedError, OfflineError, JOURNAL_PREFIX, type JournalSender, type MutationSpec } from './journal';
import type { QueryScope } from './scope';

const A: QueryScope = { realm: 'tenant', tenantId: 't-a', branchId: 'b-1', userId: 'u-1' };
const B: QueryScope = { realm: 'tenant', tenantId: 't-b', branchId: 'b-2', userId: 'u-1' };

/** A server that honours Idempotency-Key exactly like @Idempotent(): one execution per key, the same answer on retry. */
class FakeServer {
  executions: string[] = []; answers = new Map<string, unknown>(); calls: { key: string; path: string }[] = [];
  loseNextResponse = false; failWith: { status: number; code?: string } | null = null; down = false; delayMs = 0;
  send: JournalSender = async (r) => {
    this.calls.push({ key: r.idempotencyKey, path: r.path });
    if (this.delayMs) await new Promise((res) => setTimeout(res, this.delayMs));
    if (this.down) throw Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_ERROR' });
    if (this.failWith) { const f = this.failWith; throw Object.assign(new Error('nope'), { status: f.status, code: f.code ?? 'ERR' }); }
    if (!this.answers.has(r.idempotencyKey)) { this.executions.push(r.path); this.answers.set(r.idempotencyKey, { ok: true, n: this.executions.length }); }
    if (this.loseNextResponse) { this.loseNextResponse = false; throw Object.assign(new Error('timeout'), { code: 'TIMEOUT', status: 0 }); }
    return this.answers.get(r.idempotencyKey);
  };
}

const start = (id = 'tk-1'): MutationSpec => ({ resourceType: 'ticket', resourceId: id, operation: 'tech.start_service', method: 'POST',
  path: `/tech/tickets/${id}/start-service`, body: {}, offline: 'queue', ttlMs: 30 * 60_000, priority: 'HIGH' });

let store: MemoryKvStore; let server: FakeServer; let online: boolean; let now: number;
const make = () => { const j = createMutationJournal({ app: 'tech', store, send: server.send, isOnline: () => online, now: () => now }); j.setScope(A); return j; };
beforeEach(() => { store = new MemoryKvStore(); server = new FakeServer(); online = true; now = 1_000_000; });

describe('online', () => {
  it('writes the entry BEFORE sending, sends ONE key, then clears it', async () => {
    const j = make();
    let storedAtSend = 0;
    const send = server.send;
    server.send = async (r) => { storedAtSend = (await store.keys()).filter((k) => k.startsWith(JOURNAL_PREFIX)).length; return send(r); };
    const j2 = createMutationJournal({ app: 'tech', store, send: (r) => server.send(r), isOnline: () => true, now: () => now }); j2.setScope(A);
    const r = await j2.run(start());
    expect(r.status).toBe('applied');
    expect(storedAtSend).toBe(1);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].key).toMatch(/^[A-Za-z0-9_\-:.]{8,200}$/);
    expect(await j2.list()).toEqual([]);
    void j;
  });
});

describe('offline → pending → replay exactly once', () => {
  it('queues without sending and shows it as pending', async () => {
    online = false; const j = make();
    const r = await j.run(start());
    expect(r.status).toBe('pending');
    expect(server.calls).toHaveLength(0);
    const list = await j.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'pending', resourceId: 'tk-1', operation: 'tech.start_service', tenantId: 't-a', branchId: 'b-1', actorId: 'u-1' });
    expect(list[0].expiresAt).toBe(now + 30 * 60_000);
  });

  it('replays once with the same key; a second replay sends nothing', async () => {
    online = false; const j = make();
    const r = await j.run(start());
    online = true;
    const out = await j.replay();
    expect(out.map((e) => e.status)).toEqual(['applied']);
    expect(server.executions).toEqual(['/tech/tickets/tk-1/start-service']);
    expect(server.calls[0].key).toBe((r as any).entry.idempotencyKey);
    await j.replay();
    expect(server.calls).toHaveLength(1);
  });

  it('concurrent replays (two reconnect events) send once, even while the first is still in flight', async () => {
    online = false; const j = make(); await j.run(start()); await j.run(start('tk-2'));
    online = true;
    server.delayMs = 15;
    const first = j.replay();
    await new Promise((res) => setTimeout(res, 5));               // the first replay is mid-send
    await Promise.all([first, j.replay(), j.replay()]);
    expect(server.calls.map((c) => c.path)).toEqual(['/tech/tickets/tk-1/start-service', '/tech/tickets/tk-2/start-service']);
  });

  it('a lost response is retried with the SAME key, and the server runs it once', async () => {
    const j = make(); server.loseNextResponse = true;
    const r = await j.run(start());
    expect(r.status).toBe('pending');                          // sent, but the answer never came back
    expect(server.executions).toHaveLength(1);
    await j.replay();
    expect(server.calls).toHaveLength(2);
    expect(server.calls[0].key).toBe(server.calls[1].key);
    expect(server.executions).toHaveLength(1);                 // exactly once, server-side
    expect(await j.list()).toEqual([]);
  });

  it('survives a crash: a new journal over the same store replays it on launch', async () => {
    online = false; await make().run(start());
    online = true;
    const relaunched = make();
    const out = await relaunched.replay();
    expect(out[0].status).toBe('applied');
    expect(server.executions).toHaveLength(1);
  });

  it('replays HIGH before NORMAL before LOW, then oldest first', async () => {
    online = false; const j = make();
    await j.run({ ...start('low'), priority: 'LOW' }); now += 1;
    await j.run({ ...start('normal'), priority: 'NORMAL' }); now += 1;
    await j.run({ ...start('high1'), priority: 'HIGH' }); now += 1;
    await j.run({ ...start('high2'), priority: 'HIGH' });
    online = true; await j.replay();
    expect(server.calls.map((c) => c.path.split('/')[3])).toEqual(['high1', 'high2', 'normal', 'low']);
  });
});

describe('outcomes are shown, never silently overwritten', () => {
  it('EXPIRED: a stale action is not replayed', async () => {
    online = false; const j = make(); await j.run(start());
    now += 31 * 60_000; online = true;
    const out = await j.replay();
    expect(out[0].status).toBe('expired');
    expect(server.calls).toHaveLength(0);
  });
  it.each([[409, 'CONFLICT', 'conflict'], [403, 'FORBIDDEN', 'permission_revoked'], [404, 'NOT_FOUND', 'resource_changed'], [412, 'STALE_VERSION', 'stale'], [422, 'IDEMPOTENCY_KEY_REUSED', 'conflict'], [400, 'VALIDATION_FAILED', 'rejected']])(
    'HTTP %i → %s → %s', async (status, code, outcome) => {
      online = false; const j = make(); await j.run(start());
      online = true; server.failWith = { status, code };
      const out = await j.replay();
      expect(out[0].status).toBe(outcome);
      expect((await j.list()).find((e) => e.status === 'pending')).toBeUndefined();
      await j.dismiss(out[0].id);
      expect(await j.list()).toEqual([]);
    });
  it('5xx / in-progress / network: stays pending with a later retryAt', async () => {
    online = false; const j = make(); await j.run(start());
    online = true; server.failWith = { status: 503 };
    let out = await j.replay();
    expect(out[0].status).toBe('pending'); expect(out[0].retryAt).toBeGreaterThan(now); expect(out[0].attempts).toBe(1);
    server.failWith = null;
    await j.replay();                                          // before retryAt: not sent
    expect(server.executions).toHaveLength(0);
    now = out[0].retryAt; out = await j.replay();
    expect(out[0].status).toBe('applied');
  });
  it('a server rejection of an ONLINE run is thrown to the caller (the screen shows it) and not kept', async () => {
    const j = make(); server.failWith = { status: 409, code: 'CONFLICT' };
    await expect(j.run(start())).rejects.toMatchObject({ status: 409 });
    expect(await j.list()).toEqual([]);
  });
});

describe('financial actions never finalize offline and are never journaled', () => {
  it('a spec marked financial is refused by the journal', async () => {
    const j = make();
    await expect(j.run({ ...start(), financial: true })).rejects.toBeInstanceOf(JournalRefusedError);
    expect(await store.keys()).toEqual([]);
  });
  it.each(['/mobile-checkout/tickets/x/charge', '/customer/pay/intent', '/pos/refunds', '/tech/tickets/x/confirm-cash-received', '/customer/gift-cards/redeem', '/checkout/x/payment'])(
    'a payment path is refused: %s', async (path) => {
      const j = make();
      await expect(j.run({ ...start(), path })).rejects.toBeInstanceOf(JournalRefusedError);
      expect(server.calls).toHaveLength(0);
    });
  it('a body carrying a secret is refused', async () => {
    const j = make();
    await expect(j.run({ ...start(), body: { pin: '1234' } })).rejects.toBeInstanceOf(JournalRefusedError);
  });
});

describe('online-only mutations (booking create, approvals)', () => {
  const book: MutationSpec = { resourceType: 'appointment', resourceId: 'new', operation: 'customer.booking.create', method: 'POST', path: '/customer/booking', body: { serviceId: 's' }, offline: 'online-only', ttlMs: 15 * 60_000 };
  it('offline: refused up front, nothing stored, nothing sent', async () => {
    online = false; const j = make();
    await expect(j.run(book)).rejects.toBeInstanceOf(OfflineError);
    expect(await store.keys()).toEqual([]);
  });
  it('online but the answer is lost: kept and replayed with the same key (crash / drop recovery)', async () => {
    const j = make(); server.loseNextResponse = true;
    const r = await j.run(book);
    expect(r.status).toBe('pending');
    await j.replay();
    expect(server.executions).toHaveLength(1);
    expect(server.calls[0].key).toBe(server.calls[1].key);
  });
});

describe('scope', () => {
  it('another salon’s entries are neither listed nor replayed; clear() wipes all (logout)', async () => {
    online = false; const j = make(); await j.run(start());
    j.setScope(B); online = true;
    expect(await j.list()).toEqual([]);
    expect(await j.replay()).toEqual([]);
    expect(server.calls).toHaveLength(0);
    j.setScope(A);
    expect(await j.list()).toHaveLength(1);
    await j.clear();
    expect((await store.keys()).filter((k) => k.startsWith(JOURNAL_PREFIX))).toEqual([]);
  });
  it('no scope (signed out): run refuses to queue', async () => {
    online = false; const j = make(); j.setScope(null);
    await expect(j.run(start())).rejects.toBeInstanceOf(JournalRefusedError);
  });
  it('subscribers hear every change', async () => {
    online = false; const j = make(); let n = 0; const off = j.subscribe(() => { n++; });
    await j.run(start()); online = true; await j.replay();
    expect(n).toBeGreaterThanOrEqual(2); off();
  });
});

describe('the live attempt goes through the caller’s typed call', () => {
  it('exec gets the key; a replay after a lost answer uses send with the same key', async () => {
    const j = make(); const seen: string[] = [];
    const r = await j.run(start(), async (key) => { seen.push(key); throw Object.assign(new Error('dropped'), { status: 0, code: 'NETWORK_ERROR' }); });
    expect(r.status).toBe('pending');
    await j.replay();
    expect(server.calls.map((c) => c.key)).toEqual(seen);
  });
});
