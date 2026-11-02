// Constitution 7 §41 — usage alerts at 80/90/100%, once per tenant/metric/threshold/month, with an owner-only notice.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { UsageAlertSweep, thresholdsReached } from '@aipowersalon/platform';
import { seedRow } from '../events/pgtest-seed';

const T = '66666666-6666-4666-8666-666666666666';
let db: any;
let pct = 85;
// the sweep reads utilization from the entitlement evaluation; here a fake returns one tenant with one limited metric
const ent: any = { getPlanUtilization: async () => ({ tenants: [{ tenantId: T, name: 'Busy Salon', metrics: [{ metric: 'customers', used: pct * 10, effective: 1000, pct, status: 'warning' }] }] }) };
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'U', display_name: 'Busy Salon', tenant_slug: 'busysalon', tenant_code: 'BUSY01', status: 'active' });
});

describe('usage alerts (§41)', () => {
  it('thresholds reached: 85% → [80]; 100% → all three', () => {
    expect(thresholdsReached(79)).toEqual([]);
    expect(thresholdsReached(85)).toEqual([80]);
    expect(thresholdsReached(100)).toEqual([80, 90, 100]);
  });
  it('85%: one 80% alert + one owner-only notice; a second sweep the same month adds nothing', async () => {
    const s = new UsageAlertSweep(ent, db);
    expect(await s.sweep(new Date('2026-09-28T10:00:00Z'))).toMatchObject({ alerts: 1, failed: 0 });
    expect(await s.sweep(new Date('2026-09-28T11:00:00Z'))).toMatchObject({ alerts: 0, failed: 0 });
    const n = (await sql<any>`select severity, audience, title from owner_alerts where tenant_id = ${T} and category = 'usage_limit'`.execute(db)).rows;
    expect(n).toEqual([{ severity: 'info', audience: 'owner', title: 'You have used 80% of your customers limit' }]);
  });
  it('reaching 100% adds the 90% and 100% alerts (not the 80% again); a new month alerts afresh', async () => {
    pct = 100;
    const s = new UsageAlertSweep(ent, db);
    expect(await s.sweep(new Date('2026-09-29T10:00:00Z'))).toMatchObject({ alerts: 2 });
    expect((await sql<any>`select threshold from usage_alerts where tenant_id = ${T} and period = '2026-09' order by threshold`.execute(db)).rows.map((r: any) => r.threshold)).toEqual([80, 90, 100]);
    expect(await s.sweep(new Date('2026-10-01T10:00:00Z'))).toMatchObject({ alerts: 3 });
    const recent = await s.recent(10);
    expect(recent.rows[0]).toMatchObject({ tenantName: 'Busy Salon', metric: 'customers' });
  });
});
