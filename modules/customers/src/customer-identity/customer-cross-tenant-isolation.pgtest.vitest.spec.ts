// customer-cross-tenant-isolation.pgtest.vitest.spec.ts — §16 on the REAL schema (Jul 26, 2026).
//
// The claim under test is Kevin's central rule, stated negatively: sharing ONE global identity across salons must
// give Salon B no reach whatsoever into Salon A's private customer data. This tests the DATA LAYER the way an
// attacker would reach it — tenant-scoped reads for B, with A's rows sitting right there in the same tables.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';

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

const TA = 'cc000000-0000-0000-0000-00000000000a';
const TB = 'cc000000-0000-0000-0000-00000000000b';
const BA = 'cc000000-0000-0000-0000-0000000000a1';
const BB = 'cc000000-0000-0000-0000-0000000000b1';
const CA = 'cc000000-0000-0000-0000-0000000000c1';   // the person, as Salon A knows them
const CB = 'cc000000-0000-0000-0000-0000000000c2';   // the same person, as Salon B knows them
const PHONE = '+18565551234';

let pg: PGlite;
let globalId: string;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

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
  const identity = new CustomerIdentityService(repo);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','ccA','CCA'),($2,'B','Salon B','ccB','CCB')`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'A Main'),($3,$4,'B Main')`, [BA, TA, BB, TB]);

  // Salon A knows this person well: private notes, a preferred tech, marketing consent.
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, email, notes, marketing_sms_opt_in)
           values ($1,$2,$3,'Kevin','Guest','Kevin Guest','(856) 555-1234',$4,'kevin@example.com','VIP — allergic to acetone, always books Tina', true)`, [CA, TA, BA, PHONE]);
  // Salon B has just met them: a phone number and nothing else.
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone)
           values ($1,$2,$3,'Kevin','Guest','Kevin Guest','+1 856 555 1234',$4)`, [CB, TB, BB, PHONE]);

  const verified = new Date().toISOString();
  const a = await identity.ensureLinked({ tenantId: TA, customerId: CA, fullName: 'Kevin Guest', phoneRaw: '(856) 555-1234', email: 'kevin@example.com', phoneVerifiedAt: verified }, 'realtime');
  const b = await identity.ensureLinked({ tenantId: TB, customerId: CB, fullName: 'Kevin Guest', phoneRaw: '+1 856 555 1234', phoneVerifiedAt: verified }, 'realtime');
  expect(a.outcome).toBe('linked');
  expect(b.outcome).toBe('linked');
  globalId = (a as any).globalCustomerId;
  expect((b as any).globalCustomerId).toBe(globalId);            // ONE identity, two salons
});

describe('§16 a shared global identity leaks nothing between salons', () => {
  it('one identity, two tenant relationships', async () => {
    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(1);
    const links = await q(`select tenant_id from customer_global_links where global_customer_id = $1`, [globalId]);
    expect(links.length).toBe(2);
  });

  it('Salon B\u2019s tenant-scoped customer read cannot see Salon A\u2019s notes, email, or consent', async () => {
    // Exactly the shape every tenant-facing repository uses: WHERE tenant_id = <B>.
    const rowsB = await q(`select id, notes, email, marketing_sms_opt_in from customers where tenant_id = $1`, [TB]);
    expect(rowsB.length).toBe(1);
    expect(String(rowsB[0].id)).toBe(CB);
    expect(rowsB[0].notes).toBeNull();
    expect(rowsB[0].email).toBeNull();
    expect(rowsB[0].marketing_sms_opt_in).toBe(false);
    expect(JSON.stringify(rowsB)).not.toContain('acetone');       // A's private note is nowhere in B's world
  });

  it('even joining THROUGH the shared identity, a tenant-scoped query returns only that tenant\u2019s row', async () => {
    // The realistic attack shape: B follows the global link and tries to read everything attached to it, while
    // still being subject to the tenant filter every repository applies.
    const viaGlobal = await q(`
      select c.id, c.tenant_id, c.notes
      from customer_global_links l
      join customers c on c.id = l.customer_id
      where l.global_customer_id = $1 and c.tenant_id = $2`, [globalId, TB]);
    expect(viaGlobal.length).toBe(1);
    expect(String(viaGlobal[0].tenant_id)).toBe(TB);
    expect(viaGlobal[0].notes).toBeNull();
  });

  it('the identity row itself carries only GLOBAL fields — no tenant-owned column exists to leak', async () => {
    const cols = (await q(`select column_name from information_schema.columns where table_name = 'global_customers'`))
      .map((r: any) => String(r.column_name));
    for (const forbidden of ['notes', 'loyalty_points', 'membership_id', 'preferred_technician_id', 'marketing_sms_opt_in', 'tenant_id']) {
      expect(cols).not.toContain(forbidden);
    }
    expect(cols).toContain('normalized_phone');                   // identity fields ARE here
    expect(cols).toContain('email');
  });

  it('A\u2019s row is untouched by B\u2019s linking — the identity layer never wrote tenant data', async () => {
    const a = (await q(`select notes, email, marketing_sms_opt_in from customers where id = $1`, [CA]))[0];
    expect(a.notes).toContain('acetone');
    expect(a.email).toBe('kevin@example.com');
    expect(a.marketing_sms_opt_in).toBe(true);
  });
});
