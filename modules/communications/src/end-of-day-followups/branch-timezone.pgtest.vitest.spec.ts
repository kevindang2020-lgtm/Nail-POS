// branch-timezone.pgtest — end-of-day follow-ups run on the SALON's clock, against the real schema.
//
// branchTimezone() used to read store_hours_settings.timezone. Nothing in the codebase writes that table, so it
// always returned null and every salon fell through to America/New_York — a Los Angeles salon's "7pm" follow-ups
// ran at 4pm local. It now reads branches.timezone, the column the location screens actually write.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'b5b5b5b5-0000-4000-8000-000000000001';
const LA = 'b5b5b5b5-0000-4000-8000-000000000002';
const NO_TZ = 'b5b5b5b5-0000-4000-8000-000000000003';
let repo: KyselyDailyFollowUpRepository;
let pg: any;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'West Salon LLC', 'West Salon', 'west-salon', 'WEST1', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${LA}', '${T}', 'Santa Monica', 'active', 'America/Los_Angeles');`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${NO_TZ}', '${T}', 'Unset', 'active');`);
  repo = new KyselyDailyFollowUpRepository(kyselyFor(pg) as never);
});

describe('end-of-day follow-ups use the branch\'s real timezone', () => {
  it('a Los Angeles branch resolves to America/Los_Angeles — not the New York default', async () => {
    expect(await repo.branchTimezone(T, LA)).toBe('America/Los_Angeles');
  });

  it('a branch with no timezone set returns null, so the service applies its default explicitly', async () => {
    expect(await repo.branchTimezone(T, NO_TZ)).toBeNull();
  });

  it('another tenant cannot read this branch\'s timezone', async () => {
    expect(await repo.branchTimezone('b5b5b5b5-0000-4000-8000-0000000000ff', LA)).toBeNull();
  });

  it('the table it USED to read is still never written — which is why the old code always fell through', async () => {
    const r = await pg.query(`SELECT count(*)::int AS c FROM store_hours_settings`);
    expect(r.rows[0].c).toBe(0);
  });
});
