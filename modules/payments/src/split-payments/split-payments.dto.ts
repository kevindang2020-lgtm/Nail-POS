// split-payments.dto.ts — read-only view of split-tender payments: tickets settled with 2+ revenue-bearing
// payment rows (e.g. part cash + part card). Groups existing payment rows by ticket; adds no new data.
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';

export interface SplitPaymentsContext {
  tenantId: string; branchId?: string; userId: string; role: string; permissions: string[];
}

export interface RawPayment {
  id: string; ticketId: string | null; ticketNumber: string | null; customerName: string | null;
  method: string; amountCents: number; status: string; createdAt: string;
}
export interface TenderLine { paymentId: string; method: string; amountCents: number; createdAt: string; }
export interface SplitTicket {
  ticketId: string; ticketNumber: string | null; customerName: string | null;
  totalCents: number; tenderCount: number; methods: string[]; tenders: TenderLine[]; settledAt: string;
}
export interface SplitPaymentsSummary { splitTicketCount: number; totalSplitCents: number; averageTenders: number; }
export interface SplitPaymentsState { kpis: SplitPaymentsSummary; tickets: SplitTicket[]; }

export const isRevenueBearing = (s: string): boolean =>
  (REVENUE_BEARING_STATUSES as readonly string[]).includes((s || '').toLowerCase());

// Group revenue-bearing payments by ticket; a "split" ticket has 2+ tender rows.
export function buildSplitTickets(payments: RawPayment[]): SplitTicket[] {
  const byTicket = new Map<string, RawPayment[]>();
  for (const p of payments) {
    if (!p.ticketId || !isRevenueBearing(p.status)) continue;
    const arr = byTicket.get(p.ticketId) || [];
    arr.push(p); byTicket.set(p.ticketId, arr);
  }
  const tickets: SplitTicket[] = [];
  for (const [ticketId, rows] of byTicket) {
    if (rows.length < 2) continue; // not a split
    const tenders = rows
      .map((r) => ({ paymentId: r.id, method: r.method || 'unknown', amountCents: r.amountCents, createdAt: r.createdAt }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const methods = Array.from(new Set(tenders.map((t) => t.method)));
    tickets.push({
      ticketId,
      ticketNumber: rows.find((r) => r.ticketNumber)?.ticketNumber ?? null,
      customerName: rows.find((r) => r.customerName)?.customerName ?? null,
      totalCents: tenders.reduce((a, t) => a + t.amountCents, 0),
      tenderCount: tenders.length,
      methods,
      tenders,
      settledAt: tenders[tenders.length - 1].createdAt,
    });
  }
  return tickets.sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
}

export function buildSplitSummary(tickets: SplitTicket[]): SplitPaymentsSummary {
  const totalSplitCents = tickets.reduce((a, t) => a + t.totalCents, 0);
  const totalTenders = tickets.reduce((a, t) => a + t.tenderCount, 0);
  return {
    splitTicketCount: tickets.length,
    totalSplitCents,
    averageTenders: tickets.length ? Math.round((totalTenders / tickets.length) * 10) / 10 : 0,
  };
}
