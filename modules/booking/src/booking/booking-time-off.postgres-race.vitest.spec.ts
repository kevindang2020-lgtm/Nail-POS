// booking-time-off.postgres-race.vitest.spec.ts — mandate §51 (Oct 20 2026): APPROVED time off is part of the technician's
// day. Until then nothing in modules/booking read technician_time_off and approving time off wrote no blocked time, so an
// approved vacation day stayed bookable from the POS, the customer app and the AI receptionist. The fix lives in the ONE
// schedule reader (KyselyBookingRepository.blockedTimes) every path reads through, so it is proven once, here, on real
// Postgres (the range is timestamptz, the day is the branch's). Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { pbTechDayWindows, pbTimeOffToBlock, pbWithinTechWindows } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a7200000-0000-4000-8000-0000000000a1', B = 'b7200000-0000-4000-8000-0000000000b1', TECH = 'c7200000-0000-4000-8000-0000000000c1', TECH2 = 'c7200000-0000-4000-8000-0000000000c2';
const ctx = { tenantId: T, branchId: B, userId: 'u', role: 'FRONT_DESK', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyBookingRepository;

describe.skipIf(!url)('approved time off blocks the booking day (one schedule reader)', () => {
  beforeAll(async () => {
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyBookingRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'TO', 'TO', 'to-salon', 'TOSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Cherry Hill', 'America/New_York') on conflict (id) do update set timezone = excluded.timezone`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Lisa', 'L', 'Lisa L'), (${TECH2}, ${T}, ${B}, 'Mary', 'M', 'Mary M') on conflict (id) do nothing`.execute(db);
    // Lisa: whole day Oct 22 (local) approved; a PENDING request Oct 23; a CANCELLED one Oct 24
    await sql`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status, kind, reason) values
      (${T}, ${B}, ${TECH}, '2026-10-22T04:00:00Z', '2026-10-23T04:00:00Z', 'approved', 'VACATION', null),
      (${T}, ${B}, ${TECH}, '2026-10-23T04:00:00Z', '2026-10-24T04:00:00Z', 'pending', 'PERSONAL', null),
      (${T}, ${B}, ${TECH}, '2026-10-24T04:00:00Z', '2026-10-25T04:00:00Z', 'cancelled', 'PERSONAL', null),
      (${T}, ${B}, ${TECH2}, '2026-10-22T17:00:00Z', '2026-10-22T19:30:00Z', 'approved', 'PERSONAL', 'dentist')`.execute(db);   // Mary: 1:00–3:30 pm local
  });
  afterAll(async () => {
    await sql`delete from technician_time_off where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from technicians where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from branches where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
    clearBranchTimeZoneCache(); await db?.destroy();
  });

  it('a whole approved day off is a 00:00–23:59 block; pending and cancelled requests are not', async () => {
    expect((await repo.blockedTimes(ctx, '2026-10-22'))[TECH]).toEqual([{ blockId: expect.stringMatching(/^time-off:/), startTime: '00:00', endTime: '23:59', reason: 'time_off: vacation' }]);
    expect((await repo.blockedTimes(ctx, '2026-10-23'))[TECH]).toBeUndefined();   // pending: still bookable (before: also bookable — the bug was the approved one)
    expect((await repo.blockedTimes(ctx, '2026-10-24'))[TECH]).toBeUndefined();   // cancelled
    expect((await repo.blockedTimes(ctx, '2026-10-21'))[TECH]).toBeUndefined();   // the day before: untouched
  });

  it("a partial afternoon off is clipped to the branch's local HH:MM and the window engine refuses that slot and accepts the morning", async () => {
    const blocks = (await repo.blockedTimes(ctx, '2026-10-22'))[TECH2];
    expect(blocks).toEqual([{ blockId: expect.stringMatching(/^time-off:/), startTime: '13:00', endTime: '15:30', reason: 'time_off: personal' }]);
    const windows = pbTechDayWindows('09:00', '19:00', null, blocks!);
    expect(pbWithinTechWindows('14:00', '15:00', windows)).toBe(false);   // inside the time off → refused on every path
    expect(pbWithinTechWindows('10:00', '11:00', windows)).toBe(true);
    expect(pbWithinTechWindows('15:30', '16:30', windows)).toBe(true);
  });

  it('the pure clipper: a range that spans the day start / end is clipped; one outside the day is null', () => {
    const tz = 'America/New_York';
    const dayStart = Date.parse('2026-10-22T04:00:00Z'), dayEnd = dayStart + 86_400_000;
    expect(pbTimeOffToBlock({ startsAtMs: Date.parse('2026-10-21T20:00:00Z'), endsAtMs: Date.parse('2026-10-22T14:00:00Z') }, dayStart, dayEnd, tz)).toEqual({ startTime: '00:00', endTime: '10:00', reason: 'time_off' });
    expect(pbTimeOffToBlock({ startsAtMs: Date.parse('2026-10-22T20:00:00Z'), endsAtMs: Date.parse('2026-10-25T14:00:00Z'), reason: 'x' }, dayStart, dayEnd, tz)).toEqual({ startTime: '16:00', endTime: '23:59', reason: 'time_off: x' });
    expect(pbTimeOffToBlock({ startsAtMs: Date.parse('2026-10-23T04:00:00Z'), endsAtMs: Date.parse('2026-10-24T04:00:00Z') }, dayStart, dayEnd, tz)).toBeNull();
  });
});
