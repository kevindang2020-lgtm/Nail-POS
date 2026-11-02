// customer-reconciliation.pgtest.vitest.spec.ts — the 7 PM engine against the REAL schema (Jul 26, 2026).
// Proves in Postgres: a run links every unlinked customer across tenants into ONE identity per person, writes an
// honest run row + per-tenant stats, and the SECOND run is incremental (scans nothing). Also proves the imported
// (unlinked) rows the POS import leaves behind get picked up by exactly this pass.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService } from './customer-reconciliation.service';

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

const TA = 'cb000000-0000-0000-0000-000000000001';
const TB = 'cb000000-0000-0000-0000-000000000002';
const BR = 'cb000000-0000-0000-0000-0000000000b1';
let pg: PGlite;
let recon: CustomerReconciliationService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
let seq = 0;
async function seed(tenantId: string, first: string, phone: string | null, email: string | null = null): Promise<string> {
  const id = `cb000000-0000-0000-0000-0000000000${(++seq + 32).toString(16).padStart(2, '0')}`;
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, email)
           values ($1,$2,$3,$4,'Guest',$5,$6,$7)`, [id, tenantId, BR, first, `${first} Guest`, phone, email]);
  return id;
}

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const repo = new KyselyCustomerIdentityRepository(db as any);
  recon = new CustomerReconciliationService(repo, new CustomerIdentityService(repo));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','cbA','CBA'),($2,'B','Salon B','cbB','CBB')`, [TA, TB]);
});

describe('7 PM reconciliation on the real schema', () => {
  it('links unlinked customers across both salons: one person = ONE global identity, two links, honest run row', async () => {
    await seed(TA, 'Kevin', '(856) 555-1234');          // same person…
    await seed(TB, 'Kevin', '+1 856 555 1234');         // …at the other salon, different format
    await seed(TA, 'Dana', '+18565559999');             // a second person, one salon only
    const r = await recon.runReconciliation('scheduled');
    expect(r.ran).toBe(true);
    expect(r.status).toBe('COMPLETED');
    expect(r.customersScanned).toBe(3);
    expect(r.newGlobals).toBe(2);                       // Kevin + Dana
    expect(r.linkedExisting).toBe(1);                   // Kevin's second salon linked, NOT duplicated

    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(2);
    expect(Number((await q(`select count(*)::int c from customer_global_links`))[0].c)).toBe(3);
    const kevinLinks = await q(`select global_customer_id from customer_global_links l
      join customers c on c.id = l.customer_id where c.first_name = 'Kevin'`);
    expect(new Set(kevinLinks.map((x: any) => String(x.global_customer_id))).size).toBe(1);

    const run = (await q(`select status, tenants_scanned, customers_scanned, new_globals, linked_existing, errors, finished_at from customer_recon_runs order by started_at desc limit 1`))[0];
    expect(run.status).toBe('COMPLETED');
    expect(Number(run.tenants_scanned)).toBe(2);
    expect(Number(run.new_globals)).toBe(2);
    expect(Number(run.errors)).toBe(0);
    expect(run.finished_at).not.toBeNull();
    const stats = await q(`select tenant_id, status, customers_scanned from customer_recon_tenant_stats`);
    expect(stats.length).toBe(2);
    expect(stats.every((s: any) => s.status === 'ok')).toBe(true);
  });

  it('the second run is INCREMENTAL: everything is linked, nothing is rescanned (§29 — no nightly full scan)', async () => {
    const r = await recon.runReconciliation('scheduled');
    expect(r.status).toBe('COMPLETED');
    expect(r.customersScanned).toBe(0);
    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(2);   // nothing duplicated
  });

  it('a newly imported (unlinked) customer is picked up by the next pass — the import safety net', async () => {
    await seed(TB, 'Imported', '+18565550777');
    const r = await recon.runReconciliation('manual');
    expect(r.customersScanned).toBe(1);
    expect(r.newGlobals).toBe(1);
    expect(Number((await q(`select count(*)::int c from customer_global_links`))[0].c)).toBe(4);
  });
});
