// ai-ocr-receipt-validation.ts — PURE document-level financial validation. It RECONCILES (line items ↔ subtotal, and
// subtotal + tax + fees − discount ↔ total) within tolerance, rolls up confidence, and flags issues. Two hard rules:
//   1. It NEVER mutates extracted values — a mismatch is flagged for a human, never silently "corrected" to force a balance.
//   2. There is NO auto-post. requiresHumanReview is ALWAYS true; validation only sets review PRIORITY and whether hard
//      errors BLOCK posting until a person fixes them. Nothing here finalizes a financial record.
import type { DocumentType, LineItem, ConfidenceState } from './ai-ocr-receipt-core';

export interface DocumentFinancials {
  type: DocumentType;
  vendor: string | null;
  documentDate: string | null;   // ISO or null
  dateAmbiguous: boolean;
  subtotalCents: number | null;
  taxCents: number | null;
  feesCents: number | null;
  discountCents: number | null;
  /** §28 (Oct 27 2026): a tip / gratuity on a restaurant receipt — part of the total */
  tipCents?: number | null;
  totalCents: number | null;
  isCreditOrRefund: boolean;
  lineItems: Pick<LineItem, 'lineTotalCents'>[];
  fieldConfidences: number[];     // 0..1 per extracted field
}

export interface ToleranceRule { absoluteCents: number; relativePct: number; }
export const DEFAULT_TOLERANCE: ToleranceRule = { absoluteCents: 2, relativePct: 0.5 };

export type ValidationFlag =
  | 'LINE_SUM_MISMATCH' | 'TOTAL_MISMATCH' | 'MISSING_TOTAL' | 'NON_POSITIVE_TOTAL' | 'TAX_IMPLAUSIBLE'
  | 'DATE_AMBIGUOUS' | 'MISSING_REQUIRED_FIELD' | 'LOW_CONFIDENCE';

export interface ValidationCheck { name: string; passed: boolean; expectedCents?: number; actualCents?: number; deltaCents?: number; }
export interface ValidationReport {
  status: 'valid' | 'needs_review' | 'blocked';
  checks: ValidationCheck[];
  flags: ValidationFlag[];
  blocksPosting: boolean;          // hard errors a human must fix before posting is possible
  requiresHumanReview: true;       // ALWAYS true — there is no auto-post
  reviewPriority: 'low' | 'normal' | 'high';
  overallConfidence: number;       // 0..1
  missingFields: string[];
}

const within = (expected: number, actual: number, tol: ToleranceRule): boolean => {
  const delta = Math.abs(expected - actual);
  return delta <= tol.absoluteCents || (expected !== 0 && (delta / Math.abs(expected)) * 100 <= tol.relativePct);
};

/** Required fields per document type (for posting readiness). */
export function requiredFieldsFor(type: DocumentType): string[] {
  switch (type) {
    case 'invoice': case 'purchase_order': case 'subscription_invoice': return ['vendor', 'documentDate', 'totalCents'];
    case 'receipt': case 'utility_bill': case 'expense_reimbursement': return ['documentDate', 'totalCents'];
    case 'credit_memo': case 'refund_receipt': return ['documentDate', 'totalCents'];
    case 'packing_slip': case 'inventory_receiving': return ['documentDate'];   // no monetary total required
    default: return ['totalCents'];
  }
}

/** Reconcile a document. PURE — returns checks only, never mutates the input. */
export function reconcileDocument(doc: DocumentFinancials, tol: ToleranceRule = DEFAULT_TOLERANCE): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  // line items ↔ subtotal
  if (doc.lineItems.length && doc.subtotalCents != null && doc.lineItems.every((l) => l.lineTotalCents != null)) {
    const lineSum = doc.lineItems.reduce((n, l) => n + (l.lineTotalCents || 0), 0);
    checks.push({ name: 'line_items_vs_subtotal', passed: within(doc.subtotalCents, lineSum, tol), expectedCents: doc.subtotalCents, actualCents: lineSum, deltaCents: lineSum - doc.subtotalCents });
  }
  // subtotal + tax + fees − discount ↔ total
  if (doc.totalCents != null && doc.subtotalCents != null) {
    const computed = doc.subtotalCents + (doc.taxCents || 0) + (doc.feesCents || 0) + (doc.tipCents || 0) - (doc.discountCents || 0);
    checks.push({ name: 'components_vs_total', passed: within(computed, doc.totalCents, tol), expectedCents: computed, actualCents: doc.totalCents, deltaCents: doc.totalCents - computed });
  } else if (doc.totalCents != null && doc.lineItems.length && doc.lineItems.every((l) => l.lineTotalCents != null)) {
    // §147 (Oct 27 2026): a faded thermal receipt often loses its subtotal line while the items and the total survive —
    // the items + tax + fees − discount are then checked against the total (named line_items_vs_subtotal: it is the line
    // sum that is being tested), instead of letting a receipt whose lines do not add up pass as "nothing to check"
    const lineSum = doc.lineItems.reduce((n, l) => n + (l.lineTotalCents || 0), 0);
    const computed = lineSum + (doc.taxCents || 0) + (doc.feesCents || 0) + (doc.tipCents || 0) - (doc.discountCents || 0);
    checks.push({ name: 'line_items_vs_subtotal', passed: within(doc.totalCents, computed, tol), expectedCents: doc.totalCents, actualCents: computed, deltaCents: computed - doc.totalCents });
  }
  return checks;
}

export function rollupConfidence(fieldConfidences: number[]): number {
  if (!fieldConfidences.length) return 0;
  const min = Math.min(...fieldConfidences);
  const avg = fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length;
  // weight the weakest field heavily — a single low-confidence field should pull the document down
  return Math.round((0.6 * min + 0.4 * avg) * 100) / 100;
}

export interface ValidationOptions { tolerance?: ToleranceRule; highAmountCents?: number; lowConfidenceThreshold?: number; }

/** Build the full validation report. Everything still routes to human review; this only prioritizes + blocks. */
export function buildValidationReport(doc: DocumentFinancials, opts: ValidationOptions = {}): ValidationReport {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const highAmount = opts.highAmountCents ?? 50_000;
  const lowConf = opts.lowConfidenceThreshold ?? 0.6;
  const checks = reconcileDocument(doc, tol);
  const flags: ValidationFlag[] = [];

  for (const c of checks) {
    if (!c.passed && c.name === 'line_items_vs_subtotal') flags.push('LINE_SUM_MISMATCH');
    if (!c.passed && c.name === 'components_vs_total') flags.push('TOTAL_MISMATCH');
  }
  // required fields
  const required = requiredFieldsFor(doc.type);
  const missingFields = required.filter((f) => (doc as any)[f] == null || (doc as any)[f] === '');
  if (missingFields.includes('totalCents')) flags.push('MISSING_TOTAL');
  if (missingFields.some((f) => f !== 'totalCents')) flags.push('MISSING_REQUIRED_FIELD');
  // total sign
  if (doc.totalCents != null && doc.totalCents <= 0 && !doc.isCreditOrRefund) flags.push('NON_POSITIVE_TOTAL');
  // tax plausibility (0–30% of subtotal)
  if (doc.subtotalCents != null && doc.subtotalCents > 0 && doc.taxCents != null && doc.taxCents / doc.subtotalCents > 0.3) flags.push('TAX_IMPLAUSIBLE');
  // ambiguity + confidence
  if (doc.dateAmbiguous) flags.push('DATE_AMBIGUOUS');
  const overallConfidence = rollupConfidence(doc.fieldConfidences);
  if (overallConfidence < lowConf) flags.push('LOW_CONFIDENCE');

  const blockingFlags: ValidationFlag[] = ['MISSING_TOTAL', 'MISSING_REQUIRED_FIELD'];
  const blocksPosting = flags.some((f) => blockingFlags.includes(f));
  const status: ValidationReport['status'] = blocksPosting ? 'blocked' : flags.length ? 'needs_review' : 'valid';
  const bigAmount = (doc.totalCents ?? 0) >= highAmount;
  const reviewPriority: ValidationReport['reviewPriority'] = blocksPosting || flags.includes('TOTAL_MISMATCH') || bigAmount ? 'high' : flags.length ? 'normal' : 'low';

  return { status, checks, flags: [...new Set(flags)], blocksPosting, requiresHumanReview: true, reviewPriority, overallConfidence, missingFields };
}

/** Convenience: map an extracted field's numeric confidence to a state (used by the review UI). */
export function confidenceState(confidence: number, hasValue: boolean, conflicting = false): ConfidenceState {
  if (!hasValue) return 'missing';
  if (conflicting) return 'conflicting';
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}
