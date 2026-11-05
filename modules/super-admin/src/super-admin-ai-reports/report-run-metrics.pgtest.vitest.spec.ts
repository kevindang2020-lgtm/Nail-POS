// report-run-metrics.pgtest — executes the metrics snapshot that AI reports are WRITTEN FROM, against the
// real migrated schema.
//
// This is the most consequential silent-SQL surface in the reporting stack: snapshotMetrics gathers the
// revenue, booking and customer numbers, and a narrative is then generated on top of them. A wrong column name
// does not fail the report — it produces a confident, well-written report about $0 of revenue.
//
// The module already defends against this properly: each query catches to null, and `hasData` is derived from
// the ROW COUNTS rather than from the sums, so "no rows at all" is distinguishable from "genuinely zero".
// report-run-core then marks such a run `partial` instead of publishing zeros as fact. These tests pin BOTH
// halves — the numbers when data exists, and hasData=false when it does not.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyReportRunRepository } from './report-run.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'f1f1f1f1-0000-4000-8000-000000000001';
const B = 'f1f1f1f1-0000-4000-8000-000000000002';
const EMPTY_T = 'f1f1f1f1-0000-4000-8000-000000000009';
const ZERO_T = 'f1f1f1f1-0000-4000-8000-00000000000a';   // a salon that really did take $0 that day
const start = new Date(Date.now() - 86_400_000).toISOString();
const end = new Date(Date.now() + 86_400_000).toISOString();
let repo: KyselyReportRunRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Report Salon LLC', 'Report Salon', 'report-salon', 'REPT1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new KyselyReportRunRepository(kyselyFor(pg) as never);

  await pg.exec(`
    INSERT INTO tenant_daily_sales_summary (tenant_id, branch_id, summary_date, revenue_cents, refunds_cents)
    VALUES ('${T}', '${B}', current_date, 250000, 1500);
  `);
  await pg.exec(`
    INSERT INTO tenant_daily_booking_summary (tenant_id, branch_id, summary_date, bookings, completed, cancelled, no_show)
    VALUES ('${T}', '${B}', current_date, 20, 17, 2, 1);
  `);
  await pg.exec(`
    INSERT INTO tenant_daily_customer_summary (tenant_id, branch_id, summary_date, new_customers, returning_customers)
    VALUES ('${T}', '${B}', current_date, 5, 12);
  `);

  // A salon that was OPEN and genuinely took nothing. This is the case hasData exists to distinguish, and the
  // only seed that separates "derived from row counts" from "derived from sums" — with every value at zero,
  // the two definitions disagree.
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${ZERO_T}', 'Quiet Salon LLC', 'Quiet Salon', 'quiet-salon', 'QUIET1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO tenant_daily_sales_summary (tenant_id, branch_id, summary_date, revenue_cents, refunds_cents)
    VALUES ('${ZERO_T}', '${B}', current_date, 0, 0);
  `);
});

describe('the numbers an AI report is written from', () => {
  it('revenue comes BACK — $0 in a generated report is the failure mode', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T }, start, end);
    expect(m.revenueCents).toBe(250000);
  });

  it('refunds are read from their own column, not conflated with revenue', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T }, start, end);
    expect(m.refundsCents).toBe(1500);
  });

  it('every booking figure is distinct — four sums in one query is four chances to cross-wire', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T }, start, end);
    expect(m.bookings).toBe(20);
    expect(m.completed).toBe(17);
    expect(m.cancelled).toBe(2);
    expect(m.noShow).toBe(1);
  });

  it('new and returning customers are not swapped', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T }, start, end);
    expect(m.newCustomers).toBe(5);
    expect(m.returningCustomers).toBe(12);
  });

  it('hasData is TRUE when rows exist', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T }, start, end);
    expect(m.hasData).toBe(true);
  });
});

describe('hasData is the honesty flag, and it is derived from ROW COUNTS not sums', () => {
  it('a tenant with no rows reports hasData=false, so the run is marked partial rather than "$0"', async () => {
    const m = await repo.snapshotMetrics({ tenantId: EMPTY_T }, start, end);
    expect(m.hasData).toBe(false);
    expect(m.revenueCents).toBe(0);
  });

  it('a window with no rows also reports hasData=false', async () => {
    const past = new Date('2020-01-01').toISOString();
    const pastEnd = new Date('2020-01-02').toISOString();
    const m = await repo.snapshotMetrics({ tenantId: T }, past, pastEnd);
    expect(m.hasData).toBe(false);
  });

  it('A GENUINELY ZERO DAY still has data — this is the whole reason hasData counts ROWS, not sums', async () => {
    // A salon that opened and took nothing must be reported as "$0", not as "we could not gather your numbers".
    // If hasData were derived from the sums, this row would be indistinguishable from a broken query.
    const m = await repo.snapshotMetrics({ tenantId: ZERO_T }, start, end);
    expect(m.revenueCents).toBe(0);
    expect(m.hasData).toBe(true);
  });

  it('branch scoping narrows the result rather than being ignored', async () => {
    const m = await repo.snapshotMetrics({ tenantId: T, branchId: 'f1f1f1f1-0000-4000-8000-00000000000b' }, start, end);
    expect(m.hasData).toBe(false);
  });
});
