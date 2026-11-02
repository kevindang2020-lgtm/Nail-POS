// product-demand-local-day.pgtest — the demand series a product forecast learns from is the BRANCH's days (Oct 6 2026), not
// the database's UTC days. Clock: 9:30 pm Monday Oct 5 in New York (01:30 UTC Tuesday).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyProductDemandSource } from './product-demand.kysely.source';

const T = 'e7000000-0000-4000-8000-0000000000a1', B = 'e7000000-0000-4000-8000-0000000000b1', P = 'e7000000-0000-4000-8000-0000000000c1';
const NOW = Date.parse('2026-10-06T01:30:00Z');
let src: KyselyProductDemandSource;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Demand Day LLC','Demand Day','demand-day','DMDAY1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  const move = (qty: number, at: string) => q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, created_at) values ($1,$2,$3,'retail_sale',$4,$5)`, [T, B, P, -qty, at]);
  await move(2, '2026-10-05T14:00:00Z');   // 10 am Monday
  await move(3, '2026-10-06T01:00:00Z');   // 9 pm Monday (Tuesday in UTC)
  await move(5, '2026-10-05T03:00:00Z');   // 11 pm Sunday (Monday in UTC)
  src = new KyselyProductDemandSource(kyselyFor(pg) as never); src.now = () => NOW;
});

describe('the demand series', () => {
  it('ends on the branch\'s today (Monday) and files each sale under the day it happened there', async () => {
    const s = await src.getDailyDemand({ tenantId: T, branchId: B } as never, P, 7);
    expect(s).toHaveLength(7);
    expect(s[s.length - 1]).toEqual({ date: '2026-10-05', value: 5 });   // 10 am + 9 pm
    expect(s[s.length - 2]).toEqual({ date: '2026-10-04', value: 5 });   // Sunday 11 pm
    expect(s[0]!.date).toBe('2026-09-29');
  });
});
