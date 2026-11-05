// campaign-compliance-queries.pgtest — executes the campaign compliance reads against the real schema.
//
// A compliance surface that silently returns [] reports **no open flags** — no high opt-out rates, no spam
// complaints, nothing awaiting review. That is the state an operator is happiest to see and least likely to
// question, which is the recurring shape of this whole audit.
//
// `listFlags` catches to [] and `getActiveLimits` catches to null. Both are seeded and asserted non-empty,
// and the status filter has a NEGATIVE case so a filter that ignores its argument cannot pass.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyComplianceRepo } from './campaign-compliance.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'b7b7b7b7-0000-4000-8000-000000000001';
let repo: KyselyComplianceRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Campaign Salon LLC', 'Campaign Salon', 'campaign-salon', 'CAMP1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new KyselyComplianceRepo(kyselyFor(pg) as never);

  // Every column here is CHECK-constrained; an invented value is refused at insert.
  await pg.exec(`
    INSERT INTO campaign_compliance_flags (tenant_id, subject_type, subject_id, flag_type, severity, status)
    VALUES ('${T}', 'tenant_campaign', 'camp-1', 'high_opt_out',    'high',   'open'),
           ('${T}', 'tenant_campaign', 'camp-2', 'spam_complaints', 'medium', 'cleared');
  `);
  await pg.exec(`
    INSERT INTO campaign_limits (max_sends_per_day, max_campaigns_per_day, quiet_hours_start, quiet_hours_end, active)
    VALUES (5000, 3, 21, 8, true);
  `);
});

describe('compliance flags — "no open flags" is the answer nobody questions', () => {
  it('an open flag is LISTED', async () => {
    const r = await repo.listFlags({ tenantId: T });
    expect(r.length).toBeGreaterThan(0);
    expect(r.map((f) => f.subjectId)).toContain('camp-1');
  });

  it('the flag type survives the read — it is what tells an operator WHAT is wrong', async () => {
    const f = (await repo.listFlags({ tenantId: T })).find((x) => x.subjectId === 'camp-1')!;
    expect(f.flagType).toBe('high_opt_out');
  });

  it('filtering by status finds the open one', async () => {
    const r = await repo.listFlags({ tenantId: T, status: 'open' });
    expect(r.map((f) => f.subjectId)).toContain('camp-1');
  });

  // The negative. Without it, a status filter that ignores its argument passes everything above.
  it('filtering by status EXCLUDES the cleared one', async () => {
    const r = await repo.listFlags({ tenantId: T, status: 'open' });
    expect(r.map((f) => f.subjectId)).not.toContain('camp-2');
  });

  it('another tenant sees no flags', async () => {
    expect(await repo.listFlags({ tenantId: 'b8b8b8b8-0000-4000-8000-000000000002' })).toHaveLength(0);
  });
});

describe('platform campaign limits', () => {
  it('the active limits come BACK — null here reads as "no limits configured"', async () => {
    const l = await repo.getActiveLimits();
    expect(l).not.toBeNull();
    expect(l!.maxSendsPerDay).toBe(5000);
  });

  it('quiet hours survive the read, including a window that wraps midnight', async () => {
    const l = await repo.getActiveLimits();
    expect(l!.quietHoursStart).toBe(21);
    expect(l!.quietHoursEnd).toBe(8);
  });

  it('setLimits deactivates the previous row rather than leaving two active', async () => {
    await repo.setLimits({ maxSendsPerDay: 1000, maxCampaignsPerDay: 2, quietHoursStart: 22, quietHoursEnd: 7, minHoursBetween: 4 });
    const l = await repo.getActiveLimits();
    expect(l!.maxSendsPerDay).toBe(1000);   // LIMIT 1 over active=true would be non-deterministic with two
  });
});
