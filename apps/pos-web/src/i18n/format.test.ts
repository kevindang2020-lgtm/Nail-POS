// format.test — Vietnamese POS mandate §44–§48 (WP-B): the language changes words only. Money keeps the salon's currency
// and notation, dates keep the branch's zone; month names follow the language.
import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage, setBusinessTimeZone, resetLocaleForTests } from '@aipowersalon/mobile-sdk/i18n';
import './index';
import { fmtMoney, fmtNumber, fmtDate, fmtTime, tenantCurrency } from './format';
import { statusLabel } from './status-label';
import { errorText } from './error-text';

afterEach(async () => { await setLanguage('en'); resetLocaleForTests(); });

describe('money and numbers never change with the language (§45, §48)', () => {
  it('USD shows the same text in English and Vietnamese', async () => {
    const en = [fmtMoney(123456), fmtMoney(-675), fmtMoney(0), fmtMoney(123456, { whole: true }), fmtNumber(1234567)];
    await setLanguage('vi');
    const vi = [fmtMoney(123456), fmtMoney(-675), fmtMoney(0), fmtMoney(123456, { whole: true }), fmtNumber(1234567)];
    expect(vi).toEqual(en);
    expect(en).toEqual(['$1,234.56', '−$6.75', '$0.00', '$1,235', '1,234,567']);
    expect(tenantCurrency()).toBe('USD');
  });
  it('an unknown amount is a dash, never "$NaN"', () => { expect(fmtMoney(undefined)).toBe('—'); });
});

describe('dates: branch zone always, words by language (§46, §47)', () => {
  it('the clock is the branch\'s in both languages; the month name follows the language', async () => {
    setBusinessTimeZone('America/New_York');
    const at = '2026-10-09T19:05:00Z';                       // 3:05 PM in New Jersey
    expect(fmtTime(at)).toMatch(/^3:05\s?PM$/);
    expect(fmtDate(at)).toBe('Oct 9, 2026');
    await setLanguage('vi');
    expect(fmtTime(at)).toMatch(/15:05|3:05/);               // same instant, same zone
    expect(fmtDate(at)).not.toBe('Oct 9, 2026');             // Vietnamese words
    expect(fmtDate(at)).toMatch(/9/);
    expect(fmtDate(at)).toMatch(/2026/);
  });
});

describe('Phase 0 helper stubs (owned by WP-D1)', () => {
  it('statusLabel: never blank, never a raw key — a humanised code until ns/status has it', () => {
    expect(statusLabel('ticket', 'READY_FOR_CHECKOUT')).toBe('Ready for checkout');
    expect(statusLabel('ticket', null)).toBe('');
  });
  it('errorText: the server message when no translation exists', () => {
    expect(errorText('SOME_UNKNOWN_CODE', null, 'Server said no.')).toBe('Server said no.');
    expect(errorText(null, null, null)).toBe('');
  });
});
