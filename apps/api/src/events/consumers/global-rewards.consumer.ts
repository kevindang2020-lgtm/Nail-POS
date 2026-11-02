// global-rewards.consumer.ts — the Global Loyalty & Rewards Network's financial consumers (LoyaltyTokens.pdf §6.1–§6.2,
// §8.1; LoyaltyRules.pdf §2.3, §6.1). Durable, exactly-once on the EFFECT:
//   checkout.completed → earnForTicket: one judgement per ticket (reward_earn_transactions UNIQUE(tenant_id, ticket_id)),
//                        funded by the EARNING salon's wallet, resolved at the ticket's own paid time;
//   payment.refunded   → reverseEarnForRefund: the ORIGINAL snapshot, at most once per refund id.
// Separate from the salon's own tenant loyalty (loyalty-points.consumer.ts), which keeps running unchanged: the global
// network never converts or touches those points (guide §9.1). With the network's flags OFF both handlers return
// without writing anything.
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { giftCardChargeForTicket } from '@aipowersalon/gift-cards';
import { withCode } from '@aipowersalon/api-contracts';
import { GlobalRewardsRepository, earnForTicket, reverseEarnForRefund, finalizeForPaidTicket, reverseRedemptionForRefund, GrTenantMismatchError } from '@aipowersalon/loyalty';

export class GlobalRewardsConsumer implements EventConsumer {
  readonly name = 'loyalty.global_rewards';
  readonly eventTypes = [DOMAIN_EVENTS.CHECKOUT_COMPLETED, DOMAIN_EVENTS.PAYMENT_REFUNDED] as const;
  readonly critical = true;   // money: funded points + a token debit (§158: 12 retry attempts)
  // §44: safe ONLY because reward_earn_transactions UNIQUE(tenant_id, ticket_id) and the ledgers' UNIQUE(source, type)
  // refuse a second effect. Remove those constraints and this becomes NOT_REPLAYABLE.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;
  /** the ticket's gift-card charge (value bought earns nothing — D3); injectable so the handler is testable without the query builder */
  constructor(private readonly giftCardCharge: (trx: Transaction<DB>, tenantId: string, ticketId: string) => Promise<number> = giftCardChargeForTicket) {}

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const tenantId = e.tenantId!;
    const repo = new GlobalRewardsRepository(trx);
    try {
      if (e.eventType === DOMAIN_EVENTS.CHECKOUT_COMPLETED) {
        const ticketId = String(e.payload?.ticketId ?? e.aggregateId ?? '');
        if (!ticketId) return;
        // Final Completion guide §04: the paid ticket confirms its held cross-salon reward ONCE (points spent, salon owed) …
        await finalizeForPaidTicket(trx, repo, { tenantId, ticketId, eventId: e.eventId });
        // … and earning on what the customer actually paid (the reward tender itself earns nothing)
        const gc = await this.giftCardCharge(trx, tenantId, ticketId);
        await earnForTicket(trx, repo, { tenantId, ticketId, eventId: e.eventId, giftCardChargeCents: gc });
        return;
      }
      // payment.refunded: which ticket, and how much of it has been refunded so far (this refund included)
      const refundId = String(e.payload?.refundId ?? e.aggregateId ?? '');
      const paymentId = String(e.payload?.paymentId ?? '');
      if (!refundId || !paymentId) return;
      const p = (await sql<{ ticket_id: string; tenant_id: string; method: string }>`SELECT p.ticket_id, p.tenant_id, p.method FROM payments p WHERE p.id = ${paymentId}::uuid`.execute(trx)).rows[0];
      if (!p?.ticket_id) return;
      if (String(p.tenant_id) !== tenantId) throw withCode(new TenantMismatchError(`payment ${paymentId} belongs to another tenant`), 'TENANT_ACCESS_DENIED');
      if (p.method === 'global_reward') {
        // a refund of the REWARD tender: points back + the payable adjusted / offset (cumulative on that one payment)
        const onReward = Number((await sql<{ v: string }>`SELECT coalesce(sum(r.amount_cents), 0)::bigint AS v FROM payment_refunds r
          WHERE r.tenant_id = ${tenantId}::uuid AND r.payment_id = ${paymentId}::uuid AND r.status = 'refunded'`.execute(trx)).rows[0]?.v ?? 0);
        await reverseRedemptionForRefund(trx, await repo.program(trx), { tenantId, rewardPaymentId: paymentId, refundId, refundedCents: onReward });
        return;
      }
      const refunded = Number((await sql<{ v: string }>`SELECT coalesce(sum(r.amount_cents), 0)::bigint AS v FROM payment_refunds r JOIN payments p2 ON p2.id = r.payment_id AND p2.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId}::uuid AND p2.ticket_id = ${p.ticket_id}::uuid AND r.status = 'refunded' AND p2.method <> 'global_reward'`.execute(trx)).rows[0]?.v ?? 0);
      await reverseEarnForRefund(trx, repo, { tenantId, ticketId: String(p.ticket_id), refundId, refundedEligibleCents: refunded });
    } catch (err) {
      if (err instanceof GrTenantMismatchError) throw withCode(new TenantMismatchError(err.message), 'TENANT_ACCESS_DENIED');   // a SECURITY failure, never a retry-and-award
      throw err;
    }
  }
}
