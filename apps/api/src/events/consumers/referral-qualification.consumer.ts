// referral-qualification.consumer.ts — Referral Program guide (Oct 30 2026, migration 751) §04 stage 03 / §13 / §16:
//   checkout.completed → ReferralProgram.qualifyForTicket: the referred customer's FIRST completed, paid visit qualifies the
//                        referral ONCE (referral_redemptions.qualifying_ticket_id + the 'qualify:<ticket>' event key), creates
//                        the ONE reward obligation (UNIQUE (tenant, referral_id)) and — only when the salon does not require
//                        approval — issues it through the tenant loyalty ledger (source ('referral_rewards', id), once);
//   payment.refunded   → handleRefund: below the rule after the refund → an issued reward is REVERSED (audited ledger
//                        'reverse' entry), an unissued one is rejected and the referral goes to a person (UNDER_REVIEW).
// Never qualifies on a booking alone; never pays cash (a cash reward is BLOCKED_EXTERNAL). A ticket of another salon is a
// SECURITY failure, not a retry-and-award.
import { type EventConsumer, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { ReferralProgram, ReferralProgramError } from '@aipowersalon/customers';

export class ReferralQualificationConsumer implements EventConsumer {
  readonly name = 'customers.referral_qualification';
  readonly eventTypes = [DOMAIN_EVENTS.CHECKOUT_COMPLETED, DOMAIN_EVENTS.PAYMENT_REFUNDED] as const;
  readonly critical = true;   // a reward posting (loyalty points)
  // safe ONLY because of UNIQUE (tenant, referred), UNIQUE (tenant, referral_id) on rewards, the ledger's UNIQUE (source, entry_type)
  // and the event idempotency keys ('qualify:<ticket>', 'refund:<refund>'). Remove those and this becomes NOT_REPLAYABLE.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const tenantId = e.tenantId!;
    const rp = new ReferralProgram(trx);
    try {
      if (e.eventType === DOMAIN_EVENTS.CHECKOUT_COMPLETED) {
        const ticketId = String(e.payload?.ticketId ?? e.aggregateId ?? '');
        if (!ticketId) return;
        await rp.qualifyForTicket(tenantId, ticketId, `checkout.completed:${e.eventId}`, trx);
        return;
      }
      const paymentId = String(e.payload?.paymentId ?? '');
      const refundId = String(e.payload?.refundId ?? e.aggregateId ?? '');
      if (!paymentId || !refundId) return;
      const p = (await sql<{ ticket_id: string; tenant_id: string }>`SELECT p.ticket_id, p.tenant_id FROM payments p WHERE p.id = ${paymentId}::uuid`.execute(trx)).rows[0];
      if (!p?.ticket_id) return;
      if (String(p.tenant_id) !== tenantId) throw withCode(new TenantMismatchError(`payment ${paymentId} belongs to another tenant`), 'TENANT_ACCESS_DENIED');
      await rp.handleRefund(tenantId, String(p.ticket_id), refundId, trx);
    } catch (err) {
      if (err instanceof ReferralProgramError && err.code === 'TENANT_ACCESS_DENIED') throw withCode(new TenantMismatchError(err.message), 'TENANT_ACCESS_DENIED');
      throw err;
    }
  }
}
