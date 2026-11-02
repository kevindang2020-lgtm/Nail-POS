// billing-cycle-dryrun.pgtest.vitest.spec.ts — a preview must NEVER write. This runs a dry-run against the real schema,
// proves the plan is computed (counts > 0) yet NOTHING persisted (no invoices, subscriptions untouched), then runs for
// real and confirms the same plan actually lands.
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

const T_ACTIVE = 'd0000000-0000-0000-0000-000000000001';
const T_PENDING = 'd0000000-0000-0000-0000-000000000002';
const NOW = Date.UTC(2026, 5, 1); // 2026-06-01
const PAST = '2026-04-01';        // one cycle behind

let pg: PGlite;
let svc: SuperAdminBillingCycleService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const invCount = () => q(`select count(*)::int as c from billing_invoices`).then((r) => r[0].c);
const subOf = (t: string) => q(`select * from tenant_subscriptions where tenant_id=$1`, [t]).then((r) => r[0]);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new SuperAdminBillingCycleService(db as any);
  const tenant = (id: string, slug: string) => q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,$2,$3,$4,$5)`, [id, 'L ' + slug, 'D ' + slug, slug, slug.toUpperCase()]);
  const sub = (t: string, status: string) => q(`insert into tenant_subscriptions (tenant_id, plan, plan_code, status, current_period_start, current_period_end, monthly_price_cents, billing_interval) values ($1,'premium','premium',$2,'2026-03-01',$3,4900,'monthly')`, [t, status, PAST]);
  await tenant(T_ACTIVE, 'dra'); await tenant(T_PENDING, 'drp');
  await sub(T_ACTIVE, 'active'); await sub(T_PENDING, 'pending_cancellation');
});

describe('runBillingCycle dry-run', () => {
  let dry: any;
  it('previews the plan (counts > 0) but writes NOTHING', async () => {
    dry = await svc.runBillingCycle(NOW, 200, true);
    expect(dry.dryRun).toBe(true);
    expect(dry.errors).toBe(0);
    expect(dry.invoiced).toBeGreaterThanOrEqual(1); // active would be invoiced
    expect(dry.cancelled).toBe(1);                  // pending_cancellation would be cancelled
    // ...yet nothing persisted:
    expect(await invCount()).toBe(0);
    expect(String((await subOf(T_ACTIVE)).status)).toBe('active');
    expect(new Date((await subOf(T_ACTIVE)).current_period_end).toISOString().slice(0, 10)).toBe('2026-04-01'); // untouched
    expect(String((await subOf(T_PENDING)).status)).toBe('pending_cancellation'); // NOT cancelled
  });

  it('a real run then lands the SAME plan the preview reported', async () => {
    const real = await svc.runBillingCycle(NOW);
    expect(real.dryRun).toBe(false);
    expect(real.invoiced).toBe(dry.invoiced);
    expect(real.cancelled).toBe(dry.cancelled);
    expect(await invCount()).toBe(real.invoiced);                       // now written
    expect(String((await subOf(T_PENDING)).status)).toBe('cancelled');  // now cancelled
  });
});
