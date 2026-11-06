// customer-directory-scale.pgtest.vitest.spec.ts — F1 §58 / §61 / §62 evidence: the directory state at 1,000 and 10,000
// customers (synthetic) — and 100,000 (Nov 5 2026, the SQL path; the previous in-memory path is timed beside it). Runs only with CUSTOMER_SCALE=1 (it takes ~a minute on PGlite); prints latency and payload size.
// It asserts what must hold at any size: one page of rows comes back (never the whole base) and the tab counts add up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import pgDriver from 'pg';

const RUN = process.env.CUSTOMER_SCALE === '1';
const BUSY_URL = process.env.BUSY_PG_URL;
const T = 'f1e5ca1e-0000-4000-8000-000000000001', B = 'f1e5ca1e-0000-4000-8000-000000000002';
const ctx = { tenantId: T, branchId: null, userId: T, role: 'OWNER', permissions: ['pos.customers.view'] } as any;
let pg: any; let repo: KyselyCustomersRepository;

describe.skipIf(!RUN)('F1 Customer Directory at scale (synthetic)', () => {
  beforeAll(async () => {
    pg = await migratedPglite();
    await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Scale LLC','Scale','cust-scale','CSC001','active')`, [T]);
    await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
    repo = new KyselyCustomersRepository(kyselyFor(pg) as never);
  }, 120_000);
  for (const n of [1000, 10000, 100000]) {
    it(`${n} customers: page 1 of 25 returns 25 rows; counts reconcile`, async () => {
      const have = Number((await pg.query(`select count(*)::int n from customers where tenant_id = $1`, [T])).rows[0].n);
      await pg.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, created_at)
        select $1, $2, 'Cust' || g, 'Scale', 'Cust' || g || ' Scale', '+1215' || lpad(g::text, 7, '0'), now() - (g % 400) * interval '1 day' from generate_series($3::int, $4::int) g`, [T, B, have + 1, n]);
      await pg.query(`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
        select c.tenant_id, c.branch_id, c.id, 'closed', 4500, 'S' || row_number() over (), now() - (abs(hashtext(c.id::text)) % 300) * interval '1 day', now() - (abs(hashtext(c.id::text)) % 300) * interval '1 day'
        from customers c where c.tenant_id = $1 and not exists (select 1 from tickets t where t.customer_id = c.id) and abs(hashtext(c.id::text)) % 3 <> 0`, [T]);
      const t0 = performance.now();
      const st = await repo.query(ctx, { page: 1, pageSize: 25 });
      const ms = Math.round(performance.now() - t0);
      const bytes = JSON.stringify(st).length;
      const t1 = performance.now(); await repo.queryInMemory(ctx, { page: 1, pageSize: 25 }); const legacyMs = Math.round(performance.now() - t1);
      console.log(`[scale] ${n} customers: state ${ms} ms (SQL; previous in-memory path ${legacyMs} ms), payload ${(bytes / 1024).toFixed(1)} KB, rows ${st.rows.items.length}`);
      expect(st.rows.items.length).toBe(25);
      expect(st.rows.pagination.totalItems).toBe(n);
      expect(st.segmentCounts!.never + st.segmentCounts!.new + st.segmentCounts!.returning).toBe(n);
      expect(bytes).toBeLessThan(200_000);
    }, 600_000);
  }
});

// §61 / §79 (Nov 6 2026): the busy salon — 100,000 customers across 3 locations, 200 technicians, visits with technician
// service lines, loyalty profiles, duplicate candidates (shared phones), searches and filters a front desk really runs, and
// writes landing while the directory is read. Prints p50 / p95 / slowest per query; asserts correctness at any size.
const B2 = 'f1e5ca1e-0000-4000-8000-000000000003', B3 = 'f1e5ca1e-0000-4000-8000-000000000004', TB = 'f1e5ca1e-0000-4000-8000-0000000000bb';
describe.skipIf(!RUN)('F1 §79 busy salon: 100,000 customers, 200 technicians, 3 locations', () => {
  let pg2: any; let repo2: KyselyCustomersRepository;
  const ctx2 = { tenantId: TB, branchId: null, userId: TB, role: 'OWNER', permissions: ['pos.customers.view'] } as any;
  afterAll(async () => { if (BUSY_URL) await pg2?.end?.(); });
  beforeAll(async () => {
    // BUSY_PG_URL (optional): a throwaway, already-migrated REAL PostgreSQL database (e.g. one cloned with createdb -T)
    // — the same queries timed on a real server instead of PGlite (WASM, one session). Never point it at a database you keep.
    pg2 = BUSY_URL ? new pgDriver.Pool({ connectionString: BUSY_URL, max: 10, options: '-c jit=off' /* as production's poolOptions() */ }) : await migratedPglite();
    await pg2.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Busy LLC','Busy','cust-busy','CSB001','active')`, [TB]);
    await pg2.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$4,'Main','active','America/New_York'), ($2,$4,'North','active','America/New_York'), ($3,$4,'South','active','America/New_York')`, [B, B2, B3, TB]);
    await pg2.query(`insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, status, is_active) select $1, (array[$2,$3,$4]::uuid[])[1 + g % 3], 'Tech', 'No' || g, 'Tech No' || g, 'active', true from generate_series(1, 200) g`, [TB, B, B2, B3]);
    // every 50th pair shares a phone (duplicate candidates); names repeat Vietnamese / English surnames
    await pg2.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, created_at)
      select $1, (array[$2,$3,$4]::uuid[])[1 + g % 3], 'Cust' || g, (array['Nguyễn','Trần','Lê','Smith','Garcia'])[1 + g % 5], 'Cust' || g || ' ' || (array['Nguyễn','Trần','Lê','Smith','Garcia'])[1 + g % 5],
        '+1215' || lpad((case when g % 50 = 0 then g - 1 else g end)::text, 7, '0'), '+1215' || lpad((case when g % 50 = 0 then g - 1 else g end)::text, 7, '0'), now() - (g % 700) * interval '1 day'
      from generate_series(1, 100000) g`, [TB, B, B2, B3]);
    await pg2.query(`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
      select c.tenant_id, c.branch_id, c.id, 'closed', 3000 + abs(hashtext(c.id::text)) % 9000, 'B' || row_number() over (), now() - (abs(hashtext(c.id::text)) % 365) * interval '1 day', now() - (abs(hashtext(c.id::text)) % 365) * interval '1 day'
      from customers c where c.tenant_id = $1 and abs(hashtext(c.id::text)) % 3 <> 0`, [TB]);
    await pg2.query(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, loyalty_tier)
      select tenant_id, branch_id, id, abs(hashtext(id::text)) % 900, abs(hashtext(id::text)) % 900, (array['Regular','Silver','Gold'])[1 + abs(hashtext(id::text)) % 3] from customers where tenant_id = $1 and abs(hashtext(id::text)) % 2 = 0`, [TB]);
    await pg2.query(`analyze`);
    repo2 = new KyselyCustomersRepository(kyselyFor(pg2) as never);
  }, 900_000);

  it('the front desk\'s real queries at 100k: one page each, counts reconcile, p95 printed; writes during reads lose nothing', async () => {
    const runs: [string, any][] = [
      ['first page', { page: 1, pageSize: 25 }], ['page 40', { page: 40, pageSize: 25 }], ['phone search', { search: '215-000-4321' }],
      ['Vietnamese surname', { search: 'nguyễn' }], ['accent-free surname', { search: 'tran' }], ['returning tab', { segment: 'returning' }],
      ['at-risk tab', { segment: 'at_risk' }], ['Gold tier', { loyaltyTier: 'Gold' }], ['duplicate risk', { duplicateRisk: 'high' }],
      ['tab + search', { segment: 'returning', search: 'smith' }],
    ];
    const lat: Record<string, number[]> = {};
    for (let round = 0; round < 3; round++) for (const [name, f] of runs) {
      const t0 = performance.now(); const st = await repo2.query(ctx2, { pageSize: 25, ...f }); (lat[name] ??= []).push(performance.now() - t0);
      expect(st.rows.items.length).toBeLessThanOrEqual(25);
      if (name === 'first page') expect(st.rows.pagination.totalItems).toBe(100000);
      if (name === 'Vietnamese surname' || name === 'accent-free surname') expect(st.rows.pagination.totalItems).toBe(20000);
      expect(JSON.stringify(st).length).toBeLessThan(200_000);
    }
    const all = Object.values(lat).flat().sort((a, b) => a - b);
    const p = (q: number) => Math.round(all[Math.min(all.length - 1, Math.floor(q * all.length))]);
    for (const [k, v] of Object.entries(lat)) console.log(`[busy] ${k}: ${v.map((x) => Math.round(x)).join(' / ')} ms`);
    console.log(`[busy] all queries: p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, slowest ${Math.round(all[all.length - 1])} ms (${BUSY_URL ? 'real PostgreSQL 16' : 'PGlite, single process'})`);
    // writes during reads: 50 new customers land while the directory is read; nothing is lost and the total moves by 50
    await Promise.all([
      ...Array.from({ length: 50 }, (_, i) => pg2.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'Busy',$3,'Busy ' || $3)`, [TB, B2, `W${i}`])),
      repo2.query(ctx2, { page: 3, pageSize: 25 }),
    ]);
    expect((await repo2.query(ctx2, { page: 1, pageSize: 25 })).rows.pagination.totalItems).toBe(100050);
  }, 900_000);
});
