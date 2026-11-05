// customer-identity.pgtest.vitest.spec.ts — the real-time link path on the REAL schema (Jul 26, 2026).
// Proves Kevin's core rules in Postgres: CASE B creates ONE global identity; CASE A links the second salon to the
// SAME identity (two links, one global — and the tenants' own customer rows untouched); the §8 verified-unique
// race collapses into a link; ambiguous identities go to review, never a silent merge; ensureLinked is idempotent.
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

const TA = 'ca000000-0000-0000-0000-000000000001';
const TB = 'ca000000-0000-0000-0000-000000000002';
const BR = 'ca000000-0000-0000-0000-0000000000b1';
let pg: PGlite;
let repo: KyselyCustomerIdentityRepository;
let svc: CustomerIdentityService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
let custSeq = 0;
async function seedCustomer(tenantId: string, name: string, phone: string | null, email: string | null): Promise<string> {
  const id = `ca000000-0000-0000-0000-0000000000${(++custSeq + 16).toString(16).padStart(2, '0')}`;
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, email)
           values ($1,$2,$3,$4,'Guest',$5,$6,$7)`, [id, tenantId, BR, name, `${name} Guest`, phone, email]);
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
  repo = new KyselyCustomerIdentityRepository(db as any);
  svc = new CustomerIdentityService(repo);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','Salon A','caA','CAA'),($2,'B','Salon B','caB','CAB')`, [TA, TB]);
});

describe('global identity on the real schema', () => {
  it('CASE B then CASE A: two salons, formats "(856) 555-1234" and "+1 856 555 1234" → ONE global, TWO links, tenant rows untouched', async () => {
    const cA = await seedCustomer(TA, 'Kevin', '(856) 555-1234', 'Kevin@Example.com');
    const r1 = await svc.ensureLinked({ tenantId: TA, customerId: cA, firstName: 'Kevin', fullName: 'Kevin Guest', phoneRaw: '(856) 555-1234', email: 'Kevin@Example.com', phoneVerifiedAt: new Date().toISOString() });
    expect(r1.outcome).toBe('linked');
    expect((r1 as any).createdGlobal).toBe(true);

    const cB = await seedCustomer(TB, 'Kevin', '+1 856 555 1234', null);
    const r2 = await svc.ensureLinked({ tenantId: TB, customerId: cB, firstName: 'Kevin', fullName: 'Kevin Guest', phoneRaw: '+1 856 555 1234', phoneVerifiedAt: new Date().toISOString() });
    expect(r2.outcome).toBe('linked');
    expect((r2 as any).createdGlobal).toBe(false);
    expect((r2 as any).globalCustomerId).toBe((r1 as any).globalCustomerId);

    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(1);
    const links = await q(`select tenant_id, customer_id, global_customer_id from customer_global_links order by created_at`);
    expect(links.length).toBe(2);
    expect(new Set(links.map((l: any) => String(l.tenant_id))).size).toBe(2);
    expect(new Set(links.map((l: any) => String(l.global_customer_id))).size).toBe(1);
    // Kevin's rule, structurally: Salon B's customer row got NOTHING copied from Salon A.
    const rowB = (await q(`select notes, email from customers where id=$1`, [cB]))[0];
    expect(rowB.notes).toBeNull();
    expect(rowB.email).toBeNull();
    // idempotent retry
    const r3 = await svc.ensureLinked({ tenantId: TB, customerId: cB, phoneRaw: '+1 856 555 1234' });
    expect(r3.outcome).toBe('already_linked');
  });

  it('§8 race: a second create with the same VERIFIED phone collapses into a link at the DB unique index', async () => {
    const dup = await repo.createGlobal({ firstName: 'K', lastName: 'G', fullName: 'K G', phone: '+18565551234', phoneDisplay: '+18565551234', phoneVerifiedAt: new Date().toISOString(), email: null, emailVerifiedAt: null });
    expect(dup.created).toBe(false);                              // unique violation → winner returned, no duplicate
    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(1);
  });

  it('CASE C: phone matches identity X while email matches identity Y → review, nothing linked or merged', async () => {
    await q(`insert into global_customers (full_name, email, email_verified_at) values ('Other Person','someone@else.com', now())`);
    const cX = await seedCustomer(TA, 'Mixed', '(856) 555-1234', 'someone@else.com');
    const r = await svc.ensureLinked({ tenantId: TA, customerId: cX, fullName: 'Mixed Guest', phoneRaw: '(856) 555-1234', email: 'someone@else.com' });
    expect(r.outcome).toBe('review');
    expect((r as any).reason).toBe('PHONE_AND_EMAIL_MATCH_DIFFERENT_CUSTOMERS');
    expect(Number((await q(`select count(*)::int c from customer_global_links where customer_id=$1`, [cX]))[0].c)).toBe(0);
    expect(Number((await q(`select count(*)::int c from global_customers`))[0].c)).toBe(2);
  });
});
