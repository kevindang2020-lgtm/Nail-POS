// owner-attendance-salon-day.pgtest — Oct 20 2026: the Owner app's "scheduled today" counted on New York's day for EVERY salon.
// attendanceSnapshot read `ctx.branchId`, which an owner context does not have (the Owner app is salon-wide), so the branch
// time-zone lookup always fell back to the default. Found by the verify-owner-staff harness when the final run crossed
// midnight UTC (8 pm Eastern). Now: the branch being looked at (the filter) → its zone; no filter → the salon's zone.
// The clock is pinned to 01:00 UTC on Oct 21 — 9 pm on Oct 20 in New York, 10 am on Oct 21 in Tokyo.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyOwnerRepository } from './owner.kysely.repository';

const uuid = (p: string, n: number) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = uuid('a3010000', 1), TOKYO = uuid('b3010000', 1), NYC = uuid('b3010000', 2), TECH = uuid('c3010000', 1), TECH2 = uuid('c3010000', 2), TECH3 = uuid('c3010000', 3);
const owner: any = { tenantId: T, userId: uuid('d3010000', 1), role: 'OWNER', permissions: [] };
let pg: any; let repo: KyselyOwnerRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  repo = new KyselyOwnerRepository(kyselyFor(pg) as never);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Tokyo Nails','Tokyo Nails','tokyo-nails','TKYN','active')`, [T]);
  // the salon's main location is in Tokyo (first active branch); a second branch is in New York
  await q(`insert into branches (id, tenant_id, name, status, timezone, created_at) values ($1,$2,'Ginza','active','Asia/Tokyo', now() - interval '2 days'), ($3,$2,'Manhattan','active','America/New_York', now() - interval '1 day')`, [TOKYO, T, NYC]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Aki','X','Aki X'), ($4,$2,$5,'Bea','Y','Bea Y'), ($6,$2,$3,'Chie','Z','Chie Z')`, [TECH, T, TOKYO, TECH2, NYC, TECH3]);
  // Ginza's two shifts are on ITS today (Oct 21); Manhattan's one on ITS today (Oct 20) — so the two days count differently
  await q(`insert into technician_shifts (id, tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values
    (gen_random_uuid(), $1, $2, $3, '2026-10-21', '2026-10-21T00:00:00Z', '2026-10-21T08:00:00Z', 'scheduled'),
    (gen_random_uuid(), $1, $2, $6, '2026-10-21', '2026-10-21T00:00:00Z', '2026-10-21T08:00:00Z', 'scheduled'),
    (gen_random_uuid(), $1, $4, $5, '2026-10-20', '2026-10-20T13:00:00Z', '2026-10-20T21:00:00Z', 'scheduled')`, [T, TOKYO, TECH, NYC, TECH2, TECH3]);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
  clearBranchTimeZoneCache();
}, 120000);
afterAll(() => { vi.useRealTimers(); clearBranchTimeZoneCache(); });

describe('Owner attendance counts "scheduled today" on the right salon day', () => {
  it('filtered to a branch: that branch\'s day (Ginza → Oct 21, Manhattan → Oct 20)', async () => {
    expect((await repo.attendanceSnapshot(owner, TOKYO)).scheduledToday).toBe(2);
    expect((await repo.attendanceSnapshot(owner, NYC)).scheduledToday).toBe(1);
  });
  it('salon-wide (no filter): the salon\'s own zone — its main location, Tokyo — not New York\'s', async () => {
    expect((await repo.attendanceSnapshot(owner, null)).scheduledToday).toBe(2);   // the two Oct 21 shifts; New York's day would count the one Oct 20 shift
  });
});
