// payroll-list-query.pgtest.vitest.spec.ts — BUILD_PLAN Phase 12 (DoD #21/#22): GET /pos/payroll/state and
// GET /super-admin/payroll/state run on PAYROLL_PERIODS_SPEC — checked + written back as the ListQueryInterceptor does, then
// applied by the repository on the migrated schema (filter, search, declared sort, cursor); undeclared fields refused.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { parseListQuery, writeLegacyParams, ListQueryError, type ListQuerySpec } from '@aipowersalon/database';
import { encodeOffsetCursor, inspectOffsetCursor } from '@aipowersalon/api-contracts';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { PayrollControllerListQueries, SuperAdminPayrollControllerListQueries } from './payroll.list-queries';

const T1 = 'b0110000-0000-4000-8000-000000000001'; const T2 = 'b0110000-0000-4000-8000-000000000002';
let db: any; let repo: KyselyPayrollRepository;
const edge = (query: Record<string, any>, spec: ListQuerySpec) => { const q = { ...query }; writeLegacyParams(q, spec, parseListQuery(q, spec)); return q; };
const codeOf = (q: any, spec: ListQuerySpec) => { try { edge(q, spec); return 'ok'; } catch (e) { return (e as ListQueryError).code; } };
const POS = PayrollControllerListQueries.state; const SA = SuperAdminPayrollControllerListQueries.state;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [id, slug] of [[T1, 'lqp1'], [T2, 'lqp2']]) await db.insertInto('tenants').values({ id, legal_name: slug, display_name: slug, tenant_slug: slug, tenant_code: slug.toUpperCase(), status: 'active' } as any).execute();
  const rows: any[] = [];
  for (let m = 1; m <= 8; m++) rows.push({ tenant_id: T1, label: m === 3 ? 'March_10% bonus' : `2026-${String(m).padStart(2, '0')}`, period_start: `2026-${String(m).padStart(2, '0')}-01`, period_end: `2026-${String(m).padStart(2, '0')}-28`, status: m < 6 ? 'paid' : 'draft' });
  rows.push({ tenant_id: T2, label: 'other', period_start: '2026-05-01', period_end: '2026-05-28', status: 'draft' });
  await db.insertInto('payroll_periods').values(rows).execute();
  repo = new KyselyPayrollRepository(db);
}, 180_000);

describe('payroll periods on the list-query standard', () => {
  it('filter[status] = ?status=, salon-scoped; escaped search', async () => {
    const a = await repo.listPeriods(T1, edge({ filter: { status: 'draft' } }, POS) as any);
    const b = await repo.listPeriods(T1, edge({ status: 'draft' }, POS) as any);
    expect(a.items.map((x: any) => x.id)).toEqual(b.items.map((x: any) => x.id));
    expect(a.items.map((x: any) => x.label)).toEqual(['2026-08', '2026-07', '2026-06']);   // labels: the mapper's periodStart depends on the driver's date parsing
    expect((await repo.listPeriods(T1, edge({ q: 'March_10%' }, POS) as any)).items.map((x: any) => x.label)).toEqual(['March_10% bonus']);
  });
  it('sort=periodStart reverses the default; the cursor walks pages; unknown sort / filter refused', async () => {
    const asc = (await repo.listPeriods(T1, edge({ sort: 'periodStart', pageSize: '3' }, POS) as any)).items.map((x: any) => x.label);
    expect(asc).toEqual(['2026-01', '2026-02', 'March_10% bonus']);
    const c: any = inspectOffsetCursor(encodeOffsetCursor({ page: 2, pageSize: 3, sizeKey: 'pageSize', sortKey: 'periodStart', direction: 'asc' }));
    const p2 = await repo.listPeriods(T1, edge({ page: String(c.params.page), pageSize: '3', sort: c.params.sortKey, dir: c.params.direction }, POS) as any);
    expect(p2.items.map((x: any) => x.label)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(codeOf({ sort: 'payable_cents' }, POS)).toBe('INVALID_SORT');
    expect(codeOf({ filter: { tenantId: T2 } }, POS)).toBe('INVALID_FILTER');
  });
  it('the platform list takes filter[tenantId]', async () => {
    expect((await repo.listPlatform(edge({ filter: { tenantId: T2 } }, SA) as any)).items.map((x: any) => x.label)).toEqual(['other']);
  });
  it('?technician= finds the periods a technician is paid in — name accent-free, or phone digits; salon-scoped (batch 9)', async () => {
    const B = 'b0110000-0000-4000-8000-0000000000b1'; const TECH = 'b0110000-0000-4000-8000-0000000000c1';
    await db.insertInto('technicians').values({ id: TECH, tenant_id: T1, branch_id: B, first_name: 'Ngọc', last_name: 'Trần', full_name: 'Trần Ngọc', normalized_phone: '+17145550123' } as any).execute();
    const per = async (label: string) => (await db.selectFrom('payroll_periods').select(['id']).where('label', '=', label).executeTakeFirstOrThrow()).id;
    await db.insertInto('payroll_lines').values([
      { tenant_id: T1, period_id: await per('2026-07'), technician_id: TECH, technician_name: 'Trần Ngọc' },
      { tenant_id: T1, period_id: await per('2026-06'), technician_id: 'b0110000-0000-4000-8000-0000000000c2', technician_name: 'Lisa Phạm' },
      { tenant_id: T2, period_id: await per('other'), technician_id: TECH, technician_name: 'Trần Ngọc' },
    ] as any).execute();
    const labels = async (t: string, tenant = T1) => (await repo.listPeriods(tenant, edge({ technician: t }, POS) as any)).items.map((x: any) => x.label);
    expect(await labels('tran ngoc')).toEqual(['2026-07']);
    expect(await labels('NGỌC')).toEqual(['2026-07']);
    expect(await labels('555-0123')).toEqual(['2026-07']);
    expect(await labels('pham')).toEqual(['2026-06']);
    expect(await labels('nobody')).toEqual([]);
    expect(await labels('100%')).toEqual([]);                       // a LIKE wildcard is literal
    expect(await labels('tran', T2)).toEqual(['other']);
    expect(codeOf({ technician: 'x' }, POS)).toBe('ok');
  });
});
