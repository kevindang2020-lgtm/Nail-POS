// customer-phone.pgtest.vitest.spec.ts — the drivers against a REAL Postgres.
//
// ══ WHY ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// The service's 57 tests all mock the store. So they would pass whether or not:
//
//   • `ON CONFLICT (tenant_id, customer_id) WHERE status = 'pending_verification'` matches the partial index
//     (it must name the index PREDICATE, or Postgres refuses outright — a bug I already shipped once today)
//   • `digest(..., 'sha256')` exists (pgcrypto)
//   • the activation transaction actually retires the old number and promotes the new one
//   • the `record_version` guard actually refuses a stale write
//
// `tsc` sees none of it. `check:sql` sees that the statements PARSE. Only a database can say they WORK.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { KyselyPhoneStore } from './customer-phone.kysely';
import { phoneKey, maskPhone, normalizePhone } from '@aipowersalon/customers';

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
      async *streamQuery() {},
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = '11111111-1111-1111-1111-111111111111';
const T2 = '11111111-1111-1111-1111-111111111112';
const B = '22222222-2222-2222-2222-222222222222';
const C1 = '33333333-3333-3333-3333-333333333331';
const C2 = '33333333-3333-3333-3333-333333333332';
const U = '44444444-4444-4444-4444-444444444444';

let db: any;
let store: KyselyPhoneStore;
let pg: PGlite;

const PHONE = '+15551234567';
const HASH = phoneKey(normalizePhone(PHONE)!);
const MASK = maskPhone(normalizePhone(PHONE)!);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* pg_trgm / btree_gist */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  store = new KyselyPhoneStore(db);

  // both salons exist (a customer belongs to a real tenant — fk_customers_tenant, Phase 10 migration 538)
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Phone A', 'Phone A', 'phone-a-p10', 'PHA10', 'active'), (${T2}, 'Phone B', 'Phone B', 'phone-b-p10', 'PHB10', 'active') on conflict do nothing`.execute(db);
  // Two customers at one tenant, and one at ANOTHER tenant with the SAME number — the isolation case.
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
    (${C1}, ${T}, ${B}, 'Sarah', 'Chen', 'Sarah Chen', '+15559990000'),
    (${C2}, ${T}, ${B}, 'Bob', 'Diaz', 'Bob Diaz', ${PHONE})`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
    (gen_random_uuid(), ${T2}, ${B}, 'Other', 'Customer', 'Other Salon Customer', ${PHONE})`.execute(db);
}, 120_000);

describe('the schema applies', () => {
  it('creates the phone status model, sessions, and the version column', async () => {
    for (const t of ['customer_phones', 'customer_phone_update_sessions', 'tenant_customer_phone_settings']) {
      const r: any = await sql`select count(*)::int n from information_schema.tables where table_name = ${t}`.execute(db);
      expect(r.rows[0].n, t).toBe(1);
    }
    const v: any = await sql`select count(*)::int n from information_schema.columns where table_name='customers' and column_name='record_version'`.execute(db);
    expect(v.rows[0].n).toBe(1);
  });
});

describe('duplicate detection NEVER leaves the tenant', () => {
  it('finds the same-tenant customer on that number', async () => {
    const m = await store.matchesByHash(T, HASH, C1, PHONE);
    expect(m.map((x) => x.customerId)).toContain(C2);
  });

  it('does NOT return the OTHER tenant\u2019s customer with the identical number', async () => {
    // A phone hash is GLOBAL — the same number hashes identically at every salon. A query that forgot its tenant
    // would happily return other salons' customers, and the duplicate warning would become a cross-tenant
    // customer directory.
    const m = await store.matchesByHash(T, HASH, C1, PHONE);
    for (const x of m) expect(x.tenantId).toBe(T);
    expect(m.map((x) => x.fullName)).not.toContain('Other Salon Customer');
  });
});

describe('savePendingPhone — the ON CONFLICT that must match a PARTIAL index', () => {
  it('saves a pending number', async () => {
    // `ON CONFLICT (tenant_id, customer_id) WHERE status = 'pending_verification'` must name the index PREDICATE.
    // Postgres refuses outright otherwise — and I shipped exactly that bug earlier today. tsc says nothing.
    const r = await store.savePendingPhone({
      tenantId: T, branchId: B, customerId: C1,
      normalizedPhone: PHONE, phoneHash: HASH, phoneMask: MASK,
      userId: U, source: 'staff_pos', reason: 'Customer changed number',
    });
    expect(r.id).toBeTruthy();
  });

  it('SAVING TWICE updates rather than creating a second competing pending number', async () => {
    // A receptionist clicking Save twice, or two terminals at once, must not create two pending numbers —
    // whichever code arrived second would silently win.
    const p2 = '+15557778888';
    await store.savePendingPhone({
      tenantId: T, branchId: B, customerId: C1,
      normalizedPhone: p2, phoneHash: phoneKey(p2), phoneMask: maskPhone(p2),
      userId: U, source: 'staff_pos', reason: 'Corrected',
    });
    const r: any = await sql`select count(*)::int n, max(normalized_phone) p from customer_phones
      where tenant_id = ${T} and customer_id = ${C1} and status = 'pending_verification'`.execute(db);
    expect(r.rows[0].n, 'exactly ONE pending number').toBe(1);
    expect(r.rows[0].p).toBe(p2);
  });
});

describe('activate — one transaction, guarded by record_version', () => {
  it('retires the old number and promotes the new one', async () => {
    // First give the customer an ACTIVE number to retire.
    const old: any = await sql`
      insert into customer_phones (tenant_id, branch_id, customer_id, normalized_phone, phone_mask, phone_hash, status)
      values (${T}, ${B}, ${C1}, '+15559990000', '••••0000', ${phoneKey('+15559990000')}, 'active_verified')
      returning id`.execute(db);
    const oldId = old.rows[0].id;

    const pending: any = await sql`select id, normalized_phone from customer_phones
      where tenant_id = ${T} and customer_id = ${C1} and status = 'pending_verification' limit 1`.execute(db);
    const newId = pending.rows[0].id;

    const cust: any = await sql`select record_version from customers where id = ${C1}`.execute(db);
    const version = Number(cust.rows[0].record_version);

    const ok = await store.activate({
      tenantId: T, customerId: C1, newPhoneId: newId, oldPhoneId: oldId,
      normalizedPhone: pending.rows[0].normalized_phone, phoneMask: '••••8888',
      status: 'active_verified', method: 'sms_otp', expectedVersion: version,
    });
    expect(ok).toBe(true);

    // The old number is RETIRED, not deleted — historical appointments and messages keep their original contact
    // reference, and a deleted row makes an audit trail lie by omission.
    const oldRow: any = await sql`select status, replaced_by_phone_id from customer_phones where id = ${oldId}`.execute(db);
    expect(oldRow.rows[0].status).toBe('replaced');
    expect(oldRow.rows[0].replaced_by_phone_id).toBe(newId);

    const newRow: any = await sql`select status, verified_at from customer_phones where id = ${newId}`.execute(db);
    expect(newRow.rows[0].status).toBe('active_verified');
    expect(newRow.rows[0].verified_at).toBeTruthy();

    // And the customer row itself moved.
    const c: any = await sql`select normalized_phone, record_version from customers where id = ${C1}`.execute(db);
    expect(c.rows[0].normalized_phone).toBe(pending.rows[0].normalized_phone);
    expect(Number(c.rows[0].record_version)).toBe(version + 1);
  });

  it('REFUSES a stale write — a newer number is never overwritten by an older screen', async () => {
    // Two receptionists with the profile open both hit Save. Without this the SECOND silently wins, with whatever
    // was on their screen when they opened it — possibly minutes old. Nothing detects it afterwards, and the
    // customer simply stops receiving messages.
    const pending: any = await sql`
      insert into customer_phones (tenant_id, branch_id, customer_id, normalized_phone, phone_mask, phone_hash, status)
      values (${T}, ${B}, ${C2}, '+15551112222', '••••2222', ${phoneKey('+15551112222')}, 'pending_verification')
      returning id`.execute(db);

    const ok = await store.activate({
      tenantId: T, customerId: C2, newPhoneId: pending.rows[0].id, oldPhoneId: null,
      normalizedPhone: '+15551112222', phoneMask: '••••2222',
      status: 'active_verified', method: 'sms_otp',
      expectedVersion: 999,                       // a version nobody has ever had
    });
    expect(ok, 'a stale version must NOT be allowed to write').toBe(false);

    // And nothing changed.
    const c: any = await sql`select normalized_phone from customers where id = ${C2}`.execute(db);
    expect(c.rows[0].normalized_phone).toBe(PHONE);
  });

  it('leaves exactly ONE active number (uq_customer_phones_one_active holds)', async () => {
    const r: any = await sql`select count(*)::int n from customer_phones
      where tenant_id = ${T} and customer_id = ${C1} and status in ('active_verified','active_unverified')`.execute(db);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('tenant isolation on the customer lookup', () => {
  it('a customer id from ANOTHER tenant is not found', async () => {
    // The check that makes a wrong id a "not found" rather than a breach.
    expect(await store.customer(T2, C1)).toBeNull();
    expect(await store.customer(T, C1)).not.toBeNull();
  });
});
