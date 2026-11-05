// billing-invoice-core.ts — pure, side-effect-free money math for software-subscription invoices. All amounts are
// integer cents (never floating point). Totals are computed here on the backend; the client never supplies a total.

export type LineKind = 'plan' | 'addon' | 'usage' | 'fee' | 'discount' | 'credit' | 'tax';
export interface InvoiceLineInput { kind: LineKind; description: string; quantity: number; unitPriceCents: number }

export interface InvoiceTotals {
  subtotalCents: number; discountTotalCents: number; creditTotalCents: number; taxTotalCents: number;
  totalCents: number; amountDueCents: number;
}

const CHARGE_KINDS = new Set<LineKind>(['plan', 'addon', 'usage', 'fee']);

// Sum charge lines (quantity × unit price), then apply discount and credit (both reduce), add tax, clamp at zero.
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  opts: { discountCents?: number; creditCents?: number; taxCents?: number; amountPaidCents?: number } = {},
): InvoiceTotals {
  const discountTotalCents = Math.max(0, Math.round(opts.discountCents ?? 0));
  const creditTotalCents = Math.max(0, Math.round(opts.creditCents ?? 0));
  const taxTotalCents = Math.max(0, Math.round(opts.taxCents ?? 0));
  const amountPaidCents = Math.max(0, Math.round(opts.amountPaidCents ?? 0));
  const subtotalCents = lines
    .filter((l) => CHARGE_KINDS.has(l.kind))
    .reduce((s, l) => s + Math.round(l.quantity) * Math.round(l.unitPriceCents), 0);
  const totalCents = Math.max(0, subtotalCents - discountTotalCents - creditTotalCents + taxTotalCents);
  const amountDueCents = Math.max(0, totalCents - amountPaidCents);
  return { subtotalCents, discountTotalCents, creditTotalCents, taxTotalCents, totalCents, amountDueCents };
}

// INV-YYYY-NNNN. maxSeq is the highest existing sequence for the year (0 if none).
export function nextInvoiceNumber(year: number, maxSeq: number): string {
  return `INV-${year}-${String(Math.max(0, maxSeq) + 1).padStart(4, '0')}`;
}

// Parse the numeric sequence out of an INV-YYYY-NNNN string for a given year, or 0 if it doesn't match.
export function invoiceSeq(invoiceNumber: string, year: number): number {
  const m = new RegExp(`^INV-${year}-(\\d+)$`).exec(invoiceNumber);
  return m ? parseInt(m[1], 10) : 0;
}

export class BillingValidationError extends Error {}

export function validateNewInvoice(input: { tenantId?: unknown; lines?: unknown }): void {
  if (!input.tenantId || typeof input.tenantId !== 'string') throw new BillingValidationError('tenantId is required');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new BillingValidationError('At least one line item is required');
  for (const l of input.lines as any[]) {
    if (!l || typeof l.description !== 'string' || l.description.trim().length < 1) throw new BillingValidationError('Each line needs a description');
    if (!Number.isFinite(l.unitPriceCents) || l.unitPriceCents < 0) throw new BillingValidationError('Line unit price must be a non-negative integer (cents)');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new BillingValidationError('Line quantity must be a positive integer');
  }
}

// Credit application guardrails: positive amount, not exceeding remaining. Returns the new remaining balance.
export function applyCreditToRemaining(remainingCents: number, applyCents: number): number {
  if (!Number.isFinite(applyCents) || applyCents <= 0) throw new BillingValidationError('Credit amount must be positive');
  if (applyCents > remainingCents) throw new BillingValidationError('Credit amount exceeds the remaining balance');
  return remainingCents - Math.round(applyCents);
}
