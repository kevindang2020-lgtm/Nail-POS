import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals, nextInvoiceNumber, invoiceSeq, validateNewInvoice, applyCreditToRemaining, BillingValidationError } from './billing-invoice-core';

describe('computeInvoiceTotals', () => {
  it('sums only charge lines and applies discount/credit/tax as integer cents', () => {
    const t = computeInvoiceTotals(
      [{ kind: 'plan', description: 'Premium', quantity: 1, unitPriceCents: 19900 }, { kind: 'addon', description: 'AI', quantity: 2, unitPriceCents: 4900 }],
      { discountCents: 1000, creditCents: 3000, taxCents: 0 },
    );
    expect(t.subtotalCents).toBe(19900 + 9800);
    expect(t.totalCents).toBe(29700 - 1000 - 3000);
    expect(t.amountDueCents).toBe(25700);
  });
  it('clamps total at zero and never goes negative', () => {
    const t = computeInvoiceTotals([{ kind: 'plan', description: 'p', quantity: 1, unitPriceCents: 5000 }], { creditCents: 9000 });
    expect(t.totalCents).toBe(0); expect(t.amountDueCents).toBe(0);
  });
  it('subtracts amountPaid for amountDue', () => {
    const t = computeInvoiceTotals([{ kind: 'plan', description: 'p', quantity: 1, unitPriceCents: 10000 }], { amountPaidCents: 4000 });
    expect(t.amountDueCents).toBe(6000);
  });
});

describe('invoice numbering', () => {
  it('increments and zero-pads', () => {
    expect(nextInvoiceNumber(2026, 311)).toBe('INV-2026-0312');
    expect(nextInvoiceNumber(2026, 0)).toBe('INV-2026-0001');
  });
  it('parses sequence for the year', () => {
    expect(invoiceSeq('INV-2026-0312', 2026)).toBe(312);
    expect(invoiceSeq('INV-2025-0312', 2026)).toBe(0);
  });
});

describe('validateNewInvoice', () => {
  it('requires tenant and at least one valid line', () => {
    expect(() => validateNewInvoice({})).toThrow(BillingValidationError);
    expect(() => validateNewInvoice({ tenantId: 't', lines: [] })).toThrow(BillingValidationError);
    expect(() => validateNewInvoice({ tenantId: 't', lines: [{ description: '', quantity: 1, unitPriceCents: 1 }] })).toThrow(/description/);
    expect(() => validateNewInvoice({ tenantId: 't', lines: [{ description: 'x', quantity: 0, unitPriceCents: 1 }] })).toThrow(/quantity/);
    expect(() => validateNewInvoice({ tenantId: 't', lines: [{ description: 'x', quantity: 1, unitPriceCents: 100 }] })).not.toThrow();
  });
});

describe('applyCreditToRemaining', () => {
  it('reduces remaining and rejects over-apply / non-positive', () => {
    expect(applyCreditToRemaining(5000, 3000)).toBe(2000);
    expect(() => applyCreditToRemaining(5000, 6000)).toThrow(/exceeds/);
    expect(() => applyCreditToRemaining(5000, 0)).toThrow(/positive/);
  });
});
