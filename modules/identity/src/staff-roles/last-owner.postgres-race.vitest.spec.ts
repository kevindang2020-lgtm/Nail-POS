// last-owner.postgres-race.vitest.spec — BUILD_PLAN Phase 9 (RACEP9A): the salon's last two owners demote EACH OTHER at the
// same moment. Real Postgres (opt-in: PG_RACE_URL=postgres://… a migrated database). DETERMINISTIC: a gate connection holds
// the salon row FOR UPDATE, so both demotions have passed the pre-check (each still sees one other owner) and are blocked on
// the salon-row lock inside applyRoleChange when the gate opens; the second to get the lock re-counts the owners with a
// fresh snapshot, finds none besides its target, and is refused with LAST_OWNER. The salon keeps exactly one owner.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { permissionsFor } from '@aipowersalon/permissions';
import { KyselyStaffRolesStore, StaffRolesService, LAST_OWNER } from './staff-roles';
import { recordAuthorizationChange } from '../auth/authorization-audit';

const url = process.env.PG_RACE_URL;
const id = (n: number) => `e9a9a9a9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), A = id(2), B = id(3);
let pool: pg.Pool; let db: Kysely<any>;

describe.skipIf(!url)('real-Postgres last-owner race (RACEP9A)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race P9A', 'Race P9A', 'race-p9a', 'RACEP9A', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, role, email, status) values (${A}, ${T}, 'OWNER', 'race-p9a-a@x.test', 'active'), (${B}, ${T}, 'OWNER', 'race-p9a-b@x.test', 'active')
      on conflict (id) do update set role = 'OWNER', status = 'active'`.execute(db);
    await sql`delete from staff_role_assignments where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from staff_role_assignments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from users where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two concurrent demotions of the two remaining owners → one succeeds, the other is 409 LAST_OWNER; one owner remains', async () => {
    const svc = new StaffRolesService(new KyselyStaffRolesStore(db, (trx, c) => recordAuthorizationChange(trx, null, c)));
    const actor = (userId: string) => ({ tenantId: T, userId, role: 'OWNER', permissions: permissionsFor('OWNER') });
    // Wave 3 (Oct 13 2026): the audit ledger is append-only, so the count below is scoped to THIS run (a reused database
    // kept the earlier runs' rows and the assertion read 5 ≠ 1)
    const runStart = (await sql<{ t: string }>`select clock_timestamp() as t`.execute(db)).rows[0].t;
    const gate = await pool.connect();
    await gate.query('begin');
    await gate.query('select id from tenants where id = $1 for update', [T]);
    const pending = Promise.allSettled([
      svc.assignRole(actor(A), B, 'GENERAL_MANAGER', { reason: 'race' }),
      svc.assignRole(actor(B), A, 'GENERAL_MANAGER', { reason: 'race' }),
    ]);
    await new Promise((r) => setTimeout(r, 700));   // both passed the pre-check and wait on the salon-row lock
    await gate.query('commit'); gate.release();
    const results = await pending;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'CONFLICT', reason: LAST_OWNER });
    const owners = (await sql<any>`select count(*)::int as n from users where tenant_id = ${T} and role = 'OWNER' and status = 'active'`.execute(db)).rows[0];
    expect(owners.n).toBe(1);
    const audits = (await sql<any>`select count(*)::int as n from authorization_audit_events where tenant_id = ${T} and action = 'role.base_changed' and created_at >= ${runStart}`.execute(db)).rows[0];
    expect(audits.n).toBe(1);   // only the change that happened is audited (the refused one rolled back)
  });
});
