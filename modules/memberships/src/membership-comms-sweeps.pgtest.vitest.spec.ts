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

describe('Membership Overview 10 — SMS opt-outs read for the reminder preview', () => {
  it('returns only this salon\'s opted-out phones (sms channel)', async () => {
    const db = (repo as unknown as { db: { executeQuery: unknown } }).db as never;
    const { sql } = await import('kysely');
    const T = '77790000-0000-4000-8000-000000000001', X = '77790000-0000-4000-8000-000000000002';
    await sql`insert into notification_opt_outs (tenant_id, channel, address) values (${T}::uuid, 'sms', '+18565550105'), (${X}::uuid, 'sms', '+18565550104'), (${T}::uuid, 'email', '+18565550104')`.execute(db);
    const ctx = { tenantId: T, branchId: 'b', userId: 'u', role: 'OWNER', permissions: [] };
    expect([...await repo.smsOptedOut(ctx, ['+18565550104', '+18565550105'])]).toEqual(['+18565550105']);
    expect([...await repo.smsOptedOut(ctx, [])]).toEqual([]);
  });
});
