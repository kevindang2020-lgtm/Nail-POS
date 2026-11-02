// idempotency.postgres-race.vitest.spec — Constitution 5 §61–66: one Idempotency-Key runs ONCE; a retry gets the same
// answer. Pure helpers always; the store and interceptor on real Postgres when PG_RACE_URL is set (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { of, throwError, lastValueFrom } from 'rxjs';
import { canonical, requestHash, scopeOf, IdempotencyStore, IdempotencyInterceptor, STALE_INFLIGHT_MS } from '@aipowersalon/database/nest';

describe('idempotency — request identity', () => {
  it('key order does not change the request; content, params and route do', () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonical({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    const h = requestHash('POST', '/pos/checkout/payments/:paymentId/refund', { paymentId: 'p1' }, { reason: 'x', amountCents: 2000 });
    expect(requestHash('post', '/pos/checkout/payments/:paymentId/refund', { paymentId: 'p1' }, { amountCents: 2000, reason: 'x' })).toBe(h);
    expect(requestHash('POST', '/pos/checkout/payments/:paymentId/refund', { paymentId: 'p1' }, { reason: 'x', amountCents: 2001 })).not.toBe(h);
    expect(requestHash('POST', '/pos/checkout/payments/:paymentId/refund', { paymentId: 'p2' }, { reason: 'x', amountCents: 2000 })).not.toBe(h);
    expect(requestHash('POST', '/pos/checkout/payments/:paymentId/void', { paymentId: 'p1' }, { reason: 'x', amountCents: 2000 })).not.toBe(h);
  });
  it('the scope is the caller: salon + actor + person; no caller → no scope', () => {
    expect(scopeOf({ tenantId: 't1', actorType: 'USER', userId: 'u1' })).toBe('t1:USER:u1');
    expect(scopeOf({ userId: 'sa' , role: 'SUPER_ADMIN' })).toBe('-:SUPER_ADMIN:sa');
    expect(scopeOf({})).toBeNull(); expect(scopeOf(undefined)).toBeNull();
  });
});

const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('idempotency store + interceptor (real Postgres)', () => {
  let db: Kysely<any>; let pool: pg.Pool; let store: IdempotencyStore;
  const S = 'test-idem:USER:u1'; const T = '00000000-0000-4000-8000-0000000000aa';
  const base = (key: string, hash = 'h1') => ({ scope: S, key, tenantId: T, method: 'POST', route: '/x/:id/refund', hash });
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); db = new Kysely({ dialect: new PostgresDialect({ pool }) }); store = new IdempotencyStore(db); await sql`delete from api_idempotency where scope like 'test-idem%' or scope like '%:test-idem-int'`.execute(db); });
  afterAll(async () => { await sql`delete from api_idempotency where scope like 'test-idem%' or scope like '%:test-idem-int'`.execute(db); await db.destroy(); });

  it('proceed → done → replay; a different request on the same key → conflict', async () => {
    expect(await store.claim(base('key-0001'))).toEqual({ kind: 'proceed' });
    expect(await store.claim(base('key-0001'))).toEqual({ kind: 'inflight' });
    await store.complete(S, 'key-0001', T, 201, { refundId: 'r1', status: 'refunded' });
    expect(await store.claim(base('key-0001'))).toEqual({ kind: 'replay', status: 201, body: { refundId: 'r1', status: 'refunded' } });
    expect(await store.claim(base('key-0001', 'other'))).toEqual({ kind: 'conflict' });
  });
  it('a failed attempt is released; a crashed one is taken over after 60 s; an expired key starts fresh', async () => {
    expect((await store.claim(base('key-0002'))).kind).toBe('proceed'); await store.release(S, 'key-0002', T);
    expect((await store.claim(base('key-0002'))).kind).toBe('proceed');
    await sql`update api_idempotency set created_at = now() - make_interval(secs => ${STALE_INFLIGHT_MS / 1000 + 5}) where scope = ${S} and idem_key = 'key-0002'`.execute(db);
    expect((await store.claim(base('key-0002'))).kind).toBe('proceed');            // taken over
    expect((await store.claim(base('key-0002'))).kind).toBe('inflight');           // …and now it is fresh again
    await store.complete(S, 'key-0002', T, 200, { ok: true });
    await sql`update api_idempotency set expires_at = now() - interval '1 second' where scope = ${S} and idem_key = 'key-0002'`.execute(db);
    expect((await store.claim(base('key-0002', 'new-request'))).kind).toBe('proceed');  // expired: no conflict, no replay
  });
  it('keys are scoped to the caller: the same key from another person is a different request', async () => {
    await store.claim(base('key-0003')); await store.complete(S, 'key-0003', T, 201, { secret: 'mine' });
    expect(await store.claim({ ...base('key-0003'), scope: 'test-idem:USER:u2' })).toEqual({ kind: 'proceed' });
  });
  it('the tenant is part of every lookup: the same scope+key under another salon id is never replayed', async () => {
    await store.claim(base('key-0005')); await store.complete(S, 'key-0005', T, 201, { mine: true });
    // (defence in depth — the scope already names the salon; this proves the tenant_id filter itself holds)
    const other = '00000000-0000-4000-8000-0000000000bb';
    const c = await store.claim({ ...base('key-0005'), tenantId: other });
    expect(c.kind).not.toBe('replay'); expect(c.kind).toBe('inflight');   // and it answers instead of looping
  });
  it('10 simultaneous claims of one key: exactly one proceeds', async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => store.claim(base('key-0004'))));
    expect(r.filter((x) => x.kind === 'proceed')).toHaveLength(1);
    expect(r.filter((x) => x.kind === 'inflight')).toHaveLength(9);
  });
  it('the sweep deletes only expired rows, at most `limit` per call', async () => {
    for (let i = 0; i < 5; i++) { await store.claim(base('sweep-' + i + '-xx')); }
    await sql`update api_idempotency set expires_at = now() - interval '1 second' where scope = ${S} and idem_key like 'sweep-%'`.execute(db);
    expect(await store.sweepExpired(new Date(), 3)).toBe(3);
    expect(await store.sweepExpired(new Date(), 3)).toBe(2);
    expect((await sql<any>`select count(*)::int n from api_idempotency where scope = ${S} and idem_key = 'key-0001'`.execute(db)).rows[0].n).toBe(1);
  });

  describe('the interceptor', () => {
    const reflector: any = { get: (k: string) => (k === '__httpCode__' ? undefined : { required: false }) };
    const ctxOf = (headers: any, body: any, res: any) => ({
      getHandler: () => null,
      switchToHttp: () => ({ getRequest: () => ({ headers, body, params: { id: 'p1' }, method: 'POST', route: { path: '/x/:id/refund' }, ctx: { tenantId: T, actorType: 'USER', userId: 'test-idem-int' } }), getResponse: () => res }),
    }) as any;
    it('the handler runs ONCE for a key; the retry gets the same body, status and a replay header', async () => {
      const ic = new IdempotencyInterceptor(reflector, db); let runs = 0;
      const handler = { handle: () => { runs++; return of({ refundId: 'r-' + runs }); } };
      const res1: any = { headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; } };
      const a = await lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'int-key-0001' }, { amountCents: 2000 }, res1), handler));
      const res2: any = { headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; } };
      const b = await lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'int-key-0001' }, { amountCents: 2000 }, res2), handler));
      expect(runs).toBe(1); expect(b).toEqual(a); expect(res2.headers['Idempotent-Replayed']).toBe('true'); expect(res2.code).toBe(201);
      await expect(lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'int-key-0001' }, { amountCents: 9999 }, res2), handler))).rejects.toMatchObject({ status: 422 });
      expect(runs).toBe(1);
    });
    it('a failing handler releases the key so the real retry runs; no key = unchanged behaviour; a junk key is refused', async () => {
      const ic = new IdempotencyInterceptor(reflector, db); let runs = 0;
      const failing = { handle: () => { runs++; return throwError(() => new Error('processor timeout')); } };
      await expect(lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'int-key-0002' }, {}, {}), failing))).rejects.toThrow('processor timeout');
      const ok = { handle: () => { runs++; return of({ done: true }); } };
      expect(await lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'int-key-0002' }, {}, {}), ok))).toEqual({ done: true });
      expect(runs).toBe(2);
      await lastValueFrom(ic.intercept(ctxOf({}, {}, {}), ok)); await lastValueFrom(ic.intercept(ctxOf({}, {}, {}), ok)); expect(runs).toBe(4);
      await expect(lastValueFrom(ic.intercept(ctxOf({ 'idempotency-key': 'bad key!' }, {}, {}), ok))).rejects.toMatchObject({ status: 400 });
    });
    it('required: true refuses a request without a key', async () => {
      const ic = new IdempotencyInterceptor({ get: (k: string) => (k === '__httpCode__' ? undefined : { required: true }) } as any, db);
      await expect(lastValueFrom(ic.intercept(ctxOf({}, {}, {}), { handle: () => of(1) }))).rejects.toMatchObject({ status: 400 });
    });
  });
});
