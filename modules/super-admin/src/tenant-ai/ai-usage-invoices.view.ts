// ai-usage-invoices.view.ts — Four-Module Completion Guide (Oct 30 2026) §11 / AI-01: the read side of the invoice ledger
// for POS → AI Usage & Limits. Pure shaping of rows read by AiUsageScreenRepository (tenant-scoped SQL lives there).
// Five figures are kept APART and never substituted for one another:
//   Recurring subscription price   the configured plan price (not necessarily charged)
//   Estimated current-period cost  an estimate, returned with its labelled assumptions
//   Finalized invoiced amount      sum of the provider totals of FINALIZED (open / finalized / paid / uncollectible) invoices
//   Paid                           confirmed payments recorded on those invoices (refunds listed separately)
//   Outstanding                    the provider's amount due of finalized invoices
// A finalized invoice may exist before any payment. Tax is the provider's figure or Pending (draft) / Unknown — never 0 by
// default. Invoice number / date / period / status / reference appear only when an invoice record exists.
import { taxState } from '@aipowersalon/ai';
import { dateColumnYmd } from '@aipowersalon/date-time';

export interface InvoiceView {
  id: string; provider: string; number: string | null; reference: string | null; status: string; finalized: boolean; currency: string;
  date: string | null; periodStart: string | null; periodEnd: string | null;
  subtotalCents: number | null; prorationCents: number; taxCents: number | null; taxState: 'provided' | 'pending' | 'unknown';
  discountCents: number; creditCents: number; totalCents: number | null; paidCents: number; refundedCents: number; dueCents: number | null;
  packageCodes: string[]; lines: { kind: string; description: string | null; amountCents: number; packageCode: string | null }[];
  providerUpdatedAt: string | null; recordedAt: string | null; source: string;
}
const n = (v: unknown) => (v == null ? null : Number(v));
const d = (v: unknown) => dateColumnYmd(v);   // invoice_date / period_start / period_end are DATE columns
const t = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

export function invoiceViewOf(r: any): InvoiceView {
  type LineRow = { kind: unknown; description?: string | null; amount_cents: unknown; package_code?: string | null };
  const lines: LineRow[] = typeof r.lines === 'string' ? JSON.parse(r.lines) : r.lines ?? [];
  const status = String(r.status);
  const codes = [...new Set([r.package_code, ...lines.map((l) => l.package_code)].filter((c): c is string => !!c))];
  return {
    id: String(r.id), provider: String(r.provider), number: r.invoice_number ?? null, reference: r.reference ?? null, status,
    finalized: status !== 'draft' && status !== 'void', currency: String(r.currency ?? 'USD'),
    date: d(r.invoice_date), periodStart: d(r.period_start), periodEnd: d(r.period_end),
    subtotalCents: n(r.subtotal_cents), prorationCents: Number(r.proration_cents ?? 0), taxCents: n(r.tax_cents), taxState: taxState(status, n(r.tax_cents)),
    discountCents: Number(r.discount_cents ?? 0), creditCents: Number(r.credit_cents ?? 0), totalCents: n(r.total_cents),
    paidCents: Number(r.amount_paid_cents ?? 0), refundedCents: Number(r.amount_refunded_cents ?? 0), dueCents: n(r.amount_due_cents),
    packageCodes: codes, lines: lines.map((l) => ({ kind: String(l.kind), description: l.description ?? null, amountCents: Number(l.amount_cents), packageCode: l.package_code ?? null })),
    providerUpdatedAt: t(r.provider_updated_at), recordedAt: t(r.updated_at), source: String(r.source),
  };
}

export interface InvoicedAmounts {
  invoices: number; finalizedInvoices: number; draftInvoices: number;
  /** null = no finalized invoice exists for the window (shown "No finalized invoice yet", never $0) */
  finalizedCents: number | null; finalizedTotalUnknown: boolean;
  paidCents: number; refundedCents: number; outstandingCents: number | null;
  taxCents: number | null; taxState: 'provided' | 'pending' | 'unknown' | 'none';
  prorationCents: number; discountsAndCreditsCents: number;
}
/** Pure: the invoiced figures of a set of invoices (void ones excluded from every amount). */
export function invoicedAmounts(list: InvoiceView[]): InvoicedAmounts {
  const live = list.filter((i) => i.status !== 'void');
  const fin = live.filter((i) => i.finalized);
  const sum = (xs: InvoiceView[], f: (i: InvoiceView) => number | null) => xs.reduce((a, i) => a + (f(i) ?? 0), 0);
  const taxUnknown = fin.some((i) => i.taxCents == null);
  return {
    invoices: live.length, finalizedInvoices: fin.length, draftInvoices: live.length - fin.length,
    finalizedCents: fin.length ? sum(fin, (i) => i.totalCents) : null, finalizedTotalUnknown: fin.some((i) => i.totalCents == null),
    paidCents: sum(fin, (i) => i.paidCents), refundedCents: sum(fin, (i) => i.refundedCents),
    outstandingCents: fin.length ? sum(fin, (i) => i.dueCents) : null,
    taxCents: fin.length && !taxUnknown ? sum(fin, (i) => i.taxCents) : null,
    taxState: fin.length ? (taxUnknown ? 'unknown' : 'provided') : live.length ? 'pending' : 'none',
    prorationCents: sum(fin, (i) => i.prorationCents), discountsAndCreditsCents: sum(fin, (i) => i.discountCents + i.creditCents),
  };
}
/** Pure: does an invoice belong to a billing period that started on `periodStart` (YYYY-MM-DD)? */
export const inPeriodFrom = (i: InvoiceView, periodStart: string | null) => !periodStart || (i.periodEnd ?? i.date ?? '9999') >= periodStart;

export const ESTIMATE_ASSUMPTIONS = ['subscription_prices', 'yearly_monthly_equivalent', 'overage_estimate_if_enabled', 'excludes_tax_proration_discounts'] as const;
