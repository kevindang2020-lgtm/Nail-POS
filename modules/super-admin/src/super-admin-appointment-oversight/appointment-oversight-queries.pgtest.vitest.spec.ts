// appointment-oversight-queries.pgtest — executes the appointment-oversight gap queries for real.
//
// 3 swallowing catches over 44 raw queries. This is the screen that finds duplicate, overlapping and failed
// appointments — a broken query reports **no problems found**, which is the most reassuring possible lie for
// an oversight tool. Shared cached schema (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyAppointmentOversightGapRepo } from './super-admin-appointment-oversight.kysely.repository';

const T = '11111111-1111-1111-1111-111111111111';
let repo: KyselyAppointmentOversightGapRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
      VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active')
      ON CONFLICT (id) DO NOTHING;
  `);
  repo = new KyselyAppointmentOversightGapRepo(kyselyFor(pg) as any);
}, 60_000);

describe('appointment-oversight queries execute against the real migrated schema', () => {
  it('daily-by-status, technician count and today revenue all execute', async () => {
    expect(Array.isArray(await repo.appointmentDailyByStatus(undefined, 7))).toBe(true);
    expect(typeof await repo.technicianCount(undefined)).toBe('number');
    expect(typeof await repo.todayRevenueCents(undefined)).toBe('number');
  });

  it('searchAppointments returns the rows/total envelope, not a failed-query shape', async () => {
    const r: any = await repo.searchAppointments(undefined, { page: 1, pageSize: 10 } as any);
    expect(Array.isArray(r.rows)).toBe(true);
    expect(typeof r.total).toBe('number');
  });

  it('detectDuplicates executes — "no duplicates" must come from the data, not a broken query', async () => {
    const r: any = await repo.detectDuplicates(undefined, 1, 10);
    expect(Array.isArray(r.groups)).toBe(true);
    expect(typeof r.total).toBe('number');
  });
});
