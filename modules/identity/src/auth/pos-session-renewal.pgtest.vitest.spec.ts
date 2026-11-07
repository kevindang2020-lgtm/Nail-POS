// pos-session-renewal.pgtest — Kevin's session-limit decision (Nov 7 2026): the POS stays signed in while in use (each
// access-token renewal slides the session end), a POS locked for 8 h is signed out at its next renewal, 7-day hard cap;
// every other app's session keeps its fixed end. Real refresh endpoint + real session / refresh-token rows on PGlite.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AuthController } from './auth.controller';
import { RefreshSessionService, KyselyRefreshRepository } from './refresh-session';
import { KyselySessionStore } from './session-store';
import { signSession } from './auth-session-token';
process.env.REFRESH_REUSE_GRACE_SECONDS = '0';
const SECRET = 'pos-renewal-secret-value-at-least-32-chars';

let pg: any; let db: any;
const U = 'ae700000-0000-4000-8000-0000000000a1', T = 'ae700000-0000-4000-8000-0000000000a2';
const H = 3600_000;
beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'S', 'S', 'posr-t', 'POSR', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', '${T}', 'Ann', 'ann@posr.test', 'x', 'active', 'MANAGER') ON CONFLICT DO NOTHING`);
});

async function session(opts: { app: 'pos' | null; createdAgoMs: number; endsInMs: number; lockedAgoMs?: number }) {
  const now = Date.now();
  const r: any = await pg.query(`INSERT INTO sessions (user_id, tenant_id, status, created_at, expires_at, client_app, locked_at) VALUES ($1, $2, 'active', $3, $4, $5, $6) RETURNING id`,
    [U, T, new Date(now - opts.createdAgoMs), new Date(now + opts.endsInMs), opts.app, opts.lockedAgoMs != null ? new Date(now - opts.lockedAgoMs) : null]);
  const sid = r.rows[0].id as string;
  const store = new KyselySessionStore(db);
  const refresh = new RefreshSessionService(new KyselyRefreshRepository(db), store);
  const { refreshToken } = await refresh.issue(sid, U, Math.floor(opts.endsInMs / 1000));
  const access = signSession({ userId: U, tenantId: T, branchId: null, role: 'MANAGER', permissions: [], sid } as any, { secret: SECRET, ttlSeconds: 60 });
  const login: any = { async authorizationVersions() { return null; }, async currentAuthorization() { return null; } };
  const c = new AuthController(login, {} as any, store, db, undefined, refresh);
  return { sid, refreshToken, access, c };
}
async function call(s: Awaited<ReturnType<typeof session>>) {
  let status = 200; let body: any = null; const cookies: any[] = [];
  const res: any = { status(x: number) { status = x; return this; }, json(b: any) { body = b; return this; }, cookie(n: string, v: string, o: any) { cookies.push({ n, o }); return this; }, setHeader() { return this; }, send(b: any) { body = b; return this; }, end() { return this; } };
  await s.c.doRefresh({ headers: { authorization: `Bearer ${s.access}` } }, { refreshToken: s.refreshToken }, res);
  return { status, body, cookies };
}
const endOf = async (sid: string) => new Date((await pg.query(`SELECT expires_at FROM sessions WHERE id = $1`, [sid])).rows[0].expires_at).getTime();
const tokenEnd = async (sid: string) => new Date((await pg.query(`SELECT expires_at FROM refresh_tokens WHERE session_id = $1 AND revoked_at IS NULL AND superseded_by_token_id IS NULL`, [sid])).rows[0].expires_at).getTime();

describe('POS session renewal (Nov 7 2026)', () => {
  it('a POS in use 11 h after sign-in is renewed to ~12 h from now — session row and live refresh token move together', async () => {
    const s = await session({ app: 'pos', createdAgoMs: 11 * H, endsInMs: 1 * H });
    const r = await call(s);
    expect(r.status).toBe(200);
    const end = await endOf(s.sid);
    expect(end).toBeGreaterThan(Date.now() + 11.9 * H);
    expect(await tokenEnd(s.sid)).toBe(end);
  });
  it('a POS locked for 8 h is signed out at its next renewal (SESSION_ENDED), and its row is revoked', async () => {
    const s = await session({ app: 'pos', createdAgoMs: 10 * H, endsInMs: 2 * H, lockedAgoMs: 8 * H + 60_000 });
    const r = await call(s);
    expect(r.status).toBe(401); expect(r.body).toMatchObject({ code: 'SESSION_ENDED', reason: 'pos_session_limit' });
    expect((await pg.query(`SELECT status FROM sessions WHERE id = $1`, [s.sid])).rows[0].status).toBe('revoked');
  });
  it('a POS locked for 1 h is renewed but does NOT grow: it ends 8 h after the lock', async () => {
    const s = await session({ app: 'pos', createdAgoMs: 3 * H, endsInMs: 9 * H, lockedAgoMs: 1 * H });
    expect((await call(s)).status).toBe(200);
    const end = await endOf(s.sid);
    expect(Math.abs(end - (Date.now() + 7 * H))).toBeLessThan(5_000);
  });
  it('7-day hard cap: a POS in use 6 days 23 h after sign-in only gets to day 7', async () => {
    const s = await session({ app: 'pos', createdAgoMs: 7 * 24 * H - H, endsInMs: 30 * 60_000 });
    expect((await call(s)).status).toBe(200);
    expect(Math.abs(await endOf(s.sid) - (Date.now() + H))).toBeLessThan(5_000);
  });
  it('any other app keeps its fixed end (owner / tech / customer / Super Admin sessions are untouched)', async () => {
    const s = await session({ app: null, createdAgoMs: 11 * H, endsInMs: 1 * H });
    const before = await endOf(s.sid);
    expect((await call(s)).status).toBe(200);
    expect(await endOf(s.sid)).toBe(before);
  });
});
