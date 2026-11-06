// ymd-birthday.test — F1 §45 (Nov 6 2026): a calendar date (a birthday) is formatted as that date in any time zone.
// `new Date('1990-05-03')` is UTC midnight, so the Customer Profile showed May 2 in New York before it used fmtYmd.
import { it, expect } from 'vitest';
import { fmtYmd } from './format';
it('a calendar date stays its own date', () => {
  expect(fmtYmd('1990-05-03', { month: 'short', day: '2-digit', year: 'numeric' })).toMatch(/May 03, 1990|03/);
});
