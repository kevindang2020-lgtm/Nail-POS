// checkout-board-signals.ts — Checkout One-Screen + Payment Safety mandate (Oct 28 2026) §15–§16, §33–§34, §53: the
// board's money signals, ONE pure rule for the Kysely and the in-memory repositories.
//
//   Pending Payments (§16)      = every tender whose money question is still open in this branch — the SAME sources the
//                                 unsettled-payment guard reads (POS card 'processing', payment_attempts in flight /
//                                 timed out / unknown, an app charge sent and unanswered). Never a frontend spinner count,
//                                 never "declined" payments (it used to fall back to failedPaymentsToday on the screen).
//   Transactions Needing        = UNKNOWN / stuck payments, uncertain refunds, failed receipt deliveries, then the ticket
//   Attention (§34)               states (failed, partial, split). Most severe first. Nothing financial is hidden in logs.
//   Receipt Delivery Rate (§53) = paid tickets today with at least one REAL delivery ('sent', or saved to the app) ÷ paid
//                                 tickets today. A simulated / not-configured channel is not a delivery. null = no paid
//                                 ticket yet (the screen shows "—", not 0 %).
import type { CheckoutAttentionItem } from './checkout.dto';
import type { BranchUnsettledTender, UncertainRefund } from './unsettled-tenders';

/** A tender older than this with no answer is UNKNOWN for the operator (the card may have been charged). */
export const UNKNOWN_AFTER_MS = 90_000;
const UNKNOWN_STATES = new Set(['unknown', 'timed_out', 'reconciliation_required', 'confirmation_pending']);

export interface BoardTicket { ticketId: string; customerName: string; status: string; method?: string | null; finishedAt?: string | null; createdAt?: string | null }
export interface ReceiptOutcome { ticketId: string; channel: string; delivery: string; at: string }
export interface BoardSignalsInput {
  unpaid: BoardTicket[];
  unsettled: BranchUnsettledTender[];
  refunds: UncertainRefund[];
  receiptOutcomes: ReceiptOutcome[];
  paidTicketIdsToday: string[];
  guestOf: (ticketId: string | null | undefined) => string;
  hhmm: (iso?: string | null) => string;
  now?: number;
}
export interface BoardSignals {
  pendingPayments: number;
  attention: CheckoutAttentionItem[];
  receipt: { percent: number | null; delivered: number; eligible: number };
}

const DELIVERED = new Set(['sent', 'saved']);
const NOT_A_FAILURE = new Set(['sent', 'saved', 'simulated', 'not_configured']);
const RANK = { danger: 0, warn: 1, info: 2 } as const;

export function isUnknownTender(t: BranchUnsettledTender, now: number): boolean {
  return UNKNOWN_STATES.has(t.status) || now - Date.parse(t.createdAt) >= UNKNOWN_AFTER_MS;
}

export function boardSignals(i: BoardSignalsInput): BoardSignals {
  const now = i.now ?? Date.now();
  const items: CheckoutAttentionItem[] = [];
  const seen = new Set<string>();
  const add = (it: CheckoutAttentionItem) => { const k = `${it.ticketId ?? ''}|${it.type}`; if (seen.has(k)) return; seen.add(k); items.push(it); };

  // §33: the operator's words for an unresolved tender — never "declined", never "try again"
  for (const t of i.unsettled) {
    const unknown = isUnknownTender(t, now);
    const how = t.kind === 'app_intent' ? 'app payment' : t.method === 'tap_to_pay' ? 'Tap to Pay' : t.kind === 'attempt' ? 'split card' : 'card';
    add(unknown
      ? { type: 'Payment Unknown', label: 'Payment Unknown', guest: i.guestOf(t.ticketId), issue: `Payment status uncertain (${how}) — do not charge again. Verify Payment.`, time: i.hhmm(t.createdAt), ticketId: t.ticketId, severity: 'danger' }
      : { type: 'Payment Processing', label: 'Payment Processing', guest: i.guestOf(t.ticketId), issue: `Payment in progress (${how}) — wait for the answer`, time: i.hhmm(t.createdAt), ticketId: t.ticketId, severity: 'warn' });
  }
  for (const r of i.refunds) {
    add({ type: 'Refund Uncertain', label: 'Refund Uncertain', guest: i.guestOf(r.ticketId), issue: r.stranded ? 'Refund answer lost — verify with the processor before retrying' : 'Refund sent — waiting for the processor', time: i.hhmm(r.createdAt), ticketId: r.ticketId ?? undefined, severity: r.stranded ? 'danger' : 'warn' });
  }

  // §53: per paid ticket, the receipt outcomes of today; failed = an attempt that failed and no delivery that succeeded
  const byTicket = new Map<string, ReceiptOutcome[]>();
  for (const o of i.receiptOutcomes) { const l = byTicket.get(o.ticketId) ?? []; l.push(o); byTicket.set(o.ticketId, l); }
  const paid = [...new Set(i.paidTicketIdsToday)];
  let delivered = 0;
  for (const tid of paid) {
    const outs = byTicket.get(tid) ?? [];
    if (outs.some((o) => DELIVERED.has(o.delivery))) { delivered++; continue; }
    const failed = outs.filter((o) => !NOT_A_FAILURE.has(o.delivery));
    if (failed.length) {
      const last = failed.sort((a, b) => a.at.localeCompare(b.at))[failed.length - 1];
      add({ type: 'Failed Receipt', label: 'Failed Receipt', guest: i.guestOf(tid), issue: `Receipt not delivered by ${last.channel} (${last.delivery}) — the payment stands; resend`, time: i.hhmm(last.at), ticketId: tid, severity: 'warn' });
    }
  }

  // the ticket states the board already knew (unchanged wording)
  for (const t of i.unpaid) {
    const st = String(t.status);
    const isFailed = st === 'failed', isPartial = st === 'partial', isSplit = t.method === 'split' || st === 'split';
    if (!isFailed && !isPartial && !isSplit) continue;
    const type = isFailed ? 'Failed Payment' : isPartial ? 'Partial Payment' : 'Split Payment';
    const issue = isFailed ? 'Payment failed — review before retrying' : isPartial ? 'Balance remaining' : 'Awaiting next payment';
    add({ type, label: type, guest: t.customerName, issue, time: i.hhmm(t.finishedAt || t.createdAt), ticketId: t.ticketId, severity: isFailed ? 'danger' : isPartial ? 'warn' : 'info' });
  }

  items.sort((a, b) => RANK[a.severity ?? 'info'] - RANK[b.severity ?? 'info']);
  return {
    pendingPayments: i.unsettled.length,
    attention: items.slice(0, 25),
    receipt: { percent: paid.length ? Math.round((delivered / paid.length) * 100) : null, delivered, eligible: paid.length },
  };
}
