// payroll-period-overlap.pgtest — deep-scan (Oct 22 2026), on the REAL schema (PGlite, all migrations): a pay period whose
// dates overlap another period of the same scope is refused (409 PAYROLL_PERIOD_OVERLAP). The line builder pays EVERY sale
// inside a period's window, so before this a second period over the same days paid the same tickets again.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { PayrollService } from './payroll.service';
import { periodsOverlap } from './payroll-workflow';

const P = 'c0ae0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BA2 = id('b2'), BB = id('b3'), OWNER = id('ee1');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = (tenantId = TA, branchId: string | null = BA) => ({ tenantId, branchId, userId: OWNER, role: 'OWNER', permissions: ['pos.payroll.manage', 'pos.payroll.view'] } as any);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, c] of [[TA, 'OVLA01'], [TB, 'OVLB01']]) await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,lower($2),$2,'active')`, [t, c]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$2,'Second','active'), ($4,$5,'Other salon','active')`, [BA, TA, BA2, BB, TB]);
}, 180_000);

describe('pay periods never overlap within one scope', () => {
  it('periodsOverlap: inclusive days; a salon-wide period overlaps every branch; two branches may share days', () => {
    const w = (s: string, e: string, b: string | null = 'b') => ({ periodStart: s, periodEnd: e, branchId: b });
    expect(periodsOverlap(w('2026-10-19', '2026-10-25'), w('2026-10-25', '2026-10-31'))).toBe(true);    // shares the 25th
    expect(periodsOverlap(w('2026-10-19', '2026-10-25'), w('2026-10-26', '2026-11-01'))).toBe(false);
    expect(periodsOverlap(w('2026-10-19', '2026-10-25', null), w('2026-10-20', '2026-10-21', 'x'))).toBe(true);
    expect(periodsOverlap(w('2026-10-19', '2026-10-25', 'x'), w('2026-10-20', '2026-10-21', 'y'))).toBe(false);
  });
  it('a second period over the same days is refused (409 PAYROLL_PERIOD_OVERLAP, naming the first); the next week is fine', async () => {
    const svc = new PayrollService(new KyselyPayrollRepository(db));
    const first = await svc.createPeriod(ctx(), { label: 'Week 43', periodStart: '2026-10-19', periodEnd: '2026-10-25' });
    await expect(svc.createPeriod(ctx(), { periodStart: '2026-10-21', periodEnd: '2026-10-27' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_OVERLAP', status: 409, details: { periodId: first.id } });
    await expect(svc.createPeriod(ctx(TA, null), { periodStart: '2026-10-25', periodEnd: '2026-10-25' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_OVERLAP' });   // salon-wide over a branch week
    expect((await svc.createPeriod(ctx(), { periodStart: '2026-10-26', periodEnd: '2026-11-01' })).status).toBe('draft');
    expect((await svc.createPeriod(ctx(TA, BA2), { periodStart: '2026-10-19', periodEnd: '2026-10-25' })).status).toBe('draft');   // another branch
    expect((await svc.createPeriod(ctx(TB, BB), { periodStart: '2026-10-19', periodEnd: '2026-10-25' })).status).toBe('draft');    // another salon
    expect(Number((await q(`select count(*)::int as n from payroll_periods where tenant_id = $1 and branch_id = $2`, [TA, BA]))[0].n)).toBe(2);
  });
});
