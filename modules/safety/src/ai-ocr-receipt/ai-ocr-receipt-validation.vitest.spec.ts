// ai-ocr-receipt-validation.vitest.spec.ts — financial validation. Never mutates extracted values, never auto-posts
// (requiresHumanReview is always true), flags mismatches, and blocks posting on hard errors until a person fixes them.
import { describe, it, expect } from 'vitest';
import { buildValidationReport, reconcileDocument, rollupConfidence, confidenceState, requiredFieldsFor, type DocumentFinancials } from './ai-ocr-receipt-validation';

const base = (o: Partial<DocumentFinancials> = {}): DocumentFinancials => ({ type: 'invoice', vendor: 'Acme', documentDate: '2025-03-04', dateAmbiguous: false, subtotalCents: 1000, taxCents: 80, feesCents: 0, discountCents: 0, totalCents: 1080, isCreditOrRefund: false, lineItems: [{ lineTotalCents: 600 }, { lineTotalCents: 400 }], fieldConfidences: [0.9, 0.92, 0.88], ...o });

describe('validation report', () => {
  it('passes a clean document but still requires human review', () => {
    const r = buildValidationReport(base());
    expect(r.status).toBe('valid');
    expect(r.flags).toHaveLength(0);
    expect(r.blocksPosting).toBe(false);
    expect(r.requiresHumanReview).toBe(true);
    expect(r.reviewPriority).toBe('low');
  });
  it('flags mismatches without mutating values', () => {
    const doc = base({ lineItems: [{ lineTotalCents: 600 }, { lineTotalCents: 300 }] });
    const r = buildValidationReport(doc);
    expect(r.flags).toContain('LINE_SUM_MISMATCH');
    expect(doc.subtotalCents).toBe(1000); // untouched
    expect(buildValidationReport(base({ totalCents: 1200 }))).toMatchObject({ reviewPriority: 'high' });
  });
  it('blocks on missing required fields', () => {
    expect(buildValidationReport(base({ totalCents: null }))).toMatchObject({ status: 'blocked', blocksPosting: true });
    expect(buildValidationReport(base({ vendor: null })).flags).toContain('MISSING_REQUIRED_FIELD');
  });
  it('flags ambiguity, bad signs, implausible tax, low confidence', () => {
    expect(buildValidationReport(base({ dateAmbiguous: true })).flags).toContain('DATE_AMBIGUOUS');
    expect(buildValidationReport(base({ type: 'receipt', totalCents: 0, subtotalCents: 0 })).flags).toContain('NON_POSITIVE_TOTAL');
    expect(buildValidationReport(base({ type: 'refund_receipt', isCreditOrRefund: true, totalCents: -500, subtotalCents: -500, taxCents: 0 })).flags).not.toContain('NON_POSITIVE_TOTAL');
    expect(buildValidationReport(base({ taxCents: 500, totalCents: 1500 })).flags).toContain('TAX_IMPLAUSIBLE');
    expect(buildValidationReport(base({ fieldConfidences: [0.3, 0.4, 0.5] })).flags).toContain('LOW_CONFIDENCE');
  });
});

describe('helpers', () => {
  it('reconcileDocument is pure and confidence weights the weakest field', () => {
    const d = base(); const before = JSON.stringify(d); reconcileDocument(d); expect(JSON.stringify(d)).toBe(before);
    expect(rollupConfidence([0.2, 0.9, 0.9])).toBeLessThan(rollupConfidence([0.7, 0.9, 0.9]));
    expect(confidenceState(0.9, true)).toBe('high');
    expect(confidenceState(0, false)).toBe('missing');
    expect(requiredFieldsFor('packing_slip')).not.toContain('totalCents');
  });
});
