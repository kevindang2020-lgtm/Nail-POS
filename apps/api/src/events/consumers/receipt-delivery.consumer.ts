// receipt-delivery.consumer.ts — Owner & Manager Payment App mandate §98–§102 / §167: receipts are ASYNCHRONOUS.
//
// The mobile app never calls Twilio; it asks for a receipt and the request becomes a `receipt.requested` domain event
// (outbox, committed with nothing else to lose). This consumer delivers it through the ONE receipt system —
// CheckoutService.receiptSms / receiptEmail / receiptApp → the tenant's own messenger (its number, opt-outs, ledger) —
// so a Twilio outage after a payment is "Payment complete · Receipt queued for retry": the messenger's send failure is
// a TRANSIENT consumer error and the runner retries with backoff; an opt-out or an unconfigured channel is PERMANENT
// (dead-lettered for a human, never retried into a blocked number). NOT_REPLAYABLE: a replay would text the guest again.
import { type EventConsumer, ConsumerError, TenantMismatchError, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { CheckoutService } from '@aipowersalon/checkout';

type Channel = 'sms' | 'email' | 'app';

export class ReceiptDeliveryConsumer implements EventConsumer {
  readonly name = 'receipts.deliver_requested';
  readonly eventTypes = [DOMAIN_EVENTS.RECEIPT_REQUESTED] as const;
  readonly critical = false;
  readonly timeoutMs = 20_000;
  readonly replay = 'NOT_REPLAYABLE' as const;

  constructor(private readonly checkout: CheckoutService | null) {}

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    if (!this.checkout) throw new ConsumerError('TRANSIENT', 'checkout_unavailable', 'the checkout service is not wired in this process');
    const tenantId = e.tenantId; const ticketId = String(e.payload?.ticketId ?? e.aggregateId ?? '');
    const channel = (['sms', 'email', 'app'] as Channel[]).includes(e.payload?.channel) ? (e.payload.channel as Channel) : null;
    if (!tenantId || !ticketId || !channel) return;   // malformed: nothing to deliver (the envelope validator already refused worse)
    // §14: the ticket must belong to the event's tenant — a mismatch is a security failure, never a retry
    const tk = await trx.selectFrom('tickets').select(['tenant_id', 'branch_id']).where('id', '=', ticketId as any).executeTakeFirst();
    if (!tk) return;
    if (String(tk.tenant_id) !== tenantId) throw new TenantMismatchError(`ticket ${ticketId} belongs to another tenant`);
    // the requester's own permission rides on the event (pos.receipts.send) — the canonical receipt method re-checks it
    const ctx = { tenantId, branchId: String(tk.branch_id ?? e.branchId ?? ''), userId: String(e.payload?.requestedBy ?? e.actorId ?? 'receipt-worker'), role: String(e.payload?.role ?? 'MANAGER'), permissions: Array.isArray(e.payload?.permissions) ? e.payload.permissions : ['pos.receipts.send'] } as any;
    let r: any;
    try {
      r = channel === 'email' ? await this.checkout.receiptEmail(ctx, ticketId) : channel === 'app' ? await this.checkout.receiptApp(ctx, ticketId) : await this.checkout.receiptSms(ctx, ticketId);
    } catch (err: any) {
      // "A valid phone is required" / permission errors are permanent; anything else (provider, network) retries
      const msg = String(err?.message ?? err);
      if (/required|missing|forbidden|not allowed/i.test(msg)) throw new ConsumerError('PERMANENT', 'receipt_not_deliverable', msg);
      throw new ConsumerError('TRANSIENT', 'receipt_send_failed', msg);
    }
    if (r?.configured === false) throw new ConsumerError('PERMANENT', 'receipt_channel_not_configured', String(r?.disabledReason ?? 'channel not configured'));
    if (r?.delivery === 'blocked') throw new ConsumerError('PERMANENT', 'receipt_blocked', String(r?.reason ?? 'blocked'));
    if (r?.delivery === 'failed' || (r?.reason && r?.delivery !== 'sent' && r?.delivery !== 'simulated' && r?.delivery !== 'saved')) throw new ConsumerError('TRANSIENT', 'receipt_send_failed', String(r?.reason ?? 'send failed'));
  }
}
