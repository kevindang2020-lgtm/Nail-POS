// technician-app-access.pgtest.vitest.spec.ts — the toggles actually stick, and they actually MEAN something.
//
// Three POS screens have never stored a byte. `setPermissions` echoed its input back. A manager toggled "can
// process payment", got a 200, reloaded, and it was gone — and even if it HAD been stored it would have changed
// nothing, because the session was minted from `permissionsFor(role)` and never looked at the technician.
//
// So this asks two different questions, and both of them have to be true or the feature is theatre:
//
//   1. Does the write LAND?                          (the repository, against a real Postgres)
//   2. Does the landed row reach the SESSION?        (the auth repository + the pure overlay)
//
// A test that only asks the first is how you ship a permission screen that persists perfectly and grants nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { testProviderSecrets as mfaSecrets } from '@aipowersalon/testing';   // a module cannot import the API's sealers; real AES under a test key
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';
import { effectiveTechPermissions } from '@aipowersalon/permissions';
import { KyselyAuthUserRepository } from '@aipowersalon/identity';
import { permissionsFor } from '@aipowersalon/permissions';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH = 'a1111111-1111-1111-1111-111111111111';
const MANAGER = 'a2222222-2222-2222-2222-222222222222';
const TECH_USER = 'a3333333-3333-3333-3333-333333333333';
const TECH = 'a4444444-4444-4444-4444-444444444444';

const ctx = { tenantId: TENANT, branchId: BRANCH, userId: MANAGER, role: 'MANAGER', permissions: [] as string[] };

let pg: PGlite;
let db: any;
let repo: KyselyTechniciansRepository;
let auth: KyselyAuthUserRepository;

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  const files = readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  for (const f of files) {
    const sqlText = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    // 377 is NOT tolerant — if the migration this session added does not apply, this suite fails loudly.
    if (f.startsWith('377')) await pg.exec(sqlText);
    else try { await pg.exec(sqlText); } catch { /* pg_trgm / btree_gist */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  repo = new KyselyTechniciansRepository(db);
  auth = new KyselyAuthUserRepository(db, mfaSecrets);

  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                  values ($1,'Luxe','Luxe Nails','luxe','LUXE','active')`, [TENANT]);
  await pg.query(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [BRANCH, TENANT]);
  await pg.query(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'TECHNICIAN','active','Olivia Brown')`, [TECH_USER, TENANT, BRANCH]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active)
                  values ($1,$2,$3,$4,'Olivia','Brown','Olivia Brown',true)`, [TECH, TENANT, BRANCH, TECH_USER]);
}, 180000);

describe('the write LANDS', () => {
  it('setPermissions persists — and getPermissions reads back what the manager set, not a default', async () => {
    await repo.setPermissions(ctx as any, TECH, {
      matrix: [{ permission: 'pos.tech.process_payment', allowed: true }, { permission: 'pos.tech.view_earnings', allowed: false }],
    } as any);

    const got = await repo.getPermissions(ctx as any, TECH);
    const by = Object.fromEntries(got!.matrix.map((m) => [m.permission, m.allowed]));
    expect(by['pos.tech.process_payment']).toBe(true);   // granted on top of the role
    expect(by['pos.tech.view_earnings']).toBe(false);    // REVOKED — a role default the salon took away
    expect(by['pos.tech.accept_ticket']).toBe(true);     // untouched role default survives

    const r: any = await pg.query(`select count(*)::int as n from technician_permissions where tenant_id = $1 and technician_id = $2`, [TENANT, TECH]);
    expect(r.rows[0].n).toBe(2);   // only the OVERRIDES are stored; the role supplies the rest
  });

  it('setSkills persists, and the skillGroup filter finally filters on something', async () => {
    await repo.setSkills(ctx as any, TECH, { skillGroups: ['gel', 'nail_art'] } as any);
    expect((await repo.getSkills(ctx as any, TECH))!.skillGroups).toEqual(['gel', 'nail_art']);

    const hit = await repo.query(ctx as any, { skillGroup: 'gel' } as any);
    expect(hit.rows.items.map((x: any) => x.technicianId)).toContain(TECH);
    const miss = await repo.query(ctx as any, { skillGroup: 'acrylic' } as any);
    expect(miss.rows.items.length).toBe(0);
  });

  it('the canProcessPayment FILTER answers from the data instead of ignoring it', async () => {
    // It used to be: r.filter(() => !this.bool(f.canProcessPayment))  // "no schema → none can process payment"
    const yes = await repo.query(ctx as any, { canProcessPayment: 'true' } as any);
    expect(yes.rows.items.map((x: any) => x.technicianId)).toContain(TECH);
    const no = await repo.query(ctx as any, { canProcessPayment: 'false' } as any);
    expect(no.rows.items.length).toBe(0);
  });

  it('App Access and Permissions are ONE thing — they cannot disagree any more', async () => {
    // Turning payment off on the APP ACCESS screen must turn it off on the PERMISSIONS screen. They used to be
    // separate fictions, and their defaults already contradicted each other (canEditNotes:true vs the matrix's false).
    const access = await repo.getAppAccess(ctx as any, TECH);
    expect(access!.canProcessPayment).toBe(true);            // set via setPermissions above
    expect(access!.canViewEarnings).toBe(false);             // revoked via setPermissions above

    await repo.setAppAccess(ctx as any, TECH, { ...access!, canProcessPayment: false, enabled: false } as any);

    const perms = await repo.getPermissions(ctx as any, TECH);
    expect(perms!.matrix.find((m) => m.permission === 'pos.tech.process_payment')!.allowed).toBe(false);
    expect((await repo.getAppAccess(ctx as any, TECH))!.enabled).toBe(false);

    const row = await repo.query(ctx as any, {} as any);
    expect(row.rows.items[0].techAppEnabled).toBe(false);    // was a hardcoded `true` for every tech, forever
    expect(row.rows.items[0].canProcessPayment).toBe(false);
  });
});

describe('the landed row reaches the SESSION', () => {
  it('a granted permission is in the technician’s session — the screen finally means something', async () => {
    await repo.setPermissions(ctx as any, TECH, { matrix: [{ permission: 'pos.tech.process_payment', allowed: true }] } as any);

    const overrides = await auth.techPermissionOverrides(TENANT, TECH_USER);
    const session = effectiveTechPermissions(permissionsFor('TECHNICIAN'), overrides);
    expect(session).toContain('pos.tech.process_payment');
  });

  it('a REVOKED role default is gone from the session', async () => {
    await repo.setPermissions(ctx as any, TECH, { matrix: [{ permission: 'pos.tech.view_earnings', allowed: false }] } as any);

    const overrides = await auth.techPermissionOverrides(TENANT, TECH_USER);
    const session = effectiveTechPermissions(permissionsFor('TECHNICIAN'), overrides);
    expect(session).not.toContain('pos.tech.view_earnings');
    expect(session).toContain('pos.tech.accept_ticket');
  });

  it('A CORRUPT ROW CANNOT ESCALATE. The overlay does not trust its own table.', async () => {
    // However it got there — a future bug, a bad migration, a compromised write — a row naming a permission
    // outside the technician vocabulary is IGNORED, not honoured. This function is the last thing standing
    // between that row and a technician holding platform-admin rights.
    await pg.query(`insert into technician_permissions (tenant_id, branch_id, technician_id, permission_key, allowed)
                    values ($1,$2,$3,'super_admin.all',true)`, [TENANT, BRANCH, TECH]);

    const overrides = await auth.techPermissionOverrides(TENANT, TECH_USER);
    expect(overrides.some((o) => o.permission === 'super_admin.all')).toBe(true);   // the row IS there

    const session = effectiveTechPermissions(permissionsFor('TECHNICIAN'), overrides);
    expect(session).not.toContain('super_admin.all');                                // and it goes NOWHERE
    await pg.query(`delete from technician_permissions where permission_key = 'super_admin.all'`);
  });

  it('another salon’s overrides never reach this salon’s session', async () => {
    // Different tenant, same everything else. The overlay is tenant-scoped through `technicians`.
    const other = await auth.techPermissionOverrides('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TECH_USER);
    expect(other).toEqual([]);
  });
});
