// merchant-accounts-queries.pgtest — executes the Super Admin Merchant Accounts queries against the real
// migrated schema.
//
// 41 queries, all raw `sql` templates behind the same two swallowing helpers (rows() → [], one() → defaults of
// '0'). This module is money-adjacent, which makes a false zero worse than elsewhere: "0 merchant accounts
// pending underwriting" and "no open alerts" are the answers an operator is happiest to see, so a broken query
// produces a reassuring screen instead of a visibly broken one.
//
// Every assertion is "NOT the zero/empty default", because that default is exactly the failure mode.
import { describe, it, expect, beforeAll } from 'vitest';
import { SuperAdminMerchantAccountsRepository } from './super-admin-merchant-accounts.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'aaaaaaaa-0000-4000-8000-000000000001';
const scope = { tenantId: T };
let repo: SuperAdminMerchantAccountsRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Merchant Salon LLC', 'Merchant Salon', 'merchant-salon', 'MERCH1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new SuperAdminMerchantAccountsRepository(kyselyFor(pg) as never);

  // 'paused' and onboarding_status arrive in migrations 097/098, AFTER the original CHECK — seeding them here
  // proves those later migrations are in the cached schema, not just the base table.
  await pg.exec(`
    INSERT INTO tenant_payment_config (tenant_id, processor, status, onboarding_status)
    VALUES ('${T}', 'fiserv', 'active', 'under_review')
    ON CONFLICT (tenant_id) DO UPDATE SET processor = excluded.processor, status = excluded.status, onboarding_status = excluded.onboarding_status;
  `);
  await pg.exec(`
    INSERT INTO merchant_account_alerts (id, tenant_id, alert_type, severity, summary, status)
    VALUES (gen_random_uuid(), '${T}', 'settlement_delay', 'critical', 'Settlement delayed past SLA', 'open');
  `);
});

describe('merchant KPI counts execute against the real schema', () => {
  it('a configured merchant is COUNTED — 0 here is what a broken query returns', async () => {
    const k = await repo.kpiCounts(scope);
    expect(Number(k.total)).toBeGreaterThan(0);
  });

  it('an active merchant is counted as active', async () => {
    const k = await repo.kpiCounts(scope);
    expect(Number(k.active)).toBeGreaterThan(0);
  });

  it('under_review counts toward pending underwriting — the onboarding_status column (migration 098) exists', async () => {
    const k = await repo.kpiCounts(scope);
    expect(Number(k.pending_underwriting)).toBeGreaterThan(0);
  });

  it('every KPI is numeric text, never undefined — the one() default would hide a missing column', async () => {
    const k = await repo.kpiCounts(scope);
    for (const key of ['total', 'active', 'pending_underwriting', 'inactive', 'terminals']) {
      expect(Number.isNaN(Number((k as never as Record<string, string>)[key])), key).toBe(false);
    }
  });
});

describe('alerts — "no open alerts" is the most dangerous thing to fake', () => {
  it('an open critical alert comes BACK', async () => {
    const a = await repo.openAlerts(scope);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].severity).toBe('critical');
  });

  it('the alert carries its tenant name — the LEFT JOIN onto tenants actually resolved', async () => {
    const a = await repo.openAlerts(scope);
    expect(a[0].tenant_name).toBe('Merchant Salon');
  });

  it('the alert count is non-zero', async () => {
    const c = await repo.alertCount(scope);
    expect(Number((c as never as { c: string }).c ?? c)).toBeGreaterThan(0);
  });
});

describe('tenant scoping is real, not decorative', () => {
  it('another tenant sees no alerts', async () => {
    const a = await repo.openAlerts({ tenantId: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(a).toHaveLength(0);
  });

  it('another tenant has zero merchants', async () => {
    const k = await repo.kpiCounts({ tenantId: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(Number(k.total)).toBe(0);
  });
});
