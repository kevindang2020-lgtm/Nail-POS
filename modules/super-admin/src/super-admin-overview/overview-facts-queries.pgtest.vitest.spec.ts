// overview-facts-queries.pgtest — executes the Super Admin platform Overview facts against the real migrated
// schema.
//
// This repository states its own risk at the top of the file: "every metric is its own resilient query: a
// missing column/table degrades THAT metric to 0/empty (via .catch)". That is correct resilience and a perfect
// hiding place — this is the PLATFORM OPERATOR'S FRONT PAGE. Zero tenants, zero applications, zero card volume
// renders as a quiet platform, which is indistinguishable from a broken one and far more comforting.
//
// Every assertion is "NOT zero", because zero is the failure mode.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyOverviewRepository } from './overview.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'eeeeeeee-0000-4000-8000-000000000001';
const B = 'eeeeeeee-0000-4000-8000-000000000002';
const range = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) } as never;
let repo: KyselyOverviewRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Overview Salon LLC', 'Overview Salon', 'overview-salon', 'OVER1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new KyselyOverviewRepository(kyselyFor(pg) as never);

  await pg.exec(`
    INSERT INTO tenant_applications (id, salon_name, owner_name, status)
    VALUES (gen_random_uuid(), 'Hopeful Nails', 'Dana Reed', 'new');
  `);
  await pg.exec(`
    INSERT INTO tenant_daily_sales_summary (tenant_id, branch_id, summary_date, revenue_cents)
    VALUES ('${T}', '${B}', current_date, 123456);
  `);
});

describe('platform overview facts execute against the real schema', () => {
  it('a tenant is COUNTED by status — an empty list reads as "no tenants", which is never true in production', async () => {
    const f = await repo.getFacts(range);
    expect(f.tenantStatusCounts.length).toBeGreaterThan(0);
  });

  it('a pending application is counted — 0 here means nobody chases a real signup', async () => {
    const f = await repo.getFacts(range);
    expect(f.newApplications).toBeGreaterThan(0);
  });

  it('card volume sums the seeded revenue — the money metric is the one most worth faking', async () => {
    const f = await repo.getFacts(range);
    expect(f.monthlyCardVolumeCents).toBeGreaterThanOrEqual(123456);
  });

  // activeSalons is DERIVED from tenantStatusCounts, not queried from branches — a mutation on the branches
  // table left this green and I checked why rather than assuming the test was weak. It counts active TENANTS.
  it('the active count is derived from the tenant status counts', async () => {
    const f = await repo.getFacts(range);
    expect(f.activeSalons).toBeGreaterThan(0);
  });

  // The metric that DOES read branches. Without this, a broken branches query is invisible here.
  it('totalLocations counts a real branch row', async () => {
    const f = await repo.getFacts(range);
    expect(f.platformKpis?.totalLocations ?? 0).toBeGreaterThan(0);
  });

  it('every numeric fact is a NUMBER, not a bigint string — the ::bigint casts have to be coerced', async () => {
    const f = await repo.getFacts(range);
    for (const k of ['activeSalons', 'newApplications', 'monthlyCardVolumeCents', 'pausedTenants'] as const) {
      expect(typeof f[k], k).toBe('number');
    }
  });

  it('the sales series is built, not empty', async () => {
    const f = await repo.getFacts(range);
    expect(Array.isArray(f.salesSeries)).toBe(true);
    expect(f.salesSeries.length).toBeGreaterThan(0);
  });
});

// w4 sweep SW-13 (Oct 13 2026): two of the front page's facts named columns that do not exist (users.is_active,
// payment_gateway_events.status) — the PostgreSQL log of the live sweep showed both failing on every load — so Active
// Users was ALWAYS 0 and system health was ALWAYS "All Systems Online", whatever the gateway reported.
describe('the platform KPIs that were silently zero', () => {
  it('activeUsers counts the active users', async () => {
    const pg: any = (repo as any).db;
    await (await import('kysely')).sql`insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role) values (${T}, ${B}, 'Ova', 'User', 'Ova User', 'ova.user@overview.test', 'x', 'active', 'OWNER')`.execute(pg);
    const f = await repo.getFacts(range);
    expect(f.platformKpis?.activeUsers ?? 0).toBeGreaterThan(0);
  });
  it('a failed gateway event in the last 24 h lowers system health and names the issue', async () => {
    const pg: any = (repo as any).db;
    await (await import('kysely')).sql`insert into payment_gateway_events (tenant_id, branch_id, processor_type, event_type, last_error, created_at) values (${T}, ${B}, 'cardpointe', 'payment.declined', 'processor timeout', now())`.execute(pg);
    const f = await repo.getFacts(range);
    expect(f.systemHealthPercent).toBeLessThan(100);
    expect(f.systemHealthLabel).toMatch(/gateway issue/);
  });
});

describe('tenant scoping', () => {
  it('scoping to an unknown tenant zeroes the money, proving the scope predicate is applied', async () => {
    const f = await repo.getFacts(range, { tenantId: 'ffffffff-0000-4000-8000-000000000009' });
    expect(f.monthlyCardVolumeCents).toBe(0);
  });

  // The money metrics use andTenant(); the platform KPIs use a SEPARATE tenantPred() helper. Replacing that
  // second one with `true` left every test green until this case existed — two scope mechanisms need two tests.
  it('scoping also applies to the platform KPIs, which use a different predicate helper', async () => {
    const f = await repo.getFacts(range, { tenantId: 'ffffffff-0000-4000-8000-000000000009' });
    expect(f.platformKpis?.totalLocations ?? 0).toBe(0);
  });
});
