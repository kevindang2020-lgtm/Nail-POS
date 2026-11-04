// tenant-indexes.pgtest — BUILD_PLAN Phase 10 (Constitution 1 §36, §57): every one of the 81 tenant tables that had no
// tenant-leading index (measured Oct 8 2026) gets one from migration 537, and a tenant-filtered read actually USES it.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { migratedPglite } from '@aipowersalon/testing';

const FILE = `${MIGRATIONS_DIR}/537_tenant_leading_indexes.sql`;
// table → second column, straight from the migration (the file is the list; this test proves each line works)
const PLANNED: { table: string; index: string; second: string }[] = [...readFileSync(FILE, 'utf8').matchAll(/CREATE INDEX CONCURRENTLY IF NOT EXISTS (idx_(\w+)_tenant_lead) ON (\w+) \(tenant_id, (\w+)/g)]
  .map((m) => ({ index: m[1], table: m[3], second: m[4] }));

// The four daily summary tables were in the 81 too; their tenant-leading index is 540's UNIQUE (tenant_id, branch_id,
// summary_date …) (or its fallback), so 537 does not add a near-duplicate. They are still checked below.
const BY_540 = ['tenant_daily_customer_summary', 'tenant_daily_review_summary', 'tenant_daily_service_summary', 'tenant_daily_technician_summary'];
const ALL_81 = [...PLANNED.map((p) => p.table), ...BY_540];

let pg: any;
beforeAll(async () => { pg = await migratedPglite(); });

describe('537: a tenant-leading index on every tenant table that lacked one', () => {
  it('the migration covers the 81 tables measured without one (77 here + 4 by 540)', () => {
    expect(PLANNED).toHaveLength(77);
    expect(new Set(ALL_81).size).toBe(81);
    for (const t of BY_540) expect(PLANNED.map((p) => p.table)).not.toContain(t);
    for (const p of PLANNED) expect(p.index).toBe(`idx_${p.table}_tenant_lead`);
  });

  it('runs outside a transaction (CONCURRENTLY) — the header the runner reads', () => {
    expect(readFileSync(FILE, 'utf8').split('\n')[0]).toBe('-- migrate: no-transaction');
  });

  it('each index exists on the real schema and starts with tenant_id', async () => {
    const rows = (await pg.query(`SELECT indexname, tablename, indexdef FROM pg_indexes WHERE indexname LIKE '%\\_tenant\\_lead'`)).rows as any[];
    const byName = new Map(rows.map((r) => [r.indexname, r]));
    for (const p of PLANNED) {
      const r = byName.get(p.index);
      expect(r, p.index).toBeTruthy();
      expect(r.tablename).toBe(p.table);
      expect(r.indexdef).toMatch(/\(tenant_id, /);
    }
  });

  it('none of the 81 is left without a tenant-leading index (the measurement query, re-run)', async () => {
    const missing = (await pg.query(`SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = c.table_name AND (i.indexdef ~ '\\((tenant_id)[,)]' OR i.indexdef ~ '\\(tenant_id '))`,
      [ALL_81])).rows;
    expect(missing).toEqual([]);
  });

  it('EXPLAIN: a tenant-filtered read of each table is served by its new index', async () => {
    // Empty tables make a seq scan the cheapest plan, so the planner is told sequential scans cost too much — the
    // question is whether a usable tenant-leading index EXISTS and is picked, not how big today's table is.
    await pg.exec(`SET enable_seqscan = off`);
    const T = 'f1f1f1f1-0000-4000-8000-000000000001';
    const wrong: string[] = [];
    try {
      for (const p of PLANNED) {
        const plan = (await pg.query(`EXPLAIN (FORMAT JSON) SELECT * FROM ${p.table} WHERE tenant_id = '${T}' ORDER BY tenant_id, ${p.second} LIMIT 50`)).rows[0]['QUERY PLAN'];
        const text = JSON.stringify(plan);
        if (text.includes(p.index)) continue;
        // a later migration may add a better tenant-leading index the planner prefers (customer_merge_logs' target index,
        // the deal approvals' time index …) — what matters is that a tenant-leading index serves the read
        const idx = text.match(/"Index Name":"(\w+)"/)?.[1];
        const def = idx ? (await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [idx])).rows[0]?.indexdef : '';
        if (!/\(tenant_id[,)]/.test(def ?? '')) wrong.push(`${p.table}: ${idx ?? 'no index'}`);
      }
      for (const t of BY_540) {
        const text = JSON.stringify((await pg.query(`EXPLAIN (FORMAT JSON) SELECT * FROM ${t} WHERE tenant_id = '${T}' LIMIT 50`)).rows[0]['QUERY PLAN']);
        const idx = text.match(/"Index Name":"(\w+)"/)?.[1];
        const def = idx ? (await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [idx])).rows[0]?.indexdef : '';
        if (!/\(tenant_id[,)]/.test(def ?? '')) wrong.push(`${t}: ${idx ?? 'no index'}`);
      }
    } finally { await pg.exec(`RESET enable_seqscan`); }
    expect(wrong).toEqual([]);
  });

  it('payments.settlement_batch_id has its partial (tenant_id, settlement_batch_id) index', async () => {
    const r = (await pg.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_payments_settlement_batch'`)).rows[0];
    expect(r?.indexdef).toMatch(/\(tenant_id, settlement_batch_id\) WHERE \(settlement_batch_id IS NOT NULL\)/);
  });
});
