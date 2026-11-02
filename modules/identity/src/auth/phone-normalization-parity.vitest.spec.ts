// phone-normalization-parity.vitest.spec.ts — the phone-normalizer consolidation invariants (Jul 28, 2026).
//
// TWO stored-data families exist, each with ONE normalizer:
//   • STAFF (users.normalized_phone — login, invites, password reset): auth/security.normalizeIdentifier
//   • CUSTOMER (customers / global_customers identity): customer-activation-core.normalizePhone
//     (identity-core.normalizePhoneE164 delegates to it)
//
// Within the staff family, RESET MUST EQUAL LOGIN: a phone that can sign in must be able to password-reset.
// (Before this consolidation, reset used a third, stricter US-only normalizer — a staff member stored with a
// non-US number, or who typed "+"+10 digits, could sign in but never reset.)
//
// ACROSS families, ONE divergence is known and deliberate: "+" followed by exactly 10 digits. Staff treats the
// input as US ("+15551234567"); customer preserves the "+" ("+5551234567"). Each family matches what IT stored,
// so unifying the functions requires re-normalizing stored data — an owner decision. This spec FAILS on any NEW
// drift beyond that single pinned case.
import { describe, it, expect } from 'vitest';
import { normalizeIdentifier } from '@aipowersalon/auth';
import { normalizePhoneE164 } from './password-reset-core';
import { normalizePhone, toStoredCustomerPhone, phoneDigitsMatch } from '@aipowersalon/customers';

const staffPhone = (raw: string): string | null => {
  const r = normalizeIdentifier(raw);
  return r.kind === 'phone' ? r.value : null;
};

const CASES = [
  '5551234567',            // bare US 10-digit
  '(555) 123-4567',        // formatted US
  '+15551234567',          // already E.164 US
  '1-555-123-4567',        // 11 digits leading 1
  '+441234567890',         // international 12-digit
  '441234567890',          // international, no plus
  '+5551234567',           // THE divergent case: "+" + exactly 10 digits
  '5551234',               // 7-digit local
  '123456',                // too short → not a phone
  '1234567890123456',      // too long → not a phone
  'kevin@example.com',     // email → not a phone
  '',                      // empty
];

describe('staff family: password reset uses the SAME normalization as login/invites', () => {
  for (const raw of CASES) {
    it(`reset(${JSON.stringify(raw)}) === login(${JSON.stringify(raw)})`, () => {
      expect(normalizePhoneE164(raw)).toBe(staffPhone(raw));
    });
  }

  it('regression: an international staff phone that can sign in can now password-reset (was null)', () => {
    expect(staffPhone('+441234567890')).toBe('+441234567890');
    expect(normalizePhoneE164('+441234567890')).toBe('+441234567890');
  });

  it('regression: "+"+10-digit input resets against what login actually STORED (was a value matching nothing)', () => {
    // login/invites store "+15551234567" for this input; the old reset normalizer produced "+5551234567".
    expect(normalizePhoneE164('+5551234567')).toBe(staffPhone('+5551234567'));
  });
});

describe('cross-family boundary: exactly ONE known divergence, pinned', () => {
  it('the "+"+10-digit case diverges by design (staff → US; customer preserves the "+")', () => {
    expect(staffPhone('+5551234567')).toBe('+15551234567');
    expect(normalizePhone('+5551234567')).toBe('+5551234567');
  });

  it('every other representative input normalizes identically across the families', () => {
    for (const raw of CASES) {
      if (raw === '+5551234567') continue; // the pinned divergence above
      expect(normalizePhone(raw), `customer(${JSON.stringify(raw)})`).toBe(staffPhone(raw));
    }
  });
});

// ── customers.normalized_phone write semantics (Jul 28, 2026) ───────────────────────────────────────────────
// Five customer-creation sites used to write `.replace(/[^\d+]/g,'')` into the SAME column that activation and the
// identity layer fill with E.164. They now share one writer. Existing rows are NOT rewritten — the original typed
// input is unrecoverable — so readers must stay tolerant, which is what phoneDigitsMatch is for.
describe('customer phone: one write semantic, tolerant reads for legacy rows', () => {
  it('writes E.164 for anything that parses as a phone', () => {
    expect(toStoredCustomerPhone('(555) 123-4567')).toBe('+15551234567');
    expect(toStoredCustomerPhone('555-123-4567')).toBe('+15551234567');
    expect(toStoredCustomerPhone('+15551234567')).toBe('+15551234567');
    expect(toStoredCustomerPhone('+441234567890')).toBe('+441234567890');
  });

  it('matches what the customer identity layer would derive from the same input', () => {
    for (const raw of ['(555) 123-4567', '5551234567', '+441234567890', '1-555-123-4567']) {
      expect(toStoredCustomerPhone(raw), raw).toBe(normalizePhone(raw));
    }
  });

  it('never nulls a number the salon typed: unparseable input keeps the historical strip-only value', () => {
    expect(toStoredCustomerPhone('12345')).toBe('12345');       // too short to be a phone, still kept
    expect(toStoredCustomerPhone('ext. 4')).toBe('4');
    expect(toStoredCustomerPhone('')).toBeNull();
    expect(toStoredCustomerPhone(null)).toBeNull();
  });

  it('legacy rows and new rows both match a tolerant read (this is why writes could change without a rewrite)', () => {
    const legacy = '5551234567';                                 // what the old writer stored
    const current = toStoredCustomerPhone('(555) 123-4567')!;    // what the new writer stores
    expect(current).not.toBe(legacy);                            // the shapes genuinely differ
    expect(phoneDigitsMatch(legacy, current)).toBe(true);        // …and both still resolve to the same customer
    expect(phoneDigitsMatch(current, '+1 (555) 123-4567')).toBe(true);
  });

  it('tolerant matching does not collapse different numbers, or match on too few digits', () => {
    expect(phoneDigitsMatch('+15551234567', '+15559999999')).toBe(false);
    expect(phoneDigitsMatch('123', '123')).toBe(false);          // 3 digits is not an identity
    expect(phoneDigitsMatch(null, null)).toBe(false);
  });
});
