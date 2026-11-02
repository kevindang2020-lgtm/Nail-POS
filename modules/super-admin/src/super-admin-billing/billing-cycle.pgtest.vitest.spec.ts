// billing-cycle.pgtest.vitest.spec.ts — the period-end invoice generator writes MONEY (invoices) and changes
// subscription lifecycle, so it is pinned against the real migrated schema on PGlite. Covers every policy branch plus
// the idempotency guard (a second pass must not double-bill).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { SuperAdminBillingCycleService } from './billing-cycle.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

// tenant ids per scenario
const T_ACTIVE = 'a0000000-0000-0000-0000-000000000001';
const T_TRIAL  = 'a0000000-0000-0000-0000-000000000002';
const T_PENDING = 'a0000000-0000-0000-0000-000000000003';
const T_PASTDUE = 'a0000000-0000-0000-0000-000000000004';
const T_PAUSED = 'a0000000-0000-0000-0000-000000000005';
const T_FUTURE = 'a0000000-0000-0000-0000-000000000006';
const T_ANNUAL = 'a0000000-0000-0000-0000-000000000007';

const NOW = Date.UTC(2026, 5, 1); // 2026-06-01
const PAST = '2026-01-01';        // a period end in the past → due
const FUTURE = '2026-12-01';      // not due yet

let pg: PGlite;
let svc: SuperAdminBillingCycleService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* extensions / already-exists tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new SuperAdminBillingCycleService(db as any);

  const tenant = (id: string, slug: string) =>
    q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,$2,$3,$4,$5)`,
      [id, 'Legal ' + slug, 'Display ' + slug, slug, slug.toUpperCase()]);
  const sub = (tenant: string, status: string, periodEnd: string, opts: { interval?: string; price?: number; planCode?: string; cancelAt?: string | null } = {}) =>
    q(`insert into tenant_subscriptions (tenant_id, plan, plan_code, status, current_period_start, current_period_end, monthly_price_cents, billing_interval, cancel_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenant, 'premium', opts.planCode ?? 'premium', status, '2025-12-01', periodEnd, opts.price ?? 4900, opts.interval ?? 'monthly', opts.cancelAt ?? null]);

  for (const [id, slug] of [[T_ACTIVE,'act'],[T_TRIAL,'tri'],[T_PENDING,'pend'],[T_PASTDUE,'past'],[T_PAUSED,'paus'],[T_FUTURE,'futu'],[T_ANNUAL,'ann']] as const) await tenant(id, slug);
  await sub(T_ACTIVE, 'active', PAST);
  await sub(T_TRIAL, 'trialing', PAST);
  await sub(T_PENDING, 'pending_cancellation', PAST);
  await sub(T_PASTDUE, 'past_due', PAST);
  await sub(T_PAUSED, 'paused', PAST);
  await sub(T_FUTURE, 'active', FUTURE);
  await sub(T_ANNUAL, 'active', PAST, { interval: 'annual', planCode: 'test_annual' });
  // annual plan price in the catalog (so annual charges the plan's annual price, not monthly×12)
  await q(`insert into subscription_plans (code, name, monthly_price_cents, annual_price_cents, billing_interval) values ($1,$2,$3,$4,$5)`,
    ['test_annual', 'Test Annual', 4900, 49000, 'annual']).catch(() => {});
});

const invoices = (tenant: string) => q(`select * from billing_invoices where tenant_id=$1 order by period_start`, [tenant]);
const subOf = (tenant: string) => q(`select * from tenant_subscriptions where tenant_id=$1`, [tenant]).then((r) => r[0]);
const dstr = (v: any) => new Date(v).toISOString().slice(0, 10); // PGlite returns DATE columns as JS Date

describe('runBillingCycle — policy applied to the real schema', () => {
  let result: any;
  beforeAll(async () => { result = await svc.runBillingCycle(NOW); });

  it('reports the due count and no errors', () => {
    expect(result.errors).toBe(0);
    expect(result.due).toBe(4); // active, trialing, pending_cancellation, annual (past_due/paused/future filtered out by the query)
  });

  it('active → CATCHES UP: bills every missed cycle in one pass, contiguous, advances to current', async () => {
    const inv = await invoices(T_ACTIVE); // period_end 2026-01-01, now 2026-06-01 → 6 monthly cycles at once
    expect(inv).toHaveLength(6);
    expect(inv.every((i: any) => i.status === 'open' && Number(i.amount_due_cents) === 4900)).toBe(true);
    expect(inv.map((i: any) => dstr(i.period_start))).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    for (let k = 1; k < inv.length; k++) expect(dstr(inv[k].period_start)).toBe(dstr(inv[k - 1].period_end)); // contiguous
    const s = await subOf(T_ACTIVE);
    expect(String(s.status)).toBe('active');
    expect(dstr(s.current_period_end)).toBe('2026-07-01');   // fully caught up (> now)
    expect(dstr(s.current_period_start)).toBe('2026-06-01');
  });

  it('trialing → catches up all missed cycles AND converts the subscription to active', async () => {
    const inv = await invoices(T_TRIAL);
    expect(inv).toHaveLength(6);
    expect(inv.every((i: any) => Number(i.amount_due_cents) === 4900)).toBe(true);
    expect(String((await subOf(T_TRIAL)).status)).toBe('active');
  });

  it('pending_cancellation → cancels, writes NO invoice', async () => {
    expect(await invoices(T_PENDING)).toHaveLength(0);
    const s = await subOf(T_PENDING);
    expect(String(s.status)).toBe('cancelled');
    expect(s.cancelled_at).toBeTruthy();
  });

  it('past_due → skipped: no invoice, still past_due (dunning owns it)', async () => {
    expect(await invoices(T_PASTDUE)).toHaveLength(0);
    expect(String((await subOf(T_PASTDUE)).status)).toBe('past_due');
  });

  it('paused → skipped: no invoice, still paused', async () => {
    expect(await invoices(T_PAUSED)).toHaveLength(0);
    expect(String((await subOf(T_PAUSED)).status)).toBe('paused');
  });

  it('not-yet-due active → untouched', async () => {
    expect(await invoices(T_FUTURE)).toHaveLength(0);
    expect(dstr((await subOf(T_FUTURE)).current_period_end)).toBe('2026-12-01');
  });

  it('annual → charges the plan annual price, advances one year', async () => {
    const inv = await invoices(T_ANNUAL);
    expect(inv).toHaveLength(1);
    expect(Number(inv[0].amount_due_cents)).toBe(49000);
    expect(dstr((await subOf(T_ANNUAL)).current_period_end)).toBe('2027-01-01');
  });

  it('IDEMPOTENT — after full catch-up, re-running writes nothing new and never double-bills a period', async () => {
    // The first pass already caught T_ACTIVE up to 2026-07-01 (> now), so it is no longer due.
    const before = (await invoices(T_ACTIVE)).length; // 6
    await svc.runBillingCycle(NOW);
    await svc.runBillingCycle(NOW);
    const inv = await invoices(T_ACTIVE);
    expect(inv).toHaveLength(before); // unchanged — no cycle billed twice
    const periods = inv.map((i: any) => dstr(i.period_start));
    expect(new Set(periods).size).toBe(periods.length); // all distinct
  });
});
