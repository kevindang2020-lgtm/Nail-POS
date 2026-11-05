// campaign-delivery-queries.pgtest — executes the campaign delivery rollups and failure reads against the
// real migrated schema.
//
// The recurring shape, at its sharpest: a broken failure query reports **no delivery failures** — no bounces,
// no opt-outs, no spam reports, no blocked destinations. That is the healthiest-looking screen in the product,
// and it is exactly what a renamed column produces.
//
// Every seeded counter is a DIFFERENT number, so a cross-wire between two of them cannot hide.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyDeliveryRepo } from './campaign-delivery.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'e3e3e3e3-0000-4000-8000-000000000001';
let repo: KyselyDeliveryRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Delivery Salon LLC', 'Delivery Salon', 'delivery-salon', 'DELV1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new KyselyDeliveryRepo(kyselyFor(pg) as never);

  await pg.exec(`
    INSERT INTO campaign_delivery_rollups (tenant_id, subject_type, subject_id, attempted, delivered, opted_out)
    VALUES ('${T}', 'tenant_campaign', 'camp-1', 900, 860, 12);
  `);
  // Two DIFFERENT categories, with different counts — a grouping that collapses them would be invisible if
  // both rows shared a category, and a cross-wire invisible if the counts matched.
  await pg.exec(`
    INSERT INTO campaign_delivery_failures (tenant_id, subject_type, subject_id, failure_category, attempt_count, retryable)
    VALUES ('${T}', 'tenant_campaign', 'camp-1', 'invalid_phone_email', 3, false),
           ('${T}', 'tenant_campaign', 'camp-1', 'spam_reported',       1, false),
           ('${T}', 'tenant_campaign', 'camp-1', 'invalid_phone_email', 2, true);
  `);
  await pg.exec(`
    INSERT INTO campaign_metric_snapshots (snapshot_date, attempted, delivered, opened, clicked)
    VALUES (current_date, 900, 860, 410, 95);
  `);
});

describe('delivery totals', () => {
  it('attempted, delivered and opted-out all come back, and none is cross-wired', async () => {
    const t = await repo.deliveryTotals(T);
    expect(t.attempted).toBe(900);
    expect(t.delivered).toBe(860);
    expect(t.optedOut).toBe(12);
  });

  it('a tenant with no rollups reports zeros rather than throwing', async () => {
    const t = await repo.deliveryTotals('e4e4e4e4-0000-4000-8000-000000000002');
    expect(t.attempted).toBe(0);
  });
});

describe('failures — "no delivery failures" is the healthiest-looking screen in the product', () => {
  it('failures are grouped by category, with BOTH categories present', async () => {
    const counts = await repo.failureCounts(T);
    const byCat = Object.fromEntries(counts.map((c) => [c.failureCategory, c.count]));
    expect(byCat.invalid_phone_email).toBe(2);   // two rows, not summed attempt_count
    expect(byCat.spam_reported).toBe(1);
  });

  it('the failure list returns the rows themselves', async () => {
    expect((await repo.listFailures({ tenantId: T })).length).toBe(3);
  });

  it('filtering by category narrows it — and EXCLUDES the other category', async () => {
    const only = await repo.listFailures({ tenantId: T, category: 'spam_reported' });
    expect(only.length).toBe(1);
    expect(only.every((f) => f.failureCategory === 'spam_reported')).toBe(true);
  });

  it('another tenant sees no failures', async () => {
    expect(await repo.listFailures({ tenantId: 'e4e4e4e4-0000-4000-8000-000000000002' })).toHaveLength(0);
  });
});

describe('metric snapshots', () => {
  it('a snapshot comes back with distinct counters', async () => {
    const s = await repo.metricSnapshots(30);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].attempted).toBe(900);
    expect(s[0].delivered).toBe(860);
  });
});
