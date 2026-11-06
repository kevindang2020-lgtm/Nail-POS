// checkout.kysely.repository.ts — production CheckoutRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over tickets, ticket_service_lines, payments (+ customers/technicians for labels).
// Money math flows through the same dto helpers so totals never drift. Scope is session-derived.
//
// Schema notes (honest — 017 has no columns/tables for these, so they are NOT faked — in-process/default, documented):
//  - tickets has no tip / chosen-method / locked-total columns → those are held in-process per ticket (totals still
//    compute correctly within a running server; persisting them is a follow-up).
//  - payments has no change-due / processor-txn / idempotency-key columns → those round-trip on the returned object but
//    are not stored. gift cards have no table → gift balance is null (unsupported). Card processor (Fiserv) is honestly
//    'not_configured'.
//  - customer-display devices and display sessions ARE persisted to the real customer_display_devices /
//    customer_display_sessions tables: devices() reads real non-revoked rows; sessions are real rows carrying tip,
//    totals, method, state, and expiry. A device's stationCode is its register (pos_station_id → pos_stations, migration
//    511): a display DEDICATED to a register, or '' when SHARED by the branch. Which display a checkout goes to is
//    decided by display-send-core.ts from the POS's own register — never from the ticket's free-text station label.
import type { RewardCodeRow } from './loyalty-reward-code';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { visitCompletedEvent } from './visit-completed';
import { KyselyTerminalLeases, type TerminalLeasePort } from './terminal-lease';
import { hashCardNumber, lastFour, generateCardNumber, maskFromLast4, hashCardPin, crossTenantRedeemable, clearingObligation, giftCardChargeForTicket, GIFT_CARD, GIFT_CARD_STOCK } from '@aipowersalon/gift-cards';
import { PAYMENT } from '@aipowersalon/payments';
import { secureString } from '@aipowersalon/security';
import { refundNeedsApprover, refundThresholds, type RefundThresholds } from './refund-approval';
import { randomBytes, createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { couponOf, itemizedDiscounts } from './checkout-discount-items';
import type { DB } from '@aipowersalon/database';
import { applyLoyaltyEntry } from '@aipowersalon/customers';
import { branchTimeZone, transitionStatus, canMoveToSql, assertTransition, InvalidStateTransitionError } from '@aipowersalon/database';
import { PAYMENT_ATTEMPT } from './payment-attempt-machine';
import { LOYALTY_REDEMPTION, PAYMENT_REFUND, TICKET_CHECKOUT } from './checkout-lifecycles';
import { dayStartMs } from '@aipowersalon/date-time';
import type { CheckoutContext, CheckoutRepositoryPort } from './checkout.repository';
import { SplitRedemptionError, PaymentPersistenceError } from './checkout.repository';
import { Money, PaymentMethod, CheckoutSettings, CheckoutTotals } from './checkout-display.dto';
import { resolveCheckoutSettings, resolveGiftCardSaleSettings } from './checkout-settings.resolver';
import {
  POSCheckoutFullState, POSCheckoutTicketRow, POSCheckoutKpisFull, buildCheckoutAnalytics, POSCheckoutPaymentSettingsFull, CheckoutKpis,
  CheckoutAttentionItem, ReadyStaffRow, CheckoutPotentialRevenue, buildStaffRows,
  POSCustomerDisplayDevice, POSCustomerDisplaySession, PaymentRecord, CheckoutFilters, TicketStatus, resolvePaymentStatus,
  CheckoutTicketDetail, totalsForMethod, subtotalFromLines, GiftCard, GiftCardDetail, computeUpsellCapturePercent,
  buildUpsellMix, effectiveLineKind, CheckoutInProgressError, DisplayBusyError, type OpenDisplaySession } from './checkout.dto';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import type { CustomerDisplayCheckout } from '@aipowersalon/api-contracts/customer';
import { DISPLAY_ONLINE_WINDOW_MS } from '@aipowersalon/api-contracts';
import { buildCustomerDisplayCheckout } from './customer-display-projection';

import type { Ticket } from './checkout.repository';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? new Date().toISOString() : String(v));
const hhmm = (v: any) => { const d = new Date(iso(v)); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
const initials = (name: string) => name.split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase();
import { giftCardLast4 } from './gift-card-last4';
const isUuidStr = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
/** Ticket statuses that are finished — they leave the checkout board after their day. */
const CLOSED_TICKET_STATUSES = ['paid', 'void', 'voided', 'cancelled', 'canceled', 'refunded', 'closed'];
const STATUS_MAP: Record<string, TicketStatus> = { ready_checkout: 'ready_for_payment', service_done: 'ready_for_payment', paid: 'paid', reopened: 'reopened' };
/** The board status, from the row alone: paid (tickets.status — whoever recorded it) wins; a held unpaid ticket is on
 *  hold; otherwise its stored board state (migration 572), or its tickets.status mapping when it never had one. */
function boardStatus(t: { status: string; checkout_held_at?: unknown; checkout_status?: string | null }): TicketStatus {
  if (t.status === 'paid') return 'paid';
  if (t.checkout_held_at) return 'on_hold';
  return (t.checkout_status as TicketStatus) || STATUS_MAP[t.status] || 'ready_for_payment';
}

export class KyselyCheckoutRepository implements CheckoutRepositoryPort {
  // Round 2 C (Oct 12 2026): no per-process ticket state. The board status (tickets.checkout_status, migration 572) and the
  // discount are read from the row every time — a Map here showed one API replica's view to that replica only.
  // Constitution 8 §18/§102: payment.captured is written INSIDE the payment transaction. Optional and null-safe.
  /** `workforce` (merge Oct 12 2026): the ONE authoritative technician state for the Ready Technicians card; absent →
   *  the technician_statuses compat table, as before. Structural (no Nest coupling). */
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null, private readonly workforce: { legacyStatusMap(tenantId: string, branchId: string | null, ids: string[]): Promise<Record<string, string>> } | null = null) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** The instant the BRANCH's day began, at its own midnight — "today" for the KPIs. The database's own day is UTC:
   *  after 8 pm in New York the evening dropped out of today (Oct 6 2026). */
  private async dayStart(ctx: { tenantId: string; branchId?: string | null }): Promise<Date> {
    return new Date(dayStartMs(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())));
  }
  /** Functional Decision 34: one transaction per terminal across every API instance (migration 485). */
  get terminalLeases(): TerminalLeasePort { return (this._leases ??= new KyselyTerminalLeases(this.db as any)); }
  private _leases?: TerminalLeasePort;
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON

  private scoped(qb: any, ctx: CheckoutContext): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    return q;
  }
  private settingsToFull(s: CheckoutSettings): POSCheckoutPaymentSettingsFull {
    return { cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true, cardSurchargeEnabled: s.creditCardSurchargeEnabled, cardSurchargePercent: s.creditCardSurchargePercent, taxRatePercent: s.taxRatePercent, tipsEnabled: true, defaultTipPercents: s.defaultTipPercents, allowCustomTip: true, allowNoTip: true, customerDisplayMode: s.customerDisplayPayButtonEnabled ? 'customer_pays' : 'review_only', fiservStatus: resolvePaymentStatus() };
  }
  // EFFECTIVE settings for this tenant/branch from tenant_settings (tips/tax/payments-checkout), defaults when unset.
  private resolveSettings(ctx: CheckoutContext): Promise<CheckoutSettings> { return resolveCheckoutSettings(this.db, ctx.tenantId, ctx.branchId); }
  async settings(ctx: CheckoutContext) { return this.settingsToFull(await this.resolveSettings(ctx)); }
  async giftCardSaleSettings(ctx: CheckoutContext) { return resolveGiftCardSaleSettings(this.db, ctx.tenantId, ctx.branchId); }

  private async _ticket(ctx: CheckoutContext, id: string): Promise<Ticket | null> {
    const t = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id)
      .select(['id', 'customer_id', 'primary_technician_id', 'status', 'discount_cents', 'discount_snapshot', 'created_at', 'tip_cents', 'tip_type', 'tip_percent', 'chosen_payment_method', 'locked_total_cents', 'ticket_number', 'station_label', 'checkout_held_at', 'checkout_register_id', 'checkout_status']).executeTakeFirst().catch(() => undefined);
    if (!t) return null;
    // discount_snapshot: every discount writer (manual, promotion, deal, membership, loyalty) rebuilds the stack from
    // t.discountSnapshot.applied. This loader never selected it, so each new discount REPLACED the others — a membership
    // credit vanished when the front desk added a manual discount. Found by the 23-inch display work (Oct 6 2026).
    return this.hydrate(ctx, t);
  }
  async ticket(ctx: CheckoutContext, id: string) { return this._ticket(ctx, id); }

  private async hydrate(ctx: CheckoutContext, t: any): Promise<Ticket> {
    const lines = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', '=', t.id)
      .select(['id', 'service_name_snapshot', 'technician_id', 'line_total_cents', 'line_kind', 'is_add_on', 'quantity', 'price_cents_snapshot', 'product_id']).orderBy('created_at', 'asc').orderBy('id', 'asc').execute().catch(() => []);   // the order they were added (id breaks a tie) — stable, so a refresh never reorders the customer's ticket
    let custName = '', phone: string | undefined, email: string | undefined, vip = false;
    if (t.customer_id) { const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', t.customer_id).select(['full_name', 'phone_display', 'normalized_phone', 'email'] as any).executeTakeFirst().catch(() => undefined); if (c) { custName = (c as any).full_name || ''; phone = (c as any).normalized_phone || (c as any).phone_display || undefined; email = (c as any).email || undefined; } }
    if (!custName && t.queue_item_id) {
      const q = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', t.queue_item_id).select(['customer_name', 'customer_phone']).executeTakeFirst().catch(() => undefined);
      if (q) { custName = q.customer_name || ''; phone = phone || q.customer_phone || undefined; }
    }
    if (!custName) {
      const tq = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('ticket_id', '=', t.id).select(['customer_name', 'customer_phone']).executeTakeFirst().catch(() => undefined);
      if (tq) { custName = tq.customer_name || ''; phone = phone || tq.customer_phone || undefined; }
    }
    if (!custName) custName = 'Guest Customer';
    let primaryTech: string | undefined;
    if (t.primary_technician_id) { const tech = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', t.primary_technician_id).select('full_name').executeTakeFirst().catch(() => undefined); primaryTech = (tech as any)?.full_name || undefined; }
    const lineNames: Record<string, string> = {};
    const techIds = lines.map((l: any) => l.technician_id).filter(Boolean);
    if (techIds.length) { const techs = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => []); for (const x of techs) lineNames[x.id] = x.full_name; }
    const gcCharge = await this.giftCardChargeFor(ctx, t.id);
    return {
      ticketId: t.id, ticketNumber: t.ticket_number ? '#' + t.ticket_number : '#' + String(t.id).slice(0, 6), customerId: t.customer_id || '', customerName: custName, customerInitials: initials(custName || '?'), customerPhone: phone, customerEmail: email, isVip: vip,
      station: t.station_label || undefined, registerId: t.checkout_register_id ? String(t.checkout_register_id) : undefined, lines: lines.map((l: any) => ({ serviceLineId: l.id, serviceName: l.service_name_snapshot, technicianId: l.technician_id || undefined, technicianName: l.technician_id ? lineNames[l.technician_id] : undefined, priceCents: Number(l.line_total_cents || 0), kind: effectiveLineKind(l.line_kind, l.is_add_on), quantity: l.quantity == null ? undefined : Number(l.quantity), catalogCents: l.price_cents_snapshot == null ? undefined : Number(l.price_cents_snapshot), productId: l.product_id ?? null })),
      primaryTechName: primaryTech, helperTechName: undefined, loyaltyTier: undefined, qualityApproved: true, finishedAt: iso(t.created_at), notes: '', tipCents: Number(t.tip_cents || 0), tipType: (t as any).tip_type || 'none', tipPercent: (t as any).tip_percent == null ? null : Number((t as any).tip_percent), discountCents: Number(t.discount_cents || 0),
      method: ((t.chosen_payment_method as PaymentMethod) || 'card'), lockedTotalCents: t.locked_total_cents != null ? Number(t.locked_total_cents) : null, status: boardStatus(t), createdAt: iso(t.created_at), giftCardChargeCents: gcCharge,
      discountSnapshot: t.discount_snapshot ? (typeof t.discount_snapshot === 'string' ? JSON.parse(t.discount_snapshot) : t.discount_snapshot) : undefined,
    };
  }

  // Pending gift-card value the customer owes on THIS ticket: cards SOLD on it (by sale_ticket_id, any non-void status —
  // stable across the pending→active flip at payment) plus reload HOLDS on it. Added to the total by computeTotals,
  // untaxed. Two small indexed lookups.
  private async giftCardChargeFor(ctx: CheckoutContext, ticketId: string): Promise<number> {
    return giftCardChargeForTicket(this.db, ctx.tenantId, ticketId);
  }

  private effSubtotal(t: Ticket) { return Math.max(0, subtotalFromLines(t.lines) - t.discountCents); }

  async totalsFor(ctx: CheckoutContext, id: string, method?: PaymentMethod): Promise<CheckoutTotals | null> {
    const t = await this._ticket(ctx, id); if (!t) return null;
    const settings = await this.resolveSettings(ctx);
    return totalsForMethod(this.effSubtotal(t), t.tipCents, settings, method || t.method, t.giftCardChargeCents ?? 0);
  }
  private toRow(ctx: CheckoutContext, t: Ticket, settings: CheckoutSettings): POSCheckoutTicketRow {
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, settings, t.method, t.giftCardChargeCents ?? 0);
    return { ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName, customerPhone: t.customerPhone, isVip: t.isVip, station: t.station, serviceCount: t.lines.length, completedAt: t.finishedAt, finishedAt: t.finishedAt, subtotalCents: totals.subtotalCents, tipCents: totals.tipCents, taxCents: totals.taxCents, surchargeCents: totals.surchargeCents, discountCents: t.discountCents, totalDueCents: totals.totalDueCents, status: t.status, primaryTechnicianName: t.primaryTechName, helperTechnicianName: undefined, servicesLabel: t.lines[0]?.serviceName ? (t.lines[0].serviceName + (t.lines.length > 1 ? ` +${t.lines.length - 1}` : "")) : undefined };
  }
  /** The checkout BOARD's tickets: every ticket still open (any age — an unpaid ticket stays until it is settled) plus
   *  every ticket created or paid since the branch's midnight. BUILD_PLAN Phase 10 load finding: this loaded and
   *  hydrated EVERY ticket the branch ever had (≈5 queries each) — 36–42 s per request at ~6,700 tickets. History is
   *  the transactions screen's job. `OPEN_CAP` is a safety bound on open tickets (newest first). */
  private async loadBoard(ctx: CheckoutContext, since: Date): Promise<Ticket[]> {
    const OPEN_CAP = 500;
    const rows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where((eb: any) => eb.or([
        eb('status', 'not in', CLOSED_TICKET_STATUSES),
        eb('created_at', '>=', since),
        eb('paid_at', '>=', since),
      ]))
      .select(['id', 'customer_id', 'primary_technician_id', 'status', 'discount_cents', 'discount_snapshot', 'created_at', 'tip_cents', 'chosen_payment_method', 'locked_total_cents', 'ticket_number', 'station_label', 'checkout_held_at', 'checkout_register_id', 'checkout_status']).orderBy('created_at', 'desc').limit(OPEN_CAP).execute().catch(() => []);
    return Promise.all(rows.map((r: any) => this.hydrate(ctx, r)));
  }
  /** Payments since `since` only — the board's KPIs are today's (was: every payment the branch ever took). */
  private async paymentsSince(ctx: CheckoutContext, since: Date): Promise<PaymentRecord[]> {
    const rows = await this.scoped(this.db.selectFrom('payments'), ctx).where('created_at', '>=', since as any).select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'status', 'created_at']).execute().catch(() => []);
    return rows.map((p: any) => ({ paymentId: p.id, ticketId: p.ticket_id, method: p.method, amountCents: Number(p.amount_cents), tipCents: Number(p.tip_cents || 0), status: p.status, createdAt: iso(p.created_at) }));
  }

  async query(ctx: CheckoutContext, f: CheckoutFilters): Promise<POSCheckoutFullState> {
    const dayStart = await this.dayStart(ctx);
    const all = await this.loadBoard(ctx, dayStart);
    const settings = await this.resolveSettings(ctx);
    let rows = all.slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.station, t.primaryTechName, ...t.lines.map((l) => l.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.paymentMethod) rows = rows.filter((t) => t.method === f.paymentMethod);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t, settings));
    const pays = await this.paymentsSince(ctx, dayStart);
    // paid TODAY = since the branch's midnight (Oct 6 2026 — was the server's UTC date, which rolled over at 8 pm in New York)
    const since = dayStart.getTime(); const isToday = (at: string | null | undefined) => !!at && Date.parse(at) >= since;
    const unpaid = all.filter((t) => t.status !== 'paid' && t.status !== 'failed' && t.status !== 'on_hold');   // a held ticket waits aside (Oct 6 2026)
    const paidToday = pays.filter((p) => p.status === 'approved' && isToday(p.createdAt));
    const readyTotals = unpaid.map((t) => totalsForMethod(this.effSubtotal(t), t.tipCents, settings, t.method, t.giftCardChargeCents ?? 0));
    // Surcharge + tax collected today, method-agnostic: a paid ticket's charged total (sum of its approved payments
    // today) minus its base (subtotal + tip + tax) is exactly the surcharge that was added — works for straight card
    // (amount includes surcharge), cash/gift (no surcharge → 0), and split (Option A: the card segment carries the
    // surcharge, so the segment sum exceeds base by exactly the card-portion surcharge). Never negative.
    const taxRate = settings.taxRatePercent || 0;
    const ticketById = new Map(all.map((t) => [t.ticketId, t]));
    const chargedByTicket = new Map<string, number>();
    for (const p of paidToday) chargedByTicket.set(p.ticketId, (chargedByTicket.get(p.ticketId) || 0) + p.amountCents);
    let surchargeCollectedCents = 0, taxCollectedCents = 0;
    for (const [tid, charged] of chargedByTicket) {
      const t = ticketById.get(tid); if (!t) continue;
      const sub = this.effSubtotal(t); const tax = Math.round(sub * (taxRate / 100)); const base = sub + t.tipCents + tax;
      surchargeCollectedCents += Math.max(0, charged - base);
      taxCollectedCents += tax;
    }
    const paidTicketIds = [...new Set(paidToday.map((p) => p.ticketId))];
    // ---- Reference-module aggregations (real, fail-soft; honest gaps left empty/null where no backing column) ----
    // Transactions Needing Attention: derived from real ticket status signals.
    const attention: CheckoutAttentionItem[] = unpaid
      .filter((t) => ['failed', 'partial', 'split'].includes(String(t.status)) || (t.method === 'split'))
      .slice(0, 25)
      .map((t) => {
        const isFailed = String(t.status) === 'failed';
        const isPartial = String(t.status) === 'partial';
        const isSplit = t.method === 'split' || String(t.status) === 'split';
        const type = isFailed ? 'Failed Payment' : isPartial ? 'Partial Payment' : isSplit ? 'Split Payment' : 'Needs Attention';
        const issue = isFailed ? 'Payment failed — review before retrying' : isPartial ? 'Balance remaining' : isSplit ? 'Awaiting next payment' : 'Open ticket';
        return { type, label: type, guest: t.customerName, issue, time: hhmm(t.finishedAt || t.createdAt), ticketId: t.ticketId, severity: (isFailed ? 'danger' : isPartial ? 'warn' : 'info') as 'info' | 'warn' | 'danger' };
      });
    // Potential Revenue in Queue: open (unpaid) tickets only — never reported as settled revenue.
    const queueServicesCents = unpaid.reduce((a, t) => a + this.effSubtotal(t), 0);
    const queueTipsEstCents = unpaid.reduce((a, t) => a + (t.tipCents || 0), 0);
    // Retail slice: real, from line_kind === 'retail' on the queued tickets. Split out of the services bucket so the
    // total is unchanged; only the breakdown gains a real Retail line.
    const queueRetailCents = unpaid.reduce((a, t) => a + (t.lines as any[]).filter((l) => l.kind === 'retail').reduce((s, l) => s + (l.priceCents || 0), 0), 0);
    const potentialRevenue: CheckoutPotentialRevenue = { totalCents: queueServicesCents + queueTipsEstCents, servicesCents: Math.max(0, queueServicesCents - queueRetailCents), retailCents: queueRetailCents, tipsEstCents: queueTipsEstCents, ticketCount: unpaid.length };
    // Checkout Conversion (Service Done → Checkout): paid today vs all tickets that reached checkout today.
    const eligibleToday = paidTicketIds.length + unpaid.length;
    const conversionPercent = eligibleToday > 0 ? Math.round((paidTicketIds.length / eligibleToday) * 1000) / 10 : null;
    // Available Front Desk / Ready Technicians — the authoritative workforce state when bound (merge Oct 12 2026), else
    // real presence from technician_statuses (same source as Overview/Serving).
    const techRows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name', 'status']).execute().catch(() => [] as any[]);
    const techIds = (techRows as any[]).map((r) => r.id);
    let statBy: Record<string, string> = {};
    if (this.workforce && techIds.length) statBy = await this.workforce.legacyStatusMap(ctx.tenantId, ctx.branchId || null, techIds).catch(() => ({}));
    else {
      const statRows = techIds.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', techIds).select(['technician_id', 'status']).execute().catch(() => [] as any[]) : [];
      for (const sr of statRows as any[]) statBy[sr.technician_id] = sr.status;
    }
    const staff: ReadyStaffRow[] = buildStaffRows((techRows as any[]).map((r) => ({ id: r.id, name: r.full_name || r.id, baseStatus: r.status })), statBy);
    // Upsell Mix: real share of upsell lines (add_on / retail / upgrade) across today's paid tickets, by line_kind.
    let upsellMix: { category: string; sharePercent: number }[] = [];
    if (paidTicketIds.length) {
      const mixRows = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx)
        .where('ticket_id', 'in', paidTicketIds)
        .select([sql<string>`coalesce(line_kind, case when is_add_on then 'add_on' else 'service' end)`.as('kind'), sql<number>`count(*)`.as('c')])
        .groupBy('kind').execute().catch(() => [] as any[]);
      upsellMix = buildUpsellMix((mixRows as any[]).map((r) => ({ kind: String(r.kind), count: Number(r.c || 0) })));
    }
    const analytics = buildCheckoutAnalytics(paidToday, { conversionPercent, potentialRevenue, upsellMix, revenueTrendDeltaPercent: null });
    let receiptDeliveryRatePercent = 0;
    let averageCheckoutSeconds = 0;
    if (paidTicketIds.length) {
      const rcpts = await this.scoped(this.db.selectFrom('receipts'), ctx).where('ticket_id', 'in', paidTicketIds).select('ticket_id').execute().catch(() => [] as any[]);
      const withReceipt = new Set((rcpts as any[]).map((r) => r.ticket_id)).size;
      receiptDeliveryRatePercent = Math.round((withReceipt / paidTicketIds.length) * 100);
      const durRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
        .where('id', 'in', paidTicketIds).where('ready_checkout_at', 'is not', null).where('paid_at', 'is not', null)
        .select(sql<number>`coalesce(round(avg(extract(epoch from (paid_at - ready_checkout_at)))), 0)`.as('secs'))
        .executeTakeFirst().catch(() => undefined);
      averageCheckoutSeconds = Math.max(0, Number((durRow as any)?.secs || 0));
    }
    // Gift card + loyalty (wallet) redemptions today. These ledgers are tenant-wide (no branch column), so scope by
    // tenant id directly. The `as any` builder is the same dynamic-query idiom scoped() uses for sql() date predicates.
    // Gift-card 'redeem' rows store a positive amount; wallet 'payment' debits are stored negative.
    const gcRow = await (this.db.selectFrom('gift_card_transactions') as any)
      .where('tenant_id', '=', ctx.tenantId).where('type', '=', 'redeem')
      .where('created_at', '>=', (await this.dayStart(ctx)) as any)
      .select(sql<number>`coalesce(sum(amount_cents), 0)`.as('cents'))
      .executeTakeFirst().catch(() => undefined);
    const giftCardRedeemedCents = Math.max(0, Math.round(Number((gcRow as any)?.cents || 0)));
    const walletRow = await (this.db.selectFrom('customer_wallet_ledger') as any)
      .where('tenant_id', '=', ctx.tenantId).where('entry_type', '=', 'payment')
      .where('created_at', '>=', (await this.dayStart(ctx)) as any)
      .select(sql<number>`coalesce(-sum(amount_cents), 0)`.as('cents'))
      .executeTakeFirst().catch(() => undefined);
    const walletRedeemedCents = Math.max(0, Math.round(Number((walletRow as any)?.cents || 0)));
    const giftCardLoyaltyRedemptionsCents = giftCardRedeemedCents + walletRedeemedCents;
    // Upsell capture: share of today's paid tickets carrying at least one add-on line.
    let upsellTicketsWithAddOn = 0;
    if (paidTicketIds.length) {
      const addonRows = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx)
        .where('ticket_id', 'in', paidTicketIds).where('is_add_on', '=', true)
        .select('ticket_id').distinct().execute().catch(() => []);
      upsellTicketsWithAddOn = addonRows.length;
    }
    const upsellCapturePercent = computeUpsellCapturePercent(upsellTicketsWithAddOn, paidTicketIds.length);
    const kpisFull: POSCheckoutKpisFull = {
      ticketsReadyForPayment: unpaid.length, subtotalCents: readyTotals.reduce((a, x) => a + x.subtotalCents, 0), tipsTodayCents: paidToday.reduce((a, p) => a + p.tipCents, 0),
      cardSurchargeCollectedCents: surchargeCollectedCents, taxCollectedCents: taxCollectedCents, paidTicketsToday: paidTicketIds.length,
      failedPaymentsToday: pays.filter((p) => p.status === 'declined' && isToday(p.createdAt)).length,
      customerDisplayActiveSessions: (await this.scoped(this.db.selectFrom('customer_display_sessions'), ctx).where('state', '!=', 'disconnected').where((eb: any) => eb('expires_at', '>', sql`now()`)).select('id').execute().catch(() => [])).length,
      receiptDeliveryRatePercent,
      averageCheckoutSeconds,
      giftCardLoyaltyRedemptionsCents,
      upsellCapturePercent,
    };
    const kpis: CheckoutKpis = { readyForCheckoutCount: unpaid.length, subtotalTodayCents: kpisFull.subtotalCents, tipsTodayCents: kpisFull.tipsTodayCents, cardSurchargeCollectedCents: kpisFull.cardSurchargeCollectedCents };
    // Real day-over-day trends: snapshot today's checkout KPIs and compare against the latest prior business day.
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'checkout', {
      guestsReady: kpisFull.ticketsReadyForPayment, completed: kpisFull.paidTicketsToday, pending: kpisFull.failedPaymentsToday,
      revenue: kpisFull.subtotalCents, tips: kpisFull.tipsTodayCents, avgTime: kpisFull.averageCheckoutSeconds,
      redemptions: kpisFull.giftCardLoyaltyRedemptionsCents, upsell: kpisFull.upsellCapturePercent, receiptRate: kpisFull.receiptDeliveryRatePercent,
    }, ['avgTime']);
    return {
      kpis, kpisFull, kpiTrends, analytics, attention, staff, tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } }, paymentSettings: this.settingsToFull(settings),
      customerDisplay: { pairedDevices: (await this.devices(ctx)).filter((d) => d.paired), activeSession: await this.activeSession(ctx) },
      filters: { statuses: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'paid', 'failed', 'reopened', 'on_hold'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean), technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean), paymentMethods: ['card', 'cash', 'gift_card', 'split'] },
    };
  }

  async detail(ctx: CheckoutContext, id: string): Promise<CheckoutTicketDetail | null> {
    const t = await this._ticket(ctx, id); if (!t) return null;
    const settings = await this.resolveSettings(ctx);
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, settings, t.method, t.giftCardChargeCents ?? 0);
    // Real per-line category + commission from the service-line snapshots (category only — the commission block is the authority preview, see below).
    const rawLines = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', '=', id)
      .select(['id', 'service_id', 'technician_id', 'line_total_cents', 'commission_type_snapshot', 'commission_value_snapshot']).execute().catch(() => [] as any[]);
    const catByLine: Record<string, string> = {};
    const serviceIds = [...new Set((rawLines as any[]).map((l) => l.service_id).filter(Boolean))];
    if (serviceIds.length) {
      const svc = await this.scoped(this.db.selectFrom('services'), ctx).where('id', 'in', serviceIds).select(['id', 'category_id']).execute().catch(() => [] as any[]);
      const catIds = [...new Set((svc as any[]).map((x) => x.category_id).filter(Boolean))];
      const catNames: Record<string, string> = {};
      if (catIds.length) { const cats = await this.scoped(this.db.selectFrom('service_categories'), ctx).where('id', 'in', catIds).select(['id', 'name']).execute().catch(() => [] as any[]); for (const c of cats as any[]) catNames[c.id] = c.name; }
      const catByService: Record<string, string> = {}; for (const x of svc as any[]) catByService[x.id] = catNames[x.category_id] || 'Service';
      for (const l of rawLines as any[]) catByLine[l.id] = catByService[l.service_id] || 'Service';
    }
    // Oct 13 2026 (FLOW duplicate D6 merged): the commission block is filled by CheckoutService.withAuthorityCommission
    // from the compensation authority (snapshot / engine). The repository's own precedence (rules > stamp > current
    // technician rate > service rate > a 50 % guess, on the undiscounted price) was a second commission formula.
    const commission = null;
    // Preferred technician (real customer field).
    let preferredTechName: string | undefined;
    if (t.customerId) { const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', t.customerId).select('preferred_technician_id').executeTakeFirst().catch(() => undefined); const pid = (c as any)?.preferred_technician_id; if (pid) { const tn = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', pid).select('full_name').executeTakeFirst().catch(() => undefined); preferredTechName = (tn as any)?.full_name || undefined; } }
    const discountCents = t.discountCents || 0;
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber,
      customer: { customerId: t.customerId, fullName: t.customerName, initials: t.customerInitials, phone: t.customerPhone, email: t.customerEmail, isVip: t.isVip, loyaltyTier: undefined, preferredTechName },
      stationLabel: t.station, completedServices: t.lines.map((l) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, category: catByLine[l.serviceLineId] || 'Service', technicianId: l.technicianId, technicianName: l.technicianName, priceCents: l.priceCents, qty: 1, status: 'done' as const })),
      // BUILD_PLAN Phase 5, bug 14: this was { code: 'DISCOUNT', amountCents: <every discount> } — the POS showed a
      // "DISCOUNT Applied" coupon chip for a manual discount, a membership credit or a deal alike. `promotion` is now
      // only a real coupon on the ticket; `discounts` itemizes every discount (what it is, how much, which deal).
      promotion: couponOf((t as any).discountSnapshot),
      discounts: itemizedDiscounts((t as any).discountSnapshot, discountCents),
      discountSnapshot: (t as any).discountSnapshot,
      commission,
      technicians: { primary: t.primaryTechName ? { technicianId: 'tech_primary', name: t.primaryTechName } : undefined, helpers: [] },
      finishedAt: t.finishedAt, qualitySummary: { serviceCompleted: true, customerReady: true, qualityChecked: true, noOpenIssues: true, approved: true },
      serviceNotes: t.notes, totals, receiptDeliveryOptions: { sms: !!t.customerPhone, email: !!t.customerEmail, app: !!t.customerId, print: true },
    };
  }

  async setTip(ctx: CheckoutContext, id: string, tipCents: Money, meta?: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }) { const patch: any = { tip_cents: tipCents, locked_total_cents: null, updated_at: sql`now()` }; if (meta) { patch.tip_type = meta.tipType; patch.tip_percent = meta.tipPercent; } const res = await this.scoped(this.db.updateTable('tickets'), ctx).set(patch).where('id', '=', id).executeTakeFirst().catch(() => undefined); return Number((res as any)?.numUpdatedRows ?? 0) > 0; }
  /** BUILD_PLAN Phase 5, bug 13: the checkout audit trail, persisted (append-only audit_logs; the tenant Audit Log reads it). */
  async persistAudit(e: { tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string; entityId?: string; before?: unknown; after?: unknown; metadata?: unknown }): Promise<void> {
    const uuid = (v?: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${e.tenantId}, ${uuid(e.branchId)}, ${uuid(e.userId)}, ${e.role ?? null}, ${e.actionType}, ${e.entityType}, ${e.entityId ?? null}, ${JSON.stringify({ before: e.before ?? null, after: e.after ?? null, metadata: e.metadata ?? null })}::jsonb)`.execute(this.db as any);
  }
  async setDiscount(ctx: CheckoutContext, id: string, discountCents: Money, discountSnapshot?: any) {
    const upd: any = { discount_cents: discountCents, locked_total_cents: null, updated_at: new Date() };
    if (discountSnapshot !== undefined) {
      upd.discount_snapshot = JSON.stringify(discountSnapshot);
    }
    const r = await this.scoped(this.db.updateTable('tickets'), ctx).set(upd).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return Number((r as any)?.numUpdatedRows ?? 0) > 0;
  }
  async setMethod(ctx: CheckoutContext, id: string, method: PaymentMethod) { const res = await this.scoped(this.db.updateTable('tickets'), ctx).set({ chosen_payment_method: method, locked_total_cents: null, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst().catch(() => undefined); return Number((res as any)?.numUpdatedRows ?? 0) > 0; }
  /** Hold Ticket / Resume (Oct 6 2026): set aside — items, tip and discounts untouched — or back in the queue. An unpaid
   *  ticket only; false when it is paid or not this salon's. */
  async setHold(ctx: CheckoutContext, id: string, held: boolean): Promise<boolean> {
    const r: any = await this.scoped(this.db.updateTable('tickets'), ctx)
      .set({ checkout_held_at: held ? sql`now()` : null, checkout_held_by: held && isUuidStr(ctx.userId) ? ctx.userId : null, updated_at: sql`now()` } as any)
      .where('id', '=', id).where('status', '<>', 'paid').executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0) > 0;
  }
  /** Move to Front Desk (Oct 6 2026): the register this ticket is to be paid at — one of THIS branch's live registers. */
  async moveToRegister(ctx: CheckoutContext, id: string, registerId: string): Promise<{ registerId: string; name: string } | null> {
    if (!isUuidStr(registerId) || !ctx.branchId) return null;
    const reg: any = await this.db.selectFrom('pos_stations' as any).select(['id', 'name'] as any).where('tenant_id' as any, '=', ctx.tenantId).where('branch_id' as any, '=', ctx.branchId)
      .where('id' as any, '=', registerId).where('retired_at' as any, 'is', null).executeTakeFirst().catch(() => undefined);
    if (!reg) return null;
    const r: any = await this.scoped(this.db.updateTable('tickets'), ctx)
      .set({ checkout_register_id: reg.id, station_label: reg.name, updated_at: sql`now()` } as any).where('id', '=', id).where('status', '<>', 'paid').executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0) > 0 ? { registerId: String(reg.id), name: String(reg.name) } : null;
  }
  /**
   * The ticket's checkout status, written to the ROW (Round 2 C — it was a per-process Map, so a second API replica showed
   * and acted on a stale status). A board state (anything but paid) is a conditional update through TICKET_CHECKOUT that
   * never lands on a paid ticket: false when the row refuses it (paid, a payment in progress refusing a reopen, not this
   * salon's). 'ready_for_payment' is also how a voided / refunded sale comes back (reopenIfNoLongerPaid): a PAID row moves
   * back to payable in the database — tickets.status 'paid' → 'ready_checkout', paid_at kept (it was paid once: paying it
   * again is not a second visit).
   */
  async setStatus(ctx: CheckoutContext, id: string, status: TicketStatus, exec: Kysely<DB> = this.db) {
    if (status !== 'paid') return this.setBoardStatus(ctx, id, status, exec);
    if (!(await this._ticket(ctx, id))) return false;
    {
      // Constitution 8 §18/§68: the ticket's paid state and checkout.completed commit together. A standalone call
      // gets its own transaction; a caller already in one passes its executor through.
      const run = async (x: Kysely<DB>) => {
        // Phase 15: the status BEFORE this write decides visit.completed — only the transition into paid is a visit
        const prev: any = this.outbox ? await this.scoped(x.selectFrom('tickets'), ctx).select(['status', 'customer_id', 'paid_at'] as any).where('id', '=', id).forUpdate().executeTakeFirst() : undefined;
        await this.scoped(x.updateTable('tickets'), ctx).set({ status: 'paid', paid_at: sql`now()`, service_done_at: sql`COALESCE(service_done_at, now())`, checkout_held_at: null, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst();
        if (this.outbox) await this.outbox.write(x, createDomainEvent({
          eventType: DOMAIN_EVENTS.CHECKOUT_COMPLETED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
          actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`, payload: { ticketId: id, status: 'paid' } }));
        // a sale paid, voided back to payable and paid again (paid_at kept by setBoardStatus) is still ONE visit
        if (this.outbox && prev && String(prev.status) !== 'paid' && prev.paid_at == null)
          await this.outbox.write(x, visitCompletedEvent({ tenantId: ctx.tenantId, branchId: ctx.branchId, ticketId: id, customerId: prev.customer_id ? String(prev.customer_id) : null, actorId: ctx.userId, channel: 'pos' }));
      };
      // Phase 15 round 2: inside a CALLER's transaction a failure propagates, so the caller's payment row and events roll
      // back with it. Swallowed there, a database error left the transaction aborted (its COMMIT silently rolls back) and
      // an outbox refusal committed a paid ticket missing its event. A standalone call keeps the old best-effort behaviour.
      if (exec !== this.db) await run(exec);
      else await (this.outbox ? this.db.transaction().execute((trx) => run(trx as unknown as Kysely<DB>)) : run(exec)).catch(() => undefined);
    }
    return true;
  }
  // Atomic split settlement: all gift redemptions, payment rows, and the ticket's paid status are committed in ONE
  // transaction. If any segment's guarded gift redemption fails (e.g. a concurrent balance change after the service's
  // pre-validation), the whole thing rolls back — no orphan payment rows, no partial decrements, ticket stays unpaid.
  // (The card segment is authorized by the service BEFORE this call, since an external processor round-trip must not run
  // inside a DB transaction; a DB-side rollback after a successful card auth is surfaced to the caller to compensate.)
  async recordSplitAtomic(ctx: CheckoutContext, ticketId: string, segments: { method: PaymentMethod; amountCents: Money; giftCardCode?: string; pin?: string }[], opts: { cardRetref?: string; cardSurchargeCents?: Money; expectedPaidCents?: number }): Promise<PaymentRecord[]> {
    const surcharge = opts.cardSurchargeCents || 0;
    return this.db.transaction().execute(async (trx) => {
      // A duplicate split (double tap, two stations) must not record its cash/gift segments twice: same visit lock and
      // paid-amount check as cash. On refusal the service's compensation voids any card capture it already made.
      if (opts.expectedPaidCents !== undefined) await this.lockTicketAndCheckPaid(trx as unknown as Kysely<DB>, ctx, ticketId, opts.expectedPaidCents);
      const out: PaymentRecord[] = [];
      for (const seg of segments) {
        let gift: { ledgerId: string | null; ledgerTenantId: string; last4: string | null } | null = null;
        if (seg.method === 'gift_card' && seg.giftCardCode) {
          gift = await this.redeemGift(ctx, seg.giftCardCode, seg.amountCents, (seg as any).pin, trx as unknown as Kysely<DB>, ticketId);
          if (!gift) throw new SplitRedemptionError('Gift card ' + seg.giftCardCode + ' could not be redeemed (balance changed or card inactive)');
        }
        // Option A: the card segment carries the card-portion surcharge (captured on the gateway by the service before
        // this transaction), so its recorded amount = base card dollars + surcharge. Non-card segments record at base.
        const recordedAmount = seg.method === 'card' ? seg.amountCents + surcharge : seg.amountCents;
        const rec: PaymentRecord = { paymentId: '', ticketId, method: seg.method, amountCents: recordedAmount, tipCents: 0, surchargeCents: seg.method === 'card' ? surcharge : 0, status: 'approved', ...(opts.cardRetref && seg.method === 'card' ? { processorTransactionId: opts.cardRetref } : {}), createdAt: new Date().toISOString() };
        const recorded = await this.recordPayment(ctx, gift?.last4 ? { ...rec, giftCardLast4: gift.last4 } : rec, trx as unknown as Kysely<DB>);
        if (gift) await this.tieGiftLedgerToPayment(trx as unknown as Kysely<DB>, gift, recorded.paymentId);
        out.push(recorded);
        // Constitution 8: recordPayment() writes payment.captured for each NEW row in this same transaction.
      }
      // Persist the collected card surcharge on the ticket so reports/KPIs attribute it (default 0 means a fully
      // cash/gift split, or surcharge disabled, leaves the ticket unchanged).
      if (surcharge > 0) await this.scoped((trx as unknown as Kysely<DB>).updateTable('tickets'), ctx).set({ surcharge_cents: surcharge, updated_at: sql`now()` } as any).where('id', '=', ticketId).executeTakeFirst().catch(() => undefined);
      await this.setStatus(ctx, ticketId, 'paid', trx as unknown as Kysely<DB>);
      return out;
    });
  }
  async lockTotal(ctx: CheckoutContext, id: string, totalCents: Money) { await this.scoped(this.db.updateTable('tickets'), ctx).set({ locked_total_cents: totalCents, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst().catch(() => undefined); }

  // gift cards: real balances on the Postgres path (migration 033). Tenant-wide (branch_id null) so a card works at any branch.
  async giftBalance(ctx: CheckoutContext, code: string) {
    const r = await this.scoped(this.db.selectFrom('gift_cards'), ctx).where('code', '=', code).where('status', '=', 'active').select(['balance_cents']).executeTakeFirst().catch(() => undefined);
    if (r) return Number((r as any).balance_cents);
    // §15 a same-tenant miss may be an eligible network card issued at another member salon.
    const x = await this.resolveCrossTenantGiftCard(ctx, code);
    if (x.found && x.crossTenant && x.eligible && x.status === 'active') return x.balanceCents ?? null;
    return null;
  }
  async decrementGift(ctx: CheckoutContext, code: string, by: Money, pin?: string, exec: Kysely<DB> = this.db): Promise<boolean> {
    // SCAN (Oct 12 2026): the decrement and its ledger row are ONE unit — outside a caller's transaction, open one.
    if ((exec as any).isTransaction) return (await this.redeemGift(ctx, code, by, pin, exec)) !== null;
    return exec.transaction().execute(async (trx) => (await this.redeemGift(ctx, code, by, pin, trx as unknown as Kysely<DB>)) !== null);
  }
  /** The redemption itself. Returns the ledger row it wrote (to be tied to the payment) and the card's last four — its
   *  printed number's, or the code's for a card with no number — or null when nothing was redeemed. Oct 6 2026: the
   *  ledger row now carries the ticket, and later the payment, so a gift-card payment can say which card paid. */
  private async redeemGift(ctx: CheckoutContext, code: string, by: Money, pin: string | undefined, exec: Kysely<DB>, ticketId?: string): Promise<{ ledgerId: string | null; ledgerTenantId: string; last4: string | null } | null> {
    if (!(by > 0)) return null;
    const local = await this.scoped(exec.selectFrom('gift_cards'), ctx).where('code', '=', code).select(['id', 'balance_cents', 'card_pin_hash']).executeTakeFirst();
    let id: string, ledgerTenantId = ctx.tenantId, crossTenant = false, issuingTenantId = ctx.tenantId, programId: string | null = null, pinHash: string | null = null;
    if (local) {
      id = (local as any).id; pinHash = (local as any).card_pin_hash ?? null; // same-tenant redemption — unchanged (no clearing)
    } else {
      // §15/§16 cross-tenant redemption: only an eligible shared-program card at a member salon. The card lives at the
      // ISSUING tenant, so its ledger row is booked there and an inter-tenant clearing obligation is recorded.
      const x = await this.resolveCrossTenantGiftCard(ctx, code);
      if (!x.found || !x.crossTenant || !x.eligible || x.status !== 'active' || !x.id) return null;
      id = x.id; crossTenant = true; issuingTenantId = x.issuingTenantId || ctx.tenantId; ledgerTenantId = issuingTenantId; programId = x.programId ?? null; pinHash = x.pinHash ?? null;
    }
    // §3/§12 physical-card PIN gate: a card with a PIN requires the matching PIN (bound to the card code). No PIN hash =>
    // no PIN required, so every existing/digital card redeems exactly as before. Fail closed when the PIN is missing/wrong.
    if (pinHash && (!pin || hashCardPin(code, pin) !== pinHash)) return null;
    // Atomic, guarded redemption: only an ACTIVE card with sufficient balance is decremented. The `balance_cents >= by`
    // predicate is evaluated inside the UPDATE, so a concurrent second redeem sees the already-reduced balance and cannot
    // drive it negative; a voided card (status<>'active') is never touched (no resurrection) and over-redeem is rejected
    // rather than silently clamped to zero.
    const res: any = await exec.updateTable('gift_cards')
      .set((eb: any) => ({ balance_cents: eb('balance_cents', '-', by), status: eb.case().when(eb('balance_cents', '-', by), '<=', 0).then('redeemed').else('active').end(), updated_at: new Date().toISOString() }) as any)
      .where('id', '=', id).where('tenant_id', '=', ledgerTenantId).where('status', '=', 'active').where('balance_cents', '>=', by)   // the card's OWN tenant: this salon's, or the issuing salon's for a shared-program card
      .returning(['balance_cents', 'card_number_last4', 'code'] as any).executeTakeFirst();
    // A failure of the UPDATE, the ledger INSERT or the clearing INSERT is NOT swallowed (SCAN, Oct 12 2026): swallowed, the
    // card lost the money with no ledger row, or the caller's transaction was left aborted and its COMMIT became a ROLLBACK.
    // RETURNING, not a second read: a follow-up SELECT could see ANOTHER terminal's redemption that landed in between, and
    // the ledger row would state that neighbour's balance (real-PG race, Sep 30 2026: $30,$0,$0,$0,$0 instead of
    // $40,$30,$20,$10,$0). The balance this UPDATE wrote is the only true balance-after for this redemption.
    if (!res) return null;
    const after = res;
    const led: any = await exec.insertInto('gift_card_transactions').values({ tenant_id: ledgerTenantId, branch_id: crossTenant ? null : (ctx.branchId || null), gift_card_id: id, type: 'redeem', amount_cents: by, balance_after_cents: after ? Number((after as any).balance_cents) : 0, created_by_user_id: ctx.userId || null, ticket_id: ticketId && isUuidStr(ticketId) ? ticketId : null } as any).returning(['id']).executeTakeFirst();
    if (crossTenant) {
      const ob = clearingObligation({ issuingTenantId, redeemingTenantId: ctx.tenantId, amountCents: by });
      if (ob.applicable) await exec.insertInto('gift_card_clearing_entries').values({ program_id: programId, gift_card_id: id, redemption_transaction_id: led ? (led as any).id : null, issuing_tenant_id: issuingTenantId, redeeming_tenant_id: ctx.tenantId, amount_cents: ob.amountCents, platform_fee_cents: ob.platformFeeCents, status: 'pending' } as any).execute();
    }
    // the card's OWN salon books it (the issuing salon for a shared-program card); the redeeming salon is in the payload
    await this.giftCardFact(exec, ctx, DOMAIN_EVENTS.GIFT_CARD_REDEEMED, ledgerTenantId, id, { giftCardId: id, amountCents: by,
      balanceAfterCents: after ? Number((after as any).balance_cents) : null, redeemingTenantId: ctx.tenantId, crossTenant, programId });
    return { ledgerId: led ? String((led as any).id) : null, ledgerTenantId, last4: giftCardLast4((after as any).card_number_last4, (after as any).code) };
  }
  async issueGiftCard(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; idempotencyKey?: string; cardNumber?: string }): Promise<GiftCard> {
    // Idempotent by ledger key: a retried post-payment issuance returns the already-issued card instead of minting a
    // second one. gift_card_transactions carries a UNIQUE(tenant_id, idempotency_key) index (migration 401).
    const findByKey = async (): Promise<GiftCard | undefined> => {
      if (!req.idempotencyKey) return undefined;
      const r = await this.db.selectFrom('gift_card_transactions as t').innerJoin('gift_cards as g', 'g.id', 't.gift_card_id')
        .select(['g.code as code', 'g.balance_cents as bal'])
        .where('t.tenant_id', '=', ctx.tenantId).where('t.idempotency_key', '=', req.idempotencyKey)
        .executeTakeFirst().catch(() => undefined);
      return r ? { code: (r as any).code, balanceCents: Number((r as any).bal) } : undefined;
    };
    const prior = await findByKey();
    if (prior) return prior;
    const ins = await this.db.insertInto('gift_cards').values({ tenant_id: ctx.tenantId, branch_id: null, code: req.code, card_number_hash: req.cardNumber ? hashCardNumber(req.cardNumber) : null, card_number_last4: req.cardNumber ? lastFour(req.cardNumber) : null, initial_balance_cents: req.amountCents, balance_cents: req.amountCents, purchased_cents: req.amountCents, status: 'active', customer_id: req.customerId || null, issued_by_user_id: ctx.userId || null } as any).returning(['id']).executeTakeFirstOrThrow();
    try {
      await this.db.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: (ins as any).id, type: 'issue', amount_cents: req.amountCents, balance_after_cents: req.amountCents, created_by_user_id: ctx.userId || null, idempotency_key: req.idempotencyKey || null } as any).execute();
    } catch (e) {
      // Concurrent same-key race: another issuance won the ledger idempotency insert. Return the winner; the card row we
      // just inserted carries no ledger entry and never affects a balance (each card's balance is its own).
      const winner = await findByKey();
      if (winner) return winner;
      throw e;
    }
    // after the ledger insert succeeded (outside its try: a failure here must not be mistaken for the concurrent-key race)
    await this.giftCardFact(this.db, ctx, DOMAIN_EVENTS.GIFT_CARD_ISSUED, ctx.tenantId, String((ins as any).id), { giftCardId: String((ins as any).id), amountCents: req.amountCents, source: 'issue' });
    return { code: req.code, balanceCents: req.amountCents };
  }
  async createPendingGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string }): Promise<{ code: string; reference: string }> {
    // Pending sale: no stored value and no 'issue' ledger yet. The card is worthless until its ticket is paid.
    await this.db.insertInto('gift_cards').values({ tenant_id: ctx.tenantId, branch_id: (ctx as any).branchId ?? null, code: req.code, card_number_hash: req.cardNumber ? hashCardNumber(req.cardNumber) : null, card_number_last4: req.cardNumber ? lastFour(req.cardNumber) : null, initial_balance_cents: req.amountCents, balance_cents: 0, purchased_cents: req.amountCents, status: 'pending_payment', customer_id: req.customerId || null, issued_by_user_id: ctx.userId || null, sale_ticket_id: req.ticketId, reference: req.reference } as any).execute();
    return { code: req.code, reference: req.reference };
  }

  async createPhysicalGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string; pin?: string }): Promise<{ code: string; reference: string } | null> {
    const hash = hashCardNumber(req.cardNumber);
    return this.db.transaction().execute(async (trx): Promise<{ code: string; reference: string } | null> => {
      // Claim the physical card from stock — guarded so a card can only be sold once (available → activated). If it isn't
      // currently available at this tenant (unregistered, already sold, or voided), no rows update and we bail (rolls back).
      const claim: any = await trx.updateTable('gift_card_stock').set({ status: 'activated', activated_at: new Date(), updated_at: new Date() } as any)
        .where('tenant_id', '=', ctx.tenantId).where('card_number_hash', '=', hash).where('status', '=', 'available').where(canMoveToSql(GIFT_CARD_STOCK, 'activated') as any).executeTakeFirst();
      if (Number(claim?.numUpdatedRows ?? 0) === 0) return null;
      // Create the pending sale on the pre-printed number (worthless until the ticket is paid, exactly like a digital sale).
      const ins: any = await trx.insertInto('gift_cards').values({ tenant_id: ctx.tenantId, branch_id: (ctx as any).branchId ?? null, code: req.code, card_number_hash: hash, card_number_last4: lastFour(req.cardNumber), card_pin_hash: req.pin ? hashCardPin(req.code, req.pin) : null, initial_balance_cents: req.amountCents, balance_cents: 0, purchased_cents: req.amountCents, status: 'pending_payment', customer_id: req.customerId || null, issued_by_user_id: ctx.userId || null, sale_ticket_id: req.ticketId, reference: req.reference } as any).returning(['id']).executeTakeFirstOrThrow();
      await trx.updateTable('gift_card_stock').set({ gift_card_id: String(ins.id), updated_at: new Date() } as any).where('tenant_id', '=', ctx.tenantId).where('card_number_hash', '=', hash).execute();
      return { code: req.code, reference: req.reference };
    });
  }

  async activatePendingGiftCardSales(ctx: CheckoutContext, ticketId: string): Promise<{ activated: number }> {
    // Activate every pending card tied to this now-paid ticket. The conditional update (status = 'pending_payment')
    // makes this idempotent: a re-run of afterPaid matches 0 rows and issues no second activation or ledger entry.
    const pend = await this.db.selectFrom('gift_cards').select(['id', 'purchased_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('sale_ticket_id', '=', ticketId).where('status', '=', 'pending_payment')
      .execute().catch(() => [] as any[]);
    let activated = 0;
    for (const c of pend as any[]) {
      const upd = await this.db.updateTable('gift_cards')
        .set({ status: 'active', balance_cents: c.purchased_cents, updated_at: new Date() } as any)
        .where('id', '=', c.id).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'pending_payment').where(canMoveToSql(GIFT_CARD, 'active') as any)
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) > 0) {
        await this.db.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: c.id, type: 'activate', amount_cents: c.purchased_cents, balance_after_cents: c.purchased_cents, created_by_user_id: ctx.userId || null, idempotency_key: 'activate:' + c.id } as any).execute().catch(() => undefined);
        await this.giftCardFact(this.db, ctx, DOMAIN_EVENTS.GIFT_CARD_ISSUED, ctx.tenantId, String(c.id), { giftCardId: String(c.id), amountCents: Number(c.purchased_cents), source: 'sale', ticketId });
        activated++;
      }
    }
    return { activated };
  }
  // Resolve a receptionist-entered value: a normalized 16-digit number → the matching card's code (tenant-scoped);
  // anything else is assumed to already be a code. Null when a 16-digit number matches no card.
  async resolveGiftCardCode(ctx: CheckoutContext, input: string): Promise<string | null> {
    const digits = String(input || '').replace(/\D+/g, '');
    if (/^\d{16}$/.test(digits)) {
      const r = await this.scoped(this.db.selectFrom('gift_cards'), ctx).where('card_number_hash', '=', hashCardNumber(digits)).select(['code']).executeTakeFirst().catch(() => undefined);
      if (r) return String((r as any).code);
      // §15 a 16-digit number issued at another salon resolves only if the current salon may redeem it under the program.
      const x = await this.resolveCrossTenantGiftCard(ctx, digits);
      return x.found && x.crossTenant && x.eligible ? (x.code ?? null) : null;
    }
    return String(input || '').trim() || null;
  }

  async resolveCrossTenantGiftCard(ctx: CheckoutContext, input: string): Promise<{ found: boolean; eligible?: boolean; crossTenant?: boolean; reason?: string; code?: string; id?: string; issuingTenantId?: string; programId?: string | null; balanceCents?: Money; status?: string; pinHash?: string | null }> {
    // Resolve the card ACROSS tenants (deliberately NOT tenant-scoped) — this is the only cross-tenant read.
    const digits = String(input || '').replace(/\D+/g, '');
    let card: any;
    if (/^\d{16}$/.test(digits)) {
      card = await this.db.selectFrom('gift_cards').select(['id', 'code', 'tenant_id', 'balance_cents', 'status', 'program_id', 'card_pin_hash']).where('card_number_hash', '=', hashCardNumber(digits)).executeTakeFirst().catch(() => undefined);
    } else {
      const code = String(input || '').trim();
      if (!code) return { found: false };
      card = await this.db.selectFrom('gift_cards').select(['id', 'code', 'tenant_id', 'balance_cents', 'status', 'program_id', 'card_pin_hash']).where('code', '=', code).executeTakeFirst().catch(() => undefined);
    }
    if (!card) return { found: false };
    const issuingTenantId = String(card.tenant_id);
    let programScope: string | null = null, issuerActive = false, redeemerActive = false;
    if (card.program_id) {
      const prog: any = await this.db.selectFrom('gift_card_programs').select(['scope']).where('id', '=', card.program_id).executeTakeFirst().catch(() => undefined);
      programScope = prog ? String(prog.scope) : null;
      const members = await this.db.selectFrom('gift_card_program_members').select(['tenant_id'])
        .where('program_id', '=', card.program_id).where('status', '=', 'active').where('tenant_id', 'in', [issuingTenantId, ctx.tenantId]).execute().catch(() => [] as any[]);
      const set = new Set((members as any[]).map((m) => String(m.tenant_id)));
      issuerActive = set.has(issuingTenantId); redeemerActive = set.has(ctx.tenantId);
    }
    const elig = crossTenantRedeemable({ issuingTenantId, redeemingTenantId: ctx.tenantId, programScope, issuerActiveMember: issuerActive, redeemerActiveMember: redeemerActive });
    return { found: true, eligible: elig.eligible, crossTenant: elig.crossTenant, reason: elig.reason, code: String(card.code), id: String(card.id), issuingTenantId, programId: card.program_id ? String(card.program_id) : null, balanceCents: Number(card.balance_cents || 0), status: String(card.status), pinHash: card.card_pin_hash ?? null };
  }

  // §22 replace a lost/stolen card: atomically mint a replacement, move the balance via 'transfer' ledger entries, and
  // retire the original ('replaced' + lineage), revoking its outstanding barcodes. The number is never edited.
  async replaceGiftCardByCode(ctx: CheckoutContext, code: string): Promise<{ ok: boolean; reason?: string; newCode?: string; newCardNumber?: string; newReference?: string; newCardNumberMasked?: string; balanceCents?: Money }> {
    const REPLACEABLE = ['active', 'partially_redeemed', 'frozen', 'suspended', 'lost_stolen'];
    const newCode = 'GC-' + secureString(10)   /* H9: a gift-card code is spendable money — was Math.random() */;
    const newNumber = generateCardNumber();
    return this.db.transaction().execute(async (trx): Promise<{ ok: boolean; reason?: string; newCode?: string; newCardNumber?: string; newReference?: string; newCardNumberMasked?: string; balanceCents?: Money }> => {
      const old: any = await this.scoped(trx.selectFrom('gift_cards'), ctx).where('code', '=', code)
        .select(['id', 'status', 'balance_cents', 'purchased_cents', 'customer_id', 'program_id', 'design_id']).executeTakeFirst();
      if (!old) return { ok: false, reason: 'not_found' };
      if (!REPLACEABLE.includes(String(old.status))) return { ok: false, reason: 'not_replaceable' };
      const bal = Number(old.balance_cents || 0);
      if (bal <= 0) return { ok: false, reason: 'no_balance' };
      // The replacement card: same balance / owner / program, brand-new identity, pointing back at the retired card.
      const ins: any = await trx.insertInto('gift_cards').values({
        tenant_id: ctx.tenantId, branch_id: (ctx as any).branchId ?? null, code: newCode,
        card_number_hash: hashCardNumber(newNumber), card_number_last4: lastFour(newNumber),
        initial_balance_cents: bal, balance_cents: bal, purchased_cents: Number(old.purchased_cents || bal),
        status: 'active', customer_id: old.customer_id, program_id: old.program_id, design_id: old.design_id,
        issued_by_user_id: ctx.userId || null, replacement_of_card_id: old.id,
      } as any).returning(['id']).executeTakeFirstOrThrow();
      const newId = String(ins.id);
      // Move the value: a 'transfer' credit onto the new card and a matching debit off the old (not a new issuance).
      await trx.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: newId, type: 'transfer', amount_cents: bal, balance_after_cents: bal, created_by_user_id: ctx.userId || null } as any).execute();
      await trx.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: old.id, type: 'transfer', amount_cents: -bal, balance_after_cents: 0, created_by_user_id: ctx.userId || null } as any).execute();
      // Retire the original and record the forward lineage.
      // Phase 12 (#27): the original retires through GIFT_CARD, conditional on the status AND balance read — two concurrent
      // replacements of one card used to both mint a replacement carrying the full balance (money twice); the second now
      // gets 409 and its replacement rolls back
      await transitionStatus(trx as any, GIFT_CARD, { where: { id: old.id, tenant_id: ctx.tenantId, balance_cents: old.balance_cents }, from: old.status, to: 'replaced', set: { balance_cents: 0, replaced_by_card_id: newId, updated_at: new Date() } });
      // §11: the old card's outstanding barcodes stop working immediately.
      await trx.updateTable('gift_card_presentation_tokens').set({ revoked_at: new Date() } as any)
        .where('gift_card_id', '=', old.id).where('tenant_id', '=', ctx.tenantId).where('revoked_at', 'is', null).where('used_at', 'is', null).execute();
      return { ok: true, newCode, newCardNumber: newNumber, newReference: 'GC-****-' + newCode.slice(-4), newCardNumberMasked: maskFromLast4(lastFour(newNumber)), balanceCents: bal };
    }).catch((): { ok: boolean; reason?: string } => ({ ok: false, reason: 'error' }));
  }

  async getGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail | null> {
    const r = await this.scoped(this.db.selectFrom('gift_cards'), ctx).where('code', '=', code).select(['code', 'balance_cents', 'initial_balance_cents', 'status']).executeTakeFirst().catch(() => undefined);
    return r ? { code: (r as any).code, balanceCents: Number((r as any).balance_cents), initialBalanceCents: Number((r as any).initial_balance_cents), status: (r as any).status } : null;
  }
  // Pending reload = an immutable 'hold' event tied to the ticket; the card's balance does NOT change until the ticket is
  // paid. Idempotent per ticket+card so a double-tap creates one hold. Mirrors the pending-SALE model, but for an
  // existing card (credit on payment) rather than a new one.
  async createPendingGiftCardReload(ctx: CheckoutContext, req: { code: string; amountCents: Money; ticketId: string; reference: string }): Promise<{ reference: string; amountCents: Money }> {
    const card = await this.scoped(this.db.selectFrom('gift_cards'), ctx).where('code', '=', req.code).select(['id', 'balance_cents']).executeTakeFirst().catch(() => undefined);
    if (!card) return { reference: req.reference, amountCents: req.amountCents };
    const key = 'reload-hold:' + req.ticketId + ':' + (card as any).id;
    const existing = await this.db.selectFrom('gift_card_transactions').select(['id']).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', key).executeTakeFirst().catch(() => undefined);
    if (!existing) {
      await this.db.insertInto('gift_card_transactions')
        .values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: (card as any).id, type: 'hold', amount_cents: req.amountCents, balance_after_cents: Number((card as any).balance_cents), ticket_id: req.ticketId, created_by_user_id: ctx.userId || null, idempotency_key: key } as any)
        .execute().catch(() => undefined);
    }
    return { reference: req.reference, amountCents: req.amountCents };
  }

  // Credit every pending reload hold tied to this now-paid ticket, exactly once. Idempotency: the credit ('adjust')
  // carries idempotency_key 'reload:'+holdId (backed by the partial unique index), so a retried afterPaid credits
  // nothing twice. Each credit is atomic (read balance → insert ledger → update balance) inside a transaction.
  async activatePendingGiftCardReloads(ctx: CheckoutContext, ticketId: string): Promise<{ activated: number }> {
    const holds = await this.db.selectFrom('gift_card_transactions').select(['id', 'gift_card_id', 'amount_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('type', '=', 'hold')
      .execute().catch(() => [] as any[]);
    let activated = 0;
    for (const h of holds as any[]) {
      const already = await this.db.selectFrom('gift_card_transactions').select(['id'])
        .where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', 'reload:' + h.id)
        .executeTakeFirst().catch(() => undefined);
      if (already) continue;
      const done = await this.db.transaction().execute(async (trx) => {
        const cur = await trx.selectFrom('gift_cards').select(['balance_cents', 'status']).where('id', '=', h.gift_card_id).where('tenant_id', '=', ctx.tenantId).forUpdate().executeTakeFirst();
        if (!cur) return false;
        // Phase 12 (#27): a paid reload credits only a card GIFT_CARD lets become active again (never a void / replaced /
        // refunded card); the row is locked for the read-modify-write of the balance
        assertTransition(GIFT_CARD, String((cur as any).status), 'active');
        const newBal = Number((cur as any).balance_cents) + Number(h.amount_cents);
        await trx.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: h.gift_card_id, type: 'adjust', amount_cents: Number(h.amount_cents), balance_after_cents: newBal, created_by_user_id: ctx.userId || null, idempotency_key: 'reload:' + h.id } as any).execute();
        await trx.updateTable('gift_cards').set({ balance_cents: newBal, status: 'active', updated_at: new Date().toISOString() } as any).where('id', '=', h.gift_card_id).where('tenant_id', '=', ctx.tenantId).where(canMoveToSql(GIFT_CARD, 'active') as any).execute();
        return true;
      }).catch(() => false);
      if (done) activated++;
    }
    return { activated };
  }

  async reloadGiftCard(ctx: CheckoutContext, code: string, amountCents: Money): Promise<GiftCardDetail> {
    return this.db.transaction().execute(async (trx) => {
      const card = await this.scoped(trx.selectFrom('gift_cards'), ctx).where('code', '=', code).select(['id', 'balance_cents', 'status']).executeTakeFirst().catch(() => undefined);
      if (card) {
        const newBal = Number((card as any).balance_cents) + amountCents;
        // Phase 12 (#27): a reload revives nothing (a void / replaced / refunded card → 409), and the balance write is
        // conditional on the status AND balance read — a concurrent redemption or reload gets 409, not a lost update of money
        assertTransition(GIFT_CARD, String((card as any).status), 'active');
        const up: any = await trx.updateTable('gift_cards').set({ balance_cents: newBal, status: 'active', updated_at: new Date().toISOString() } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', (card as any).id)
          .where('status', '=', (card as any).status).where('balance_cents', '=', (card as any).balance_cents).where(canMoveToSql(GIFT_CARD, 'active') as any).executeTakeFirst();
        if (!Number(up?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(GIFT_CARD, null, 'active', 'concurrent');
        await trx.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: (card as any).id, type: 'adjust', amount_cents: amountCents, balance_after_cents: newBal, created_by_user_id: ctx.userId || null } as any).execute();
      }
      return (await this.getGiftCard(ctx, code))!;
    });
  }
  async voidGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail> {
    return this.db.transaction().execute(async (trx) => {
      const card = await this.scoped(trx.selectFrom('gift_cards'), ctx).where('code', '=', code).select(['id', 'balance_cents', 'status']).executeTakeFirst().catch(() => undefined);
      if (card) {
        const prior = Number((card as any).balance_cents);
        // Phase 12 (#27): voiding a card that is already void / replaced / refunded is refused (409) — it used to write a
        // second adjusting ledger line; the void is conditional on the status and balance read
        assertTransition(GIFT_CARD, String((card as any).status), 'void');
        const up: any = await trx.updateTable('gift_cards').set({ balance_cents: 0, status: 'void', updated_at: new Date().toISOString() } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', (card as any).id)
          .where('status', '=', (card as any).status).where('balance_cents', '=', (card as any).balance_cents).where(canMoveToSql(GIFT_CARD, 'void') as any).executeTakeFirst();
        if (!Number(up?.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(GIFT_CARD, null, 'void', 'concurrent');
        await trx.insertInto('gift_card_transactions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, gift_card_id: (card as any).id, type: 'adjust', amount_cents: -prior, balance_after_cents: 0, created_by_user_id: ctx.userId || null } as any).execute();
      }
      return (await this.getGiftCard(ctx, code))!;
    });
  }
  async recordReceipt(ctx: CheckoutContext, rec: { ticketId: string; paymentId?: string; totalCents: Money; emailedTo?: string }): Promise<{ receiptId: string; receiptNumber: string }> {
    const receiptNumber = 'R-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
    const ins = await this.db.insertInto('receipts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: rec.ticketId, payment_id: rec.paymentId || null, total_cents: rec.totalCents, receipt_number: receiptNumber, emailed_to: rec.emailedTo || null } as any).returning(['id']).executeTakeFirstOrThrow().catch(() => undefined);
    // developer merge (Oct 6 2026): a receipt for a known customer lands in their app feed (any channel — the app
    // shows every receipt under Receipts; this is the bell). Best-effort: a feed row never fails a receipt.
    const tk: any = await this.scoped(this.db.selectFrom('tickets'), ctx).select(['customer_id']).where('id', '=', rec.ticketId).executeTakeFirst().catch(() => undefined);
    if (tk?.customer_id) {
      const amount = `$${(Number(rec.totalCents) / 100).toFixed(2)}`;
      await this.db.insertInto('customer_notifications').values({ tenant_id: ctx.tenantId, customer_id: tk.customer_id, type: 'payment', title: 'Receipt generated', body: `Receipt ${receiptNumber} for ${amount}`, reference: (ins as any)?.id || receiptNumber } as any).execute().catch(() => undefined);
    }
    return { receiptId: (ins as any)?.id || receiptNumber, receiptNumber };
  }

  /** developer merge (Oct 6 2026): the customer's app account behind a ticket — the push target for an app-saved receipt. */
  async customerUserIdForTicket(ctx: CheckoutContext, ticketId: string): Promise<string | null> {
    const row: any = await this.db.selectFrom('tickets as t').innerJoin('customers as c', 'c.id', 't.customer_id')
      .where('t.id', '=', ticketId).where('t.tenant_id', '=', ctx.tenantId).where('c.tenant_id', '=', ctx.tenantId).select(['c.user_id']).executeTakeFirst().catch(() => undefined);
    return row?.user_id ? String(row.user_id) : null;
  }

  /** Active owner and manager user IDs for the salon (push targets for receipt generated / payment notifications). */
  async activeOwnerUserIds(ctx: CheckoutContext): Promise<string[]> {
    const rows: any[] = await this.db.selectFrom('users')
      .select(['id'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('role', 'in', ['OWNER', 'MANAGER'])
      .where('status', '=', 'active')
      .execute()
      .catch(() => []);
    return rows.map((r) => String(r.id));
  }

  async recordSatisfaction(ctx: CheckoutContext, ticketId: string, rating: number): Promise<boolean> {
    const r = Math.round(rating);
    if (!(r >= 1 && r <= 5)) return false;
    const res = await this.scoped(this.db.updateTable('tickets'), ctx).set({ satisfaction_rating: r } as any).where('id', '=', ticketId).executeTakeFirst().catch(() => undefined);
    return res !== undefined && Number((res as any).numUpdatedRows ?? 1) > 0;
  }

  async recordPayment(ctx: CheckoutContext, rec: PaymentRecord, exec: Kysely<DB> = this.db): Promise<PaymentRecord> {
    // Constitution 8 §18: a standalone call (payCash/payCard/… pass no executor) becomes ONE transaction holding the
    // payment row and its domain event. A caller already inside a transaction (recordSplitAtomic) passes it through.
    if (exec === this.db && this.outbox) return this.db.transaction().execute((trx) => this.recordPayment(ctx, rec, trx as unknown as Kysely<DB>));
    // Idempotency: a card charge carries an idempotency key. If a payment with that key already exists for this
    // tenant, return it instead of inserting a second row (the processor dedupes on its side via the same key).
    const dupSel = ['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'surcharge_cents', 'status', 'processor_transaction_id', 'change_due_cents', 'created_at'] as const;
    const mapRow = (d: any): PaymentRecord => ({ paymentId: d.id, ticketId: d.ticket_id, method: d.method, amountCents: Number(d.amount_cents), tipCents: Number(d.tip_cents || 0), surchargeCents: Number(d.surcharge_cents || 0), status: d.status, processorTransactionId: d.processor_transaction_id || undefined, changeDueCents: Number(d.change_due_cents || 0), idempotencyKey: rec.idempotencyKey, createdAt: iso(d.created_at) });
    if (rec.idempotencyKey) {
      const dup = await this.scoped(exec.selectFrom('payments'), ctx).where('idempotency_key', '=', rec.idempotencyKey).select(dupSel as any).executeTakeFirst().catch(() => undefined);
      if (dup) return mapRow(dup);
    }
    let insErr: unknown;
    const ins = await exec.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: rec.ticketId, method: rec.method, amount_cents: rec.amountCents, tip_cents: rec.tipCents || 0, surcharge_cents: rec.surchargeCents || 0, tax_cents: 0, discount_cents: 0, status: rec.status, processor_transaction_id: rec.processorTransactionId || null, idempotency_key: rec.idempotencyKey || null, change_due_cents: rec.changeDueCents || 0, created_by_user_id: ctx.userId || null, gift_card_last4: rec.method === 'gift_card' && typeof rec.giftCardLast4 === 'string' && /^[A-Z0-9]{4}$/.test(rec.giftCardLast4) ? rec.giftCardLast4 : null,
      // migration 660 (Tap to Pay mandate §66/§82/§221): surface dimension + device + brand/last4 only — never a PAN
      payment_surface: rec.paymentSurface || null, device_id: rec.deviceId || null, card_brand: typeof rec.cardBrand === 'string' && rec.cardBrand ? rec.cardBrand.slice(0, 32) : null, card_last4: typeof rec.cardLast4 === 'string' && /^[0-9]{4}$/.test(rec.cardLast4) ? rec.cardLast4 : null } as any).returning(['id']).executeTakeFirst().catch((e: unknown) => { insErr = e; return undefined; });
    if (ins) {
      const persisted = { ...rec, paymentId: (ins as any).id }; // real row id so a later refund/void can locate it
      // Only a NEW row is a new fact. The idempotency-key dedupe branches return the existing row and emit nothing —
      // exactly the §23/§25 behaviour for a retried charge. One event per payment, ever.
      if (this.outbox) {
        await this.outbox.write(exec, createDomainEvent({
          // a 'partial' tender (gift card / split / mobile partial, mandate §87) IS captured money — it was recorded as payment.failed
          eventType: rec.status === 'approved' || rec.status === 'partial' ? DOMAIN_EVENTS.PAYMENT_CAPTURED : DOMAIN_EVENTS.PAYMENT_FAILED, tenantId: ctx.tenantId, branchId: ctx.branchId,
          aggregateType: 'payment', aggregateId: persisted.paymentId, actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${rec.ticketId}`,
          payload: { paymentId: persisted.paymentId, ticketId: rec.ticketId, method: rec.method, amountCents: rec.amountCents, tipCents: rec.tipCents || 0,
                     surchargeCents: rec.surchargeCents || 0, status: rec.status, paymentSurface: rec.paymentSurface ?? 'pos' },   // integer cents + ids + method + surface; never a PAN (§225)
        }));
      }
      return persisted;
    }
    // The insert persisted no row. The ONLY legitimate no-row outcome is a concurrent charge with the SAME idempotency
    // key winning the unique-constraint race — recover by returning the REAL persisted row (not the client placeholder).
    if (rec.idempotencyKey) {
      const existing = await this.scoped(this.db.selectFrom('payments'), ctx).where('idempotency_key', '=', rec.idempotencyKey).select(dupSel as any).executeTakeFirst().catch(() => undefined);
      if (existing) return mapRow(existing);
    }
    // No row persisted and nothing to recover → a genuine persistence failure. Returning a phantom-success record here
    // would let the caller flip the ticket to 'paid' (payCash/payCard/payGiftCard) or commit recordSplitAtomic with NO
    // payment row behind it — silent missing revenue. Surface it instead: the ticket stays payable / the split tx rolls
    // back, and the controller turns this into an error the POS can retry rather than a false "paid".
    throw new PaymentPersistenceError('payment row failed to persist (ticket=' + rec.ticketId + ', method=' + rec.method + ', amount_cents=' + rec.amountCents + ', status=' + rec.status + ')', insErr);
  }
  /** Inside a write transaction: lock the visit (a second station paying the same ticket waits here, then re-reads) and
   *  refuse with CheckoutInProgressError if what has been paid is no longer what the caller priced the payment on. */
  private async lockTicketAndCheckPaid(k: Kysely<DB>, ctx: CheckoutContext, ticketId: string, expectedPaidCents: number): Promise<void> {
    const t = await this.scoped(k.selectFrom('tickets'), ctx).select(['id']).where('id', '=', ticketId).forUpdate().executeTakeFirst();
    if (!t) throw new PaymentPersistenceError('ticket not found for payment (ticket=' + ticketId + ')');
    const r = await this.scoped(k.selectFrom('payments'), ctx).where('ticket_id', '=', ticketId).where('status', 'in', ['approved', 'partial'])
      .select((eb: any) => eb.fn.sum('amount_cents').as('s')).executeTakeFirst();
    if (Number((r as any)?.s || 0) !== expectedPaidCents) throw new CheckoutInProgressError();
  }
  async recordPaymentIfUnchanged(ctx: CheckoutContext, rec: PaymentRecord, expectedPaidCents: number): Promise<PaymentRecord> {
    return this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      await this.lockTicketAndCheckPaid(k, ctx, rec.ticketId, expectedPaidCents);
      return this.recordPayment(ctx, rec, k);
    });
  }
  /** Gift-card payment: the card debit and the payment row commit together, under the visit lock and the paid-amount
   *  check. Before Oct 4 2026 they were separate statements with no check, and two simultaneous taps on a card that could
   *  cover the bill twice debited it twice and recorded two full payments (reproduced live 3/3). null = the card could
   *  not be redeemed (balance changed, inactive, wrong PIN) — nothing was written. */
  async redeemGiftAndRecordIfUnchanged(ctx: CheckoutContext, code: string, by: Money, pin: string | undefined, rec: PaymentRecord, expectedPaidCents: number): Promise<PaymentRecord | null> {
    return this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      await this.lockTicketAndCheckPaid(k, ctx, rec.ticketId, expectedPaidCents);
      const gift = await this.redeemGift(ctx, code, by, pin, k, rec.ticketId);
      if (!gift) return null;
      const paid = await this.recordPayment(ctx, gift.last4 ? { ...rec, giftCardLast4: gift.last4 } : rec, k);
      await this.tieGiftLedgerToPayment(k, gift, paid.paymentId);
      return paid;
    });
  }
  /** The redemption's ledger row names the payment it paid (in the card's own salon's ledger — the issuing salon's for a
   *  network card). */
  private async tieGiftLedgerToPayment(exec: Kysely<DB>, gift: { ledgerId: string | null; ledgerTenantId: string }, paymentId: string): Promise<void> {
    if (!gift.ledgerId || !isUuidStr(paymentId)) return;
    await (exec.updateTable('gift_card_transactions') as any).set({ payment_id: paymentId }).where('id', '=', gift.ledgerId).where('tenant_id', '=', gift.ledgerTenantId).execute();
  }
  async payments(ctx: CheckoutContext): Promise<PaymentRecord[]> {
    const rows = await this.scoped(this.db.selectFrom('payments'), ctx).select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'status', 'created_at']).execute().catch(() => []);
    return rows.map((p: any) => ({ paymentId: p.id, ticketId: p.ticket_id, method: p.method, amountCents: Number(p.amount_cents), tipCents: Number(p.tip_cents || 0), status: p.status, createdAt: iso(p.created_at) }));
  }
  async membershipRedemptionsForTicket(ctx: CheckoutContext, ticketId: string) {
    // Decision 15: carry the benefit TYPE and the value the member's balance actually paid (allocated_value_cents) — a
    // dollar credit takes off what it paid, not the whole service.
    const rows: any[] = await (this.db as any).selectFrom('membership_redemptions as r').leftJoin('membership_benefits as b' as any, (j: any) => j.onRef('b.id', '=', 'r.benefit_id').onRef('b.tenant_id', '=', 'r.tenant_id'))
      .select(['r.id as id', 'r.service_line_id as service_line_id', 'r.standard_value_cents as standard_value_cents', 'r.upgrade_charge_cents as upgrade_charge_cents', 'r.allocated_value_cents as allocated_value_cents', 'b.benefit_type as benefit_type'] as any)
      .where('r.tenant_id' as any, '=', ctx.tenantId).where('r.ticket_id' as any, '=', ticketId).execute().catch(() => []);
    return rows.map((r) => ({ redemptionId: String(r.id), serviceLineId: r.service_line_id ? String(r.service_line_id) : null, standardValueCents: Number(r.standard_value_cents ?? 0), upgradeChargeCents: Number(r.upgrade_charge_cents ?? 0), benefitType: r.benefit_type ?? null, allocatedValueCents: Number(r.allocated_value_cents ?? 0) }));
  }
  // ── Decision 15, loyalty step: reward codes ──
  private static rewardCodeRow(r: any): RewardCodeRow {
    return { redemptionId: String(r.id), code: String(r.code), customerId: String(r.customer_id), rewardTitle: String(r.reward_title ?? ''), status: r.status,
      rewardType: r.reward_type === 'percent_off' ? 'percent_off' : 'amount_off', valueCents: Number(r.value_cents ?? 0), percent: Number(r.percent ?? 0),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, ticketId: r.ticket_id ? String(r.ticket_id) : null };
  }
  private static readonly CODE_COLS = ['id', 'code', 'customer_id', 'reward_title', 'status', 'reward_type', 'value_cents', 'percent', 'expires_at', 'ticket_id'];
  async findRewardCode(ctx: CheckoutContext, code: string): Promise<RewardCodeRow | null> {
    const r = await (this.db as any).selectFrom('loyalty_redemptions').select(KyselyCheckoutRepository.CODE_COLS).where('tenant_id', '=', ctx.tenantId).where('code', '=', code).executeTakeFirst().catch(() => null);
    return r ? KyselyCheckoutRepository.rewardCodeRow(r) : null;
  }
  async reserveRewardCode(ctx: CheckoutContext, redemptionId: string, ticketId: string): Promise<boolean> {
    // Atomic: only a code still 'issued' (or already on this ticket) moves — two registers cannot both take it.
    const res: any = await sql`update loyalty_redemptions set status = 'applied', ticket_id = ${ticketId}::uuid, applied_at = coalesce(applied_at, now())
      where tenant_id = ${ctx.tenantId} and id = ${redemptionId}::uuid and ${canMoveToSql(LOYALTY_REDEMPTION, 'applied')} and (status = 'issued' or ticket_id = ${ticketId}::uuid)`.execute(this.db);
    return Number(res.numAffectedRows ?? res.numUpdatedRows ?? 0) > 0;
  }
  async releaseRewardCodes(ctx: CheckoutContext, ticketId: string): Promise<void> {
    await sql`update loyalty_redemptions set status = 'issued', ticket_id = null, applied_at = null where tenant_id = ${ctx.tenantId} and ticket_id = ${ticketId}::uuid and ${canMoveToSql(LOYALTY_REDEMPTION, 'issued')}`.execute(this.db);
  }
  async rewardCodeForTicket(ctx: CheckoutContext, ticketId: string): Promise<RewardCodeRow | null> {
    const r = await (this.db as any).selectFrom('loyalty_redemptions').select(KyselyCheckoutRepository.CODE_COLS).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('status', '=', 'applied').executeTakeFirst().catch(() => null);
    return r ? KyselyCheckoutRepository.rewardCodeRow(r) : null;
  }
  async markRewardCodesUsed(ctx: CheckoutContext, ticketId: string): Promise<void> {
    await sql`update loyalty_redemptions set status = 'used', used_at = now() where tenant_id = ${ctx.tenantId} and ticket_id = ${ticketId}::uuid and ${canMoveToSql(LOYALTY_REDEMPTION, 'used')}`.execute(this.db);
  }
  async memberDiscountInputs(ctx: CheckoutContext, ticketId: string) {
    const t: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', ticketId).select(['customer_id']).executeTakeFirst().catch(() => null);
    const lineRows: any[] = await (this.db as any).selectFrom('ticket_service_lines as l').where('l.tenant_id', '=', ctx.tenantId).where('l.ticket_id', '=', ticketId).where('l.removed_at', 'is', null)
      .select(['l.id as id', 'l.service_name_snapshot as name', 'l.service_id as service_id', 'l.product_id as product_id', 'l.category_snapshot as category', 'l.line_kind as kind', 'l.line_total_cents as total', 'l.price_cents_snapshot as price']).execute().catch(() => []);
    const lines = lineRows.map((l) => ({ serviceLineId: String(l.id), serviceName: l.name ?? undefined, serviceId: l.service_id ? String(l.service_id) : null, categoryName: l.category ?? null,
      isRetail: !!l.product_id || String(l.kind ?? '').toLowerCase() === 'retail' || String(l.kind ?? '').toLowerCase() === 'product', priceCents: Number(l.total ?? l.price ?? 0) }));
    if (!t?.customer_id) return { lines, benefits: [] };
    // Only memberships whose benefits are live: active, trial, grace (billing retry window), comped. Paused, past due,
    // cancelled, expired and suspended memberships give nothing.
    const bRows: any[] = await (this.db as any).selectFrom('customer_memberships as cm').innerJoin('membership_benefits as b' as any, (j: any) => j.onRef('b.plan_version_id', '=', 'cm.plan_version_id').onRef('b.tenant_id', '=', 'cm.tenant_id'))
      .select(['b.id as id', 'b.benefit_type as benefit_type', 'b.label as label', 'b.percent as percent', 'b.value_cents as value_cents', 'b.service_id as service_id', 'b.category_snapshot as category'] as any)
      .where('cm.tenant_id' as any, '=', ctx.tenantId).where('cm.customer_id' as any, '=', t.customer_id)
      .where('cm.status' as any, 'in', ['active', 'trial', 'grace', 'comped']).where('b.benefit_type' as any, 'in', ['percent_discount', 'fixed_discount']).execute().catch(() => []);
    const benefits = bRows.map((b) => ({ benefitId: String(b.id), benefitType: String(b.benefit_type), label: String(b.label ?? ''), percent: Number(b.percent ?? 0), valueCents: Number(b.value_cents ?? 0), serviceId: b.service_id ? String(b.service_id) : null, categoryName: b.category ?? null }));
    return { lines, benefits };
  }
  async cardPaymentsForTicket(ctx: CheckoutContext, ticketId: string): Promise<PaymentRecord[]> {
    return (await this.paymentsForTicket(ctx, ticketId)).filter((p) => p.method === 'card');
  }
  async paymentsForTicket(ctx: CheckoutContext, ticketId: string): Promise<PaymentRecord[]> {
    const rows = await this.scoped(this.db.selectFrom('payments'), ctx).where('ticket_id', '=', ticketId)
      .select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'surcharge_cents', 'status', 'processor_transaction_id', 'created_at', 'gift_card_last4'] as any).orderBy('created_at', 'asc').execute();
    return rows.map((p: any) => ({ paymentId: p.id, ticketId: p.ticket_id, method: p.method, amountCents: Number(p.amount_cents), tipCents: Number(p.tip_cents || 0), surchargeCents: Number(p.surcharge_cents || 0),
      status: p.status, processorTransactionId: p.processor_transaction_id ?? undefined, createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
      ...(p.gift_card_last4 ? { giftCardLast4: String(p.gift_card_last4) } : {}) }));
  }

  /** 23-inch spec §30–§39: the customer-safe checkout for the display — built from the SAME ticket, totals and payments
   *  the POS reads (one authoritative checkout). Read-only; scoped to the tenant + branch the caller derived server-side. */
  async customerDisplayCheckout(ctx: CheckoutContext, ticketId: string): Promise<CustomerDisplayCheckout | null> {
    const t = await this._ticket(ctx, ticketId); if (!t) return null;
    const settings = await this.resolveSettings(ctx);
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, settings, t.method, t.giftCardChargeCents ?? 0);
    const payments = await this.paymentsForTicket(ctx, ticketId).catch(() => [] as PaymentRecord[]);
    const earned: any = t.status === 'paid'
      ? await this.db.selectFrom('loyalty_point_earnings').where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
        .select((eb) => eb.fn.sum<number>('points').as('p')).executeTakeFirst().catch(() => undefined)
      : undefined;
    return buildCustomerDisplayCheckout({
      ticketNumber: t.ticketNumber, createdAt: t.createdAt, ticketStatus: t.status, lines: t.lines,
      discountCents: t.discountCents, discountSnapshot: (t as any).discountSnapshot ?? null, totals,
      payments: payments.map((p) => ({ method: p.method, amountCents: p.amountCents, surchargeCents: p.surchargeCents ?? 0, status: p.status, ...(p.giftCardLast4 ? { giftCardLast4: p.giftCardLast4 } : {}) })),
      surchargeLabel: settings.surchargeLabel, loyaltyPointsEarned: earned?.p == null ? null : Number(earned.p),
    });
  }
  async findPayment(ctx: CheckoutContext, paymentId: string): Promise<PaymentRecord | null> {
    const p = await this.scoped(this.db.selectFrom('payments'), ctx).where('id', '=', paymentId).select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'status', 'processor_transaction_id', 'created_at']).executeTakeFirst().catch(() => undefined);
    return p ? { paymentId: (p as any).id, ticketId: (p as any).ticket_id, method: (p as any).method, amountCents: Number((p as any).amount_cents), tipCents: Number((p as any).tip_cents || 0), status: (p as any).status, processorTransactionId: (p as any).processor_transaction_id || undefined, createdAt: iso((p as any).created_at) } : null;
  }

  async findPaymentByIdempotencyKey(ctx: CheckoutContext, idempotencyKey: string): Promise<PaymentRecord | null> {
    const p = await this.scoped(this.db.selectFrom('payments'), ctx).where('idempotency_key', '=', idempotencyKey).select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'status', 'processor_transaction_id', 'created_at']).executeTakeFirst().catch(() => undefined);
    return p ? { paymentId: (p as any).id, ticketId: (p as any).ticket_id, method: (p as any).method, amountCents: Number((p as any).amount_cents), tipCents: Number((p as any).tip_cents || 0), status: (p as any).status, processorTransactionId: (p as any).processor_transaction_id || undefined, createdAt: iso((p as any).created_at) } : null;
  }

  async claimPayment(ctx: CheckoutContext, rec: { paymentId: string; ticketId: string; method: PaymentMethod; amountCents: Money; tipCents: Money; surchargeCents?: Money; idempotencyKey: string }): Promise<{ claimed: boolean; paymentId: string; existing: PaymentRecord | null }> {
    // Insert an in-flight ('processing') row to reserve the key. The partial unique index payments_tenant_idem_uq
    // rejects a second concurrent insert with the same key, so exactly one caller wins the claim.
    let insertedId: string | undefined; let insertErr: unknown;
    try {
      const ins = await this.db.insertInto('payments').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: rec.ticketId, method: rec.method, amount_cents: rec.amountCents, tip_cents: rec.tipCents || 0, surcharge_cents: rec.surchargeCents || 0, tax_cents: 0, discount_cents: 0, status: 'processing', idempotency_key: rec.idempotencyKey, change_due_cents: 0, created_by_user_id: ctx.userId } as any).returning(['id']).executeTakeFirst();
      insertedId = (ins as any)?.id;
    } catch (e) { insertErr = e; }
    if (insertedId) return { claimed: true, paymentId: insertedId, existing: null };
    // No row returned → a duplicate key (or an insert error). If a row already holds this key, this caller is a
    // concurrent loser; otherwise the insert failed for some other reason and we surface it.
    const existing = await this.findPaymentByIdempotencyKey(ctx, rec.idempotencyKey);
    if (existing) return { claimed: false, paymentId: existing.paymentId, existing };
    if (insertErr) throw insertErr;
    return { claimed: false, paymentId: rec.paymentId, existing: null };
  }

  async finalizePayment(ctx: CheckoutContext, paymentId: string, patch: { status: PaymentRecord['status']; processorTransactionId?: string }): Promise<PaymentRecord | null> {
    const set: any = { status: patch.status, processor_transaction_id: patch.processorTransactionId ?? null };
    if (patch.status === 'declined' || patch.status === 'failed') set.idempotency_key = null; // release the reservation so the card can be re-attempted (a verified never-reached charge too)
    await this.scoped(this.db.updateTable('payments'), ctx).set(set).where('id', '=', paymentId).where(canMoveToSql(PAYMENT, patch.status) as any).execute().catch(() => undefined);   // Phase 12 (#27): a finished payment is not re-finalized
    return this.findPayment(ctx, paymentId);
  }

  /**
   * Phase 15 round 3 — an approved card charge (live, or settled by Verify) recorded in ONE transaction. It used to be
   * finalizePayment then a standalone setStatus('paid'), each swallowing its own error: a failed paid write left the card
   * charged, the payment 'approved' and the ticket open (due 0, so never charged again, but never paid either), and no
   * write ever produced payment.captured for a live card. Now: the ticket row is locked, the claimed row moves
   * processing → approved (PAYMENT machine), payment.captured is written for that move, and setStatus('paid') writes
   * paid_at + checkout.completed + visit.completed with the same executor. Any failure throws and rolls everything back.
   */
  async completeCardPayment(ctx: CheckoutContext, ticketId: string, paymentId: string, processorTransactionId?: string): Promise<{ payment: PaymentRecord | null; completed: boolean }> {
    const completed = await this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      const tk = await this.scoped(k.selectFrom('tickets'), ctx).select(['id']).where('id', '=', ticketId).forUpdate().executeTakeFirst();
      if (!tk) throw new PaymentPersistenceError('ticket not found for card completion (ticket=' + ticketId + ')');
      const row: any = await this.scoped(k.updateTable('payments'), ctx).set({ status: 'approved', processor_transaction_id: processorTransactionId ?? null } as any)
        .where('id', '=', paymentId).where('ticket_id', '=', ticketId).where('status', '=', 'processing').where(canMoveToSql(PAYMENT, 'approved') as any)   // only the claimed / stuck row: PAYMENT lets approved → approved, which would re-complete
        .returning(['id', 'method', 'amount_cents', 'tip_cents', 'surcharge_cents'] as any).executeTakeFirst();
      if (!row) return false;   // not 'processing' any more: another verification completed it — write nothing
      if (this.outbox) {
        await this.outbox.write(k, createDomainEvent({
          eventType: DOMAIN_EVENTS.PAYMENT_CAPTURED, tenantId: ctx.tenantId, branchId: ctx.branchId,
          aggregateType: 'payment', aggregateId: String(row.id), actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${ticketId}`,
          payload: { paymentId: String(row.id), ticketId, method: row.method, amountCents: Number(row.amount_cents), tipCents: Number(row.tip_cents || 0),
                     surchargeCents: Number(row.surcharge_cents || 0), status: 'approved' },   // the same shape recordPayment writes (§225: never a PAN)
        }));
      }
      if (!(await this.setStatus(ctx, ticketId, 'paid', k))) throw new PaymentPersistenceError('ticket not found for card completion (ticket=' + ticketId + ')');
      return true;
    });
    return { payment: await this.findPayment(ctx, paymentId), completed };
  }
  private async setBoardStatus(ctx: CheckoutContext, id: string, status: Exclude<TicketStatus, 'paid'>, exec: Kysely<DB>): Promise<boolean> {
    if (status === 'on_hold') return false;   // a hold is checkout_held_at (setHold), never a board status
    const unsettle = status === 'ready_for_payment';
    let q = this.scoped(exec.updateTable('tickets'), ctx)
      .set({ checkout_status: status, updated_at: sql`now()`, ...(unsettle ? { status: sql`CASE WHEN status = 'paid' THEN 'ready_checkout' ELSE status END` } : {}) } as any)
      .where('id', '=', id)
      .where((eb: any) => eb.or([eb('checkout_status', 'is', null), canMoveToSql(TICKET_CHECKOUT, status) as any]));
    if (!unsettle) q = q.where('status', '<>', 'paid');   // a stale replica never writes a board state over a paid ticket
    // inside a caller's transaction a failure propagates (an aborted transaction must not look like "refused")
    const run = q.executeTakeFirst();
    const r: any = exec === this.db ? await run.catch(() => undefined) : await run;
    return Number(r?.numUpdatedRows ?? 0) > 0;
  }
  async isPaid(ctx: CheckoutContext, ticketId: string): Promise<boolean> {
    const t: any = await this.scoped(this.db.selectFrom('tickets'), ctx).select(['status'] as any).where('id', '=', ticketId).executeTakeFirst();
    return t?.status === 'paid';
  }

  async claimPaymentAttempt(ctx: CheckoutContext, rec: { ticketId: string; method: PaymentMethod; amountCents: Money; idempotencyKey: string }): Promise<{ claimed: boolean; attemptId: string | null }> {
    let id: string | undefined; let err: unknown;
    try {
      const ins = await this.db.insertInto('payment_attempts').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: rec.ticketId, amount_cents: rec.amountCents, method: rec.method, status: 'processing', idempotency_key: rec.idempotencyKey } as any).returning(['id']).executeTakeFirst();
      id = (ins as any)?.id;
    } catch (e) { err = e; }
    if (id) return { claimed: true, attemptId: id };
    // No row returned → UNIQUE(tenant, idempotency_key) rejected a duplicate reservation (concurrent loser) or the
    // insert failed for another reason. If a reservation row already holds the key, this caller is a loser.
    const existing = await this.db.selectFrom('payment_attempts').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', rec.idempotencyKey).select(['id']).executeTakeFirst().catch(() => undefined);
    if (existing) return { claimed: false, attemptId: null };
    if (err) throw err;
    return { claimed: false, attemptId: null };
  }
  async settlePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string): Promise<void> {
    // Phase 12 (#27): only processing | needs_review → settled (was unconditional: a failed / refunded attempt could be
    // turned back into settled); best-effort as before — the payment row is the record
    await transitionStatus(this.db, PAYMENT_ATTEMPT, { where: { tenant_id: ctx.tenantId, idempotency_key: idempotencyKey }, to: 'settled', set: { updated_at: new Date() } }).catch(() => undefined);
  }
  async releasePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string): Promise<void> {
    await this.db.deleteFrom('payment_attempts').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', idempotencyKey).execute().catch(() => undefined);
  }

  async markPaymentVoided(ctx: CheckoutContext, paymentId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const prev: any = await this.scoped(trx.selectFrom('payments'), ctx).select(['status', 'ticket_id', 'method', 'amount_cents']).where('id', '=', paymentId).forUpdate().executeTakeFirst();
      // Phase 12 (#27): voiding goes through PAYMENT — a refunded / declined / failed payment cannot be voided (409)
      if (prev) assertTransition(PAYMENT, String(prev.status), 'voided');
      await this.scoped(trx.updateTable('payments'), ctx).set({ status: 'voided' } as any).where('id', '=', paymentId).where(canMoveToSql(PAYMENT, 'voided') as any).executeTakeFirst();
      // payment.voided — declared since Constitution 8, recorded by nothing until now. Only a REAL transition is a fact:
      // voiding an already-voided payment records nothing.
      if (prev && prev.status !== 'voided' && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.PAYMENT_VOIDED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'payment', aggregateId: paymentId,
        actorId: ctx.userId, actorType: 'user', correlationId: prev.ticket_id ? `ticket:${prev.ticket_id}` : undefined,
        payload: { paymentId, ticketId: prev.ticket_id ?? null, method: prev.method ?? null, amountCents: Number(prev.amount_cents ?? 0) } }));
    }).catch(() => undefined);
  }

  async recordRefund(ctx: CheckoutContext, input: { paymentId: string | null; amountCents: number; reason?: string | null; method?: string | null; processorType?: string | null; processorRefundId?: string | null }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const ins: any = await trx.insertInto('payment_refunds').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, payment_id: input.paymentId, payment_gateway_id: ctx.tenantId,
        processor_type: input.processorType ?? null, amount_cents: input.amountCents, reason: input.reason ?? null,
        status: 'refunded', processor_refund_id: input.processorRefundId ?? null, created_by_user_id: ctx.userId || null,
      } as any).returning('id').executeTakeFirst();
      if (ins?.id) await this.refundFact(trx, ctx, String(ins.id), input.paymentId, input.amountCents);
    });
  }

  /** Points earned on a refunded / voided amount go back — through the loyalty ledger (Phase 10) as a `reverse` entry,
   *  at most what the customer still has (points already spent stay spent). A void is keyed by its payment, so voiding
   *  the same payment twice reverses once. Best-effort: the refund / void has already happened. */
  async reverseLoyaltyPoints(ctx: CheckoutContext, ticketId: string, refundedCents: number, reason: string, source?: { table: string; id: string }): Promise<void> {
    const ptsToReverse = Math.floor(refundedCents / 100);
    if (ptsToReverse <= 0) return;
    try {
      await this.db.transaction().execute(async (trx) => {
        const ticket = await trx.selectFrom('tickets').select(['customer_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
        if (!ticket || !ticket.customer_id) return;
        const customerId = String(ticket.customer_id);
        const has = await trx.selectFrom('customer_loyalty_profiles').select(['id']).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).executeTakeFirst();
        if (!has) return;                                                     // nothing was ever earned
        await applyLoyaltyEntry(trx as any, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, customerId, entryType: 'reverse', delta: -ptsToReverse, clampToBalance: true,
          reason: `Refund reversal: ${reason}`, sourceTable: source?.table ?? null, sourceId: source?.id ?? null, actorUserId: ctx.userId || null,
          legacyType: 'refund_reversal', legacySource: 'pos' });
      });
    } catch { /* best-effort */ }
  }

  async refundedTotalCents(ctx: CheckoutContext, originalPaymentId: string): Promise<number> {
    const r = await this.scoped(this.db.selectFrom('payment_refunds'), ctx).where('payment_id', '=', originalPaymentId)
      .select((eb: any) => eb.fn.sum('amount_cents').as('s')).executeTakeFirst().catch(() => undefined);
    return Number((r as any)?.s || 0);
  }
  async paymentSignatureForTicket(ctx: CheckoutContext, ticketId: string): Promise<{ signaturePng: string; capturedOn: string } | null> {
    const pay: any = await this.db.selectFrom('payments').select(['id'])
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', ctx.branchId).where('ticket_id', '=', ticketId)
      .where('method', '=', 'card').where('status', '=', 'approved')
      .orderBy('created_at', 'desc').limit(1).executeTakeFirst().catch(() => undefined);
    if (!pay?.id) return null;
    const sig: any = await this.db.selectFrom('payment_signatures').select(['signature_png', 'captured_on'])
      .where('tenant_id', '=', ctx.tenantId).where('payment_id', '=', pay.id)
      .executeTakeFirst().catch(() => undefined);
    return sig?.signature_png ? { signaturePng: String(sig.signature_png), capturedOn: String(sig.captured_on ?? 'customer_display') } : null;
  }
  async reserveRefundAtomic(ctx: CheckoutContext, input: { paymentId: string; capturedCents: Money; amountCents: Money; reason?: string | null; method?: string | null; processorType?: string | null; canApprove?: boolean; thresholds?: RefundThresholds }): Promise<{ ok: true; refundId: string } | { ok: false; refundable: number }> {
    return this.db.transaction().execute(async (trx) => {
      // Serialize refunds for THIS payment, then re-sum and reserve atomically — a concurrent same-payment refund
      // either waits here and sees this reservation in the sum, or is rejected. Mirrors wallet.postDebitAtomic.
      const lockKey = `${ctx.tenantId}|${input.paymentId}|refund`;
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(trx);
      const sumRow = await trx.selectFrom('payment_refunds').where('tenant_id', '=', ctx.tenantId).where('payment_id', '=', input.paymentId)
        .select((eb: any) => eb.fn.sum('amount_cents').as('s')).executeTakeFirst();
      const already = Number((sumRow as any)?.s || 0);
      const refundable = input.capturedCents - already;
      if (input.amountCents > refundable) return { ok: false as const, refundable: Math.max(0, refundable) };
      // Constitution 12 M9: evaluated HERE, under the same advisory lock and against the same re-summed total, so the
      // rule is cumulative and two concurrent under-limit refunds cannot pass together.
      if (!input.canApprove && refundNeedsApprover(input.method, already, input.amountCents, input.thresholds ?? refundThresholds())) return { ok: false as const, approvalRequired: true, refundable: Math.max(0, refundable) };
      const ins = await trx.insertInto('payment_refunds').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, payment_id: input.paymentId, payment_gateway_id: ctx.tenantId, processor_type: input.processorType ?? null, amount_cents: input.amountCents, reason: input.reason ?? null, status: 'reserved', processor_refund_id: null, created_by_user_id: ctx.userId || null } as any).returning(['id']).executeTakeFirstOrThrow();
      return { ok: true as const, refundId: (ins as any).id };
    });
  }
  async releaseRefund(ctx: CheckoutContext, refundId: string): Promise<void> {
    await this.db.deleteFrom('payment_refunds').where('tenant_id', '=', ctx.tenantId).where('id', '=', refundId).execute().catch(() => undefined);
  }
  async finalizeRefund(ctx: CheckoutContext, refundId: string, processorRefundId: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const prev: any = await trx.selectFrom('payment_refunds').select(['status', 'payment_id', 'amount_cents']).where('tenant_id', '=', ctx.tenantId).where('id', '=', refundId).forUpdate().executeTakeFirst();
      await trx.updateTable('payment_refunds').set({ status: 'refunded', processor_refund_id: processorRefundId } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', refundId).where(canMoveToSql(PAYMENT_REFUND, 'refunded') as any).execute();
      if (prev && prev.status !== 'refunded') await this.refundFact(trx, ctx, refundId, prev.payment_id, Number(prev.amount_cents ?? 0));
    }).catch(() => undefined);
  }
  /** gift_card.issued / gift_card.redeemed — declared since Constitution 8, recorded by nothing until now. Cents + ids;
   *  never the code, the card number or the PIN. `exec` is the caller's transaction when there is one. */
  private async giftCardFact(exec: any, ctx: CheckoutContext, type: string, tenantId: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(exec, createDomainEvent({ eventType: type as any, tenantId, branchId: tenantId === ctx.tenantId ? ctx.branchId : undefined,
      aggregateType: 'gift_card', aggregateId, actorId: ctx.userId, actorType: 'user', payload }));
  }
  /** payment.refunded — declared since Constitution 8, recorded by nothing until now. Once per refund: at the moment it
   *  becomes 'refunded' (a reservation that is released never refunded anything). Cents + ids only. */
  private async refundFact(trx: any, ctx: CheckoutContext, refundId: string, paymentId: string | null, amountCents: number): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.PAYMENT_REFUNDED, tenantId: ctx.tenantId, branchId: ctx.branchId,
      aggregateType: 'payment_refund', aggregateId: refundId, actorId: ctx.userId, actorType: 'user',
      payload: { refundId, paymentId, amountCents } }));
  }


  async paidTotalCents(ctx: CheckoutContext, ticketId: string): Promise<number> {
    const r = await this.scoped(this.db.selectFrom('payments'), ctx).where('ticket_id', '=', ticketId).where('status', 'in', ['approved', 'partial'])
      .select((eb: any) => eb.fn.sum('amount_cents').as('s')).executeTakeFirst().catch(() => undefined);
    return Number((r as any)?.s || 0);
  }
  async setFinalTotals(ctx: CheckoutContext, ticketId: string, t: { subtotalCents: number; taxCents: number; surchargeCents: number; totalCents: number }): Promise<void> {
    await this.scoped(this.db.updateTable('tickets'), ctx).set({ subtotal_cents: t.subtotalCents, tax_cents: t.taxCents, surcharge_cents: t.surchargeCents, total_cents: t.totalCents, updated_at: sql`now()` } as any)
      .where('id', '=', ticketId).execute();
  }
  async recordProviderSurcharge(ctx: CheckoutContext, paymentId: string, feeCents: number): Promise<void> {
    if (!(feeCents > 0)) return;
    await this.scoped(this.db.updateTable('payments'), ctx)
      .set({ surcharge_cents: feeCents, amount_cents: sql`amount_cents + ${feeCents}` } as any)
      .where('id', '=', paymentId).where('surcharge_cents', '=', 0).executeTakeFirst();
  }
  async paidBreakdown(ctx: CheckoutContext, ticketId: string): Promise<{ totalCents: number; surchargeCents: number }> {
    const r = await this.scoped(this.db.selectFrom('payments'), ctx).where('ticket_id', '=', ticketId).where('status', 'in', ['approved', 'partial'])
      .select((eb: any) => [eb.fn.sum('amount_cents').as('total'), eb.fn.sum('surcharge_cents').as('surcharge')]).executeTakeFirst();
    return { totalCents: Number((r as any)?.total || 0), surchargeCents: Number((r as any)?.surcharge || 0) };
  }
  async hasReceipt(ctx: CheckoutContext, ticketId: string): Promise<boolean> {
    const r = await this.scoped(this.db.selectFrom('receipts'), ctx).where('ticket_id', '=', ticketId).select('id').limit(1).executeTakeFirst();
    return !!r;
  }

  // ---- customer-display devices + sessions (REAL tables) ----
  private async deviceRow(ctx: CheckoutContext, deviceId: string): Promise<any> {
    return this.scoped(this.db.selectFrom('customer_display_devices'), ctx).where('id', '=', deviceId).where('revoked_at', 'is', null).where('pairing_status', '=', 'paired')
      .select(['id', 'device_name', 'pos_station_id', 'pairing_status', 'last_seen_at', 'maintenance_at']).executeTakeFirst().catch(() => undefined);
  }
  private deviceToModel(d: any): POSCustomerDisplayDevice {
    const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : NaN;
    return {
      deviceId: d.id, label: d.device_name || '', stationCode: d.pos_station_id ? String(d.pos_station_id) : '', paired: (d.pairing_status || '') === 'paired', lastSeenAt: d.last_seen_at ? iso(d.last_seen_at) : '',
      // 23-inch spec §83–§85: online is the display's own heartbeat, recent enough — never a stored flag
      online: Number.isFinite(seen) && Date.now() - seen <= DISPLAY_ONLINE_WINDOW_MS, maintenance: !!d.maintenance_at,
    };
  }
  async devices(ctx: CheckoutContext): Promise<POSCustomerDisplayDevice[]> {
    const rows = await this.scoped(this.db.selectFrom('customer_display_devices'), ctx).where('revoked_at', 'is', null).where('pairing_status', '=', 'paired')
      .select(['id', 'device_name', 'pos_station_id', 'pairing_status', 'last_seen_at', 'maintenance_at']).orderBy('created_at', 'asc').execute().catch(() => []);
    return rows.map((d: any) => this.deviceToModel(d));
  }
  async openDisplaySessionsForTicket(ctx: CheckoutContext, ticketId: string): Promise<OpenDisplaySession[]> {
    const rows = await this.scoped(this.db.selectFrom('customer_display_sessions'), ctx).where('ticket_id', '=', ticketId).where('closed_at', 'is', null)
      .where('state', 'not in', ['closed', 'disconnected', 'completed']).where((eb: any) => eb('expires_at', '>', sql`now()`))
      .select(['id', 'display_device_id', 'state']).execute().catch(() => []);
    return (rows as any[]).filter((r) => r.display_device_id).map((r) => ({ sessionId: String(r.id), deviceId: String(r.display_device_id), state: String(r.state) }));
  }

  // map a session row (joined to its ticket + device for ticketNumber/station) to the API model
  private async sessionToModel(ctx: CheckoutContext, row: any): Promise<POSCustomerDisplaySession> {
    const t = row.ticket_id ? await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', row.ticket_id).select(['ticket_number', 'station_label']).executeTakeFirst().catch(() => undefined) : undefined;
    const stationUuid = row.pos_station_id ? String(row.pos_station_id) : '';
    const expired = row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
    return {
      sessionId: row.id, ticketId: row.ticket_id || '', ticketNumber: (t as any)?.ticket_number || '', deviceId: row.display_device_id || '',
      stationCode: stationUuid || ((t as any)?.station_label || ''), state: (expired ? 'disconnected' : row.state) as POSCustomerDisplaySession['state'],
      selectedTipCents: Number(row.selected_tip_cents || 0), totalDueCents: Number(row.total_due_cents || 0), paymentMethod: row.payment_method || undefined,
      expiresAt: row.expires_at ? iso(row.expires_at) : '', payButtonEnabled: (await this.resolveSettings(ctx)).customerDisplayPayButtonEnabled,
    };
  }
  private sessCols = ['id', 'ticket_id', 'display_device_id', 'pos_station_id', 'state', 'selected_tip_cents', 'total_due_cents', 'payment_method', 'expires_at'] as const;

  async createSession(ctx: CheckoutContext, ticketId: string, deviceId: string): Promise<POSCustomerDisplaySession | null> {
    const t = await this._ticket(ctx, ticketId); const d = await this.deviceRow(ctx, deviceId); if (!t || !d) return null;
    const publicToken = randomBytes(24).toString('base64url'); const tokenHash = createHash('sha256').update(publicToken).digest('hex');
    const settings = await this.resolveSettings(ctx);
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, settings, t.method);
    // ── Reserve the display (spec §85–§86, §180) ── one transaction, the display's row locked: retire its expired
    // sessions, then look at what it is showing. Another customer → DISPLAY_BUSY (never displace them, least of all
    // mid-payment); the SAME ticket re-sent → its old session is retired and a fresh one (new token) replaces it.
    // Migration 505's partial unique index backs this for any writer that bypasses the lock.
    const ins = await this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      await this.scoped(k.selectFrom('customer_display_devices'), ctx).where('id', '=', deviceId).select('id').forUpdate().executeTakeFirst();
      await this.scoped(k.updateTable('customer_display_sessions'), ctx).set({ state: 'disconnected', closed_at: sql`now()`, updated_at: sql`now()` } as any)
        .where('display_device_id', '=', deviceId).where('closed_at', 'is', null).where((eb: any) => eb('expires_at', '<=', sql`now()`)).execute();
      const cur: any = await this.scoped(k.selectFrom('customer_display_sessions'), ctx).where('display_device_id', '=', deviceId)
        .where('closed_at', 'is', null).where('state', 'not in', ['closed', 'disconnected']).select(['id', 'ticket_id', 'state']).executeTakeFirst();
      if (cur && cur.ticket_id !== ticketId) throw new DisplayBusyError(cur.state);
      if (cur) await this.scoped(k.updateTable('customer_display_sessions'), ctx).set({ state: 'disconnected', closed_at: sql`now()`, updated_at: sql`now()` } as any).where('id', '=', cur.id).execute();
      return k.insertInto('customer_display_sessions').values({
      tenant_id: ctx.tenantId, branch_id: (ctx.branchId || null) as any, display_device_id: deviceId, pos_station_id: (d.pos_station_id || null) as any,
      ticket_id: ticketId, customer_id: (t.customerId || null) as any, state: 'showing_ticket', selected_tip_cents: t.tipCents,
      subtotal_cents: totals.subtotalCents, surcharge_cents: totals.surchargeCents, tax_cents: totals.taxCents, total_due_cents: totals.totalDueCents,
      payment_method: (t.method || null) as any, expires_at: new Date(Date.now() + 600000) as any, public_token_hash: tokenHash,
      } as any).returning(this.sessCols as any).executeTakeFirst();
    }).catch((e: any) => {
      if (e instanceof DisplayBusyError) throw e;
      if (e?.code === '23505' && /uq_customer_display_one_active_session/.test(String(e?.constraint ?? e?.message ?? ''))) throw new DisplayBusyError(null);
      return undefined;
    });
    if (!ins) return null;
    const model = await this.sessionToModel(ctx, ins);
    return { ...model, publicToken };
  }
  async getSession(ctx: CheckoutContext, sessionId: string): Promise<POSCustomerDisplaySession | null> {
    const row = await this.scoped(this.db.selectFrom('customer_display_sessions'), ctx).where('id', '=', sessionId).select(this.sessCols as any).executeTakeFirst().catch(() => undefined);
    return row ? this.sessionToModel(ctx, row) : null;
  }
  async updateSession(ctx: CheckoutContext, sessionId: string, patch: Partial<POSCustomerDisplaySession>): Promise<POSCustomerDisplaySession | null> {
    const cur = await this.scoped(this.db.selectFrom('customer_display_sessions'), ctx).where('id', '=', sessionId).select(['id', 'ticket_id']).executeTakeFirst().catch(() => undefined);
    if (!cur) return null;
    const set: any = {};
    if (patch.state != null) set.state = patch.state;
    if (patch.selectedTipCents != null) set.selected_tip_cents = patch.selectedTipCents;
    if (patch.expiresAt != null) set.expires_at = new Date(patch.expiresAt);
    if (Object.keys(set).length) { set.updated_at = sql`now()`; await this.db.updateTable('customer_display_sessions').set(set).where('tenant_id', '=', ctx.tenantId).where('id', '=', sessionId).execute().catch(() => {}); }
    if (patch.selectedTipCents != null && (cur as any).ticket_id) await this.setTip(ctx, (cur as any).ticket_id, patch.selectedTipCents, { tipType: 'custom', tipPercent: null }); // cents-only source: an explicit amount — keeps provenance consistent instead of leaving a stale earlier 'percent' label
    return this.getSession(ctx, sessionId);
  }
  async closeSession(ctx: CheckoutContext, sessionId: string): Promise<boolean> {
    const res = await this.scoped(this.db.updateTable('customer_display_sessions'), ctx).set({ state: 'disconnected', closed_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', sessionId).executeTakeFirst().catch(() => undefined);
    return Number((res as any)?.numUpdatedRows ?? 0) > 0;
  }
  async activeSession(ctx: CheckoutContext): Promise<POSCustomerDisplaySession | null> {
    // 23-inch spec §81: only a checkout that is ON a display — a released (completed) or cancelled session is history.
    // (This read used to skip only 'disconnected': a session the display had released stayed "active" until it expired,
    // so the POS kept offering Clear Display for a customer who had already left.)
    const row = await this.scoped(this.db.selectFrom('customer_display_sessions'), ctx).where('closed_at', 'is', null).where('state', 'not in', ['closed', 'disconnected', 'completed'])
      .where((eb: any) => eb('expires_at', '>', sql`now()`))
      .select(this.sessCols as any).orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined);
    return row ? this.sessionToModel(ctx, row) : null;
  }
}
