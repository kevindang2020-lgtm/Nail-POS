// tech-payroll.pgtest.vitest.spec.ts — the technician payroll roll-up is money the tech is owed, so it has to be exactly
// right against a real schema. This pins the semantics fixed after manual review:
//   • DRAFT periods are excluded — their lines are still editable by the owner (provisional), so a tech must never see
//     draft numbers as owed;
//   • Unpaid = finalized (owed, not yet paid); Paid = paid; Total = paid + unpaid;
//   • periods come back newest-first and tenant-scoped (another tenant's identical line never leaks in).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyTechRepository } from './tech.kysely.repository';

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

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BR = 'a1111111-1111-1111-1111-111111111111';
const TECH = 'a2222222-2222-2222-2222-222222222222';
const P_DRAFT = 'd0000000-0000-0000-0000-000000000001';
const P_FINAL = 'f0000000-0000-0000-0000-000000000002';
const P_PAID = 'e0000000-0000-0000-0000-000000000003';
const P_OTHER = 'c0000000-0000-0000-0000-000000000004';
const ctx: any = { tenantId: T, branchId: BR, userId: 'u1', role: 'TECHNICIAN', permissions: [] };

let pg: PGlite;
let repo: KyselyTechRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* extensions / already-exists */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyTechRepository(db as any);

  const period = (id: string, tenant: string, start: string, end: string, status: string) =>
    q(`insert into payroll_periods (id, tenant_id, branch_id, period_start, period_end, status) values ($1,$2,$3,$4,$5,$6)`, [id, tenant, BR, start, end, status]);
  const line = (period: string, tenant: string, payable: number, tips = 0, services = 0) =>
    q(`insert into payroll_lines (tenant_id, period_id, technician_id, services_count, tips_cents, payable_cents) values ($1,$2,$3,$4,$5,$6)`, [tenant, period, TECH, services, tips, payable]);

  await period(P_DRAFT, T, '2026-06-01', '2026-06-15', 'draft');   // provisional — must be hidden
  await period(P_FINAL, T, '2026-05-16', '2026-05-31', 'draft');     // owed → Unpaid
  await period(P_PAID, T, '2026-05-01', '2026-05-15', 'draft');       // Paid
  await period(P_OTHER, OTHER, '2026-05-01', '2026-05-15', 'draft');  // different tenant — must not leak
  await line(P_DRAFT, T, 99900, 500, 9);
  await line(P_FINAL, T, 12500, 300, 5);
  await line(P_PAID, T, 75000, 800, 30);
  await line(P_OTHER, OTHER, 55500, 100, 2);
  // lines are written while the period is open (610: review/finalized/paid periods lock their lines), then the period closes
  await q(`update payroll_periods set status = 'finalized' where id = $1`, [P_FINAL]);
  await q(`update payroll_periods set status = 'paid' where id in ($1, $2)`, [P_PAID, P_OTHER]);
});

describe('tech myPayroll', () => {
  it('excludes draft periods and rolls up paid/unpaid/total correctly', async () => {
    const v = await repo.myPayroll(ctx, TECH);
    expect(v.paidCents).toBe(75000);       // the paid period only
    expect(v.unpaidCents).toBe(12500);     // the finalized period only — NOT the 99900 draft
    expect(v.totalCents).toBe(87500);
    const ids = v.periods.map((p) => p.periodId);
    expect(ids).not.toContain(P_DRAFT);    // the draft is invisible to the technician
    expect(ids).toEqual([P_FINAL, P_PAID]); // newest-first (finalized period is more recent than paid)
  });

  it('is tenant-scoped — another tenant identical line never leaks in', async () => {
    const v = await repo.myPayroll(ctx, TECH);
    expect(v.periods.map((p) => p.periodId)).not.toContain(P_OTHER);
    expect(v.paidCents).toBe(75000); // not 75000+55500
  });

  it('surfaces the finalized period as unpaid and the paid period as paid', async () => {
    const v = await repo.myPayroll(ctx, TECH);
    const byId = Object.fromEntries(v.periods.map((p) => [p.periodId, p]));
    expect(byId[P_FINAL].status).toBe('finalized');
    expect(byId[P_FINAL].payableCents).toBe(12500);
    expect(byId[P_PAID].status).toBe('paid');
    expect(byId[P_PAID].payableCents).toBe(75000);
  });
});
