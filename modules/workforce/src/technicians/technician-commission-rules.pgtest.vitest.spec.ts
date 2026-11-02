// technician-commission-rules.pgtest — a technician's commission set on the POS is what PAYROLL pays (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: the owner gave Anna a personal 65 % on the Acrylic Full Set on the POS Technicians screen
// (PATCH /pos/technicians/:id/commission, gated by the Super Admin's one-time Admin Authorization Code). The call
// answered 200 and spent the code — and changed nothing that money reads: `byService` / `byCategory` were dropped, and
// `defaultPercent` went into technicians.default_commission_split_percent, a column the ONE compensation engine never
// reads (precedence: authored rule → service rate → tenant default). Payroll kept paying the service rate.
//
// The POS edit now authors the rule in the one engine — "Technician Default" (rank 4), "Technician + Service" (rank 2),
// "Technician + Category" (rank 3) — active from now, superseding the technician's previous version of the same rule,
// and the read-back is those rules. Asked of the DATABASE through the same resolver checkout stamps lines with.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { TechniciansService } from './technicians.service';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';
import { hashCommissionAuthCode } from './commission-security.service';
import { resolveLineCommissionWithDefault } from '../compensation/compensation-rule-loader';

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

const T = 'e3000000-0000-4000-8000-0000000000a1', B = 'e3000000-0000-4000-8000-0000000000b1', U = 'e3000000-0000-4000-8000-0000000000c1';
const ANNA = 'e3000000-0000-4000-8000-0000000000d1', MARY = 'e3000000-0000-4000-8000-0000000000d2';
const ACR = 'e3000000-0000-4000-8000-0000000000e1', GEL = 'e3000000-0000-4000-8000-0000000000e2';
const owner: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.technicians.commission.edit', 'technicians.view_pay', 'pos.technicians.view'] };
let pg: PGlite; let db: any; let svc: TechniciansService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
let n = 0;
const code = async () => { const c = `PILOT${++n}X`; await q(`insert into admin_commission_auth_codes (tenant_id, code_enc, expires_at) values ($1, $2, now() + interval '1 day')`, [T, hashCommissionAuthCode(c)]); return c; };
const rate = async (technicianId: string, serviceId: string) => resolveLineCommissionWithDefault(db, { tenantId: T, branchId: B, technicianId, serviceId, serviceCategory: 'Nails', asOf: new Date(Date.now() + 1000).toISOString() });

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new TechniciansService(new KyselyTechniciansRepository(db));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Rate LLC','Rate Salon','rate-salon','RATE01')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$3,$4,'Anna','Le','Anna Le','active'), ($2,$3,$4,'Mary','Ng','Mary Ng','active')`, [ANNA, MARY, T, B]);
  const CAT = 'e3000000-0000-4000-8000-0000000000f1';
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, commission_type, commission_value) values ($1,$3,$4,$5,'Acrylic Full Set',75,7000,'active','percent',55), ($2,$3,$4,$5,'Gel Manicure',45,4500,'active','percent',60)`, [ACR, GEL, T, B, CAT]);
}, 240_000);

describe('the POS technician commission edit authors the rule payroll pays', () => {
  it('before: the service rate prices Anna\'s acrylic (55 %)', async () => {
    expect((await rate(ANNA, ACR)).commissionValue).toBe(55);
  });
  it('a personal per-service rate (65 % on the acrylic) is what the engine resolves for Anna — and only for Anna, only that service', async () => {
    await svc.setCommission(owner, ANNA, { byService: [{ serviceId: ACR, percent: 65 }], adminAuthCode: await code() } as any);
    const r = await rate(ANNA, ACR);
    expect(r.commissionValue).toBe(65);
    expect(r.source).toBe('Technician + Service');
    expect((await rate(ANNA, GEL)).commissionValue).toBe(60);    // her other services keep the service rate
    expect((await rate(MARY, ACR)).commissionValue).toBe(55);    // Mary is untouched
    const read = await svc.getCommission(owner, ANNA);
    expect(read.byService).toEqual([{ serviceId: ACR, percent: 65 }]);
  });
  it('a technician default (70 %) prices her other services; the more specific per-service rate still wins on the acrylic', async () => {
    await svc.setCommission(owner, ANNA, { defaultPercent: 70, adminAuthCode: await code() } as any);
    expect((await rate(ANNA, GEL))).toMatchObject({ commissionValue: 70, source: 'Technician Default' });
    expect((await rate(ANNA, ACR)).commissionValue).toBe(65);
    expect((await svc.getCommission(owner, ANNA)).defaultPercent).toBe(70);
  });
  it('changing the rate supersedes the old version (one active rule per scope, the old one closed — history kept)', async () => {
    await svc.setCommission(owner, ANNA, { byService: [{ serviceId: ACR, percent: 62 }], adminAuthCode: await code() } as any);
    expect((await rate(ANNA, ACR)).commissionValue).toBe(62);
    const vers = await q(`select v.status, v.commission_value::int as v from compensation_policy_versions v join compensation_policies p on p.id = v.policy_id where p.tenant_id = $1 and p.technician_id = $2 and p.service_id = $3 order by v.version`, [T, ANNA, ACR]);
    expect(vers.map((x: any) => [x.status, x.v])).toEqual([['replaced', 65], ['active', 62]]);
  });
  it('without the Super Admin code nothing is authored', async () => {
    await expect(svc.setCommission(owner, MARY, { defaultPercent: 90 } as any)).rejects.toThrow(/Authorization Code/);
    expect((await rate(MARY, GEL)).commissionValue).toBe(60);
  });
  it('an out-of-range per-service percent is refused', async () => {
    await expect(svc.setCommission(owner, MARY, { byService: [{ serviceId: GEL, percent: 140 }], adminAuthCode: await code() } as any)).rejects.toThrow(/0.100/);
  });
});
