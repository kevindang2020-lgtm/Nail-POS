// control-plane.postgres-race — the races PGlite cannot prove (one session), run against a REAL Postgres with a real
// connection pool: every transaction below gets its own connection, so row locks genuinely serialise them.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database). Skipped otherwise.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { KyselyPlatformStaffRepository, KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';

const url = process.env.PG_RACE_URL;
const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
let db: any; let pool: pg.Pool;

describe.skipIf(!url)('real-Postgres races (Constitution 7 §26, §78)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    // (no cleanup of audit rows: audit_logs is append-only by trigger — a second run proved it by refusing the delete)
  });
  afterAll(async () => { await db?.destroy(); });

  it('§26: two Platform Super Admins demoting each other at the same instant — 50 rounds, never zero left', async () => {
    const staff = new KyselyPlatformStaffRepository(db);
    const { randomUUID } = await import('node:crypto');
    let bothSucceeded = 0;
    for (let round = 0; round < 50; round++) {
      // an isolated pair each round: the only two active super admins in this test's world are A and B
      await sql`update users set status = 'inactive' where role = 'SUPER_ADMIN' and email like 'race-%@platform.test'`.execute(db);
      await sql`update users set status = 'inactive' where role = 'SUPER_ADMIN' and platform_role = 'PLATFORM_SUPER_ADMIN' and email not like 'race-%'`.execute(db);
      const A = randomUUID(), B = randomUUID();
      await sql`insert into users (id, email, role, status, platform_role) values (${A}, ${'race-a-' + round + '@platform.test'}, 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN'),
                                                                                (${B}, ${'race-b-' + round + '@platform.test'}, 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`.execute(db);
      const [ra, rb] = await Promise.all([
        staff.changeRole({ userId: A, permissions: all }, B, 'PLATFORM_ADMIN', `race round ${round} A`),
        staff.changeRole({ userId: B, permissions: all }, A, 'PLATFORM_ADMIN', `race round ${round} B`),
      ]);
      if (ra.ok && rb.ok) bothSucceeded++;
      const left = Number((await sql<any>`select count(*)::int n from users where id in (${A}, ${B}) and platform_role = 'PLATFORM_SUPER_ADMIN' and status = 'active'`.execute(db)).rows[0].n);
      expect(left, `round ${round}`).toBe(1);
    }
    expect(bothSucceeded).toBe(0);
  }, 120_000);

  it('§78: 25 simultaneous extensions of one support session on separate connections — at most 2 win, the count matches', async () => {
    const repo = new KyselySuperAdminPlatformRepo(db);
    const { randomUUID } = await import('node:crypto');
    const U = randomUUID(), T = randomUUID();
    await sql`insert into users (id, email, role, status, platform_role) values (${U}, ${'race-ext-' + U + '@platform.test'}, 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'Race Salon', ${'race-' + T.slice(0, 8)}, ${'R' + T.slice(0, 7)}, 'active')`.execute(db);
    const s: any = (await sql`insert into support_access_sessions (tenant_id, admin_user_id, reason, scope, expires_at) values (${T}, ${U}, 'race test session', 'READ_ONLY', now() + interval '20 minutes') returning id`.execute(db)).rows[0];
    const results = await Promise.all(Array.from({ length: 25 }, () => repo.extendSupportSession(String(s.id), U, 15, 'parallel extension attempt')));
    const won = results.filter((r: any) => r.ok).length;
    expect(won).toBeGreaterThanOrEqual(1);
    expect(won).toBeLessThanOrEqual(2);
    expect(Number((await sql<any>`select extension_count from support_access_sessions where id = ${s.id}`.execute(db)).rows[0].extension_count)).toBe(won);
  }, 60_000);
});
