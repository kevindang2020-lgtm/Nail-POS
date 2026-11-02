// loyalty-points.consumer.ts — Constitution 8 §25 / §74 / §101–102: loyalty points as a FINANCIAL-pattern consumer.
//
// Business rule reused, not invented: skip-line-checkout awards 1 point per whole dollar paid. That path is inline
// and unguarded (call it twice, award twice). This consumer makes earning durable and exactly-once on the effect:
//   processed_events            → this (consumer, event) runs at most once     (delivery idempotency, §23)
//   loyalty_point_earnings      → this PAYMENT earns at most once, ever       (business idempotency, §25 / §102)
// so a redelivery, a replay, or a second producer emitting the same payment all collapse to one award.
// §14: the ticket is loaded tenant-scoped; a ticket that belongs to another tenant is a SECURITY failure.
//
// D3 — loyalty basis (Oct 22 2026, Kevin: "use the recommended"; migration 675):
//   • points on EVERY paid tender: a `partial` tender (the cash part of a mobile split, a partial gift-card tender)
//     earns like an `approved` one — before, only the final tender of a split earned;
//   • NO points for buying gift-card value: the ticket's gift-card charge (cards sold on it + reload holds, the same
//     giftCardChargeForTicket every checkout surface uses) is netted off the tenders, first tender first, and recorded
//     per earning as excluded_cents; amount_cents is the ELIGIBLE base, so points = floor(amount_cents / 100) holds;
//   • net of refunds: reverseLoyaltyPoints (checkout) takes back at most what the payment earned (reversed_points).
// An earning row is written for every customer tender (points may be 0 — e.g. a $0.50 tender, or one that only
// bought a gift card): the row IS the record that the tender was judged, so a replay never re-judges it.
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS, OutboxWriter, createDomainEvent } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { applyLoyaltyEntry } from '@aipowersalon/customers';
import { giftCardChargeForTicket } from '@aipowersalon/gift-cards';

export const POINTS_PER_DOLLAR = 1;   // the existing skip-line rule; a configurable rate belongs in loyalty_platform_config later
export const pointsFor = (amountCents: number) => Math.floor(Math.max(0, amountCents) / 100) * POINTS_PER_DOLLAR;
/** Tender statuses that are MONEY PAID (§D3): the last tender of a ticket and every partial one before it. */
export const EARNING_STATUSES: readonly string[] = ['approved', 'partial'];

/** D3: how much of THIS tender bought gift-card value (earns nothing) given the ticket's gift-card charge and what
 *  earlier tenders already covered. Pure; the consumer feeds it the ticket's numbers. */
export function excludedCentsFor(amountCents: number, giftCardChargeCents: number, excludedSoFarCents: number): number {
  const remaining = Math.max(0, Number(giftCardChargeCents || 0) - Math.max(0, Number(excludedSoFarCents || 0)));
  return Math.min(Math.max(0, Number(amountCents || 0)), remaining);
}

/** Tender statuses that never moved money: such a row takes no place in the first-tender-first netting order. Every other
 *  status (approved, partial, captured, completed, settled, succeeded, and the later refunded / voided states of a tender
 *  that DID pay) keeps its place, so a refund or void after the fact never shifts the split of the tenders behind it. */
export const NEVER_PAID_STATUSES: readonly string[] = ['cancelled', 'created', 'declined', 'expired', 'failed', 'not_configured', 'open', 'pending', 'processing', 'requires_action'];

/** How much the ticket's tenders BEFORE this one (payments.created_at, then id) paid — the amount that absorbs the
 *  gift-card charge ahead of this tender. Pure of processing order: the answer is the same whichever event runs first.
 *  A payment row that cannot be found (an event about a tender the payments table does not hold — legacy data, or a
 *  synthetic event) falls back to what the ticket's OTHER earnings already excluded, the pre-M4 rule. */
export async function paidBeforeThisTender(trx: Transaction<DB>, tenantId: string, ticketId: string, paymentId: string): Promise<number> {
  const r = await sql<{ found: boolean; paid_before: number }>`
    WITH me AS (SELECT created_at, id FROM payments WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND id = ${paymentId}::uuid)
    SELECT (SELECT count(*) FROM me) > 0 AS found,
           coalesce((SELECT sum(p.amount_cents)::int FROM payments p, me
                      WHERE p.tenant_id = ${tenantId} AND p.ticket_id = ${ticketId} AND p.id <> me.id AND p.amount_cents > 0
                        AND p.status <> ALL(${NEVER_PAID_STATUSES as string[]}::text[])
                        AND (p.created_at, p.id) < (me.created_at, me.id)), 0) AS paid_before`.execute(trx);
  const row = r.rows[0];
  if (row?.found) return Number(row.paid_before ?? 0);
  const prior = await sql<{ excluded: number }>`SELECT coalesce(sum(excluded_cents), 0)::int AS excluded FROM loyalty_point_earnings
    WHERE tenant_id = ${tenantId} AND ticket_id = ${ticketId} AND payment_id <> ${paymentId}`.execute(trx);
  return Number(prior.rows[0]?.excluded ?? 0);
}

export class LoyaltyPointsConsumer implements EventConsumer {
  readonly name = 'loyalty.points_on_payment';
  readonly eventTypes = [DOMAIN_EVENTS.PAYMENT_CAPTURED] as const;
  readonly critical = true;                    // money-adjacent: 12 retry attempts (§158)
  // §44: safe ONLY because loyalty_point_earnings UNIQUE(tenant_id, payment_id) refuses the second award (§25).
  //         Remove that constraint and this becomes NOT_REPLAYABLE.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const tenantId = e.tenantId!; const paymentId = e.aggregateId;
    const ticketId = String(e.payload?.ticketId ?? '');
    const amountCents = Number(e.payload?.amountCents ?? 0);
    if (!ticketId || !EARNING_STATUSES.includes(String(e.payload?.status ?? '')) || amountCents <= 0) return;

    // §14: load through the tenant; a mismatch is a security event, not a retry
    const ticket = await trx.selectFrom('tickets').select(['tenant_id', 'branch_id', 'customer_id']).where('id', '=', ticketId).executeTakeFirst();
    if (!ticket) return;                                                              // ticket gone → nothing to award (§56 revalidate)
    if (String(ticket.tenant_id) !== tenantId) throw new TenantMismatchError(`ticket ${ticketId} belongs to another tenant`);
    if (!ticket.customer_id) return;                                                  // walk-in with no customer record earns nothing

    // D3: the gift-card value on this ticket earns nothing — netted off the tenders FIRST TENDER FIRST, where "first" is
    // the tender's place in `payments` (created_at, then id), never the order the events happen to be processed in.
    // M4 lanes (Oct 26 2026): two payment.captured events of one ticket are two aggregates (payment ids) and may now be
    // delivered side by side or in either order; netting "in the order judged" made the split — and the points each
    // tender earned, and what a refund of either later takes back — depend on timing (59 vs 60 points). The ticket's
    // advisory lock still serializes the two judgements; what each one concludes no longer depends on who went first.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'loyalty:' + ticketId}))`.execute(trx);
    const gcCharge = await giftCardChargeForTicket(trx, tenantId, ticketId);
    const excluded = excludedCentsFor(amountCents, gcCharge, await paidBeforeThisTender(trx, tenantId, ticketId, paymentId));
    const base = amountCents - excluded;
    const points = pointsFor(base);

    // §25/§102: the ledger row IS the business guard. ON CONFLICT DO NOTHING + RETURNING tells us if WE inserted it.
    const inserted = await sql<{ id: string }>`
      INSERT INTO loyalty_point_earnings (tenant_id, branch_id, customer_id, payment_id, ticket_id, amount_cents, points, event_id, excluded_cents)
      VALUES (${tenantId}, ${ticket.branch_id ?? null}, ${ticket.customer_id}, ${paymentId}, ${ticketId}, ${base}, ${points}, ${e.eventId}, ${excluded})
      ON CONFLICT (tenant_id, payment_id) DO NOTHING
      RETURNING id`.execute(trx);
    if (!inserted.rows.length) return;                                                // already earned by an earlier delivery/replay/producer
    if (points <= 0) return;                                                          // judged (row kept), nothing to credit

    // credit the balance in the SAME transaction, through the ONE loyalty writer (Phase 10): a per-customer lock (two
    // payments for a customer with no profile yet used to create two profiles — SELECT … FOR UPDATE locks nothing that
    // does not exist), the profile inserted if missing, and a loyalty_ledger `earn` row keyed by this payment.
    await applyLoyaltyEntry(trx as any, { tenantId, branchId: ticket.branch_id ?? e.branchId ?? null, customerId: String(ticket.customer_id), entryType: 'earn', delta: points,
      reason: 'Points earned from purchase', sourceTable: 'payments', sourceId: paymentId, actorUserId: null, requestId: e.correlationId ?? null,
      legacyType: 'earn_purchase', legacySource: 'payment.captured' });
    // loyalty.points_earned — recorded ONLY when this consumer's ledger insert landed (a replay, a redelivery, or the
    // skip-line inline award having got there first all returned above), in the SAME transaction as the credit.
    await new OutboxWriter().write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.LOYALTY_POINTS_EARNED, tenantId, branchId: ticket.branch_id ?? e.branchId ?? undefined,
      aggregateType: 'payment', aggregateId: paymentId, actorType: 'worker', causationId: e.eventId, correlationId: e.correlationId,
      payload: { customerId: ticket.customer_id, paymentId, ticketId, points, source: 'payment.captured' } }));
  }
}
