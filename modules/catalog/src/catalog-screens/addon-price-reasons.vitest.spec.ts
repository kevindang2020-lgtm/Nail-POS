import { describe, it, expect } from 'vitest';
import { addOnPriceReasons } from './catalog-screens.repository';

describe('addOnPriceReasons (ADD-ONS 14)', () => {
  it('a line charged at its quoted menu price has only the tax note', () => {
    expect(addOnPriceReasons({ line_total_cents: 1000, price_cents_snapshot: 1000, quantity: 1, is_taxable: true, menu_cents: 1000, menu_rows: 3 }))
      .toEqual({ quantity: 1, quotedCents: 1000, menuPriceCents: 1000, priceReasons: ['tax_on_ticket'] });
  });
  it('names an override up or down, a quantity, and a menu price changed since', () => {
    expect(addOnPriceReasons({ line_total_cents: 1800, price_cents_snapshot: 1000, quantity: 2, is_taxable: false, menu_cents: 1200, menu_rows: 1 }).priceReasons)
      .toEqual(['quantity', 'line_reduced', 'menu_price_changed']);
    expect(addOnPriceReasons({ line_total_cents: 1200, price_cents_snapshot: 1000, quantity: 1, is_taxable: false, menu_cents: 1000, menu_rows: 1 }).priceReasons).toEqual(['line_increased']);
  });
  it('says when there is no single default price instead of inventing one', () => {
    expect(addOnPriceReasons({ line_total_cents: 1000, price_cents_snapshot: 1000, quantity: 1, is_taxable: false, menu_cents: null, menu_rows: 4 }).priceReasons).toEqual(['price_varies_by_service']);
    expect(addOnPriceReasons({ line_total_cents: 1000, price_cents_snapshot: null, quantity: 1, is_taxable: false, menu_cents: null, menu_rows: 0 })).toMatchObject({ quotedCents: null, priceReasons: ['no_active_menu_price'] });
  });
});
