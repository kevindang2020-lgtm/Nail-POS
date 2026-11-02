// invoice-pdf.ts — the customer invoice as a PDF (Invoices mandate Oct 29 2026 §14: Preview / Print / Download PDF).
// ENGLISH ONLY (customer-facing documents are English — the standing rule). Every figure is the server's: the stored line
// items, discount, tax, total, the posted invoice_payments and the balance. Opened inline it is what Preview / Print show
// (the browser's PDF viewer prints it; the POS opens no print dialog); as an attachment it is the download.
import { PdfWriter, PAGE, money, longDate, wrapText } from '../finance-screens/finance-pdf';

export interface InvoicePdfData {
  salon: { name: string; address: string | null; phone: string | null };
  invoice: { invoiceNumber: string; displayStatus: string; issueDate: string | null; dueDate: string | null; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; paidCents: number; balanceCents: number; notes: string | null; voidReason: string | null;
    customer: { name: string | null; phone: string | null; email: string | null } };
  lines: Array<{ description: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  payments: Array<{ paidOn: string | null; method: string; reference: string | null; amountCents: number }>;
  generatedAt: string;
}
const STATUS: Record<string, string> = { draft: 'DRAFT', sent: 'DUE', overdue: 'OVERDUE', partially_paid: 'PARTIALLY PAID', paid: 'PAID', void: 'VOID' };
const METHOD: Record<string, string> = { cash: 'Cash', check: 'Check', card_external: 'Card (external terminal)', bank_transfer: 'Bank transfer', other: 'Other' };

export function renderInvoicePdf(d: InvoicePdfData): Buffer {
  const pdf = new PdfWriter({ title: `Invoice ${d.invoice.invoiceNumber}`, author: d.salon.name });
  const INK = '#231C15', MUTED = '#6E6457', ACCENT = '#9C7A45', BAND = '#F6F1E8';
  const L = PAGE.m, R = PAGE.w - PAGE.m, W = R - L, bottom = PAGE.h - PAGE.m - 30;
  let y = PAGE.m;

  pdf.text(d.salon.name, L, y, { size: 17, font: 'bold', width: W * 0.6 });
  pdf.text('INVOICE', L + W * 0.6, y + 2, { size: 16, font: 'bold', color: ACCENT, width: W * 0.4, align: 'right' });
  y += 24;
  if (d.salon.address) { pdf.text(d.salon.address, L, y, { size: 9, color: MUTED, width: W * 0.6 }); }
  pdf.text(d.invoice.invoiceNumber, L + W * 0.6, y, { size: 10.5, font: 'bold', width: W * 0.4, align: 'right' });
  y += 13;
  if (d.salon.phone) pdf.text(d.salon.phone, L, y, { size: 9, color: MUTED, width: W * 0.6 });
  pdf.text(STATUS[d.invoice.displayStatus] ?? d.invoice.displayStatus.toUpperCase(), L + W * 0.6, y, { size: 9.5, font: 'bold', color: d.invoice.displayStatus === 'overdue' || d.invoice.displayStatus === 'void' ? '#A23B2A' : ACCENT, width: W * 0.4, align: 'right' });
  y += 20;
  pdf.line(L, y, R, y, { color: ACCENT, width: 1.2 });
  y += 14;

  const half = W / 2;
  pdf.text('BILL TO', L, y, { size: 8, font: 'bold', color: MUTED });
  pdf.text('ISSUED', L + half, y, { size: 8, font: 'bold', color: MUTED, width: half / 2 });
  pdf.text('DUE', L + half + half / 2, y, { size: 8, font: 'bold', color: MUTED, width: half / 2 });
  y += 12;
  pdf.text(d.invoice.customer.name ?? 'Unlinked customer', L, y, { size: 11, font: 'bold', width: half - 12 });
  pdf.text(longDate(d.invoice.issueDate), L + half, y, { size: 10.5, width: half / 2 });
  pdf.text(longDate(d.invoice.dueDate), L + half + half / 2, y, { size: 10.5, width: half / 2 });
  y += 14;
  if (d.invoice.customer.phone) { pdf.text(d.invoice.customer.phone, L, y, { size: 9.5, color: MUTED, width: half - 12 }); y += 12; }
  if (d.invoice.customer.email) { pdf.text(d.invoice.customer.email, L, y, { size: 9.5, color: MUTED, width: half - 12 }); y += 12; }
  y += 14;

  const col = { desc: L + 8, descW: W * 0.52, qty: L + W * 0.55, qtyW: W * 0.1, unit: L + W * 0.66, unitW: W * 0.15, amt: L + W * 0.82, amtW: W * 0.18 - 8 };
  const header = () => {
    pdf.rect(L, y, W, 18, BAND);
    pdf.text('Description', col.desc, y + 5, { size: 8.5, font: 'bold', color: MUTED, width: col.descW });
    pdf.text('Qty', col.qty, y + 5, { size: 8.5, font: 'bold', color: MUTED, width: col.qtyW, align: 'right' });
    pdf.text('Unit price', col.unit, y + 5, { size: 8.5, font: 'bold', color: MUTED, width: col.unitW, align: 'right' });
    pdf.text('Amount', col.amt, y + 5, { size: 8.5, font: 'bold', color: MUTED, width: col.amtW, align: 'right' });
    y += 24;
  };
  header();
  for (const l of d.lines) {
    const wrapped = wrapText(l.description, col.descW, 9.5);
    if (y + 14 * wrapped.length > bottom) { pdf.addPage(); y = PAGE.m; header(); }
    wrapped.forEach((t, i) => pdf.text(t, col.desc, y + i * 12, { size: 9.5, color: INK }));
    pdf.text(String(l.quantity), col.qty, y, { size: 9.5, width: col.qtyW, align: 'right' });
    pdf.text(money(l.unitPriceCents), col.unit, y, { size: 9.5, width: col.unitW, align: 'right' });
    pdf.text(money(l.lineTotalCents), col.amt, y, { size: 9.5, width: col.amtW, align: 'right' });
    y += 12 * wrapped.length + 4;
    pdf.line(L, y - 2, R, y - 2, { width: 0.4 });
  }
  y += 8;

  const totals: Array<[string, string, boolean]> = [['Subtotal', money(d.invoice.subtotalCents), false]];
  if (d.invoice.discountCents) totals.push(['Discount', `-${money(d.invoice.discountCents)}`, false]);
  if (d.invoice.taxCents) totals.push(['Tax', money(d.invoice.taxCents), false]);
  totals.push(['Total', money(d.invoice.totalCents), true]);
  if (d.invoice.paidCents) totals.push(['Paid', `-${money(d.invoice.paidCents)}`, false]);
  totals.push([d.invoice.displayStatus === 'void' ? 'Balance (void)' : 'Balance due', money(d.invoice.balanceCents), true]);
  if (y + 16 * totals.length > bottom) { pdf.addPage(); y = PAGE.m; }
  for (const [k, v, strong] of totals) {
    pdf.text(k, L + W * 0.55, y, { size: strong ? 10.5 : 9.5, font: strong ? 'bold' : 'reg', width: W * 0.25, align: 'right' });
    pdf.text(v, col.amt, y, { size: strong ? 10.5 : 9.5, font: strong ? 'bold' : 'reg', width: col.amtW, align: 'right' });
    y += strong ? 16 : 14;
  }

  if (d.payments.length) {
    y += 10;
    if (y + 20 + 13 * d.payments.length > bottom) { pdf.addPage(); y = PAGE.m; }
    pdf.text('PAYMENTS RECEIVED', L, y, { size: 8, font: 'bold', color: MUTED }); y += 13;
    for (const p of d.payments) {
      pdf.text(`${longDate(p.paidOn)} · ${METHOD[p.method] ?? p.method}${p.reference ? ` · Ref ${p.reference}` : ''}`, L, y, { size: 9, width: W * 0.75 });
      pdf.text(money(p.amountCents), col.amt, y, { size: 9, width: col.amtW, align: 'right' });
      y += 13;
    }
  }
  if (d.invoice.voidReason) { y += 10; pdf.text(`This invoice was voided: ${d.invoice.voidReason}`, L, y, { size: 9, color: '#A23B2A', width: W }); y += 13; }
  if (d.invoice.notes) {
    y += 10;
    if (y + 40 > bottom) { pdf.addPage(); y = PAGE.m; }
    pdf.text('NOTES', L, y, { size: 8, font: 'bold', color: MUTED }); y += 12;
    for (const t of wrapText(d.invoice.notes, W, 9).slice(0, 30)) { if (y > bottom) { pdf.addPage(); y = PAGE.m; } pdf.text(t, L, y, { size: 9, color: INK }); y += 11; }
  }
  pdf.text(`Generated ${d.generatedAt.slice(0, 10)} · ${d.salon.name}`, L, PAGE.h - PAGE.m - 10, { size: 7.5, color: MUTED, width: W });
  return pdf.toBuffer();
}
