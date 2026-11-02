// compensation-serving-wire.pgtest.vitest.spec.ts — proves Phase 1b end-to-end against the REAL KyselyServingRepository:
// adding a service line resolves the authored compensation rule and bakes its rate onto ticket_service_lines; when no
// rule applies it falls back to the service default (unchanged branch). Money is integer cents; the baked snapshot is
// what payroll/earnings later read, so this is the money-path proof for the rule→line wiring.
import { describe, it, expect, beforeAll } from 'vitest';
import { PLATFORM_FALLBACK_COMMISSION_PERCENT } from '@aipowersalon/workforce';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyServingRepository } from './serving.kysely.repository';

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

const T = 'ba000000-0000-0000-0000-000000000001';
const T2 = 'ba000000-0000-0000-0000-000000000002';
const B = 'ba000000-0000-0000-0000-0000000000b1';
const C = 'ba000000-0000-0000-0000-0000000000c1';
const U = 'ba000000-0000-0000-0000-0000000000f1';
const TICKET1 = 'ba000000-0000-0000-0000-000000000a01';
const TICKET2 = 'ba000000-0000-0000-0000-000000000a02';
const TECH = 'ba000000-0000-0000-0000-0000000000e1';
const SVC1 = 'ba000000-0000-0000-0000-0000000000d1';
const SVC2 = 'ba000000-0000-0000-0000-0000000000d2';
const P_TENANT = 'ba000000-0000-0000-0000-000000000901';
const T3 = 'ba000000-0000-0000-0000-000000000003';
const TICKET3 = 'ba000000-0000-0000-0000-000000000a03';
const SVC3 = 'ba000000-0000-0000-0000-0000000000d3';
const P_SUPPLY = 'ba000000-0000-0000-0000-000000000903';

let pg: PGlite;
let repo: KyselyServingRepository;
const ctx = (tenantId: string) => ({ tenantId, branchId: B, userId: U, role: 'MANAGER' }) as any;
const line = (serviceId: string): any => ({ serviceLineId: 'x', serviceId, serviceName: 'Gel Manicure', category: 'Nails', priceCents: 10000, technicianId: TECH, status: 'serving', isAddOn: false, estDurationMin: 30 });
const lineRow = (ticketId: string) => pg.query(`select commission_type_snapshot, commission_value_snapshot, supply_method_snapshot, supply_value_snapshot, rule_source from ticket_service_lines where ticket_id=$1`, [ticketId]).then((r: any) => r.rows[0]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyServingRepository(db as any);
  // the salons and one customer each exist (fk_customers_tenant / fk_tickets_customer, Phase 10 migration 538; a
  // ticket's customer belongs to the ticket's salon — the tenant-consistency trigger of 450)
  for (const [t, n] of [[T, 1], [T2, 2], [T3, 3]] as const) await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, $2, $2, $3, $4, 'active') on conflict do nothing`, [t, `Comp ${n}`, `comp-wire-${n}`, `CMPW${n}`]);
  const C2 = 'ba000000-0000-0000-0000-0000000000c2', C3 = 'ba000000-0000-0000-0000-0000000000c3';
  for (const [c, t] of [[C, T], [C2, T2], [C3, T3]]) await pg.query(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1, $2, $3, 'C', 'C', 'C C') on conflict do nothing`, [c, t, B]);
  // two open tickets (one per tenant); serving state so addService's load() accepts them
  await pg.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status, serving_started_at) values ($1,$2,$3,$4,'serving', now())`, [TICKET1, T, B, C]);
  await pg.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status, serving_started_at) values ($1,$2,$3,$4,'serving', now())`, [TICKET2, T2, B, C2]);
  // tenant T authors a salon-default 60% rule; tenant T2 authors nothing
  await pg.query(`insert into compensation_policies (id, tenant_id) values ($1,$2)`, [P_TENANT, T]);
  await pg.query(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, status, effective_start, approved) values ($1,$2,1,'percent',60,'active', now() - interval '5 days', true)`, [P_TENANT, T]);
  // tenant T3 authors a salon-default rule that carries an explicit fixed supply charge (Method C)
  await pg.query(`insert into tickets (id, tenant_id, branch_id, customer_id, status, serving_started_at) values ($1,$2,$3,$4,'serving', now())`, [TICKET3, T3, B, C3]);
  await pg.query(`insert into compensation_policies (id, tenant_id) values ($1,$2)`, [P_SUPPLY, T3]);
  await pg.query(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, supply_method, supply_value, status, effective_start, approved) values ($1,$2,1,'percent',60,'fixed',1000,'active', now() - interval '5 days', true)`, [P_SUPPLY, T3]);
});

describe('serving line creation bakes the resolved commission (§4/§21, Phase 1b)', () => {
  it('bakes the authored rule rate (60%) onto the line for a tenant with a rule', async () => {
    const ok = await repo.addService(ctx(T), TICKET1, line(SVC1));
    expect(ok).toBe(true);
    const row = await lineRow(TICKET1);
    expect(row.commission_type_snapshot).toBe('percent');
    expect(Number(row.commission_value_snapshot)).toBe(60); // the rule, not a service default
    expect(row.supply_method_snapshot).toBe('none'); // Method A default — no deduction
  });

  it('bakes an explicitly-authored fixed supply (Method C) onto the line', async () => {
    const ok = await repo.addService(ctx(T3), TICKET3, line(SVC3));
    expect(ok).toBe(true);
    const row = await lineRow(TICKET3);
    expect(row.supply_method_snapshot).toBe('fixed');
    expect(Number(row.supply_value_snapshot)).toBe(1000);
    expect(Number(row.commission_value_snapshot)).toBe(60);
  });

  // Re-pinned (merge Oct 12 2026 — other chat's Technician Profile phase 2; Payroll mandate §11 precedence rule → service
  // rate → tenant default): a line with no rule and no service rate stamps the TENANT DEFAULT instead of null, so payroll
  // never meets a line with an unknown basis. The value is read from the tenant row, not hardcoded.
  it('falls back (no rule + no service row → tenant default snapshot, never null) for a tenant without rules', async () => {
    const ok = await repo.addService(ctx(T2), TICKET2, line(SVC2));
    expect(ok).toBe(true);
    const row = await lineRow(TICKET2);
    const t = (await pg.query(`select default_commission_percent from tenants where id=$1`, [T2])).rows[0] as any;
    expect(Number(row.commission_value_snapshot)).toBe(t?.default_commission_percent != null ? Number(t.default_commission_percent) : PLATFORM_FALLBACK_COMMISSION_PERCENT);
    expect(row.commission_type_snapshot).toBe('percent');
    expect(row.rule_source).toBeTruthy();   // 587 provenance — never an unlabelled rate
  });
});
