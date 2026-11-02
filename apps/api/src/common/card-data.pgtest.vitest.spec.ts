// card-data.pgtest — Constitution 12 §84–86: no column may store a card number, CVV or magnetic-stripe data. EVER.
//
// Phase 11 verified the schema clean ONCE. A one-time check protects nothing: the next migration adding a `cvv` or
// `card_number` column would pass every other gate. This fails the build instead.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

let cols: Array<{ table_name: string; column_name: string }> = [];
beforeAll(async () => {
  const pg = await migratedPglite();
  cols = (await pg.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows;
});
// Reviewed exceptions — each is NOT payment-card data, and says why:
const ALLOWED = new Set([
  'gift_cards.card_number',          // a salon GIFT card's own number (not a payment card); dead column — writers store only the hash + last4
  'gift_cards.card_number_hash',     // hash of the gift card number
  'gift_cards.card_number_last4',    // last four only
  'gift_card_stock.card_number_hash',  // PHYSICAL salon gift-card stock — hashed number, not a payment card
  'gift_card_stock.card_number_last4', // its last four
]);
const FORBIDDEN = /(^|_)(cvv2?|cvc2?|cid|security_code|card_verification|track_?[12]?_?data|magstripe|mag_stripe|full_card|pan|primary_account_number|card_number)($|_)/i;

describe('§84–86 no payment-card data column exists', () => {
  it('scans a real, fully migrated schema (so the check cannot pass on an empty one)', () => expect(cols.length).toBeGreaterThan(1000));
  it('no column named like a card number, CVV or stripe data — outside the reviewed exceptions', () => {
    const hits = cols.map((c) => `${c.table_name}.${c.column_name}`).filter((k) => FORBIDDEN.test(k.split('.')[1]) && !ALLOWED.has(k));
    expect(hits, `card-data column(s) found — store a processor TOKEN, never the card:\n${hits.join('\n')}`).toEqual([]);
  });
  it('stored cards are tokens: hardware payment methods hold a gateway token, brand and last4 only', () => {
    const hpm = cols.filter((c) => c.table_name === 'hardware_payment_methods').map((c) => c.column_name);
    expect(hpm).toContain('gateway_payment_method_token'); expect(hpm).toContain('last4');
    expect(hpm.some((c) => FORBIDDEN.test(c))).toBe(false);
  });
});
