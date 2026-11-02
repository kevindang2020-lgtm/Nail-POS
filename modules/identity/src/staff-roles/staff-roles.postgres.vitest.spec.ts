// staff-roles.postgres.vitest.spec.ts — the staff-roles store on real Postgres (migration 486). Opt-in: PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyStaffRolesStore, StaffRolesService } from './staff-roles';

const url = process.env.PG_RACE_URL;
const T = 'a6000000-0000-4000-8000-0000000000aa';
const T2 = 'a6000000-0000-4000-8000-0000000000bb';
const U = 'e6000000-0000-4000-8000-0000000000e1';
const OWNER = { tenantId: T, userId: 'e6000000-0000-4000-8000-0000000000e0', role: 'OWNER' };
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('staff roles store on real Postgres (Decision 12)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const t of [T, T2]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${'Roles ' + t.slice(-2)}, ${'Roles ' + t.slice(-2)}, ${'roles-' + t.slice(-2)}, ${'RL' + t.slice(-2).toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, email, role, password_hash) values (${U}, ${T}, 'acct-roles@example.com', 'MANAGER', 'x') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from staff_role_assignments where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined);
    await sql`delete from tenant_custom_roles where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('custom roles persist; one live name per salon (case-insensitive); archiving frees the name; other salons are separate', async () => {
    const store = new KyselyStaffRolesStore(db);
    const svc = new StaffRolesService(store);
    const r = await svc.createCustomRole(OWNER, { name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login', 'booking.manage'] });
    await expect(store.insertCustomRole({ tenantId: T, name: 'front desk lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'], createdBy: OWNER.userId })).rejects.toThrow();   // the DB index, not just the service
    await store.insertCustomRole({ tenantId: T2, name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'], createdBy: OWNER.userId });   // another salon: fine
    await svc.archiveCustomRole(OWNER, r.key.slice(7));
    await svc.createCustomRole(OWNER, { name: 'Front Desk Lead', baseRole: 'FRONT_DESK', scope: 'BRANCH', permissions: ['pos.login'] });   // name free again
    expect((await store.customRoles(T, true)).length).toBe(2);
  });

  it('assignment is per salon, upserts, clears, and resolves through the fail-safe resolver', async () => {
    const store = new KyselyStaffRolesStore(db); const svc = new StaffRolesService(store);
    expect(await store.userBaseRole(T, U)).toBe('MANAGER');
    expect(await store.userBaseRole(T2, U)).toBeNull();                 // not staff of the other salon
    await svc.assignRole(OWNER, U, 'GENERAL_MANAGER');
    await svc.assignRole(OWNER, U, 'ACCOUNTANT');                       // upsert
    expect(await store.assignment(T, U)).toBe('ACCOUNTANT');
    expect((await svc.resolvePermissions(T, U, 'MANAGER'))!).toContain('payroll.view');
    await svc.assignRole(OWNER, U, null);
    expect(await svc.resolvePermissions(T, U, 'MANAGER')).toBeNull();
  });
});
