// customer-language — English + Vietnamese POS mandate WP-I (§54–§55): a customer's communication language as staff
// type it becomes 'en' / 'vi'; anything else is refused; the message language is the CUSTOMER's, never the staff's.
import { describe, it, expect } from 'vitest';
import { normalizeCustomerLanguage, customerMessageLanguage } from './language';

describe('customer communication language', () => {
  it('maps the ways staff write Vietnamese / English to the code (accents, case, region, spacing)', () => {
    for (const v of ['vi', 'VI', 'vi-VN', 'vi_vn', 'vn', 'Vietnamese', ' vietnamese ', 'Tiếng Việt', 'tieng viet', 'TIẾNG  VIỆT', 'Viet Nam']) expect(normalizeCustomerLanguage(v)).toBe('vi');
    for (const v of ['en', 'EN', 'en-US', 'English', 'english ', 'Tiếng Anh', 'eng']) expect(normalizeCustomerLanguage(v)).toBe('en');
  });
  it('blank / null = no preference; another language or a mix is not something the salon writes in (undefined → refused)', () => {
    expect(normalizeCustomerLanguage(null)).toBeNull();
    expect(normalizeCustomerLanguage('   ')).toBeNull();
    for (const v of ['Spanish', 'fr', 'Vietnamese / English', 'anh', 42]) expect(normalizeCustomerLanguage(v)).toBeUndefined();
  });
  it("the message language is ALWAYS English (Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans); the stored preference no longer changes it", () => {
    expect(customerMessageLanguage('vi')).toBe('en');
    expect(customerMessageLanguage('en', 'vi')).toBe('en');
    expect(customerMessageLanguage(null, 'vi')).toBe('en');
    expect(customerMessageLanguage('Tiếng Việt', 'vi')).toBe('en');
    expect(customerMessageLanguage(null)).toBe('en');
    expect(customerMessageLanguage('Spanish')).toBe('en');             // never a language without templates
  });
});
