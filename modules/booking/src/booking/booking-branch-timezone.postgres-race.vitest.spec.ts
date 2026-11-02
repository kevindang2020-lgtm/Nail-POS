// booking-branch-timezone.postgres-race.vitest.spec.ts — the booking board runs on the BRANCH's clock (Oct 2 2026):
// at 02:30 UTC on Oct 2 a New Jersey branch is at 10:30 pm Oct 1 and a Los Angeles branch at 7:30 pm Oct 1; at 05:30 UTC
// New Jersey has rolled to Oct 2 while Los Angeles is still on Oct 1. Each branch's "today" and "now" come from its zone.
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyBookingRepository } from './booking.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a7100000-0000-4000-8000-0000000000a1', NJ = 'b7100000-0000-4000-8000-0000000000b1', LA = 'b7100000-0000-4000-8000-0000000000b2';
const ctx = (branchId: string) => ({ tenantId: T, branchId, userId: 'u', role: 'FRONT_DESK', permissions: [] }) as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyBookingRepository;

describe.skipIf(!url)('booking board on the branch clock', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T02:30:00Z'));
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyBookingRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'TZ', 'TZ', 'tz-salon', 'TZSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${NJ}, ${T}, 'Cherry Hill', 'America/New_York'), (${LA}, ${T}, 'Santa Monica', 'America/Los_Angeles') on conflict (id) do update set timezone = excluded.timezone`.execute(db);
  });
  afterAll(async () => { vi.useRealTimers(); clearBranchTimeZoneCache(); await db?.destroy(); });

  it("each branch gets its own day and minute: New Jersey 10:30 pm Oct 1, Los Angeles 7:30 pm Oct 1", async () => {
    expect(await repo.clock(ctx(NJ))).toEqual({ today: '2026-10-01', nowMinute: 22 * 60 + 30, timeZone: 'America/New_York' });
    expect(await repo.clock(ctx(LA))).toEqual({ today: '2026-10-01', nowMinute: 19 * 60 + 30, timeZone: 'America/Los_Angeles' });
  });

  it('three hours later (05:30 UTC) New Jersey is on Oct 2 while Los Angeles is still on Oct 1', async () => {
    vi.setSystemTime(new Date('2026-10-02T05:30:00Z'));
    expect((await repo.clock(ctx(NJ))).today).toBe('2026-10-02');
    expect((await repo.clock(ctx(LA))).today).toBe('2026-10-01');
    vi.setSystemTime(new Date('2026-10-02T02:30:00Z'));
  });

  it("the board's default date and its zone label follow the branch", async () => {
    vi.setSystemTime(new Date('2026-10-02T05:30:00Z'));
    expect((await repo.query(ctx(LA), {} as any)).dateRange).toMatchObject({ from: '2026-10-01', timezone: 'America/Los_Angeles' });
    expect((await repo.query(ctx(NJ), {} as any)).dateRange).toMatchObject({ from: '2026-10-02', timezone: 'America/New_York' });
    vi.setSystemTime(new Date('2026-10-02T02:30:00Z'));
  });
});
