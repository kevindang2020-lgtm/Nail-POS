// loyalty-points.consumer.ts — Constitution 8 §25 / §74 / §101–102: loyalty points as a FINANCIAL-pattern consumer.
//
// Business rule reused, not invented: skip-line-checkout awards 1 point per whole dollar paid. That path is inline
// and unguarded (call it twice, award twice). This consumer makes earning durable and exactly-once on the effect:
//   processed_events            → this (consumer, event) runs at most once     (delivery idempotency, §23)
//   loyalty_point_earnings      → this PAYMENT earns at most once, ever       (business idempotency, §25 / §102)
// so a redelivery, a replay, or a second producer emitting the same payment all collapse to one award.
// §14: the ticket is loaded tenant-scoped; a ticket that belongs to another tenant is a SECURITY failure.
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS, OutboxWriter, createDomainEvent } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { applyLoyaltyEntry } from '@aipowersalon/customers';

export const POINTS_PER_DOLLAR = 1;   // the existing skip-line rule; a configurable rate belongs in loyalty_platform_config later
export const pointsFor = (amountCents: number) => Math.floor(Math.max(0, amountCents) / 100) * POINTS_PER_DOLLAR;

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
    if (!ticketId || e.payload?.status !== 'approved') return;

    // §14: load through the tenant; a mismatch is a security event, not a retry
    const ticket = await trx.selectFrom('tickets').select(['tenant_id', 'branch_id', 'customer_id']).where('id', '=', ticketId).executeTakeFirst();
    if (!ticket) return;                                                              // ticket gone → nothing to award (§56 revalidate)
    if (String(ticket.tenant_id) !== tenantId) throw new TenantMismatchError(`ticket ${ticketId} belongs to another tenant`);
    if (!ticket.customer_id) return;                                                  // walk-in with no customer record earns nothing

    const points = pointsFor(amountCents);
    if (points <= 0) return;

    // §25/§102: the ledger row IS the business guard. ON CONFLICT DO NOTHING + RETURNING tells us if WE inserted it.
    const inserted = await sql<{ id: string }>`
      INSERT INTO loyalty_point_earnings (tenant_id, branch_id, customer_id, payment_id, ticket_id, amount_cents, points, event_id)
      VALUES (${tenantId}, ${ticket.branch_id ?? null}, ${ticket.customer_id}, ${paymentId}, ${ticketId}, ${amountCents}, ${points}, ${e.eventId})
      ON CONFLICT (tenant_id, payment_id) DO NOTHING
      RETURNING id`.execute(trx);
    if (!inserted.rows.length) return;                                                // already earned by an earlier delivery/replay/producer

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
