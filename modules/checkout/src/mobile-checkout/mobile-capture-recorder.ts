// mobile-capture-recorder.ts — the ONE place a mobile (Owner & Manager Payment App) tender becomes money on the canonical
// checkout. Mandate §72 / §84–§87 / §170–§173 / §216–§218.
//
// Before this existed, applyCaptureResult moved only the ATTEMPT lifecycle (payment_attempts.status → confirmed): a
// processor-verified Tap to Pay capture never produced a payments row, never flipped the ticket to paid, never ran the
// post-payment work (payroll snapshot, loyalty, gift-card activation) and never told the POS. This records it exactly as
// the POS and the customer-display terminal do (TerminalCaptureService.recordApproval), through the SAME repository:
//
//   ONE transaction:  lock the ticket row (FOR UPDATE)  →  dedupe on the idempotency key (a redelivered result records
//   nothing: `duplicate`)  →  KyselyCheckoutRepository.recordPayment (payments row + payment.captured on the outbox)  →
//   ticket 'paid' + checkout.completed + visit.completed (full) or 'payment_in_progress' (a partial / split tender, §87:
//   the successful $30 is never erased when the $70 is declined)  →  link the attempt to its payment.
//
// The service then runs CheckoutService.runPostPaymentWork (it IS afterPaid, not a copy) and the realtime signals.
// Money math is integer cents; the card data that reaches this file is brand + last4 only (§80–§82) — the database
// CHECK refuses anything else in card_last4.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { DB } from '@aipowersalon/database';
import type { Ctx } from '@aipowersalon/permissions';
import type { CheckoutRepositoryPort } from '../checkout/checkout.repository';
import type { PaymentRecord, PaymentSurface } from '../checkout/checkout.dto';
import type { CheckoutContext } from '../checkout/checkout.repository';

export interface RecordTenderInput {
  ticketId: string;
  idempotencyKey: string;
  amountCents: number;
  method: 'card' | 'cash';
  surface: PaymentSurface;
  deviceId?: string | null;
  processorRef?: string;
  cardBrand?: string;
  cardLast4?: string;
}

export interface RecordTenderResult {
  paymentId: string;
  /** A payments row for this idempotency key already existed — nothing was recorded again. */
  duplicate: boolean;
  totalDueCents: number;
  /** Sum of approved + partial payments on the ticket AFTER this tender. */
  paidCents: number;
  remainingCents: number;
  /** True when this tender completed the ticket (status 'paid'). */
  ticketPaid: boolean;
  /** True when the repository wrote the domain events on the outbox (the realtime projection delivers them). */
  eventsViaOutbox: boolean;
}

export interface MobileCaptureRecorderPort {
  recordTender(ctx: Ctx, input: RecordTenderInput): Promise<RecordTenderResult>;
}

const cents = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));

/**
 * Works over the canonical checkout repository. With a Kysely database the whole record is ONE transaction under the
 * ticket's row lock (the Kysely repository accepts the transaction as its executor); the in-memory repository (unit
 * tests) runs the same sequence without a transaction.
 */
export class MobileCaptureRecorder implements MobileCaptureRecorderPort {
  constructor(private readonly repo: CheckoutRepositoryPort, private readonly db: Kysely<DB> | null = null) {}

  async recordTender(ctx: Ctx, input: RecordTenderInput): Promise<RecordTenderResult> {
    const amount = cents(input.amountCents);
    if (amount <= 0) throw new Error('A tender must be a positive whole number of cents.');
    const cctx = ctx as unknown as CheckoutContext;
    const eventsViaOutbox = this.repo.emitsDomainEvents?.() ?? false;
    if (this.db) {
      const db = this.db;
      return db.transaction().execute(async (trx) => {
        const k = trx as unknown as Kysely<DB>;
        const tk = await k.selectFrom('tickets').select(['id']).where('id', '=', input.ticketId as any).where('tenant_id', '=', ctx.tenantId as any).forUpdate().executeTakeFirst();
        if (!tk) throw new Error('ticket not found');
        const prior: any = await k.selectFrom('payments').select(['id']).where('tenant_id', '=', ctx.tenantId as any).where('idempotency_key' as any, '=', input.idempotencyKey).executeTakeFirst();
        const paidBefore = await this.paidSum(k, ctx.tenantId, input.ticketId);
        const t = await this.totals(cctx, input);
        if (prior) {
          const remaining = Math.max(0, t.cardDue - paidBefore);
          return { paymentId: String(prior.id), duplicate: true, totalDueCents: t.cardDue, paidCents: paidBefore, remainingCents: remaining, ticketPaid: remaining <= 0, eventsViaOutbox };
        }
        const full = paidBefore + amount >= t.ownDue;
        const rec = this.record(input, amount, full, t.tipCents, t.surchargeCents);
        const persisted = await (this.repo as any).recordPayment(cctx, rec, k);
        const ticketOk = await (this.repo as any).setStatus(cctx, input.ticketId, full ? 'paid' : 'payment_in_progress', k);
        if (!ticketOk) throw new Error('ticket not found');
        await k.updateTable('payment_attempts').set({ payment_id: persisted.paymentId, processor_ref: input.processorRef ?? null, card_brand: input.cardBrand ?? null, card_last4: input.cardLast4 && /^[0-9]{4}$/.test(input.cardLast4) ? input.cardLast4 : null, updated_at: sql`now()` } as any)
          .where('tenant_id', '=', ctx.tenantId as any).where('idempotency_key', '=', input.idempotencyKey).execute();
        const paid = paidBefore + amount;
        return { paymentId: String(persisted.paymentId), duplicate: false, totalDueCents: t.cardDue, paidCents: paid, remainingCents: full ? 0 : Math.max(0, t.cardDue - paid), ticketPaid: full, eventsViaOutbox };
      });
    }
    // in-memory (unit tests): the same sequence, no transaction
    const existing = await this.repo.findPaymentByIdempotencyKey(cctx, input.idempotencyKey);
    const paidBefore = await this.repo.paidTotalCents(cctx, input.ticketId);
    const t = await this.totals(cctx, input);
    if (existing) {
      const remaining = Math.max(0, t.cardDue - paidBefore);
      return { paymentId: existing.paymentId, duplicate: true, totalDueCents: t.cardDue, paidCents: paidBefore, remainingCents: remaining, ticketPaid: remaining <= 0, eventsViaOutbox };
    }
    const full = paidBefore + amount >= t.ownDue;
    const persisted = await this.repo.recordPayment(cctx, this.record(input, amount, full, t.tipCents, t.surchargeCents));
    if (!(await this.repo.setStatus(cctx, input.ticketId, full ? 'paid' : 'payment_in_progress'))) throw new Error('ticket not found');
    const paid = paidBefore + amount;
    return { paymentId: persisted.paymentId, duplicate: false, totalDueCents: t.cardDue, paidCents: paid, remainingCents: full ? 0 : Math.max(0, t.cardDue - paid), ticketPaid: full, eventsViaOutbox };
  }

  /** The ticket's totals for THIS tender's method (a cash tender owes no card surcharge: Option A, checkout.service
   *  paySplit) decide whether it completes the ticket; the remaining balance a card would still need uses card totals —
   *  the figure the app shows (mobile-checkout-ticket balanceDueCents). */
  private async totals(cctx: CheckoutContext, input: RecordTenderInput): Promise<{ ownDue: number; cardDue: number; tipCents: number; surchargeCents: number }> {
    const own = await this.repo.totalsFor(cctx, input.ticketId, input.method);
    const card = input.method === 'card' ? own : await this.repo.totalsFor(cctx, input.ticketId, 'card');
    return { ownDue: cents(own?.totalDueCents), cardDue: cents(card?.totalDueCents), tipCents: cents(own?.tipCents), surchargeCents: cents(own?.surchargeCents) };
  }

  private record(input: RecordTenderInput, amount: number, full: boolean, tipCents: number, surchargeCents: number): PaymentRecord {
    return {
      paymentId: this.db ? '' : 'pay_mobile_' + randomUUID(), ticketId: input.ticketId, method: input.method, amountCents: amount,
      // the ticket's tip rides on the tender that completes it (the POS records the same way); a partial carries none
      tipCents: full ? tipCents : 0, surchargeCents: input.method === 'card' && full ? surchargeCents : 0,
      status: full ? 'approved' : 'partial', idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString(),
      ...(input.processorRef ? { processorTransactionId: input.processorRef } : {}),
      paymentSurface: input.surface, deviceId: input.deviceId ?? undefined,
      cardBrand: input.cardBrand, cardLast4: input.cardLast4,
    };
  }

  private async paidSum(k: Kysely<DB>, tenantId: string, ticketId: string): Promise<number> {
    const r: any = await k.selectFrom('payments').select((eb: any) => eb.fn.sum('amount_cents').as('s'))
      .where('tenant_id', '=', tenantId as any).where('ticket_id', '=', ticketId as any).where('status', 'in', ['approved', 'partial']).executeTakeFirst();
    return cents(r?.s);
  }
}
