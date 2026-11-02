// booking-deposit.service.ts — Decision D11 (Oct 14 2026 build plan: "build — card-on-file through the salon's card processor; refundable /
// forfeit per salon setting; through the ONE checkout/payment domain"), rebuilt Oct 21 2026.
//
// The life of a deposit, all of it here and nowhere else:
//   • requirement — the salon's booking-appointments settings decide (depositRequired, depositPercent of the booked
//     price; the refund window is the salon's cancellation window; a no-show forfeits unless the salon's no-show policy
//     is "none"). Snapshotted on the row at booking time.
//   • pay — the customer's card token (hosted tokenizer; the raw card never touches us) is charged through the ONE provider
//     router (PaymentGatewayResolver: tenant + branch → merchant → adapter), card-not-present, with a stored profile so the
//     same card can be charged later (no-show fee). Approved → captured. Declined → failed (the customer may try another
//     card). A lost answer (timeout) is NOT a failure: the row keeps the note, and the next attempt first asks the gateway
//     by order id whether the charge went through (Functional Decision 22) — never a blind second charge.
//   • apply — at checkout the captured deposit is a payment on the visit's ticket (method 'deposit'); if it is more than
//     the ticket owes, the rest goes back to the card.
//   • cancel — the salon's own cancellation, or the guest's inside the window → refunded through the processor; the
//     guest's late cancellation → forfeited (the salon keeps it). No-show → forfeited per policy, else refunded.
// Every money move is one transaction with its status transition (BOOKING_DEPOSIT machine) and its domain event.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { BOOKING_DEPOSIT, APPOINTMENT_DEPOSIT } from '../booking-lifecycles';
// §105: booking does not import the payments module (payments → ai → booking would close a cycle). The processor is a
// STRUCTURAL port — the same shape as @aipowersalon/payments' PaymentProcessor, bound by the API through the gateway token.
export interface DepositCardProcessor {
  authorizeAndCapture(input: { account: string; expiry?: string; cvv?: string; name?: string; amountCents: number; orderId: string; idempotencyKey?: string; ecomind?: string; profile?: string }): Promise<{ approved: boolean; retref?: string | null; profileId?: string | null; respstat?: string; respText?: string }>;
  refund(input: { retref: string; amountCents: number }): Promise<{ ok: boolean; retref?: string | null; respstat?: string; respText?: string }>;
  inquireByOrderId?(orderId: string): Promise<{ transactions: { approved: boolean; retref?: string | null }[] }>;
}

export type DepositStatus = 'pending' | 'captured' | 'failed' | 'applied' | 'refunded' | 'forfeited';
export interface DepositCtx { tenantId: string; branchId?: string | null; userId?: string | null }
export interface DepositPolicy {
  /** the salon requires a deposit on bookings */
  required: boolean;
  /** percent of the booked price (whole cents, rounded) */
  percent: number;
  /** a cancellation at least this many hours before the start is refunded; later ones forfeit */
  cancellationWindowHours: number;
  /** a no-show forfeits the deposit (false: it is refunded) */
  forfeitOnNoShow: boolean;
}
export interface DepositView {
  depositId: string; appointmentId: string; status: DepositStatus; amountCents: number; cardLast4: string | null;
  refundableUntil: string | null; forfeitOnNoShow: boolean; appliedCents: number | null; refundedCents: number | null; endedReason: string | null; failureReason: string | null;
}
/** the ONE payment domain: PaymentGatewayResolver (tenant + branch → merchant → adapter) and the adapter it builds */
export interface DepositGatewayPort {
  resolve(tenantId: string, branchId?: string | null): Promise<{ configured: boolean; processorType: string; processor?: DepositCardProcessor }>;
}

export class DepositError extends Error {
  constructor(public readonly code: 'DEPOSIT_NOT_FOUND' | 'DEPOSIT_NOT_PAYABLE' | 'PAYMENTS_NOT_CONFIGURED' | 'DEPOSIT_DECLINED' | 'DEPOSIT_STATUS_UNKNOWN' | 'DEPOSIT_INVALID', message: string, public readonly status: number) { super(message); this.name = 'DepositError'; }
}

const ORDER = (depositId: string) => 'dep:' + depositId;
/** the columns a deposit read needs — never `*` (response-exposure gate) */
const COLS = ['id', 'tenant_id', 'branch_id', 'appointment_id', 'customer_id', 'amount_cents', 'status', 'processor_type', 'processor_transaction_id', 'card_profile_id', 'card_last4', 'captured_at',
  'refundable_until', 'forfeit_on_no_show', 'applied_ticket_id', 'applied_payment_id', 'applied_cents', 'refund_transaction_id', 'refunded_cents', 'ended_reason', 'failure_reason', 'idempotency_key', 'created_at', 'updated_at'] as const;
const isUuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

export class BookingDepositService {
  constructor(private readonly db: Kysely<DB>, private readonly gateway: DepositGatewayPort, private readonly outbox?: OutboxWriter, private readonly now: () => Date = () => new Date()) {}

  /** The salon's deposit policy from its booking-appointments settings (branch row over salon row), honest defaults. */
  async policy(ctx: DepositCtx): Promise<DepositPolicy> {
    const rows: any[] = await (this.db.selectFrom('tenant_settings') as any).select(['branch_id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'booking-appointments')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || '00000000-0000-0000-0000-000000000000'), eb('branch_id', 'is', null)]))
      .execute();
    const row = rows.find((r) => r.branch_id) ?? rows[0];
    let v: any = {};
    if (row?.settings_json) { try { v = typeof row.settings_json === 'string' ? JSON.parse(row.settings_json) : row.settings_json; } catch { v = {}; } }
    const pct = Number.isFinite(Number(v.depositPercent)) ? Math.max(0, Math.min(100, Number(v.depositPercent))) : 20;
    const win = Number.isFinite(Number(v.cancellationWindowHours)) ? Math.max(0, Number(v.cancellationWindowHours)) : 24;
    return { required: v.depositRequired === true && pct > 0, percent: pct, cancellationWindowHours: win, forfeitOnNoShow: !['none', 'no_fee', 'waive'].includes(String(v.noShowPolicy ?? 'charge_fee')) };
  }

  /** What a booking of this price would owe up front — nothing when the salon takes no deposit. */
  async requirementFor(ctx: DepositCtx, priceCents: number): Promise<{ required: false } | { required: true; amountCents: number; policy: DepositPolicy }> {
    const policy = await this.policy(ctx);
    if (!policy.required) return { required: false };
    const amountCents = Math.round(priceCents * policy.percent / 100);
    return amountCents > 0 ? { required: true, amountCents, policy } : { required: false };
  }

  /** The appointment exists; its deposit row is created PENDING with the policy snapshot. Idempotent per appointment. */
  async createForAppointment(ctx: DepositCtx, input: { appointmentId: string; customerId: string | null; priceCents: number; startsAt: Date }): Promise<DepositView | null> {
    const req = await this.requirementFor(ctx, input.priceCents);
    if (!req.required) return null;
    const refundableUntil = new Date(input.startsAt.getTime() - req.policy.cancellationWindowHours * 3600_000);
    const ins: any = await (this.db.insertInto('booking_deposits') as any).values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, appointment_id: input.appointmentId, customer_id: input.customerId, amount_cents: req.amountCents, status: 'pending',
      refundable_until: refundableUntil.toISOString(), forfeit_on_no_show: req.policy.forfeitOnNoShow, updated_by: isUuid(ctx.userId) ? ctx.userId : null,
    }).onConflict((oc: any) => oc.constraint('booking_deposits_one_per_appointment').doNothing()).returning(['id']).executeTakeFirst();
    await (this.db.updateTable('pos_tech_appointments') as any).set({ deposit_status: 'required' }).where('tenant_id', '=', ctx.tenantId).where('id', '=', input.appointmentId).where('deposit_status', '=', 'not_required').where(canMoveToSql(APPOINTMENT_DEPOSIT, 'required') as any).execute();
    return this.forAppointment(ctx, input.appointmentId).then((v) => v ?? (ins ? { depositId: String(ins.id) } as any : null));
  }

  async forAppointment(ctx: DepositCtx, appointmentId: string): Promise<DepositView | null> {
    const r: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).executeTakeFirst();
    return r ? view(r) : null;
  }
  async byId(ctx: DepositCtx, depositId: string): Promise<DepositView | null> {
    if (!isUuid(depositId)) return null;
    const r: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', depositId).executeTakeFirst();
    return r ? view(r) : null;
  }

  /**
   * Charge the deposit to the customer's card token. pending / failed → captured | failed. Idempotent: a captured row
   * answers as captured without a second charge. A lost answer leaves the row pending with the note; the next call asks the
   * gateway by order id first and completes the capture from its record rather than charging again.
   */
  async pay(ctx: DepositCtx, depositId: string, card: { token: string; expiry?: string; cvv?: string; name?: string }): Promise<DepositView> {
    const row: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', depositId).executeTakeFirst();
    if (!row) throw new DepositError('DEPOSIT_NOT_FOUND', 'No deposit to pay.', 404);
    if (row.status === 'captured' || row.status === 'applied') return view(row);
    if (row.status !== 'pending' && row.status !== 'failed') throw new DepositError('DEPOSIT_NOT_PAYABLE', 'This deposit can no longer be paid (' + row.status + ').', 409);
    if (!card?.token || typeof card.token !== 'string' || card.token.length < 8) throw new DepositError('DEPOSIT_INVALID', 'A card token is required.', 400);
    const g = await this.gateway.resolve(ctx.tenantId, String(row.branch_id));
    if (!g.configured || !g.processor) throw new DepositError('PAYMENTS_NOT_CONFIGURED', 'Card payments are not set up at this salon yet; the salon will take the deposit in person.', 409);
    const amount = Number(row.amount_cents);
    // Functional Decision 22: a previous attempt whose answer was lost — ask the gateway what happened before charging again
    if (row.failure_reason && row.status === 'pending' && g.processor.inquireByOrderId) {
      const found = (await g.processor.inquireByOrderId(ORDER(depositId)).catch(() => ({ transactions: [] }))).transactions.find((t) => t.approved);
      if (found) return this.captured(ctx, row, { retref: found.retref ?? null, profileId: null, last4: null, processorType: g.processorType });
    }
    let r: Awaited<ReturnType<DepositCardProcessor['authorizeAndCapture']>>;
    try {
      r = await g.processor.authorizeAndCapture({ account: card.token, expiry: card.expiry, cvv: card.cvv, name: card.name, amountCents: amount, orderId: ORDER(depositId), idempotencyKey: ORDER(depositId), ecomind: 'E', profile: 'Y' });
    } catch (e: any) {
      // the answer was lost: not a decline, not a capture — remembered, never retried blind
      await (this.db.updateTable('booking_deposits') as any).set({ failure_reason: ('answer lost: ' + String(e?.message ?? e)).slice(0, 500), updated_at: this.now().toISOString() }).where('id', '=', depositId).where('tenant_id', '=', ctx.tenantId).execute();
      throw new DepositError('DEPOSIT_STATUS_UNKNOWN', 'The card processor did not answer. Please try again in a moment; you will not be charged twice.', 409);
    }
    if (!r.approved) {
      const reason = (r.respText || r.respstat || 'declined').slice(0, 200);
      await (this.db.updateTable('booking_deposits') as any).set({ status: 'failed', failure_reason: reason, updated_at: this.now().toISOString() }).where('id', '=', depositId).where('tenant_id', '=', ctx.tenantId).where(canMoveToSql(BOOKING_DEPOSIT, 'failed') as any).execute();
      await (this.db.updateTable('pos_tech_appointments') as any).set({ deposit_status: 'failed' }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.appointment_id).where(canMoveToSql(APPOINTMENT_DEPOSIT, 'failed') as any).execute();
      throw new DepositError('DEPOSIT_DECLINED', 'The card was declined: ' + reason, 402);
    }
    return this.captured(ctx, row, { retref: r.retref ?? null, profileId: r.profileId ?? null, last4: last4Of(card.token), processorType: g.processorType });
  }

  private async captured(ctx: DepositCtx, row: any, c: { retref: string | null; profileId: string | null; last4: string | null; processorType: string }): Promise<DepositView> {
    const nowIso = this.now().toISOString();
    return this.db.transaction().execute(async (trx) => {
      const up: any = await (trx.updateTable('booking_deposits') as any)
        .set({ status: 'captured', processor_type: c.processorType, processor_transaction_id: c.retref, card_profile_id: c.profileId, card_last4: c.last4, captured_at: nowIso, failure_reason: null, updated_at: nowIso })
        .where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['pending', 'failed']).where(canMoveToSql(BOOKING_DEPOSIT, 'captured') as any).returning(COLS as any).executeTakeFirst();
      if (!up) { const cur: any = await (trx.selectFrom('booking_deposits') as any).select(COLS as any).where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst(); return view(cur); }
      await (trx.updateTable('pos_tech_appointments') as any).set({ deposit_status: 'paid' }).where('tenant_id', '=', ctx.tenantId).where('id', '=', row.appointment_id).where(canMoveToSql(APPOINTMENT_DEPOSIT, 'paid') as any).execute();
      await this.fact(trx, ctx, DOMAIN_EVENTS.BOOKING_DEPOSIT_CAPTURED, up, { amountCents: Number(up.amount_cents), processorTransactionId: c.retref });
      return view(up);
    });
  }

  /**
   * Checkout: the captured deposit for THIS ticket's appointment (ticket → queue item → appointment), if any and not yet
   * applied. The caller (the checkout domain) records the 'deposit' payment row and calls markApplied in its transaction.
   */
  async capturedForTicket(ctx: DepositCtx, ticketId: string): Promise<{ depositId: string; appointmentId: string; amountCents: number; retref: string | null } | null> {
    if (!isUuid(ticketId)) return null;
    const r: any = await sql`SELECT d.id, d.appointment_id, d.amount_cents, d.processor_transaction_id
      FROM booking_deposits d JOIN pos_queue_items q ON q.appointment_id = d.appointment_id AND q.tenant_id = d.tenant_id
      JOIN tickets t ON t.queue_item_id = q.id AND t.tenant_id = d.tenant_id
      WHERE t.id = ${ticketId}::uuid AND d.tenant_id = ${ctx.tenantId}::uuid AND d.status = 'captured' LIMIT 1`.execute(this.db).then((x: any) => x.rows[0]);
    return r ? { depositId: String(r.id), appointmentId: String(r.appointment_id), amountCents: Number(r.amount_cents), retref: r.processor_transaction_id ?? null } : null;
  }
  /** captured → applied, inside the checkout's transaction. The remainder (deposit above what the ticket owed) is refunded to the card by refundRemainder. */
  async markApplied(exec: Kysely<DB>, ctx: DepositCtx, depositId: string, applied: { ticketId: string; paymentId: string; appliedCents: number }): Promise<boolean> {
    const nowIso = this.now().toISOString();
    const up: any = await (exec.updateTable('booking_deposits') as any)
      .set({ status: 'applied', applied_ticket_id: applied.ticketId, applied_payment_id: isUuid(applied.paymentId) ? applied.paymentId : null, applied_cents: applied.appliedCents, ended_reason: 'checkout', updated_at: nowIso, updated_by: isUuid(ctx.userId) ? ctx.userId : null })
      .where('id', '=', depositId).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'captured').where(canMoveToSql(BOOKING_DEPOSIT, 'applied') as any).returning(COLS as any).executeTakeFirst();
    if (!up) return false;
    await this.fact(exec, ctx, DOMAIN_EVENTS.BOOKING_DEPOSIT_APPLIED, up, { amountCents: Number(up.amount_cents), appliedCents: applied.appliedCents, ticketId: applied.ticketId, paymentId: applied.paymentId });
    return true;
  }
  /** After apply: what the ticket did not take goes back to the card (best-effort, recorded on the row; a failure is logged by the caller). */
  async refundRemainder(ctx: DepositCtx, depositId: string): Promise<{ refundedCents: number } | null> {
    const row: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', depositId).executeTakeFirst();
    if (!row || row.status !== 'applied' || row.refunded_cents != null) return null;
    const rest = Number(row.amount_cents) - Number(row.applied_cents ?? 0);
    if (rest <= 0 || !row.processor_transaction_id) return null;
    const g = await this.gateway.resolve(ctx.tenantId, String(row.branch_id));
    if (!g.configured || !g.processor) return null;
    const r = await g.processor.refund({ retref: String(row.processor_transaction_id), amountCents: rest });
    if (!r.ok) return null;
    await (this.db.updateTable('booking_deposits') as any).set({ refunded_cents: rest, refund_transaction_id: r.retref ?? null, updated_at: this.now().toISOString() }).where('id', '=', depositId).where('tenant_id', '=', ctx.tenantId).execute();
    return { refundedCents: rest };
  }

  /**
   * The appointment was cancelled. The salon's own cancellation, or the guest's inside the window, refunds the deposit
   * through the processor; the guest's late cancellation forfeits it. A pending (unpaid) deposit simply ends. Idempotent.
   */
  async onCancelled(ctx: DepositCtx, appointmentId: string, by: 'customer' | 'salon'): Promise<DepositView | null> {
    const row: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).executeTakeFirst();
    if (!row) return null;
    if (row.status !== 'captured') return view(row);
    const inWindow = row.refundable_until ? this.now().getTime() <= new Date(row.refundable_until).getTime() : false;
    if (by === 'salon' || inWindow) return this.refundAll(ctx, row, by === 'salon' ? 'salon_cancelled' : 'customer_cancelled');
    return this.forfeit(ctx, row, 'late_cancellation');
  }
  /** The guest did not come: forfeit per the policy snapshot, else refund. Idempotent. */
  async onNoShow(ctx: DepositCtx, appointmentId: string): Promise<DepositView | null> {
    const row: any = await (this.db.selectFrom('booking_deposits') as any).select(COLS as any).where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).executeTakeFirst();
    if (!row) return null;
    if (row.status !== 'captured') return view(row);
    return row.forfeit_on_no_show ? this.forfeit(ctx, row, 'no_show') : this.refundAll(ctx, row, 'no_show');
  }

  private async refundAll(ctx: DepositCtx, row: any, reason: string): Promise<DepositView> {
    const amount = Number(row.amount_cents);
    const g = await this.gateway.resolve(ctx.tenantId, String(row.branch_id));
    if (!g.configured || !g.processor || !row.processor_transaction_id) throw new DepositError('PAYMENTS_NOT_CONFIGURED', 'The deposit cannot be refunded automatically (card payments are not set up); refund it from the salon.', 409);
    const r = await g.processor.refund({ retref: String(row.processor_transaction_id), amountCents: amount });
    if (!r.ok) throw new DepositError('DEPOSIT_DECLINED', 'The processor refused the refund: ' + String(r.respText || r.respstat || ''), 409);
    const nowIso = this.now().toISOString();
    return this.db.transaction().execute(async (trx) => {
      const up: any = await (trx.updateTable('booking_deposits') as any)
        .set({ status: 'refunded', refunded_cents: amount, refund_transaction_id: r.retref ?? null, ended_reason: reason, updated_at: nowIso, updated_by: isUuid(ctx.userId) ? ctx.userId : null })
        .where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'captured').where(canMoveToSql(BOOKING_DEPOSIT, 'refunded') as any).returning(COLS as any).executeTakeFirst();
      if (!up) { const cur: any = await (trx.selectFrom('booking_deposits') as any).select(COLS as any).where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst(); return view(cur); }
      await this.fact(trx, ctx, DOMAIN_EVENTS.BOOKING_DEPOSIT_REFUNDED, up, { amountCents: amount, reason, refundTransactionId: r.retref ?? null });
      return view(up);
    });
  }
  private async forfeit(ctx: DepositCtx, row: any, reason: string): Promise<DepositView> {
    const nowIso = this.now().toISOString();
    return this.db.transaction().execute(async (trx) => {
      const up: any = await (trx.updateTable('booking_deposits') as any)
        .set({ status: 'forfeited', ended_reason: reason, updated_at: nowIso, updated_by: isUuid(ctx.userId) ? ctx.userId : null })
        .where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'captured').where(canMoveToSql(BOOKING_DEPOSIT, 'forfeited') as any).returning(COLS as any).executeTakeFirst();
      if (!up) { const cur: any = await (trx.selectFrom('booking_deposits') as any).select(COLS as any).where('id', '=', row.id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst(); return view(cur); }
      await this.fact(trx, ctx, DOMAIN_EVENTS.BOOKING_DEPOSIT_FORFEITED, up, { amountCents: Number(up.amount_cents), reason });
      return view(up);
    });
  }

  private async fact(exec: any, ctx: DepositCtx, type: string, row: any, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(exec, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: String(row.branch_id), aggregateType: 'booking_deposit', aggregateId: String(row.id),
      actorId: ctx.userId ?? undefined, actorType: ctx.userId ? 'user' : 'system', payload: { depositId: String(row.id), appointmentId: String(row.appointment_id), customerId: row.customer_id ?? null, ...payload } }));
  }
}

/** a CardSecure token keeps the card's last four as its own last four digits; anything else is unknown */
function last4Of(token: string): string | null { const m = /(\d{4})$/.exec(String(token || '')); return m ? m[1] : null; }

function view(r: any): DepositView {
  return { depositId: String(r.id), appointmentId: String(r.appointment_id), status: r.status, amountCents: Number(r.amount_cents), cardLast4: r.card_last4 ?? null,
    refundableUntil: r.refundable_until ? new Date(r.refundable_until).toISOString() : null, forfeitOnNoShow: !!r.forfeit_on_no_show,
    appliedCents: r.applied_cents == null ? null : Number(r.applied_cents), refundedCents: r.refunded_cents == null ? null : Number(r.refunded_cents), endedReason: r.ended_reason ?? null, failureReason: r.failure_reason ?? null };
}
