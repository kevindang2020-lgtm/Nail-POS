// refresh-session.postgres.vitest.spec.ts — the rotation on real Postgres (migration 494 indexes; refresh_tokens from
// 001): the compare-and-set supersede makes a CONCURRENT replay lose. Opt-in: PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { RefreshSessionService, KyselyRefreshRepository } from './refresh-session';
import { KyselySessionStore } from './session-store';

const url = process.env.PG_RACE_URL;
const T = 'a7b00000-0000-4000-8000-0000000000a1', B = 'b7b00000-0000-4000-8000-0000000000b1', U = 'c7b00000-0000-4000-8000-0000000000c1';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('refresh rotation on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'RT', 'RT', 'rt-salon', 'RTSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${U}, ${T}, ${B}, 'rt@example.test', 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from refresh_tokens where user_id = ${U}`.execute(db).catch(() => undefined); await sql`delete from sessions where user_id = ${U}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('ten concurrent uses of ONE refresh token: exactly one rotates, the replays burn the family', async () => {
    const sessions = new KyselySessionStore(db as any);
    const sid = (await sessions.create({ userId: U, tenantId: T, branchId: B, ttlSeconds: 3600 } as any))!;
    // A REAL race: every caller reads the row before any of them supersedes it (a barrier in findByHash), so only the
    // compare-and-set in SQL can decide — the "already superseded" check never sees anything.
    const repo = new KyselyRefreshRepository(db);
    let waiting = 0; let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const racing: any = Object.create(repo);
    racing.findByHash = async (h: string) => { const row = await repo.findByHash(h); if (++waiting === 10) release(); await gate; return row; };
    const svc = new RefreshSessionService(racing, sessions);
    const { refreshToken } = await svc.issue(sid, U, 3600);
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.rotate(refreshToken)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'reused').length).toBeGreaterThanOrEqual(1);
    // the family is burned: the winner's new token no longer works either, and the session is revoked
    const winner: any = results.find((r) => r.ok);
    expect(await svc.rotate(winner.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
    expect(await sessions.isRevoked(sid)).toBe(true);
  });
  it('a clean chain rotates three times; sign-out revokes the family', async () => {
    const sessions = new KyselySessionStore(db as any);
    const sid = (await sessions.create({ userId: U, tenantId: T, branchId: B, ttlSeconds: 3600 } as any))!;
    const svc = new RefreshSessionService(new KyselyRefreshRepository(db), sessions);
    let { refreshToken } = await svc.issue(sid, U, 3600);
    for (let i = 0; i < 3; i++) { const r: any = await svc.rotate(refreshToken); expect(r.ok).toBe(true); refreshToken = r.refreshToken; }
    await svc.revokeSession(sid);
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('§44 / migration 499: revoking a session by ANY path (a plain update, as the session list does) ends its refresh tokens', async () => {
    const sessions = new KyselySessionStore(db as any);
    const sid = (await sessions.create({ userId: U, tenantId: T, branchId: B, ttlSeconds: 3600 } as any))!;
    const svc = new RefreshSessionService(new KyselyRefreshRepository(db), sessions);
    const { refreshToken } = await svc.issue(sid, U, 3600);
    await sql`update sessions set revoked_at = now(), status = 'revoked' where id = ${sid}::uuid`.execute(db);   // not through the service
    const rt: any = (await sql`select revoked_at from refresh_tokens where session_id = ${sid}::uuid`.execute(db)).rows[0];
    expect(rt.revoked_at).not.toBeNull();
    expect(await svc.rotate(refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });
});
