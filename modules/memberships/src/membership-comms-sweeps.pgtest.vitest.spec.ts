// membership-comms-sweeps.pgtest — Nov 3: the all-salon renewal-reminder and expiry sweeps compared a timestamp with
// `$now + make_interval(...)`, an untyped parameter Postgres resolves as an INTERVAL ("operator does not exist: timestamp with time
// zone <= interval") — every run failed. They now cast the parameter; this runs both against the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipCommsRepository } from './membership-comms.kysely.repository';

let repo: KyselyMembershipCommsRepository;
beforeAll(async () => { const pg = await migratedPglite(); repo = new KyselyMembershipCommsRepository(kyselyFor(pg) as never); }, 240_000);

describe('membership comms sweeps', () => {
  it('the all-salon renewal and expiry sweeps run (an empty result, not an SQL error)', async () => {
    expect(await repo.membersDueForReminderAllTenants(new Date('2026-11-03T12:00:00Z'), 3, 50)).toEqual([]);
    expect(await repo.membersExpiringAllTenants(new Date('2026-11-03T12:00:00Z'), 7, 50)).toEqual([]);
  });
});
