// report-tickets.ts — the Sales Report "Ticket Explorer" (SUNMI batch 9 guide 4, Nov 10 2026). Pure.
// One row per PAID ticket of the period (a split tender is one ticket with several payment legs). Each money part stays its
// own figure: sales before discounts, discount, net, tax, tips, surcharge and the charged total (= what the payments
// collected); refunds on the ticket are shown beside it, never netted silently. Services and technicians come from the
// ticket's own service lines (a manicure + pedicure by two technicians shows both, never one ticket total per technician).
import type { Tx } from './reports.repository';
import type { ServiceLineFact } from './service-revenue';

export interface ReportTicketFact {
  ticketId: string; ticketNumber: string | null; occurredAt: string; customerId: string | null; customer: string;
  services: string[]; technicians: string[]; methods: string[];
  salesCents: number; discountCents: number; netCents: number; taxCents: number; tipCents: number; surchargeCents: number;
  chargedCents: number; refundedCents: number; status: 'paid' | 'refunded' | 'partially_refunded';
  /** search only — never sent to the screen */
  phoneDigits?: string;
}

export function ticketFacts(rows: Tx[], facts: { lines: ServiceLineFact[]; ticketNumbers?: Record<string, string | null>; phones?: Record<string, string> }): ReportTicketFact[] {
  const m = new Map<string, ReportTicketFact>();
  for (const r of rows) {
    if (!r.ticketId) continue;
    const t = m.get(r.ticketId) ?? {
      ticketId: r.ticketId, ticketNumber: facts.ticketNumbers?.[r.ticketId] ?? null, occurredAt: r.occurredAt ?? r.at, customerId: r.customerId || null, customer: r.customer || '',
      services: [], technicians: [], methods: [], salesCents: 0, discountCents: 0, netCents: 0, taxCents: 0, tipCents: 0, surchargeCents: 0, chargedCents: 0, refundedCents: 0,
      status: 'paid' as const, phoneDigits: facts.phones?.[r.ticketId] ?? '',
    };
    if (r.status === 'refunded') { t.refundedCents += Math.abs(r.grossCents || 0); m.set(r.ticketId, t); continue; }
    const at = r.occurredAt ?? r.at; if (at < t.occurredAt) t.occurredAt = at;
    t.salesCents += r.salesCents ?? 0; t.discountCents += r.discountCents || 0; t.taxCents += r.taxCents || 0; t.tipCents += r.tipCents || 0;
    t.surchargeCents += r.surchargeCents || 0; t.chargedCents += r.grossCents || 0;
    if (r.paymentMethod && !t.methods.includes(r.paymentMethod)) t.methods.push(r.paymentMethod);
    m.set(r.ticketId, t);
  }
  for (const l of facts.lines) {
    const t = m.get(l.ticketId); if (!t || l.noLines) continue;
    if (l.serviceName && !t.services.includes(l.serviceName)) t.services.push(l.serviceName);
    if (l.technician && !t.technicians.includes(l.technician)) t.technicians.push(l.technician);
  }
  const out = [...m.values()].filter((t) => t.chargedCents > 0 || t.salesCents > 0);   // a refund-only row of an older ticket is not a sale of this period
  for (const t of out) {
    t.netCents = t.salesCents - t.discountCents;
    t.status = t.refundedCents <= 0 ? 'paid' : t.refundedCents >= t.chargedCents ? 'refunded' : 'partially_refunded';
  }
  return out;
}
