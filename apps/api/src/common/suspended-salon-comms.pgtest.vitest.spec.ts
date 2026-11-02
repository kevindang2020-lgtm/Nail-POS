// Constitution 7 §19 on the real schema: reminders and end-of-day follow-ups skip a suspended or closed salon.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyRemindersRepository, KyselyDailyFollowUpRepository } from '@aipowersalon/communications';
import { seedRow } from '../events/pgtest-seed';

const A = '6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a', S = '6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: A, legal_name: 'A', display_name: 'Active Salon', tenant_slug: 'activesalon', tenant_code: 'ACTV01', status: 'active' });
  await seedRow(pg, 'tenants', { id: S, legal_name: 'S', display_name: 'Suspended Salon', tenant_slug: 'suspsalon', tenant_code: 'SUSP02', status: 'active' });
  for (const t of [A, S]) { await seedRow(pg, 'reminder_settings', { tenant_id: t, enabled: true }); await seedRow(pg, 'branches', { tenant_id: t, name: 'Main', status: 'active' }); }
  await sql`update tenants set lifecycle_state = 'SUSPENDED', suspension_reason_code = 'BILLING' where id = ${S}`.execute(db);
});
describe('scheduled communications vs salon status (§19)', () => {
  it('reminders are sent only for active salons', async () => {
    expect((await new KyselyRemindersRepository(db).listEnabledTenants()).map((t: any) => t.tenantId)).toEqual([A]);
  });
  it('end-of-day follow-ups run only for active salons\' branches', async () => {
    expect((await new KyselyDailyFollowUpRepository(db).activeBranches()).map((b: any) => b.tenantId)).toEqual([A]);
  });
});
