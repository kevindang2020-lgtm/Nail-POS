// payroll-ymd.vitest.spec — Nov 3: a DATE read back as UTC midnight (PGlite / drivers without a local-date parser) showed the pay
// period one day early west of UTC (stub "Oct 11 – Oct 17" for Oct 12 – Oct 18). ymdOf reads the day the database stored either way.
import { describe, it, expect } from 'vitest';
import { ymdOf } from './payroll.dto';

describe('ymdOf', () => {
  it('local midnight (node-postgres) and UTC midnight (PGlite) both give the stored day; strings pass through', () => {
    expect(ymdOf(new Date(2026, 9, 12))).toBe('2026-10-12');
    expect(ymdOf(new Date(Date.UTC(2026, 9, 12)))).toBe('2026-10-12');
    expect(ymdOf('2026-10-12')).toBe('2026-10-12');
  });
});
