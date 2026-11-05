// customer-directory-scale.pgtest.vitest.spec.ts — F1 §58 / §61 / §62 evidence: the directory state at 1,000 and 10,000
// customers (synthetic). Runs only with CUSTOMER_SCALE=1 (it takes ~a minute on PGlite); prints latency and payload size.
// It asserts what must hold at any size: one page of rows comes back (never the whole base) and the tab counts add up.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const RUN = process.env.CUSTOMER_SCALE === '1';
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
  for (const n of [1000, 10000]) {
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
      console.log(`[scale] ${n} customers: state ${ms} ms, payload ${(bytes / 1024).toFixed(1)} KB, rows ${st.rows.items.length}`);
      expect(st.rows.items.length).toBe(25);
      expect(st.rows.pagination.totalItems).toBe(n);
      expect(st.segmentCounts!.never + st.segmentCounts!.new + st.segmentCounts!.returning).toBe(n);
      expect(bytes).toBeLessThan(200_000);
    }, 600_000);
  }
});
