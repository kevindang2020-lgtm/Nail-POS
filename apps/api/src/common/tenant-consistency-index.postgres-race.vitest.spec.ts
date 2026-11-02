// tenant-consistency-index.postgres-race.vitest.spec.ts — Phase 1 (BUILD_PLAN_2026-10-06), migration 517.
//
// The tenant-consistency trigger (migration 450) looked the parent up with `id::text = $1`, which no index can serve:
// every insert into a checked table read its parent table end to end. This counts what the trigger does on a REAL
// Postgres: with sequential scans priced out, the parent lookup must be an index scan, never a scan of `branches`.
// The refusal of a crossed salon (the trigger's purpose) is re-proven on the same path.
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';

const url = process.env.PG_RACE_URL;
const T = 'c0517000-0000-4000-8000-000000000001';
const T2 = 'c0517000-0000-4000-8000-000000000002';
const B = 'c0517000-0000-4000-8000-0000000000b1';
const B2 = 'c0517000-0000-4000-8000-0000000000b2';

describe.skipIf(!url)('tenant-consistency trigger on real Postgres', () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => {
    if (!pool) return;
    await pool.query('delete from customers where tenant_id = any($1::uuid[])', [[T, T2]]).catch(() => undefined);
    await pool.query('delete from branches where id = any($1::uuid[])', [[B, B2]]).catch(() => undefined);
    await pool.query('delete from tenants where id = any($1::uuid[])', [[T, T2]]).catch(() => undefined);
    await pool.end();
  });

  async function stats(c: pg.PoolClient) {
    await c.query('select pg_stat_force_next_flush()');
    await c.query('select pg_stat_clear_snapshot()');
    // seq = whole-table scans; pkey = lookups through the primary key; other = scans of any OTHER branches index (with
    // sequential scans priced out, the old `id::text` lookup read the whole ux_branches_tenant_id index instead).
    const t = await c.query(`select coalesce(seq_scan,0)::int seq from pg_stat_user_tables where relname = 'branches'`);
    const i = await c.query(`select indexrelname, coalesce(idx_scan,0)::int n from pg_stat_user_indexes where relname = 'branches'`);
    const pkey = i.rows.filter((r: any) => r.indexrelname === 'branches_pkey').reduce((a: number, r: any) => a + r.n, 0);
    const other = i.rows.filter((r: any) => r.indexrelname !== 'branches_pkey').reduce((a: number, r: any) => a + r.n, 0);
    return { seq: t.rows[0].seq as number, pkey, other };
  }

  it('checking a customer\'s branch is an INDEX lookup on branches, not a scan of the whole table', async () => {
    const c = await pool.connect();
    try {
      for (const [t, b, slug] of [[T, B, 'c517a'], [T2, B2, 'c517b']]) {
        await c.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values ($1, $2, $2, $2, upper($2), 'active') on conflict (id) do nothing`, [t, slug]);
        await c.query(`insert into branches (id, tenant_id, name) values ($1, $2, $3) on conflict (id) do nothing`, [b, t, slug]);
      }
      await c.query('set enable_seqscan = off');   // a scan of a tiny table is cheap; price it out so only an INDEX-capable query avoids it
      const before = await stats(c);
      for (let i = 0; i < 5; i++) {
        await c.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, 'Index', $3, 'Index ' || $3)`, [T, B, `P${i}`]);
      }
      const after = await stats(c);
      expect(after.seq - before.seq, 'the trigger scanned the whole branches table').toBe(0);
      expect(after.other - before.other, 'the trigger read a whole branches index instead of looking the row up').toBe(0);
      expect(after.pkey - before.pkey).toBeGreaterThanOrEqual(5);
    } finally {
      await c.query('reset enable_seqscan').catch(() => undefined);
      c.release();
    }
  });

  it('a customer naming ANOTHER salon\'s branch is still refused', async () => {
    await expect(pool.query(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, 'Cross', 'Over', 'Cross Over')`, [T, B2]))
      .rejects.toThrow(/cross-tenant reference refused/);
  });
});
