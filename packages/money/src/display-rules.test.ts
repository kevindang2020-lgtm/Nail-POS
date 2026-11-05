// The Phase 13 display rules must print EXACTLY what the apps' local formatters printed (byte-for-byte), so each case
// is checked against the replaced one-liner itself.
import { describe, it, expect } from 'vitest';
import { centsToUsd, centsToUsdWhole, centsToUsdFixed, centsToUsdLoose, formatCurrency } from './index';

const CASES = [0, 1, 99, 100, 150, 12345, 123456789, -500, -12345, 50, 1999];
describe('mobile display rules are byte-identical to the replaced local formatters', () => {
  it('centsToUsdWhole ≡ customer appt/home money()', () => {
    for (const c of CASES) expect(centsToUsdWhole(c)).toBe('$' + Math.round((c || 0) / 100).toLocaleString('en-US'));
    expect(centsToUsdWhole(undefined)).toBe('$0');
  });
  it('centsToUsd ≡ the 2-decimal grouped money() (deals, invoices, receipts, cash screens)', () => {
    // wave 4 pilot: a negative amount is now written sign-first ("−$5.00", U+2212) — the old "$-5.00" was the defect
    for (const c of CASES) expect(centsToUsd(c)).toBe((c < 0 ? '−$' : '$') + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  });
  it('centsToUsdFixed ≡ `$${(c / 100).toFixed(2)}`', () => { for (const c of CASES) expect(centsToUsdFixed(c)).toBe(`$${(c / 100).toFixed(2)}`); });
  it('centsToUsdLoose ≡ `$${(c / 100).toLocaleString("en-US")}`', () => { for (const c of CASES) expect(centsToUsdLoose(c)).toBe(`$${(c / 100).toLocaleString('en-US')}`); });
  it('formatCurrency ≡ the Intl currency money() variants', () => {
    for (const c of CASES) {
      expect(formatCurrency(c)).toBe(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100));
      expect(formatCurrency(c, { fractionDigits: 0 })).toBe(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100));
      expect(formatCurrency(c, { fractionDigits: 2 })).toBe(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((c || 0) / 100));
    }
    expect(formatCurrency(-12345)).toBe('-$123.45');
    expect(centsToUsd(-12345)).toBe('−$123.45');   // sign before the symbol (U+2212 minus), never "$-123.45" (wave 4 pilot)
  });
});
