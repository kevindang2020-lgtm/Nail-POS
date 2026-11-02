// owner-payroll-dates — the Owner app's payroll periods carry 'YYYY-MM-DD' dates (wave 4 PILOT, Oct 13 2026).
// Found by live-pilot-day.mjs: GET /owner/payroll answered periodStart "Thu Oct 15 2026 00:00:00 GMT+0000 (Coordinated
// Universal Time)". node-postgres parses a DATE column into a JS Date at local midnight and mapPeriod did String(date).
// The Tech App (payroll-self, ymdOf) already read the local parts; the owner's read did not.
import { describe, it, expect } from 'vitest';
import { KyselyOwnerRepository } from './owner.kysely.repository';

const row = (start: unknown, end: unknown) => ({ id: 'p1', branch_id: null, label: 'Week', period_start: start, period_end: end, status: 'paid', finalized_at: null, paid_at: null, total_payable_cents: 1, total_commission_cents: 1, total_tips_cents: 0 });

describe('owner payroll period dates', () => {
  const repo: any = new KyselyOwnerRepository({} as never);
  it('a pg DATE (JS Date at local midnight) maps to its calendar day, not Date#toString', () => {
    const p = repo.mapPeriod(row(new Date(2026, 9, 15), new Date(2026, 9, 21)));
    expect(p.periodStart).toBe('2026-10-15');
    expect(p.periodEnd).toBe('2026-10-21');
  });
  it('a string date is kept as its first ten characters', () => {
    expect(repo.mapPeriod(row('2026-10-15', '2026-10-21T00:00:00Z')).periodEnd).toBe('2026-10-21');
  });
});
