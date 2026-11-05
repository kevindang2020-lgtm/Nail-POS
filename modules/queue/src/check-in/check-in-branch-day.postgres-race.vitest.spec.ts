// check-in-branch-day.postgres-race.vitest.spec.ts — the POS check-in list and the Go Check-In kiosk use the BRANCH's
// day (Oct 2 2026). At 01:00 UTC on Oct 2 it is 9 pm Oct 1 in New Jersey: the database's current_date (UTC) had already
// moved to Oct 2, so tonight's 9:30 pm appointment disappeared from check-in. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyCheckInRepository } from './check-in.kysely.repository';
import { GoCheckInService } from '../go-check-in/go-check-in.service';

const url = process.env.PG_RACE_URL;
const T = 'a7200000-0000-4000-8000-0000000000a1', B = 'b7200000-0000-4000-8000-0000000000b1', TECH = 'c7200000-0000-4000-8000-0000000000c1';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('check-in on the branch day', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));   // 9:00 pm Oct 1 in New Jersey
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'CI', 'CI', 'ci-day-salon', 'CIDS', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Cherry Hill', 'America/New_York') on conflict (id) do update set timezone = excluded.timezone`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Mia', 'Tran', 'Mia Tran') on conflict (id) do nothing`.execute(db);
    await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      values (${T}, ${B}, ${TECH}, 'Tonight Nine-Thirty', 'manual', '[]'::jsonb, '2026-10-01', '21:30', '22:00', 30, 'booked', 'not_required'),
             (${T}, ${B}, ${TECH}, 'Tomorrow Morning', 'manual', '[]'::jsonb, '2026-10-02', '10:00', '10:30', 30, 'booked', 'not_required')`.execute(db);
  });
  afterAll(async () => { vi.useRealTimers(); clearBranchTimeZoneCache(); await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it("the POS check-in list shows tonight's appointment, not tomorrow's", async () => {
    const repo = new KyselyCheckInRepository(db as any);
    // (the list takes names from the linked customer record; these fixtures have none, so check by start time)
    const starts = (await repo.appointmentSearch({ tenantId: T, branchId: B, userId: 'u', role: 'FRONT_DESK', permissions: [] } as any, '')).map((a: any) => String(a.startTime).slice(0, 5));
    expect(starts).toEqual(['21:30']);   // tonight's, not tomorrow's 10:00
  });

  it("the kiosk's today is the branch's day, and its day began at New Jersey midnight", async () => {
    const svc = new GoCheckInService({ branchTimeZone: async () => 'America/New_York' } as any);
    expect(await (svc as any).todayInfo({ tenantId: T, branchId: B })).toEqual({ today: '2026-10-01', dayStartMs: Date.parse('2026-10-01T04:00:00Z'), nowMinutes: 21 * 60, weekday: 4 });   // 9:00 pm on Thursday Oct 1 (Unit 7: the clock and weekday the technician list needs)
    const la = new GoCheckInService({ branchTimeZone: async () => 'America/Los_Angeles' } as any);
    expect((await (la as any).todayInfo({ tenantId: T, branchId: B })).today).toBe('2026-10-01');
  });
});
