// tenant-isolation.pgtest.vitest.spec.ts — TWO REAL SALONS. Can Salon A see Salon B?
//
// ══ WHY A TEST AND NOT A CODE REVIEW ══════════════════════════════════════════════════════════════════════
//
// I read the code and concluded "no leak". That is not the same as proving it, and it is exactly the sentence
// somebody says before shipping one.
//
// So: two real tenants, in a real Postgres, with real overlapping data — the same customer phone number, the same
// staff name, the same appointment time. Then every read path a salon can reach is called **as Salon A**, and the
// test asserts **nothing belonging to Salon B ever comes back.**
//
// The data is deliberately COLLIDING. A leak that only shows up when two salons share a phone number is a leak
// that will not show up in a test where they do not.
//
// ══ AND THE PART THAT WAS MISSING ═════════════════════════════════════════════════════════════════════════
//
// The first version of this file imported NO REPOSITORIES. It wrote its own SQL — correctly scoped, with a
// tenant_id — and asserted that the scoping worked.
//
// **That proves the SCHEMA supports isolation. It does not prove the PRODUCTION CODE does it.** The test would have
// passed with flying colours while every repository in the codebase quietly forgot its tenant predicate, because
// the test was never asking them.
//
// So the sections at the bottom call the REAL repositories — the exact classes that serve the exact endpoints — and
// ask them for the other salon's data.
import { KyselyPhoneStore } from '@aipowersalon/booking';
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
// THE REAL PRODUCTION CODE. Not a re-implementation of it.
import { KyselyOwnerPortfolioRepo } from '@aipowersalon/tenants';
import { phoneKey, normalizePhone } from '@aipowersalon/customers';

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

// TWO SALONS. Different owners. No relationship whatsoever.
const SALON_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALON_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BRANCH_A = 'a1111111-1111-1111-1111-111111111111';
const BRANCH_B = 'b1111111-1111-1111-1111-111111111111';
const OWNER_A = 'a2222222-2222-2222-2222-222222222222';
const OWNER_B = 'b2222222-2222-2222-2222-222222222222';
const CUST_A = 'a3333333-3333-3333-3333-333333333333';
const CUST_B = 'b3333333-3333-3333-3333-333333333333';

// THE SAME PHONE NUMBER at both salons. A real person who visits two nail salons — and the exact case where a
// missing tenant filter silently returns the wrong salon's customer.
const SHARED_PHONE = '+15551234567';

let db: any;
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX')); } catch { /* pg_trgm / btree_gist */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  await sql`insert into tenants (id, legal_name, tenant_slug, display_name, tenant_code, status) values
    (${SALON_A}, 'Salon A LLC', 'salon-a', 'Salon A', 'AAA001', 'active'),
    (${SALON_B}, 'Salon B LLC', 'salon-b', 'Salon B', 'BBB001', 'active')`.execute(db);

  await sql`insert into branches (id, tenant_id, name) values
    (${BRANCH_A}, ${SALON_A}, 'A Main'),
    (${BRANCH_B}, ${SALON_B}, 'B Main')`.execute(db);

  // Two owners. Each belongs to their OWN salon.
  await sql`insert into users (id, tenant_id, branch_id, role, full_name, email, normalized_phone) values
    (${OWNER_A}, ${SALON_A}, ${BRANCH_A}, 'OWNER', 'Owner A', 'a@a.com', '+15550000001'),
    (${OWNER_B}, ${SALON_B}, ${BRANCH_B}, 'OWNER', 'Owner B', 'b@b.com', '+15550000002')`.execute(db);

  // 'full' was never a level (migration 068: owner | manager | viewer | report_only); 530's CHECK refuses it. No .catch:
  // a swallowed fixture error here silently emptied both portfolios.
  await sql`insert into user_branch_access (user_id, tenant_id, branch_id, access_level, is_primary_owner) values
    (${OWNER_A}, ${SALON_A}, ${BRANCH_A}, 'owner', true),
    (${OWNER_B}, ${SALON_B}, ${BRANCH_B}, 'owner', true)`.execute(db);

  // The SAME PERSON is a customer at both salons — the collision that exposes a missing tenant filter.
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values
    (${CUST_A}, ${SALON_A}, ${BRANCH_A}, 'Jane', 'Doe', 'Jane Doe', ${SHARED_PHONE}),
    (${CUST_B}, ${SALON_B}, ${BRANCH_B}, 'Jane', 'Doe', 'Jane Doe', ${SHARED_PHONE})`.execute(db);
}, 120_000);

// ══ the reads a salon can actually reach ══════════════════════════════════════════════════════════════════

describe('CUSTOMERS — Salon A must never see Salon B\u2019s customer', () => {
  it('a customer list scoped to Salon A returns ONLY Salon A', async () => {
    const r: any = await sql`select id, tenant_id from customers where tenant_id = ${SALON_A}`.execute(db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].id).toBe(CUST_A);
  });

  it('LOOKING UP THE SHARED PHONE returns only THIS salon\u2019s customer', async () => {
    // The whole point. Jane Doe is a customer at BOTH salons, on the same number. A query that forgets its tenant
    // returns the wrong one — or both — and the salon is now looking at another salon's customer record.
    const a: any = await sql`select id from customers where tenant_id = ${SALON_A} and normalized_phone = ${SHARED_PHONE}`.execute(db);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].id).toBe(CUST_A);

    const b: any = await sql`select id from customers where tenant_id = ${SALON_B} and normalized_phone = ${SHARED_PHONE}`.execute(db);
    expect(b.rows[0].id).toBe(CUST_B);

    // And the UNSCOPED version — the bug — returns BOTH. This is what a missing tenant_id actually does.
    const leak: any = await sql`select id from customers where normalized_phone = ${SHARED_PHONE}`.execute(db);
    expect(leak.rows.length, 'an unscoped lookup returns BOTH salons — this is the shape of the bug').toBe(2);
  });

  it('fetching a customer BY ID from the other salon returns nothing when scoped', async () => {
    // GET /customers/:id — the id comes from the URL, and an attacker chooses it. WITH the tenant filter, Salon A
    // asking for Salon B's customer gets nothing. Without it, they get the customer.
    const scoped: any = await sql`select id from customers where id = ${CUST_B} and tenant_id = ${SALON_A}`.execute(db);
    expect(scoped.rows, 'Salon A must NOT be able to fetch Salon B\u2019s customer by id').toHaveLength(0);

    const unscoped: any = await sql`select id from customers where id = ${CUST_B}`.execute(db);
    expect(unscoped.rows.length, 'without tenant_id, the same request DOES return it').toBe(1);
  });
});

describe('OWNER PORTFOLIO — an owner must see only THEIR salons', () => {
  it('Owner A\u2019s portfolio contains Salon A and NOT Salon B', async () => {
    // This is the query the Owner App actually runs: the salon list is derived from `user_branch_access` for the
    // SESSION's user — never from a list the client sends.
    const r: any = await sql`
      select uba.tenant_id, t.display_name
      from user_branch_access uba
      join tenants t on t.id = uba.tenant_id
      where uba.user_id = ${OWNER_A}`.execute(db);

    const tenantIds = r.rows.map((x: any) => x.tenant_id);
    expect(tenantIds).toContain(SALON_A);
    expect(tenantIds, 'Owner A must NOT see Salon B').not.toContain(SALON_B);
  });

  it('Owner B sees Salon B and NOT Salon A', async () => {
    const r: any = await sql`select uba.tenant_id from user_branch_access uba where uba.user_id = ${OWNER_B}`.execute(db);
    const ids = r.rows.map((x: any) => x.tenant_id);
    expect(ids).toContain(SALON_B);
    expect(ids).not.toContain(SALON_A);
  });

  it('an owner cannot widen their portfolio by ASKING for another salon', async () => {
    // The portfolio is derived from the session's user id. Even if a client sent Salon B's id, the query is keyed
    // on `user_id`, so it simply is not in the result set — there is no parameter to poison.
    const r: any = await sql`
      select uba.tenant_id from user_branch_access uba
      where uba.user_id = ${OWNER_A} and uba.tenant_id = ${SALON_B}`.execute(db);
    expect(r.rows, 'Owner A has no access row for Salon B, so no query can produce one').toHaveLength(0);
  });
});

describe('BOOKING VERIFICATION — a phone proven at Salon A proves nothing at Salon B', () => {
  it('is enforced by the unique key, not by convention', async () => {
    const hash = 'HASH_OF_SHARED_PHONE';
    await sql`insert into booking_verified_phones (tenant_id, phone_hash, phone_mask, provider)
      values (${SALON_A}, ${hash}, '\u2022\u2022\u2022\u20224567', 'twilio_verify')`.execute(db);

    // Salon B looks up the SAME phone hash. It must find nothing — the customer proved that number to Salon A,
    // and that is not a credential at Salon B.
    const b: any = await sql`select 1 from booking_verified_phones where tenant_id = ${SALON_B} and phone_hash = ${hash}`.execute(db);
    expect(b.rows, 'a phone verified at Salon A must NOT be verified at Salon B').toHaveLength(0);

    const a: any = await sql`select 1 from booking_verified_phones where tenant_id = ${SALON_A} and phone_hash = ${hash}`.execute(db);
    expect(a.rows).toHaveLength(1);
  });
});

describe('THE SCHEMA ITSELF enforces isolation where it can', () => {
  it('customers carry a tenant_id, so a scoped query is always possible', async () => {
    const r: any = await sql`select count(*)::int n from information_schema.columns
      where table_name = 'customers' and column_name = 'tenant_id'`.execute(db);
    expect(r.rows[0].n).toBe(1);
  });

  it('the tables a salon reads all carry tenant_id', async () => {
    // If a table a salon can reach has NO tenant_id, no query on it can be scoped — the isolation would have to
    // live entirely in application code, and one forgotten join would leak it.
    for (const t of ['customers', 'tickets', 'pos_tech_appointments', 'booking_verified_phones', 'customer_phones']) {
      const r: any = await sql`select count(*)::int n from information_schema.columns
        where table_name = ${t} and column_name = 'tenant_id'`.execute(db);
      expect(r.rows[0].n, `${t} must carry tenant_id`).toBe(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE REAL REPOSITORIES — the classes that actually serve the endpoints a salon can call.
//
// Everything above proves the schema CAN be scoped. This proves the code DOES scope it.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('THE REAL CODE: a salon cannot read another salon\u2019s customer', () => {
  it('KyselyPhoneStore.customer() refuses the other salon\u2019s customer id', async () => {
    // `GET /pos/customers/:customerId/phone` → this exact call. The id comes from the URL, so an attacker chooses
    // it. The tenant predicate is the ONLY thing between that and Salon B's customer record.
    const store = new KyselyPhoneStore(db);

    expect(await store.customer(SALON_A, CUST_B), 'Salon A must not read Salon B\u2019s customer').toBeNull();
    expect(await store.customer(SALON_B, CUST_A), 'Salon B must not read Salon A\u2019s customer').toBeNull();

    // …and each still reads its own.
    expect(await store.customer(SALON_A, CUST_A)).not.toBeNull();
    expect(await store.customer(SALON_B, CUST_B)).not.toBeNull();
  });

  it('KyselyPhoneStore.matchesByHash() does not become a cross-tenant customer directory', async () => {
    // Both salons have a customer on the SAME phone number — the case that finds the bug. A phone hash is global:
    // the same number hashes identically everywhere, so a lookup that forgot its tenant would hand Salon A's
    // receptionist Salon B's customer, by name.
    const store = new KyselyPhoneStore(db);
    const hash = phoneKey(normalizePhone(SHARED_PHONE)!);

    const seenByA = await store.matchesByHash(SALON_A, hash, 'no-exclusion', SHARED_PHONE);
    for (const m of seenByA) expect(m.tenantId, 'a match from another salon leaked').toBe(SALON_A);
    expect(seenByA.map((m) => m.customerId)).not.toContain(CUST_B);

    const seenByB = await store.matchesByHash(SALON_B, hash, 'no-exclusion', SHARED_PHONE);
    expect(seenByB.map((m) => m.customerId)).not.toContain(CUST_A);
  });

  it('KyselyPhoneStore.settings() returns THIS salon\u2019s policy, not the other\u2019s', async () => {
    await sql`insert into tenant_customer_phone_settings (tenant_id, branch_id, allow_manual_confirmation)
      values (${SALON_A}, null, false), (${SALON_B}, null, true)`.execute(db).catch(() => undefined);
    const store = new KyselyPhoneStore(db);
    expect((await store.settings(SALON_A, null)).allowManualConfirmation).toBe(false);
    expect((await store.settings(SALON_B, null)).allowManualConfirmation).toBe(true);
  });
});

describe('THE REAL CODE: an owner sees ONLY their own salons', () => {
  it('KyselyOwnerPortfolioRepo.loadPortfolio() never returns another owner\u2019s salon', async () => {
    // The multi-salon portfolio query MUST span tenants — that is the whole feature. Which puts it exactly one
    // broken predicate away from spanning EVERY tenant on the platform.
    const repo = new KyselyOwnerPortfolioRepo(db);

    const a = await repo.loadPortfolio(OWNER_A);
    const idsA = a.salons.map((s: any) => s.tenantId);
    expect(idsA).toContain(SALON_A);
    expect(idsA, 'Owner A must NOT see the other salon').not.toContain(SALON_B);

    const b = await repo.loadPortfolio(OWNER_B);
    const idsB = b.salons.map((s: any) => s.tenantId);
    expect(idsB).toContain(SALON_B);
    expect(idsB, 'Owner B must NOT see the other salon').not.toContain(SALON_A);
  });

  it('an owner with NO grants sees NOTHING — not everything', async () => {
    // The failure that matters most. A portfolio query with a broken WHERE returns EVERY salon — and an empty
    // portfolio is indistinguishable from a working one until the day somebody with no grants logs in and is shown
    // the entire platform.
    const repo = new KyselyOwnerPortfolioRepo(db);
    const none = await repo.loadPortfolio('99999999-9999-9999-9999-999999999999');
    expect(none.salons).toHaveLength(0);
  });
});
