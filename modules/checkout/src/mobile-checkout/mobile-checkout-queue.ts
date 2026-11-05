// mobile-checkout-queue.ts — pure mapping from the canonical POS checkout ticket rows to the Owner & Manager Payment
// App queue rows (the first reference screen). No I/O, no second query: the rows come straight from
// CheckoutService.getState().tickets, so the app and the POS read the SAME tickets by construction.
//
// Source row (POSCheckoutTicketRow) carries the real service-names summary (servicesLabel), the authoritative
// totalDueCents, and the canonical TicketStatus — all surfaced honestly. Paid tickets are excluded from the active
// queue by default (a paid ticket leaves the queue), matching the reference behaviour.

import type { MobileQueueResult, MobileQueueRow, MobileQueueStatus } from '@aipowersalon/api-contracts/tenant';
export type { MobileQueueResult, MobileQueueRow, MobileQueueStatus };   // owned by packages/api-contracts (Constitution 13 §13)
import type { POSCheckoutTicketRow, TicketStatus } from '../checkout/checkout.dto';

export type MobileQueueSort = 'oldest' | 'newest' | 'amount_desc' | 'customer';
export type MobileQueueFilter = 'all' | 'ready' | 'in_progress' | 'failed' | 'paid';



/** Mask a phone to its last 4 (e.g. "(•••) •••-4567"). Never returns the full number. */
export function maskPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '•••';
  return `(•••) •••-${digits.slice(-4)}`;
}

export function mapTicketStatus(s: TicketStatus): MobileQueueStatus {
  switch (s) {
    case 'payment_in_progress':
    case 'sent_to_customer_display': return 'payment_in_progress';
    case 'failed': return 'payment_failed';
    case 'paid': return 'paid';
    case 'reopened':
    case 'ready_for_payment':
    default: return 'ready_for_payment';
  }
}

function matchesFilter(s: MobileQueueStatus, f: MobileQueueFilter): boolean {
  switch (f) {
    case 'all': return s !== 'paid';          // active queue excludes paid by default
    case 'ready': return s === 'ready_for_payment';
    case 'in_progress': return s === 'payment_in_progress';
    case 'failed': return s === 'payment_failed';
    case 'paid': return s === 'paid';
    default: return s !== 'paid';
  }
}

function readyAtOf(r: POSCheckoutTicketRow): string {
  return r.finishedAt || r.completedAt || '';
}

function searchRows(rows: POSCheckoutTicketRow[], q: string): POSCheckoutTicketRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) =>
    (r.ticketNumber || '').toLowerCase().includes(s) ||
    (r.customerName || '').toLowerCase().includes(s) ||
    (r.customerPhone || '').toLowerCase().includes(s) ||
    (r.primaryTechnicianName || '').toLowerCase().includes(s) ||
    (r.servicesLabel || '').toLowerCase().includes(s),
  );
}

function sortRows(rows: POSCheckoutTicketRow[], sort: MobileQueueSort): POSCheckoutTicketRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'newest': return copy.sort((a, b) => readyAtOf(b).localeCompare(readyAtOf(a)));
    case 'amount_desc': return copy.sort((a, b) => (b.totalDueCents || 0) - (a.totalDueCents || 0));
    case 'customer': return copy.sort((a, b) => (a.customerName || '').localeCompare(b.customerName || ''));
    case 'oldest':
    default: return copy.sort((a, b) => readyAtOf(a).localeCompare(readyAtOf(b)));
  }
}

export interface MobileQueueOpts { search?: string; status?: MobileQueueFilter; sort?: MobileQueueSort; }

/** Filter → search → sort → map. Pure. */
export function mapMobileQueue(rows: POSCheckoutTicketRow[], opts: MobileQueueOpts = {}, now: Date = new Date()): MobileQueueResult {
  const searched = opts.search ? searchRows(rows, opts.search) : rows;
  const sorted = sortRows(searched, opts.sort ?? 'oldest');
  const items = sorted
    .map((r) => ({ row: r, status: mapTicketStatus(r.status) }))
    .filter(({ status }) => matchesFilter(status, opts.status ?? 'all'))
    .map(({ row, status }): MobileQueueRow => ({
      ticketId: row.ticketId,
      ticketNumber: row.ticketNumber,
      readyAt: readyAtOf(row),
      customerName: row.customerName,
      customerPhoneMasked: maskPhone(row.customerPhone),
      isVip: !!row.isVip,
      stationLabel: row.station,
      serviceCount: row.serviceCount,
      servicesLabel: row.servicesLabel,
      technicianName: row.primaryTechnicianName,
      totalDueCents: row.totalDueCents,
      status,
    }));
  return { items, count: items.length, generatedAt: now.toISOString() };
}
