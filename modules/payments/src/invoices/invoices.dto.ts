// invoices.dto.ts — salon-issued customer invoices. Money is integer cents throughout. Lifecycle:
// draft -> sent -> paid (or void). Pure helpers compute line/invoice totals, the next invoice number,
// and a status summary; the service/repo persist to the invoices + invoice_lines tables (migration 322).

export interface InvoicesContext { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[]; }

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';
export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'paid', 'void'];

export interface InvoiceLineInput { description: string; quantity: number; unitPriceCents: number; }
export interface InvoiceLine { id: string; description: string; quantity: number; unitPriceCents: number; lineTotalCents: number; position: number; }
export interface InvoiceInput { customerId?: string | null; dueDate?: string | null; notes?: string | null; taxCents?: number; lines: InvoiceLineInput[]; }

export interface Invoice {
  id: string; invoiceNumber: string; customerId: string | null; customerName: string | null;
  status: InvoiceStatus; issueDate: string; dueDate: string | null;
  subtotalCents: number; taxCents: number; totalCents: number; notes: string | null;
  lines?: InvoiceLine[]; createdAt: string;
}
export interface InvoicesSummary { total: number; draft: number; sent: number; paid: number; outstandingCents: number; paidCents: number; }
export interface InvoicesState { kpis: InvoicesSummary; invoices: Invoice[]; }

const toInt = (n: any) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? v : 0; };

export function normalizeLines(lines: InvoiceLineInput[]): InvoiceLine[] {
  return (lines || []).filter((l) => l && String(l.description || '').trim() && toInt(l.quantity) > 0).map((l, i) => {
    const quantity = Math.max(1, toInt(l.quantity));
    const unitPriceCents = Math.max(0, toInt(l.unitPriceCents));
    return { id: `line_${i + 1}`, description: String(l.description).trim(), quantity, unitPriceCents, lineTotalCents: quantity * unitPriceCents, position: i };
  });
}
export function computeInvoiceTotals(lines: InvoiceLine[], taxCents = 0): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce((a, l) => a + l.lineTotalCents, 0);
  const tax = Math.max(0, toInt(taxCents));
  return { subtotalCents, taxCents: tax, totalCents: subtotalCents + tax };
}
// Next number as INV-0001, based on the highest existing INV-#### (ignores any non-matching numbers).
export function nextInvoiceNumber(existing: string[]): string {
  let max = 0;
  for (const n of existing || []) { const m = /^INV-(\d+)$/.exec(n || ''); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `INV-${String(max + 1).padStart(4, '0')}`;
}
export function buildInvoicesSummary(invoices: Invoice[]): InvoicesSummary {
  const by = (s: InvoiceStatus) => invoices.filter((i) => i.status === s);
  // legacy /state summary (face value; it has no payment ledger) — the Oct 29 2026 screen reads InvoicesLedgerRepository.summary
  const outstandingCents = invoices.filter((i) => i.status === 'sent').reduce((a, i) => a + i.totalCents, 0);
  const paidCents = by('paid').reduce((a, i) => a + i.totalCents, 0);
  return { total: invoices.length, draft: by('draft').length, sent: by('sent').length, paid: by('paid').length, outstandingCents, paidCents };
}
