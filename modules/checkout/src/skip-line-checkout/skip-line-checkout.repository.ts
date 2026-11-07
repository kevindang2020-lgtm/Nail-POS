import { APP_CARD_METHODS, unsettledTendersForTicket, type UnsettledTender } from '../checkout/unsettled-tenders';
import { randomBytes } from 'node:crypto';
// skip-line-checkout.repository.ts — Kysely persistence. Reuses tickets + ticket_service_lines (bill), payments
// (records the actual cash/app payment), owner_audit_log + owner_alerts (audit/alerts). Everything tenant-scoped.
import { transitionStatus, assertTransition } from '@aipowersalon/database';
import { PAYMENT_INTENT, CASH_PAYMENT_CONFIRMATION } from '../checkout/checkout-lifecycles';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { visitCompletedEvent } from '../checkout/visit-completed';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { Kysely, sql } from 'kysely';
import { resolveCheckoutSettings } from '../checkout/checkout-settings.resolver';
import type { DB } from '@aipowersalon/database';
import { applyLoyaltyEntry } from '@aipowersalon/customers';
import { Bill, BillLine, IntentMethod, IntentStatus, CashConfStatus, SkipLineSettings, DEFAULT_SKIP_LINE_SETTINGS } from './skip-line-checkout.dto';

export interface SLCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string; permissions?: string[]; }
const num = (v: any) => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
/** What Verify / the sweep need of a charged app intent (no card data lives on the intent). */
const CHARGED_INTENT_COLS = ['id', 'tenant_id', 'branch_id', 'ticket_id', 'customer_id', 'amount_cents', 'customer_tip_cents', 'method', 'status', 'charge_started_at'] as const;
export interface ChargedIntentRow { id: string; tenant_id: string; branch_id: string | null; ticket_id: string; customer_id: string | null; amount_cents: number | string; customer_tip_cents: number | string; method: string; status: string; charge_started_at: Date | string | null }
/** A user column takes a real user id only — a system actor ('system:payment-attempt-sweep') records NULL, never a bad uuid (B-80). */
const actorUserId = (ctx: SLCtx): string | null => (isUuid(ctx.userId) ? ctx.userId : null);
const isUuid = (x: any): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

export class SkipLineCheckoutRepository {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will the domain events reach clients (and consumers) through the outbox? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }

  // ---- identity resolvers (same links the rest of the app uses) ----
  async resolveCustomerId(ctx: SLCtx): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('customers').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null).executeTakeFirst().catch(() => undefined);
    return r?.id ?? null;
  }
  async resolveTechnicianId(ctx: SLCtx): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('technicians').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst().catch(() => undefined);
    return r?.id ?? null;
  }

  // ---- bill (backend-authoritative; recomputed from service lines + ticket columns) ----
  private async buildBill(ctx: SLCtx, t: any): Promise<Bill> {
    const lines = await this.db.selectFrom('ticket_service_lines').select(['id', 'service_name_snapshot', 'technician_id', 'line_total_cents']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', t.id).execute().catch(() => []);
    const services: BillLine[] = lines.map((l) => ({ serviceLineId: l.id, serviceName: l.service_name_snapshot, technicianId: l.technician_id, priceCents: num(l.line_total_cents) }));
    const subtotal = services.reduce((a, l) => a + l.priceCents, 0);
    const discount = num(t.discount_cents), tax = num(t.tax_cents), tip = num(t.tip_cents);
    const totalDue = Math.max(0, subtotal - discount + tax + tip);
    let customerName = '', technicianName = '';
    if (t.customer_id) { const c = await this.db.selectFrom('customers').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', t.customer_id).executeTakeFirst().catch(() => undefined); customerName = c?.full_name || ''; }
    if (t.primary_technician_id) { const tech = await this.db.selectFrom('technicians').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', t.primary_technician_id).executeTakeFirst().catch(() => undefined); technicianName = tech?.full_name || ''; }
    return { ticketId: t.id, invoiceId: t.id, ticketNumber: t.ticket_number ? '#' + t.ticket_number : '#' + String(t.id).slice(0, 6), customerId: t.customer_id, customerName, technicianId: t.primary_technician_id, technicianName, services, subtotalCents: subtotal, discountCents: discount, taxCents: tax, tipCents: tip, totalDueCents: totalDue, ticketStatus: t.status, paid: !!t.paid_at };
  }
  private ticketCols = ['id', 'customer_id', 'primary_technician_id', 'branch_id', 'status', 'discount_cents', 'tax_cents', 'tip_cents', 'subtotal_cents', 'total_cents', 'ticket_number', 'paid_at', 'service_done_at', 'ready_checkout_at', 'updated_at'] as const;
  async activeBillForCustomer(ctx: SLCtx, customerId: string): Promise<Bill | null> {
    const t = await this.db.selectFrom('tickets').select(this.ticketCols).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('paid_at', 'is', null).where('status', 'in', ['service_done', 'ready_checkout']).orderBy('updated_at', 'desc').executeTakeFirst().catch(() => undefined);
    return t ? this.buildBill(ctx, t) : null;
  }
  async billForTicket(ctx: SLCtx, ticketId: string): Promise<Bill | null> {
    const t = await this.db.selectFrom('tickets').select(this.ticketCols).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst().catch(() => undefined);
    return t ? this.buildBill(ctx, t) : null;
  }

  /** Payment master build §9.4 (Customer App lane): the conditional surcharge disclosure for this ticket — the salon's switch AND the
   *  enrolled rate of the merchant that charges the ticket's branch. Any failure → nothing applies (fail closed). */
  async cardSurchargeDisclosure(tenantId: string, ticketId: string): Promise<{ applies: boolean; ratePercent: number }> {
    try {
      const t: any = await this.db.selectFrom('tickets').select(['branch_id']).where('tenant_id', '=', tenantId).where('id', '=', ticketId).executeTakeFirst();
      const s = await resolveCheckoutSettings(this.db, tenantId, t?.branch_id ?? null);
      return s.creditCardSurchargeEnabled && s.creditCardSurchargePercent > 0 ? { applies: true, ratePercent: s.creditCardSurchargePercent } : { applies: false, ratePercent: 0 };
    } catch { return { applies: false, ratePercent: 0 }; }
  }

  // ---- settings ----
  /** 425: the tenant's tip cap for customer-added tips — same source the POS/display use (checkout settings). */
  async maxTipPercent(tenantId: string, branchId: string | null): Promise<number> {
    const s = await resolveCheckoutSettings(this.db, tenantId, branchId).catch(() => null);
    return s?.maxTipPercent ?? 100;
  }

  /** One definition of the row → settings mapping, shared by both readers so they cannot drift apart. */
  private mapSettings(r: unknown): SkipLineSettings {
    return { featureEnabled: !!(r as any).feature_enabled, autoSendPromptOnServiceDone: !!(r as any).auto_send_prompt_on_service_done, requireFrontDeskApproval: !!(r as any).require_front_desk_approval, allowCashToTechnician: !!(r as any).allow_cash_to_technician, requireTechConfirmationForCash: !!(r as any).require_tech_confirmation_for_cash, managerApprovalOverCents: num((r as any).manager_approval_over_cents) };
  }

  /** Reads the stored settings, or the defaults when none are stored. THROWS on a query error. */
  private async readSettingsStrict(tenantId: string): Promise<SkipLineSettings> {
    const r = await this.db.selectFrom('skip_line_checkout_settings').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    return r ? this.mapSettings(r) : { ...DEFAULT_SKIP_LINE_SETTINGS };
  }

  async getSettings(tenantId: string): Promise<SkipLineSettings> {
    // "No row" and "the query failed" are DIFFERENT facts and must not share a fallback.
    //
    // No row → the salon never configured Skip-the-Line, so the product defaults apply (unchanged behaviour).
    // Query error → we do not know what the salon chose. The defaults have featureEnabled AND
    // allowCashToTechnician set to TRUE, so collapsing an error into them would silently RE-ENABLE cash
    // collection by technicians for a salon that had switched it off — fail-open on a cash-handling control.
    // On error we fail CLOSED instead: the feature and the cash method are off, and the customer simply pays at
    // the front desk as they would without this feature. Consistent with how consent, support sessions and AI
    // auto-assignment already fail in this codebase.
    let r: unknown;
    try {
      r = await this.db.selectFrom('skip_line_checkout_settings').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    } catch {
      return { ...DEFAULT_SKIP_LINE_SETTINGS, featureEnabled: false, allowCashToTechnician: false };
    }
    if (!r) return { ...DEFAULT_SKIP_LINE_SETTINGS };
    return this.mapSettings(r);
  }
  async updateSettings(tenantId: string, p: Partial<SkipLineSettings>): Promise<SkipLineSettings> {
    // Deliberately NOT this.getSettings(): that method returns fail-CLOSED values on a read error, and merging
    // them here would PERSIST them — a transient read failure during an update would permanently switch the
    // feature and cash collection off. An update needs the truth or nothing, so a read error aborts it.
    const cur = await this.readSettingsStrict(tenantId);
    const next = { ...cur, ...p };
    const vals: any = { tenant_id: tenantId, feature_enabled: next.featureEnabled, auto_send_prompt_on_service_done: next.autoSendPromptOnServiceDone, require_front_desk_approval: next.requireFrontDeskApproval, allow_cash_to_technician: next.allowCashToTechnician, require_tech_confirmation_for_cash: next.requireTechConfirmationForCash, manager_approval_over_cents: Math.max(0, Math.trunc(next.managerApprovalOverCents)) };
    const exists = await this.db.selectFrom('skip_line_checkout_settings').select('tenant_id').where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (exists) await this.db.updateTable('skip_line_checkout_settings').set({ ...vals, updated_at: sql`now()` }).where('tenant_id', '=', tenantId).execute();
    else await this.db.insertInto('skip_line_checkout_settings').values(vals).execute();
    return next;
  }

  // ---- payment intents ----
  async createIntent(ctx: SLCtx, i: { ticketId: string; customerId: string | null; amountCents: number; method: IntentMethod; status: IntentStatus; gateway?: string | null; expiresAt?: Date | null; customerTipCents?: number }): Promise<any> {
    const r = await this.db.insertInto('payment_intents').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: i.ticketId, invoice_id: i.ticketId, customer_id: i.customerId, amount_cents: i.amountCents, currency: 'USD', method: i.method, status: i.status, gateway: i.gateway ?? null, created_by_user_id: actorUserId(ctx), expires_at: i.expiresAt ?? null, customer_tip_cents: Math.max(0, Math.trunc(i.customerTipCents ?? 0)) }).returningAll().executeTakeFirstOrThrow();
    return r;
  }
  async getIntent(ctx: SLCtx, id: string): Promise<any | null> {
    return (await this.db.selectFrom('payment_intents').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined)) ?? null;
  }
  async setIntentStatus(ctx: SLCtx, id: string, status: IntentStatus): Promise<void> {
    // Phase 12 (#27): through PAYMENT_INTENT — a succeeded intent is never re-processed (a second charge), a cancelled one
    // never revived (409); conditional, so a concurrent writer gets 409 instead of a lost update
    await transitionStatus(this.db, PAYMENT_INTENT, { where: { tenant_id: ctx.tenantId, id }, to: status, set: { updated_at: sql`now()` } });
  }

  // ---- B-80 (Oct 23 2026): app-charge recovery — the card was sent, the answer may be lost ----
  /** The moment the card is sent to the processor: ONE charger per intent (charge_started_at IS NULL wins). Conditional,
   *  so a second confirm of the same intent — a double tap, a retry after a lost answer — never reaches the processor. */
  async markChargeStarted(ctx: SLCtx, intentId: string): Promise<boolean> {
    const r = await sql<any>`update payment_intents set status = 'processing', charge_started_at = now(), updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${intentId} and charge_started_at is null and status in ('created','sent_to_customer','requires_action','processing') returning id`.execute(this.db);
    return r.rows.length > 0;
  }
  /** processing + charged → succeeded | failed, exactly once (conditional on status = 'processing'). */
  async settleChargedIntent(ctx: SLCtx, intentId: string, to: { status: 'succeeded' | 'failed'; processorRef?: string | null; failureReason?: string | null; settledBy: string }): Promise<boolean> {
    const r = await sql<any>`update payment_intents set status = ${to.status}, processor_ref = coalesce(${to.processorRef ?? null}, processor_ref), failure_reason = ${to.failureReason ? String(to.failureReason).slice(0, 500) : null},
        settled_by = ${to.settledBy}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${intentId} and status = 'processing' and charge_started_at is not null returning id`.execute(this.db);
    return r.rows.length > 0;
  }
  async touchIntentInquired(ctx: SLCtx, intentId: string): Promise<void> {
    await sql`update payment_intents set last_inquired_at = now() where tenant_id = ${ctx.tenantId} and id = ${intentId}`.execute(this.db);
  }
  /** App charges on this ticket whose answer is not back (oldest first). */
  async openChargedIntentsForTicket(ctx: SLCtx, ticketId: string): Promise<ChargedIntentRow[]> {
    return this.db.selectFrom('payment_intents').select(CHARGED_INTENT_COLS).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('status', '=', 'processing')
      .where('charge_started_at', 'is not', null).where('method', 'in', [...APP_CARD_METHODS]).orderBy('charge_started_at', 'asc').execute();
  }
  /** The sweep's population is EVERY salon's charged app intents still 'processing' past the cutoff (one owner per tick,
   *  under the payments.stranded_attempts lease); each row is then verified and settled under its own tenant id.
   *  Reviewed cross-tenant read (tenant-builder baseline). */
  async strandedChargedIntents(cutoff: Date, limit: number): Promise<ChargedIntentRow[]> {
    return this.db.selectFrom('payment_intents').select(CHARGED_INTENT_COLS).where('status', '=', 'processing').where('charge_started_at', 'is not', null).where('charge_started_at', '<', cutoff)
      .where('method', 'in', [...APP_CARD_METHODS]).orderBy('charge_started_at', 'asc').limit(limit).execute();
  }
  /** B-81: every card charge mid-air on the ticket (POS card row, split / Tap to Pay attempt, another app intent). */
  async unsettledTendersForTicket(ctx: SLCtx, ticketId: string, exceptIntentId?: string | null): Promise<UnsettledTender[]> {
    return unsettledTendersForTicket(this.db, ctx.tenantId, ticketId, { exceptIntentId: exceptIntentId ?? null });
  }
  /** Processor references already recorded as payments on this ticket (so the same approval is never recorded twice). */
  async recordedProcessorRefs(ctx: SLCtx, ticketId: string): Promise<Set<string>> {
    const rows = await this.db.selectFrom('payments').select('processor_transaction_id').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('processor_transaction_id', 'is not', null).execute();
    return new Set(rows.map((r) => String(r.processor_transaction_id)));
  }

  // ---- cash confirmations ----
  async createCashConfirmation(ctx: SLCtx, c: { ticketId: string; paymentIntentId: string; customerId: string | null; technicianId: string | null; amountCents: number }): Promise<any> {
    const r = await this.db.transaction().execute(async (trx) => {
      const row: any = await trx.insertInto('cash_payment_confirmations').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: c.ticketId, invoice_id: c.ticketId, payment_intent_id: c.paymentIntentId, customer_id: c.customerId, technician_id: c.technicianId, amount_cents: c.amountCents, status: 'pending' }).returningAll().executeTakeFirstOrThrow();
      // skip_line.cash_to_tech_requested — the confirmation now waits on the technician (ids + cents; no customer name)
      if (this.outbox && row?.id) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.CASH_TO_TECH_REQUESTED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
        aggregateType: 'cash_payment_confirmation', aggregateId: String(row.id), actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${c.ticketId}`,
        payload: { confirmationId: String(row.id), ticketId: c.ticketId, paymentIntentId: c.paymentIntentId, technicianId: c.technicianId, amountCents: c.amountCents } }));
      return row;
    });
    return r;
  }
  async pendingCashForTicket(ctx: SLCtx, ticketId: string): Promise<any | null> {
    return (await this.db.selectFrom('cash_payment_confirmations').selectAll().where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('status', '=', 'pending').orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined)) ?? null;
  }
  async cashPendingForTechnician(ctx: SLCtx, technicianId: string): Promise<any[]> {
    const rows = await this.db.selectFrom('cash_payment_confirmations').selectAll().where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('status', '=', 'pending').orderBy('created_at', 'desc').execute().catch(() => []);
    const out: any[] = [];
    for (const c of rows) { const bill = await this.billForTicket(ctx, c.ticket_id); out.push({ confirmationId: c.id, ticketId: c.ticket_id, paymentIntentId: c.payment_intent_id, amountCents: num(c.amount_cents), customerName: bill?.customerName || '', ticketNumber: bill?.ticketNumber || '', services: bill?.services || [] }); }
    return out;
  }
  async setCashConfirmationStatus(ctx: SLCtx, id: string, status: CashConfStatus, byUserId: string | null, notes?: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const prev: any = await trx.selectFrom('cash_payment_confirmations').select(['status', 'ticket_id', 'technician_id', 'amount_cents']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (prev) assertTransition(CASH_PAYMENT_CONFIRMATION, String(prev.status), status);   // Phase 12 (#27): a confirmed cash payment is final
      await trx.updateTable('cash_payment_confirmations').set({ status, confirmed_by_user_id: byUserId, confirmed_at: status === 'confirmed' ? sql`now()` : null, notes: notes ?? null, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
      // skip_line.cash_to_tech_not_paid — only on the transition INTO customer_did_not_pay
      if (status === 'customer_did_not_pay' && prev && String(prev.status) !== 'customer_did_not_pay' && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.CASH_TO_TECH_NOT_PAID, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, aggregateType: 'cash_payment_confirmation', aggregateId: id,
        actorId: isUuid(byUserId) ? byUserId! : undefined, actorType: 'user', correlationId: prev.ticket_id ? `ticket:${prev.ticket_id}` : undefined,
        payload: { confirmationId: id, ticketId: prev.ticket_id ?? null, technicianId: prev.technician_id ?? null, amountCents: Number(prev.amount_cents ?? 0) } }));
    });
  }

  // ---- record a payment into the shared payments table + close the ticket (same as POS checkout) ----
  async recordPaymentAndCloseTicket(ctx: SLCtx, ticketId: string, method: string, amountCents: number, tipCents: number, opts?: { processorTxnId?: string | null; idempotencyKey?: string | null; surchargeCents?: number }): Promise<{ paymentId: string }> {
    try { return await this.recordPaymentAndCloseTicketTx(ctx, ticketId, method, amountCents, tipCents, opts); }
    catch (e: any) {
      // B-80 race (Oct 23 2026, found by the real-Postgres recovery race test): two settlers of one approved charge (staff
      // Verify + the sweep) both passed the "already recorded?" check; payments_tenant_idem_uq let ONE insert win. The
      // loser is the same payment — answer with the winner, never a raw unique-violation 500.
      if (opts?.idempotencyKey && (e?.code === '23505' || /duplicate key|unique constraint/i.test(String(e?.message ?? e)))) {
        const won = await this.db.selectFrom('payments').select('id').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', opts.idempotencyKey).where('status', '=', 'approved').executeTakeFirst();
        if (won) return { paymentId: String(won.id) };
      }
      throw e;
    }
  }
  private async recordPaymentAndCloseTicketTx(ctx: SLCtx, ticketId: string, method: string, amountCents: number, tipCents: number, opts?: { processorTxnId?: string | null; idempotencyKey?: string | null; surchargeCents?: number }): Promise<{ paymentId: string }> {
    return this.db.transaction().execute(async (trx) => {
      if (opts?.idempotencyKey) { // a retried charge with the same key must not insert a second payment row
        // B-80 (Oct 23 2026): only an APPROVED row is "this payment, already recorded" — a declined row under the same
        // key used to make the retry mark the ticket paid while the only payment row stayed 'declined'.
        const dup = await trx.selectFrom('payments').select('id').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', opts.idempotencyKey).where('status', '=', 'approved').executeTakeFirst().catch(() => undefined);
        if (dup) { await trx.updateTable('tickets').set({ status: 'paid', paid_at: sql`now()`, updated_at: sql`now()`, tip_cents: tipCents, total_cents: amountCents }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute(); return { paymentId: dup.id }; }
      }
      // Phase 15: the status BEFORE this payment decides visit.completed — only the transition into paid is a visit
      const before: any = await trx.selectFrom('tickets').select(['status', 'paid_at']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).forUpdate().executeTakeFirst();
      const ins = await trx.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, method, amount_cents: amountCents, tip_cents: tipCents, surcharge_cents: Math.max(0, opts?.surchargeCents ?? 0), tax_cents: 0, discount_cents: 0, status: 'approved', change_due_cents: 0, processor_transaction_id: opts?.processorTxnId ?? null, idempotency_key: opts?.idempotencyKey ?? null, created_by_user_id: actorUserId(ctx) } as any).returning(['id']).executeTakeFirstOrThrow();
      await trx.updateTable('tickets').set({ status: 'paid', paid_at: sql`now()`, updated_at: sql`now()`, tip_cents: tipCents, total_cents: amountCents, chosen_payment_method: method }).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
      // §343 / Constitution 8: the SAME facts a POS checkout records — a skip-line payment used to record none, so the
      // analytics rollup and platform live-ops never counted it. Only a NEW payment row is a fact (a deduped retry
      // returned above and records nothing). Integer cents + ids + method; never card data.
      if (this.outbox && ins?.id) {
        const paymentId = String(ins.id);
        const cust: any = await trx.selectFrom('tickets').select('customer_id').where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
        const customerId = cust?.customer_id ? String(cust.customer_id) : null;
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_CAPTURED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'payment', aggregateId: paymentId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
          payload: { paymentId, ticketId, customerId, method, amountCents, tipCents, surchargeCents: Math.max(0, opts?.surchargeCents ?? 0), status: 'approved', channel: 'skip_line' } }));
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.CHECKOUT_COMPLETED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'ticket', aggregateId: ticketId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
          payload: { ticketId, status: 'paid', channel: 'skip_line' } }));
        if (before && String(before.status) !== 'paid' && before.paid_at == null)   // paid, voided back to payable, paid again: one visit
          await this.outbox.write(trx, visitCompletedEvent({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, customerId, actorId: isUuid(ctx.userId) ? ctx.userId : null, channel: 'skip_line' }));
      }
      // Developer (Sep 2026): a receipt row for the paid ticket (same transaction).
      const receiptNumber = randomBytes(5).toString('hex').toUpperCase();   // 10 hex chars from the CSPRNG (was Math.random)
      await trx.insertInto('receipts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, payment_id: (ins as any).id, total_cents: amountCents, receipt_number: receiptNumber } as any).execute().catch(() => undefined);
      return { paymentId: ins.id };
    });
  }

  async recordDeclinedPayment(ctx: SLCtx, ticketId: string, method: string, amountCents: number, tipCents: number, processorTxnId: string | null, idempotencyKey: string | null, reason?: string | null, customerId?: string | null): Promise<{ paymentId: string }> {
    return this.db.transaction().execute(async (trx) => {
    const ins = await trx.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, method, amount_cents: amountCents, tip_cents: tipCents, tax_cents: 0, discount_cents: 0, status: 'declined', change_due_cents: 0, processor_transaction_id: processorTxnId, idempotency_key: idempotencyKey, created_by_user_id: actorUserId(ctx) } as any).returning(['id']).executeTakeFirstOrThrow().catch(() => ({ id: '' } as any));
    if (this.outbox && ins?.id) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_FAILED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
      aggregateType: 'payment', aggregateId: String(ins.id), actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
      payload: { paymentId: String(ins.id), ticketId, customerId: customerId ?? null, method, amountCents, tipCents, status: 'declined', channel: 'skip_line', reason: reason ? String(reason).slice(0, 120) : null } }));
    return { paymentId: ins.id };
    });
  }

  /** A saved, tokenized card for app charges (never raw PAN). Returns null if absent — caller falls back to a client token. */
  async savedCardToken(ctx: SLCtx, customerId: string, methodId: string, merchantAccountId: string | null = null): Promise<{ token: string; expiry?: string } | null> {
    // Payment master build §8D: only a provider-verified hosted-iFrame card, with consent, not revoked, bound to THIS merchant account.
    let q: any = this.db.selectFrom('customer_payment_methods').select(['token', 'exp_month', 'exp_year'])
      .where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', methodId)
      .where('token_source', '=', 'hosted_iframe').where('verified_at', 'is not', null)
      .where('consent_at', 'is not', null).where('revoked_at', 'is', null);
    q = merchantAccountId ? q.where('merchant_account_id', '=', merchantAccountId) : q.where('merchant_account_id', 'is', null);
    const r = await q.executeTakeFirst().catch(() => undefined);
    if (!r || !(r).token) return null;
    const mm = (r).exp_month, yy = (r).exp_year;
    const expiry = mm && yy ? String(mm).padStart(2, '0') + String(yy).slice(-2) : undefined;
    return { token: String(r.token), expiry };
  }

  // ---- POS skip-line state: intents + cash confirmations joined to ticket numbers ----
  async skipLineState(ctx: SLCtx): Promise<any> {
    const intents = await this.db.selectFrom('payment_intents').selectAll().where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['sent_to_customer', 'processing', 'requires_action', 'cash_pending_tech_confirmation', 'cash_issue_needs_front_desk', 'failed']).orderBy('created_at', 'desc').limit(200).execute().catch(() => []);
    const out: any[] = [];
    for (const i of intents) {
      const bill = await this.billForTicket(ctx, i.ticket_id);
      const chargeStartedAt = i.charge_started_at ? (i.charge_started_at instanceof Date ? i.charge_started_at.toISOString() : String(i.charge_started_at)) : null;
      // B-80: unsettled = the card WAS sent and the answer is not back — the POS offers "Verify" (never "pay again")
      out.push({ intentId: i.id, ticketId: i.ticket_id, ticketNumber: bill?.ticketNumber || '', customerName: bill?.customerName || '', method: i.method, status: i.status, amountCents: num(i.amount_cents),
        chargeStartedAt, unsettled: i.status === 'processing' && !!chargeStartedAt, failureReason: i.failure_reason ?? null });
    }
    return { items: out };
  }

  // ---- loyalty: award points when a ticket is paid (1 point per dollar). Best-effort; never blocks a payment. ----
  /** 1 point per whole dollar, ONCE per payment. The award is written to loyalty_point_earnings — UNIQUE(tenant_id,
   *  payment_id), the same ledger the loyalty-points consumer uses — in the same transaction as the balance credit, so a
   *  second call for the same payment (a retry, or the consumer handling PAYMENT_CAPTURED) awards nothing. It used to
   *  credit the balance with no ledger row: call it twice, award twice. */
  async awardLoyaltyForPayment(ctx: SLCtx, customerId: string | null, amountCents: number, paymentId: string, ticketId: string): Promise<{ awarded: number; balance: number } | null> {
    if (!isUuid(ctx.tenantId) || !isUuid(customerId) || !customerId || !isUuid(paymentId)) return null;
    const pts = Math.floor((amountCents || 0) / 100); // 1 loyalty point per dollar paid
    if (pts <= 0) return null;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const ledger = await sql<{ id: string }>`
          INSERT INTO loyalty_point_earnings (tenant_id, branch_id, customer_id, payment_id, ticket_id, amount_cents, points, source)
          VALUES (${ctx.tenantId}, ${ctx.branchId ?? null}, ${customerId}, ${paymentId}, ${isUuid(ticketId) ? ticketId : null}, ${amountCents}, ${pts}, 'skip_line.payment')
          ON CONFLICT (tenant_id, payment_id) DO NOTHING RETURNING id`.execute(trx);
        if (!ledger.rows.length) return null;                                   // this payment already earned
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.LOYALTY_POINTS_EARNED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'payment', aggregateId: paymentId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user',
          payload: { customerId, paymentId, ticketId: isUuid(ticketId) ? ticketId : null, points: pts, source: 'skip_line.payment' } }));
        // Phase 10: the balance moves only through the loyalty ledger (lock, profile-if-missing, `earn` row keyed by payment)
        const r = await applyLoyaltyEntry(trx as any, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, customerId, entryType: 'earn', delta: pts,
          reason: 'Points earned from purchase', sourceTable: 'payments', sourceId: paymentId, actorUserId: isUuid(ctx.userId) ? ctx.userId : null,
          legacyType: 'earn_purchase', legacySource: 'pos', newProfileTier: 'Member' });
        const balance = r.balanceAfter;
        return { awarded: pts, balance };
      });
    } catch { return null; }
  }


  // ---- audit + alert (reuse existing tenant surfaces) ----
  async audit(ctx: SLCtx, action: string, entityId: string | null, metadata: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'skip_line_checkout', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) }).execute(); } catch { /* audit never blocks */ }
  }
  async alert(ctx: SLCtx, severity: 'info' | 'warning' | 'critical', code: string, message: string, meta: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_alerts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, category: 'skip_line_checkout', severity, status: 'new', title: code, body: message, metadata: JSON.stringify(meta ?? {}) }).execute(); } catch { /* alerts never block */ }
  }
}
