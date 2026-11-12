// REFUNDS & VOIDS extras #03 (Smart Duplicate Warning) — before a cashier confirms a ticket refund, the preview names any
// EARLIER refund on the same ticket that looks like the same refund again (same amount back, same tenders). It is a
// WARNING only: the cashier may still refund (a second, equal partial refund can be genuine). TRUE duplicates — a retry
// of the same request — are already BLOCKED elsewhere (the route's Idempotency-Key, the atomic per-payment refund cap and
// REFUND_PENDING_VERIFICATION while a processor answer is unknown); this never weakens those.
//
// A ticket refund is written as one refund payment row PER TENDER (refundTicket loops the allocations), so rows written
// close together are grouped back into one refund event before comparing amounts.

export interface RefundRowLike { paymentId: string; method: string; amountCents: number; createdAt: string }
export interface EarlierRefundEvent { at: string; amountCents: number; methods: string[]; refundPaymentIds: string[] }

/** Rows written within this many ms of the previous row are parts of one ticket refund (card call first, then cash). */
export const REFUND_EVENT_GAP_MS = 120_000;

export function groupRefundEvents(rows: RefundRowLike[], gapMs = REFUND_EVENT_GAP_MS): EarlierRefundEvent[] {
  const sorted = rows.filter((r) => Number.isFinite(Date.parse(r.createdAt))).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: (EarlierRefundEvent & { last: number })[] = [];
  for (const r of sorted) {
    const t = Date.parse(r.createdAt);
    const cur = out[out.length - 1];
    if (cur && t - cur.last <= gapMs) {
      cur.amountCents += r.amountCents; cur.last = t; cur.refundPaymentIds.push(r.paymentId);
      if (!cur.methods.includes(r.method)) cur.methods.push(r.method);
    } else out.push({ at: r.createdAt, amountCents: r.amountCents, methods: [r.method], refundPaymentIds: [r.paymentId], last: t });
  }
  return out.map(({ last: _last, ...e }) => e);
}

/** Earlier refund events on the ticket that return the SAME amount over the same tender methods as the proposed refund. */
export function possibleDuplicateRefunds(earlier: EarlierRefundEvent[], proposed: { amountCents: number; methods: string[] }): (EarlierRefundEvent & { sameTenders: boolean })[] {
  const want = [...new Set(proposed.methods)].sort().join(',');
  return earlier
    .filter((e) => e.amountCents === proposed.amountCents)
    .map((e) => ({ ...e, sameTenders: [...e.methods].sort().join(',') === want }))
    .reverse();   // newest first
}
