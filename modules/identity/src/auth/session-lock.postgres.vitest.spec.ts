// session-lock.postgres.vitest.spec.ts — Functional Decision 35 on real Postgres (migration 491): the session row
// carries the lock, a second API server sees it, re-locking keeps the first time, and POST /auth/verify-pin unlocks the
// session only with the right PIN (POST /auth/lock locks it). Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselySessionStore } from './session-store';
import { AuthController } from './auth.controller';
import { hashPassword } from '@aipowersalon/auth';
import { KyselyAuthEvents } from './auth-events';

const url = process.env.PG_RACE_URL;
const U = 'e3500000-0000-4000-8000-0000000000e1';
let db: Kysely<any>; let pool: pg.Pool;
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const lockedAtRow = async (sid: string) => ((await sql`select locked_at from sessions where id = ${sid}`.execute(db)).rows[0] as any)?.locked_at ?? null;

// one database handle and one proof user for both blocks below
beforeAll(async () => {
  if (!url) return;
  pool = new pg.Pool({ connectionString: url, max: 4 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
  await sql`delete from auth_events where user_id = ${U}`.execute(db);
  await sql`delete from sessions where user_id = ${U}`.execute(db);
  await sql`delete from users where id = ${U}`.execute(db);
  await sql`insert into users (id, role, email, full_name, pin_hash) values (${U}, 'FRONT_DESK', 'd35@example.test', 'Pin Tester', ${await hashPassword('4826')})`.execute(db);
});
afterAll(async () => {
  if (!url) return;
  await sql`delete from auth_events where user_id = ${U}`.execute(db).catch(() => undefined);
  await sql`delete from refresh_tokens where user_id = ${U}`.execute(db).catch(() => undefined);
  await sql`delete from sessions where user_id = ${U}`.execute(db).catch(() => undefined); await sql`delete from users where id = ${U}`.execute(db).catch(() => undefined); await db?.destroy();
});

describe.skipIf(!url)('session lock on real Postgres (Decision 35)', () => {
  it('lock / unlock persist on the row; a second server instance sees the lock; re-lock keeps the first time', async () => {
    const a = new KyselySessionStore(db as any), b = new KyselySessionStore(db as any);
    const sid = (await a.create({ userId: U, tenantId: null, branchId: null, ttlSeconds: 3600 }))!;
    expect(await b.lockedAt(sid)).toBeNull();
    await a.lock(sid);
    const first = await lockedAtRow(sid);
    expect(first).not.toBeNull();
    expect(await new KyselySessionStore(db as any).lockedAt(sid)).toBe(new Date(first).getTime());   // another server, cold cache
    await new Promise((r) => setTimeout(r, 20));
    await a.lock(sid);
    expect(new Date(await lockedAtRow(sid)).getTime()).toBe(new Date(first).getTime());
    await a.unlock(sid);
    expect(await lockedAtRow(sid)).toBeNull();
    expect(await a.lockedAt(sid)).toBeNull();
  });

  it('POST /auth/lock locks the session; a wrong PIN leaves it locked; the right PIN unlocks it', async () => {
    const store = new KyselySessionStore(db as any);
    const sid = (await store.create({ userId: U, tenantId: null, branchId: null, ttlSeconds: 3600 }))!;
    const ctl = new AuthController({} as any, {} as any, store, db as any, undefined);
    const req = { ctx: { userId: U, role: 'FRONT_DESK' }, sessionId: sid };
    const r1 = res(); await ctl.lock(req, r1);
    expect(r1.body).toMatchObject({ success: true, locked: true });
    expect(await lockedAtRow(sid)).not.toBeNull();
    const r2 = res(); await ctl.verifyPin(req, { pin: '0000' }, r2);
    expect(r2.code).toBe(403);
    expect(await lockedAtRow(sid)).not.toBeNull();
    const r3 = res(); await ctl.verifyPin(req, { pin: '4826' }, r3);
    expect(r3.code).toBe(200);
    expect(await lockedAtRow(sid)).toBeNull();
  });
});

// Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8
// hours locked." The server idle-locks a POS session from its own activity clock (migration 570), on a fixed injected clock.
describe.skipIf(!url)('server idle lock on real Postgres (Oct 12 2026)', () => {
  const T0 = Date.parse('2026-10-12T09:00:00Z'); const MIN = 60_000;
  let tenantId: string; let now = T0;
  const store = (minutes = 60, enabled = true) => new KyselySessionStore(db as any, { now: () => now, idleLockPolicy: async () => ({ enabled, minutes }) });
  const row = async (sid: string) => (await sql`select client_app, locked_at, last_activity_at, pin_failures, status from sessions where id = ${sid}`.execute(db)).rows[0] as any;
  const events = async (sid: string, type: string) => Number(((await sql`select count(*)::int n from auth_events where session_id = ${sid}::uuid and event_type = ${type}`.execute(db)).rows[0] as any).n);
  beforeAll(async () => {
    tenantId = ((await sql`select id from tenants order by created_at limit 1`.execute(db)).rows[0] as any).id;
  });

  it('a POS session nobody used for 60 minutes is locked at last activity + 60 — written on the row, seen by another server', async () => {
    now = T0;
    const a = store();
    const sid = (await a.create({ userId: U, tenantId, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' }))!;
    expect(await row(sid)).toMatchObject({ client_app: 'pos', locked_at: null });
    expect(new Date((await row(sid)).last_activity_at).getTime()).toBe(T0);
    now = T0 + 59 * MIN;
    expect(await store().lockedAt(sid)).toBeNull();
    now = T0 + 75 * MIN;
    expect(await store().lockedAt(sid)).toBe(T0 + 60 * MIN);            // a cold server (the second API replica)
    expect(new Date((await row(sid)).locked_at).getTime()).toBe(T0 + 60 * MIN);
    expect(await a.lockedAt(sid)).toBe(T0 + 60 * MIN);
  });

  it('activity reported on ONE server keeps the session open on another; a locked row ignores activity', async () => {
    now = T0;
    const a = store(), b = store();
    const sid = (await a.create({ userId: U, tenantId, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' }))!;
    expect(await b.lockedAt(sid)).toBeNull();                          // b caches the row now
    now = T0 + 59 * MIN; await a.touchActivity(sid);
    now = T0 + 61 * MIN;
    expect(await b.lockedAt(sid)).toBeNull();                          // b re-reads before it locks: a's activity wins
    now = T0 + 59 * MIN + 61 * MIN;
    expect(await b.lockedAt(sid)).toBe(T0 + 119 * MIN);
    await a.touchActivity(sid);
    expect(new Date((await row(sid)).last_activity_at).getTime()).toBe(T0 + 59 * MIN);
  });

  it('a session that is not a POS session is never idle-locked (native, the apps, no header)', async () => {
    now = T0;
    const sid = (await store().create({ userId: U, tenantId, branchId: null, ttlSeconds: 86_400, clientApp: 'native' }))!;
    expect(await row(sid)).toMatchObject({ client_app: null, last_activity_at: null });
    now = T0 + 24 * 3_600_000;
    expect(await store().lockedAt(sid)).toBeNull();
  });

  it('PIN: wrong → refused + audited; right → unlocked and the idle clock restarts; the 5th wrong PIN ends the session', async () => {
    now = T0;
    const s = store();
    const sid = (await s.create({ userId: U, tenantId, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' }))!;
    const ctl = new AuthController({} as any, {} as any, s, db as any, undefined, undefined, undefined, new KyselyAuthEvents(db), undefined, undefined);
    const req = { ctx: { userId: U, role: 'FRONT_DESK', tenantId }, sessionId: sid, headers: {} };
    now = T0 + 90 * MIN;
    expect(await s.lockedAt(sid)).toBe(T0 + 60 * MIN);
    const w = res(); await ctl.verifyPin(req, { pin: '0000' }, w);
    expect(w.code).toBe(403);
    expect((await row(sid)).pin_failures).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(await events(sid, 'PIN_UNLOCK_FAILED')).toBe(1);
    const ok = res(); await ctl.verifyPin(req, { pin: '4826' }, ok);
    expect(ok.code).toBe(200);
    expect(await row(sid)).toMatchObject({ locked_at: null, pin_failures: 0 });
    expect(new Date((await row(sid)).last_activity_at).getTime()).toBe(T0 + 90 * MIN);
    now = T0 + 149 * MIN;
    expect(await s.lockedAt(sid)).toBeNull();                          // 59 minutes after the unlock
    for (let i = 1; i <= 4; i++) { const r = res(); await ctl.verifyPin(req, { pin: '1111' }, r); expect(r.code).toBe(403); }
    const fifth = res(); await ctl.verifyPin(req, { pin: '1111' }, fifth);
    expect(fifth.code).toBe(429);
    expect(fifth.body).toMatchObject({ code: 'too_many_attempts' });
    expect((await row(sid)).status).toBe('revoked');
    const after = res(); await ctl.verifyPin(req, { pin: '4826' }, after);   // even the right PIN cannot bring it back
    expect(after.code).not.toBe(200);
  });

  it('GET /auth/lock-status and POST /auth/session-activity', async () => {
    now = T0;
    const s = store(30);
    const sid = (await s.create({ userId: U, tenantId, branchId: null, ttlSeconds: 86_400, clientApp: 'pos' }))!;
    const ctl = new AuthController({} as any, {} as any, s, db as any, undefined, undefined, undefined, undefined, undefined, undefined);
    const req = { ctx: { userId: U, role: 'FRONT_DESK', tenantId }, sessionId: sid, headers: {} };
    const st = { body: await ctl.lockStatus(req) };
    expect(st.body).toEqual({ posSession: true, salon: { enabled: true, minutes: 30 }, locked: false, lockedAt: null, fullSignInAt: null, idleLockAt: new Date(T0 + 30 * MIN).toISOString(), fullSignInAfterHours: 8 });
    now = T0 + 20 * MIN;
    const a = { body: await ctl.sessionActivity(req) };
    expect(a.body).toEqual({ ok: true, idleLockAt: new Date(T0 + 50 * MIN).toISOString() });
    now = T0 + 51 * MIN;
    const l = { body: await ctl.lockStatus(req) };
    expect(l.body).toMatchObject({ locked: true, lockedAt: new Date(T0 + 50 * MIN).toISOString(), fullSignInAt: new Date(T0 + 50 * MIN + 8 * 3_600_000).toISOString(), idleLockAt: null });
  });

  it('sign-in from the POS (X-Client-Type: pos) stores a POS session; native / an app / no header do not', async () => {
    const prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = 'test-session-secret-value-32-chars-long';
    try {
      now = T0;
      const s = store();
      const login: any = { attempt: async () => ({ outcome: 'SUCCESS', principal: { userId: U, tenantId, branchId: null, role: 'FRONT_DESK', permissions: [], subscriptionStatus: 'active' } }) };
      const ctl = new AuthController(login, {} as any, s, db as any, undefined, undefined, undefined, undefined, undefined, undefined);
      const signIn = async (headers: Record<string, string>) => {
        const r: any = res(); r.cookie = () => r; r.clearCookie = () => r;
        await ctl.doLogin({ headers }, { portal: 'tenant', salonCode: 'X', identifier: 'd35@example.test', password: 'x' }, r);
        const sid = ((await sql`select id from sessions where user_id = ${U} order by created_at desc, id limit 1`.execute(db)).rows[0] as any).id;
        return (await row(sid)).client_app;
      };
      expect(await signIn({ 'x-client-type': 'pos' })).toBe('pos');
      for (const h of [{ 'x-client-type': 'native' }, { 'x-client-type': 'tech' }, {}]) {
        await new Promise((r) => setTimeout(r, 5));
        expect(await signIn(h as any)).toBeNull();
      }
    } finally { process.env.AUTH_SESSION_SECRET = prev; }
  });
});
