// application-status-check.pgtest.vitest.spec.ts — every application lifecycle status is storable (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: the Super Admin's "Under Review" button answered 404 "Application not found", and
// "Start Onboarding" created the onboarding case but left the application `approved` and unlinked. Migration 060's
// CHECK only allowed the eight legacy statuses; the intake lifecycle (applications-lifecycle-core, Jul 2026) moves
// through sixteen. The UPDATE failed on the CHECK and the repository's `.catch(() => undefined)` turned the constraint
// violation into "not found". This suite runs on the REAL migrations: every status in APPLICATION_STATUSES must be
// writable, and a genuine database failure must surface instead of reading as a missing row.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';
import { APPLICATION_STATUSES } from './applications-lifecycle-core';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

let pg: PGlite;
let repo: KyselySuperAdminPlatformRepo;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselySuperAdminPlatformRepo(db as any);
}, 240_000);

describe('tenant_applications.status accepts the whole intake lifecycle', () => {
  it.each(APPLICATION_STATUSES.map((s) => [s]))('status "%s" is storable through updateApplication', async (status) => {
    const id = (await q(`insert into tenant_applications (owner_name, salon_name, email, phone) values ('Grace Pilot', 'Pilot Nails', 'g@pilot.test', '6095550100') returning id`))[0].id;
    const r = await repo.updateApplication(id, { status });
    expect(r?.status).toBe(status);
    expect((await q(`select status from tenant_applications where id = $1`, [id]))[0].status).toBe(status);
  });

  it('a status outside the lifecycle is still refused by the database — and the refusal is not reported as "not found"', async () => {
    const id = (await q(`insert into tenant_applications (owner_name, salon_name, email, phone) values ('Grace Pilot', 'Pilot Nails', 'g2@pilot.test', '6095550101') returning id`))[0].id;
    await expect(repo.updateApplication(id, { status: 'made_up_status' })).rejects.toThrow();
    expect(await repo.updateApplication('00000000-0000-0000-0000-0000000000aa', { status: 'new' })).toBeNull();   // a missing row is still null
  });
});
