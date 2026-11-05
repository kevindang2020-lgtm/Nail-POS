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
const isUuid = (x: any): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

export class SkipLineCheckoutRepository {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will the domain events reach clients (and consumers) through the outbox? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }

  // ---- identity resolvers (same links the rest of the app uses) ----
  async resolveCustomerId(ctx: SLCtx): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('customers').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null).executeTakeFirst().catch(() => undefined);
    return (r as any)?.id ?? null;
  }
  async resolveTechnicianId(ctx: SLCtx): Promise<string | null> {
    if (!ctx.tenantId || !ctx.userId) return null;
    const r = await this.db.selectFrom('technicians').select('id').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst().catch(() => undefined);
    return (r as any)?.id ?? null;
  }

  // ---- bill (backend-authoritative; recomputed from service lines + ticket columns) ----
  private async buildBill(ctx: SLCtx, t: any): Promise<Bill> {
    const lines = await this.db.selectFrom('ticket_service_lines').select(['id', 'service_name_snapshot', 'technician_id', 'line_total_cents']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', t.id).execute().catch(() => []);
    const services: BillLine[] = (lines as any[]).map((l) => ({ serviceLineId: l.id, serviceName: l.service_name_snapshot, technicianId: l.technician_id, priceCents: num(l.line_total_cents) }));
    const subtotal = services.reduce((a, l) => a + l.priceCents, 0);
    const discount = num(t.discount_cents), tax = num(t.tax_cents), tip = num(t.tip_cents);
    const totalDue = Math.max(0, subtotal - discount + tax + tip);
    let customerName = '', technicianName = '';
    if (t.customer_id) { const c = await this.db.selectFrom('customers').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', t.customer_id).executeTakeFirst().catch(() => undefined); customerName = (c as any)?.full_name || ''; }
    if (t.primary_technician_id) { const tech = await this.db.selectFrom('technicians').select('full_name').where('tenant_id', '=', ctx.tenantId).where('id', '=', t.primary_technician_id).executeTakeFirst().catch(() => undefined); technicianName = (tech as any)?.full_name || ''; }
    return { ticketId: t.id, invoiceId: t.id, ticketNumber: t.ticket_number ? '#' + t.ticket_number : '#' + String(t.id).slice(0, 6), customerId: t.customer_id, customerName, technicianId: t.primary_technician_id, technicianName, services, subtotalCents: subtotal, discountCents: discount, taxCents: tax, tipCents: tip, totalDueCents: totalDue, ticketStatus: t.status, paid: !!t.paid_at };
  }
  private ticketCols = ['id', 'customer_id', 'primary_technician_id', 'branch_id', 'status', 'discount_cents', 'tax_cents', 'tip_cents', 'subtotal_cents', 'total_cents', 'ticket_number', 'paid_at', 'service_done_at', 'ready_checkout_at', 'updated_at'] as const;
  async activeBillForCustomer(ctx: SLCtx, customerId: string): Promise<Bill | null> {
    const t = await this.db.selectFrom('tickets').select(this.ticketCols as any).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('paid_at', 'is', null).where('status', 'in', ['service_done', 'ready_checkout']).orderBy('updated_at', 'desc').executeTakeFirst().catch(() => undefined);
    return t ? this.buildBill(ctx, t) : null;
  }
  async billForTicket(ctx: SLCtx, ticketId: string): Promise<Bill | null> {
    const t = await this.db.selectFrom('tickets').select(this.ticketCols as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst().catch(() => undefined);
    return t ? this.buildBill(ctx, t) : null;
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
    const r = await this.db.insertInto('payment_intents').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: i.ticketId, invoice_id: i.ticketId, customer_id: i.customerId, amount_cents: i.amountCents, currency: 'USD', method: i.method, status: i.status, gateway: i.gateway ?? null, created_by_user_id: ctx.userId ?? null, expires_at: i.expiresAt ?? null, customer_tip_cents: Math.max(0, Math.trunc(i.customerTipCents ?? 0)) } as any).returningAll().executeTakeFirstOrThrow();
    return r;
  }
  async getIntent(ctx: SLCtx, id: string): Promise<any | null> {
    return (await this.db.selectFrom('payment_intents').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined)) ?? null;
  }
  async setIntentStatus(ctx: SLCtx, id: string, status: IntentStatus): Promise<void> {
    // Phase 12 (#27): through PAYMENT_INTENT — a succeeded intent is never re-processed (a second charge), a cancelled one
    // never revived (409); conditional, so a concurrent writer gets 409 instead of a lost update
    await transitionStatus(this.db as any, PAYMENT_INTENT, { where: { tenant_id: ctx.tenantId, id }, to: status as any, set: { updated_at: sql`now()` } });
  }

  // ---- cash confirmations ----
  async createCashConfirmation(ctx: SLCtx, c: { ticketId: string; paymentIntentId: string; customerId: string | null; technicianId: string | null; amountCents: number }): Promise<any> {
    const r = await this.db.transaction().execute(async (trx) => {
      const row: any = await trx.insertInto('cash_payment_confirmations').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: c.ticketId, invoice_id: c.ticketId, payment_intent_id: c.paymentIntentId, customer_id: c.customerId, technician_id: c.technicianId, amount_cents: c.amountCents, status: 'pending' } as any).returningAll().executeTakeFirstOrThrow();
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
    for (const c of rows as any[]) { const bill = await this.billForTicket(ctx, c.ticket_id); out.push({ confirmationId: c.id, ticketId: c.ticket_id, paymentIntentId: c.payment_intent_id, amountCents: num(c.amount_cents), customerName: bill?.customerName || '', ticketNumber: bill?.ticketNumber || '', services: bill?.services || [] }); }
    return out;
  }
  async setCashConfirmationStatus(ctx: SLCtx, id: string, status: CashConfStatus, byUserId: string | null, notes?: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const prev: any = await trx.selectFrom('cash_payment_confirmations').select(['status', 'ticket_id', 'technician_id', 'amount_cents'] as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (prev) assertTransition(CASH_PAYMENT_CONFIRMATION, String(prev.status), status);   // Phase 12 (#27): a confirmed cash payment is final
      await trx.updateTable('cash_payment_confirmations').set({ status, confirmed_by_user_id: byUserId, confirmed_at: status === 'confirmed' ? sql`now()` : null, notes: notes ?? null, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).execute();
      // skip_line.cash_to_tech_not_paid — only on the transition INTO customer_did_not_pay
      if (status === 'customer_did_not_pay' && prev && String(prev.status) !== 'customer_did_not_pay' && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.CASH_TO_TECH_NOT_PAID, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, aggregateType: 'cash_payment_confirmation', aggregateId: id,
        actorId: isUuid(byUserId) ? byUserId! : undefined, actorType: 'user', correlationId: prev.ticket_id ? `ticket:${prev.ticket_id}` : undefined,
        payload: { confirmationId: id, ticketId: prev.ticket_id ?? null, technicianId: prev.technician_id ?? null, amountCents: Number(prev.amount_cents ?? 0) } }));
    });
  }

  // ---- record a payment into the shared payments table + close the ticket (same as POS checkout) ----
  async recordPaymentAndCloseTicket(ctx: SLCtx, ticketId: string, method: string, amountCents: number, tipCents: number, opts?: { processorTxnId?: string | null; idempotencyKey?: string | null }): Promise<{ paymentId: string }> {
    return this.db.transaction().execute(async (trx) => {
      if (opts?.idempotencyKey) { // a retried charge with the same key must not insert a second payment row
        const dup = await trx.selectFrom('payments').select('id').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', opts.idempotencyKey).executeTakeFirst().catch(() => undefined);
        if (dup) { await trx.updateTable('tickets').set({ status: 'paid', paid_at: sql`now()`, updated_at: sql`now()`, tip_cents: tipCents, total_cents: amountCents } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute(); return { paymentId: (dup as any).id }; }
      }
      // Phase 15: the status BEFORE this payment decides visit.completed — only the transition into paid is a visit
      const before: any = await trx.selectFrom('tickets').select(['status', 'paid_at'] as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).forUpdate().executeTakeFirst();
      const ins = await trx.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, method, amount_cents: amountCents, tip_cents: tipCents, tax_cents: 0, discount_cents: 0, status: 'approved', change_due_cents: 0, processor_transaction_id: opts?.processorTxnId ?? null, idempotency_key: opts?.idempotencyKey ?? null, created_by_user_id: ctx.userId ?? null } as any).returning(['id']).executeTakeFirstOrThrow();
      await trx.updateTable('tickets').set({ status: 'paid', paid_at: sql`now()`, updated_at: sql`now()`, tip_cents: tipCents, total_cents: amountCents, chosen_payment_method: method } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).execute();
      // §343 / Constitution 8: the SAME facts a POS checkout records — a skip-line payment used to record none, so the
      // analytics rollup and platform live-ops never counted it. Only a NEW payment row is a fact (a deduped retry
      // returned above and records nothing). Integer cents + ids + method; never card data.
      if (this.outbox && (ins as any)?.id) {
        const paymentId = String((ins as any).id);
        const cust: any = await trx.selectFrom('tickets').select('customer_id').where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
        const customerId = cust?.customer_id ? String(cust.customer_id) : null;
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_CAPTURED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'payment', aggregateId: paymentId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
          payload: { paymentId, ticketId, customerId, method, amountCents, tipCents, surchargeCents: 0, status: 'approved', channel: 'skip_line' } }));
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.CHECKOUT_COMPLETED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'ticket', aggregateId: ticketId, actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
          payload: { ticketId, status: 'paid', channel: 'skip_line' } }));
        if (before && String(before.status) !== 'paid' && before.paid_at == null)   // paid, voided back to payable, paid again: one visit
          await this.outbox.write(trx, visitCompletedEvent({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId, customerId, actorId: isUuid(ctx.userId) ? ctx.userId : null, channel: 'skip_line' }));
      }
      // Developer (Sep 2026): a receipt row for the paid ticket (same transaction).
      const receiptNumber = randomBytes(5).toString('hex').toUpperCase();   // 10 hex chars from the CSPRNG (was Math.random)
      await trx.insertInto('receipts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, payment_id: (ins as any).id, total_cents: amountCents, receipt_number: receiptNumber } as any).execute().catch(() => undefined);
      return { paymentId: (ins as any).id };
    });
  }

  async recordDeclinedPayment(ctx: SLCtx, ticketId: string, method: string, amountCents: number, tipCents: number, processorTxnId: string | null, idempotencyKey: string | null, reason?: string | null, customerId?: string | null): Promise<{ paymentId: string }> {
    return this.db.transaction().execute(async (trx) => {
    const ins = await trx.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: ticketId, method, amount_cents: amountCents, tip_cents: tipCents, tax_cents: 0, discount_cents: 0, status: 'declined', change_due_cents: 0, processor_transaction_id: processorTxnId, idempotency_key: idempotencyKey, created_by_user_id: ctx.userId ?? null } as any).returning(['id']).executeTakeFirstOrThrow().catch(() => ({ id: '' } as any));
    if (this.outbox && (ins as any)?.id) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_FAILED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
      aggregateType: 'payment', aggregateId: String((ins as any).id), actorId: isUuid(ctx.userId) ? ctx.userId! : undefined, actorType: 'user', correlationId: `ticket:${ticketId}`,
      payload: { paymentId: String((ins as any).id), ticketId, customerId: customerId ?? null, method, amountCents, tipCents, status: 'declined', channel: 'skip_line', reason: reason ? String(reason).slice(0, 120) : null } }));
    return { paymentId: (ins as any).id };
    });
  }

  /** A saved, tokenized card for app charges (never raw PAN). Returns null if absent — caller falls back to a client token. */
  async savedCardToken(ctx: SLCtx, customerId: string, methodId: string): Promise<{ token: string; expiry?: string } | null> {
    const r = await this.db.selectFrom('customer_payment_methods').select(['token', 'exp_month', 'exp_year'] as any).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('id', '=', methodId).executeTakeFirst().catch(() => undefined);
    if (!r || !(r as any).token) return null;
    const mm = (r as any).exp_month, yy = (r as any).exp_year;
    const expiry = mm && yy ? String(mm).padStart(2, '0') + String(yy).slice(-2) : undefined;
    return { token: String((r as any).token), expiry };
  }

  // ---- POS skip-line state: intents + cash confirmations joined to ticket numbers ----
  async skipLineState(ctx: SLCtx): Promise<any> {
    const intents = await this.db.selectFrom('payment_intents').selectAll().where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['sent_to_customer', 'processing', 'requires_action', 'cash_pending_tech_confirmation', 'cash_issue_needs_front_desk', 'failed'] as any).orderBy('created_at', 'desc').limit(200).execute().catch(() => []);
    const out: any[] = [];
    for (const i of intents as any[]) { const bill = await this.billForTicket(ctx, i.ticket_id); out.push({ intentId: i.id, ticketId: i.ticket_id, ticketNumber: bill?.ticketNumber || '', customerName: bill?.customerName || '', method: i.method, status: i.status, amountCents: num(i.amount_cents) }); }
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
    try { await this.db.insertInto('owner_audit_log').values({ tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, user_id: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null, action, entity_type: 'skip_line_checkout', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) } as any).execute(); } catch { /* audit never blocks */ }
  }
  async alert(ctx: SLCtx, severity: 'info' | 'warning' | 'critical', code: string, message: string, meta: any): Promise<void> {
    if (!isUuid(ctx.tenantId)) return;
    try { await this.db.insertInto('owner_alerts').values({ tenant_id: ctx.tenantId, branch_id: (ctx.branchId as any) ?? null, category: 'skip_line_checkout', severity, status: 'new', title: code, body: message, metadata: JSON.stringify(meta ?? {}) } as any).execute(); } catch { /* alerts never block */ }
  }
}
