// duplicate-review.postgres-race — Duplicate Review guide §12 / acceptance "concurrent reviewer" on REAL Postgres
// (PGlite is single-session, so a race cannot be judged there). Opt-in: PG_RACE_URL=postgres://… (a migrated database).
// Two reviewers confirm the same previewed merge at the same instant with different request keys: exactly one merge
// happens, the other is refused, the loyalty ledger moves the points once, and the source is archived once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { DuplicateReviewCenter } from './duplicate-review-center';

const url = process.env.PG_RACE_URL;
const P = 'c7619000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), U1 = id(10), U2 = id(11), A = id(101), D = id(102);
const ctx = (u: string) => ({ tenantId: T, branchId: B, userId: u, role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.edit', 'pos.customers.merge'] }) as any;
let db: Kysely<any>; let pool: pg.Pool;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audit = async () => undefined;

describe.skipIf(!url)('Duplicate Review — concurrent confirms on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'Race Salon', 'dr-race', 'DRRACE', 'active') on conflict (id) do nothing`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York') on conflict (id) do nothing`);
    for (const t of ['customer_duplicate_merge_ops', 'customer_duplicate_health_runs']) await q(sql`delete from ${sql.table(t)} where tenant_id = ${T}`);
    await q(sql`alter table customer_duplicate_events disable trigger trg_customer_duplicate_events_append_only`);
    await q(sql`delete from customer_duplicate_events where tenant_id = ${T}`);
    await q(sql`alter table customer_duplicate_events enable trigger trg_customer_duplicate_events_append_only`);
    for (const t of ['customer_duplicate_groups', 'customer_duplicate_scans', 'customer_duplicate_decisions', 'customer_merge_logs', 'loyalty_ledger', 'customer_loyalty_profiles']) await q(sql`delete from ${sql.table(t)} where tenant_id = ${T}`);
    await q(sql`delete from customers where tenant_id = ${T}`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values
      (${A}, ${T}, ${B}, 'Rae', 'Race', 'Rae Race', '+16095550900', 'rae@example.com', 'active'),
      (${D}, ${T}, ${B}, 'Rae', 'Race', 'Rae Race', '+16095550900', 'rae@example.com', 'active')`);
    await q(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, delta, balance_after, entry_type) values (${T}, ${B}, ${D}, 'earn', 70, 'checkout', 70, 70, 70, 'earn')`);
    await q(sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values (${T}, ${B}, ${D}, 70, 70)`);
  });
  afterAll(async () => { await db?.destroy(); });

  it('two reviewers, one merge: the second is refused and nothing is applied twice', async () => {
    const dr = new DuplicateReviewCenter(db as any);
    await dr.scan(ctx(U1));
    const g = (await q(sql`select id from customer_duplicate_groups where tenant_id = ${T}`))[0];
    const p1 = await dr.preview(ctx(U1), g.id, A, { fullContact: false });
    const p2 = await dr.preview(ctx(U2), g.id, A, { fullContact: false });
    expect(p1.previewHash).toBe(p2.previewHash);
    const go = (u: string, p: any) => dr.confirm(ctx(u), g.id, { survivorId: A, previewHash: p.previewHash, idempotencyKey: `race-${u}`, acknowledged: p.acknowledgements.map((a: any) => a.code), confirm: true }, audit)
      .then((r) => r.status, (e) => e.code);
    const results = (await Promise.all([go(U1, p1), go(U2, p2)])).sort();
    expect(results.filter((r) => r === 'completed')).toHaveLength(1);
    expect(results.find((r) => r !== 'completed')).toMatch(/DUPLICATE_ALREADY_MERGED|DUPLICATE_STALE_PREVIEW/);
    expect((await q(sql`select count(*)::int n from customer_merge_logs where tenant_id = ${T}`))[0].n).toBe(1);
    expect((await q(sql`select points_balance from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${A}`))[0].points_balance).toBe(70);
    expect((await q(sql`select count(*)::int n from loyalty_ledger where tenant_id = ${T} and entry_type = 'merge'`))[0].n).toBe(2);   // one out, one in
    expect((await q(sql`select count(*)::int n from customer_duplicate_merge_ops where tenant_id = ${T} and status = 'completed'`))[0].n).toBe(1);
  });

  it('two scans at once produce one set of groups (advisory lock), never duplicates', async () => {
    const dr = new DuplicateReviewCenter(db as any, null, () => Date.now() + 3600_000);
    await Promise.all([dr.scan(ctx(U1)), dr.scan(ctx(U2))]);
    expect((await q(sql`select count(*)::int n from customer_duplicate_groups where tenant_id = ${T}`))[0].n).toBe(1);
  });
});
