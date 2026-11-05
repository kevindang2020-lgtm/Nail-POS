// campaign-limits-enforcement.pgtest — platform campaign limits enforced end to end, against the real schema:
// migration 442's started_at, the salon-local "today" SQL, the strict limits read, and the service chokepoint.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyCampaignsRepository } from './campaigns.kysely.repository';
import { KyselyComplianceRepo } from './campaign-compliance.kysely.repository';
import { CampaignComplianceService } from './campaign-compliance.service';
import { CampaignsService, CampaignLimitError } from './campaigns.service';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'f9f9f9f9-0000-4000-8000-000000000001';
const B = 'f9f9f9f9-0000-4000-8000-000000000002';
const ctx = { tenantId: T, userId: 'f9f9f9f9-0000-4000-8000-0000000000aa', role: 'OWNER', permissions: ['pos.marketing.manage'] } as never;
let pg: any; let repo: KyselyCampaignsRepository; let complianceRepo: KyselyComplianceRepo; let svc: CampaignsService;

const draft = async (name: string, audience: number) => {
  const r = await pg.query(`INSERT INTO campaigns (tenant_id, branch_id, name, channel, audience_size, status)
                            VALUES ('${T}', '${B}', '${name}', 'sms', ${audience}, 'draft') RETURNING id`);
  return r.rows[0].id as string;
};
const setLimits = async (l: Record<string, number | null>) =>
  complianceRepo.setLimits({ maxSendsPerDay: null, maxCampaignsPerDay: null, quietHoursStart: null, quietHoursEnd: null, minHoursBetween: null, ...l } as never);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Limits Salon LLC', 'Limits Salon', 'limits-salon', 'LIMS1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/Chicago') ON CONFLICT DO NOTHING;`)
    .catch(() => undefined);
  const db = kyselyFor(pg) as never;
  repo = new KyselyCampaignsRepository(db);
  complianceRepo = new KyselyComplianceRepo(db);
  svc = new CampaignsService(repo, undefined, undefined, new CampaignComplianceService(complianceRepo));
});

describe('migration 442: started_at is stamped once', () => {
  it('activating a campaign stamps started_at', async () => {
    await setLimits({});
    const id = await draft('Stamp me', 10);
    await svc.transition(ctx, id, 'in_progress');
    const r = await pg.query(`SELECT started_at FROM campaigns WHERE id = '${id}'`);
    expect(r.rows[0].started_at).not.toBeNull();
  });

  it('a later status change does NOT move started_at — the daily count depends on it staying put', async () => {
    const id = await draft('Keep me', 10);
    await svc.transition(ctx, id, 'in_progress');
    const before = (await pg.query(`SELECT started_at FROM campaigns WHERE id = '${id}'`)).rows[0].started_at;
    await pg.query(`UPDATE campaigns SET started_at = started_at - interval '3 hours' WHERE id = '${id}'`);
    const moved = (await pg.query(`SELECT started_at FROM campaigns WHERE id = '${id}'`)).rows[0].started_at;
    await repo.setStatus(ctx, id, 'in_progress');   // re-entering must not re-stamp
    const after = (await pg.query(`SELECT started_at FROM campaigns WHERE id = '${id}'`)).rows[0].started_at;
    expect(new Date(after).getTime()).toBe(new Date(moved).getTime());
    expect(new Date(after).getTime()).not.toBe(new Date(before).getTime());
  });
});

describe('the salon clock and the day\'s facts come from real rows', () => {
  it('the salon timezone is read from the branch', async () => {
    expect(await repo.salonTimezone(ctx, B)).toBe('America/Chicago');
  });

  it('an unknown branch falls back to the tenant\'s own branch, not to a stranger\'s', async () => {
    expect(await repo.salonTimezone(ctx, 'f9f9f9f9-0000-4000-8000-0000000000ff')).toBe('America/Chicago');
  });

  it('limitFacts counts today\'s started campaigns and sums their audiences', async () => {
    const f = await repo.limitFacts(ctx, 'America/Chicago');
    expect(f.campaignsStartedToday).toBeGreaterThanOrEqual(1);
    expect(f.sendsStartedToday).toBeGreaterThanOrEqual(10);
    expect(f.lastStartedAt).toBeInstanceOf(Date);
  });

  it('a campaign that started YESTERDAY does not count toward today', async () => {
    const before = await repo.limitFacts(ctx, 'America/Chicago');
    const id = await draft('Yesterday', 500);
    await pg.query(`UPDATE campaigns SET status = 'in_progress', started_at = now() - interval '2 days' WHERE id = '${id}'`);
    const after = await repo.limitFacts(ctx, 'America/Chicago');
    expect(after.campaignsStartedToday).toBe(before.campaignsStartedToday);
    expect(after.sendsStartedToday).toBe(before.sendsStartedToday);
  });
});

describe('the chokepoint refuses a start that breaks a limit', () => {
  it('the daily campaign cap blocks the next start, with a reason the owner can act on', async () => {
    const started = (await repo.limitFacts(ctx, 'America/Chicago')).campaignsStartedToday;
    await setLimits({ maxCampaignsPerDay: started });
    const id = await draft('One too many', 10);
    await expect(svc.transition(ctx, id, 'in_progress')).rejects.toBeInstanceOf(CampaignLimitError);
    await expect(svc.transition(ctx, id, 'in_progress')).rejects.toMatchObject({ code: 'max_campaigns_per_day' });
  });

  it('…and the refused campaign stays in DRAFT — nothing was sent', async () => {
    const r = await pg.query(`SELECT status, started_at FROM campaigns WHERE name = 'One too many'`);
    expect(r.rows[0].status).toBe('draft');
    expect(r.rows[0].started_at).toBeNull();
  });

  it('the send cap counts THIS campaign\'s audience before it goes out', async () => {
    const sent = (await repo.limitFacts(ctx, 'America/Chicago')).sendsStartedToday;
    await setLimits({ maxSendsPerDay: sent + 50 });
    const id = await draft('Too big', 100);
    await expect(svc.transition(ctx, id, 'in_progress')).rejects.toMatchObject({ code: 'max_sends_per_day' });
  });

  it('with the limits lifted, the same campaign starts normally', async () => {
    await setLimits({});
    const id = await draft('Allowed', 100);
    await expect(svc.transition(ctx, id, 'in_progress')).resolves.toBeTruthy();
  });
});

describe('a limits READ ERROR refuses the start instead of lifting every cap', () => {
  it('when the limits cannot be read, the campaign is not started', async () => {
    const broken = { getLimitsStrict: async () => { throw new Error('db down'); } } as never;
    const guarded = new CampaignsService(repo, undefined, undefined, broken);
    const id = await draft('During an outage', 10);
    await expect(guarded.transition(ctx, id, 'in_progress')).rejects.toMatchObject({ code: 'limits_unavailable' });
    const r = await pg.query(`SELECT status FROM campaigns WHERE id = '${id}'`);
    expect(r.rows[0].status).toBe('draft');
  });
});
