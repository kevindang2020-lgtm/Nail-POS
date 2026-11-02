// branch-timezone.test.ts — the one branch time-zone lookup: the branch's own zone, a bad value or no branch falls back
// to America/New_York, and it is cached (not a query per request).
import { describe, it, expect, beforeEach } from 'vitest';
import { branchTimeZone, tenantTimeZone, safeZoneName, clearBranchTimeZoneCache, isValidTimeZone, DEFAULT_SALON_TIME_ZONE } from './branch-timezone';

const fakeDb = (tz: unknown) => { const calls = { n: 0 }; const db: any = { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ executeTakeFirst: async () => { calls.n++; return tz === undefined ? undefined : { timezone: tz }; } }) }) }) }) }; return { db, calls }; };
beforeEach(() => clearBranchTimeZoneCache());

describe('branchTimeZone', () => {
  it("uses the branch's zone", async () => { expect(await branchTimeZone(fakeDb('America/Los_Angeles').db, 't', 'b')).toBe('America/Los_Angeles'); });
  it('falls back to New York for a missing, blank or invalid zone, or no branch', async () => {
    for (const v of [undefined, null, '', 'Mars/Olympus']) { clearBranchTimeZoneCache(); expect(await branchTimeZone(fakeDb(v).db, 't', 'b')).toBe(DEFAULT_SALON_TIME_ZONE); }
    expect(await branchTimeZone(fakeDb('America/Chicago').db, 't', null)).toBe(DEFAULT_SALON_TIME_ZONE);
  });
  it('is cached for a few minutes per branch', async () => {
    const { db, calls } = fakeDb('America/Chicago');
    await branchTimeZone(db, 't', 'b', 0); await branchTimeZone(db, 't', 'b', 60_000);
    expect(calls.n).toBe(1);
    await branchTimeZone(db, 't', 'b', 6 * 60_000);
    expect(calls.n).toBe(2);
  });
  it('isValidTimeZone', () => { expect(isValidTimeZone('Asia/Tokyo')).toBe(true); expect(isValidTimeZone('EST5EDT-ish')).toBe(false); });
});

// Oct 6 2026 (Unit 9): a salon-wide zone for counts kept per salon, and a zone name safe to write into SQL text
const fakeBranches = (rows: unknown[] | Error) => { const calls = { n: 0 }; const chain: any = { select: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain, execute: async () => { calls.n++; if (rows instanceof Error) throw rows; return rows; } }; return { db: { selectFrom: () => chain } as any, calls }; };
describe('tenantTimeZone', () => {
  it("is the salon's first branch with a real zone", async () => {
    expect(await tenantTimeZone(fakeBranches([{ timezone: 'Nowhere/Land' }, { timezone: 'America/Denver' }, { timezone: 'America/Chicago' }]).db, 't')).toBe('America/Denver');
  });
  it('falls back to New York with no branch, no valid zone, or a failing query', async () => {
    for (const rows of [[], [{ timezone: null }, { timezone: '' }], new Error('down')]) { clearBranchTimeZoneCache(); expect(await tenantTimeZone(fakeBranches(rows as any).db, 't')).toBe(DEFAULT_SALON_TIME_ZONE); }
    expect(await tenantTimeZone(fakeBranches([{ timezone: 'Asia/Tokyo' }]).db, '')).toBe(DEFAULT_SALON_TIME_ZONE);
  });
  it('is cached apart from any one branch', async () => {
    const { db, calls } = fakeBranches([{ timezone: 'Asia/Tokyo' }]);
    await tenantTimeZone(db, 't', 0); await tenantTimeZone(db, 't', 60_000);
    expect(calls.n).toBe(1);
    expect(await branchTimeZone(fakeDb('America/Chicago').db, 't', 'b')).toBe('America/Chicago');   // a branch lookup is not the salon's
  });
});
describe('safeZoneName', () => {
  it('passes a real zone and nothing else', () => {
    expect(safeZoneName('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(safeZoneName('Etc/GMT+5')).toBe('Etc/GMT+5');
    for (const bad of ["America/New_York'; drop table x; --", 'Mars/Olympus', '', null, 42]) expect(safeZoneName(bad)).toBe(DEFAULT_SALON_TIME_ZONE);
  });
});
