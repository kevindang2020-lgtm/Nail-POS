// skip-line-checkout.service.ts — Skip-the-Line orchestration. Backend-authoritative money, tenant/branch derived from
// the session + ticket + assignment, realtime events on the shared bus. Reuses the bill math, the payments table, and
// the tenant audit/alert surfaces via the repository. Card/app charge (start/confirm via the processor) is added next.
import { processorFromEnv, type PaymentProcessor, SandboxPaymentProcessor } from '@aipowersalon/payments';
import { type RealtimeEmitter, EVENTS, type EventName } from '@aipowersalon/realtime-contracts';
import { SkipLineCheckoutRepository, type SLCtx } from './skip-line-checkout.repository';
import { validateCustomTip } from '../checkout/checkout-display.dto';
import { hasPermission } from '@aipowersalon/permissions';
import { Bill, SkipLineSettings, SLC_EVENTS, SkipLineError } from './skip-line-checkout.dto';
import { looksLikeRawPan } from '@aipowersalon/payments';   // wave 3 PAYI §31: the one PCI card-data rule

const CASH_PERM_OVERRIDE = 'pos.checkout.take_payment'; // lets a manager confirm cash on a ticket not assigned to them

export class SkipLineCheckoutService {
  constructor(private readonly repo: SkipLineCheckoutRepository, private readonly realtime?: RealtimeEmitter,
              private readonly gateway?: { resolve(tenantId: string, branchId?: string | null): Promise<{ processor?: PaymentProcessor }> }) {}
  private cardMethods = new Set(['card', 'apple_pay', 'google_pay']);
  /**
   * The SALON's own processor — the same per-tenant gateway checkout, top-ups and membership renewals use (so its
   * platform kill switch applies too). BUG FIXED (Sep 28 2026): this used processorFromEnv(), one server-wide processor,
   * so a skip-line card payment would have charged whatever merchant account the server's environment named instead of
   * the salon's own, and ignored the payment kill switch. With the gateway injected (always, in the module): the
   * tenant's processor, else a clearly-labeled sandbox only when PAYMENTS_SANDBOX=1, else the server-wide processor only
   * when PAYMENTS_ALLOW_ENV_FALLBACK=1 (the resolver's own dev rule), else none (honest "not configured").
   */
  private async resolveProcessor(tenantId: string, branchId?: string | null): Promise<{ processor?: PaymentProcessor; sandbox: boolean; merchantAccountId?: string | null }> {
    const sandbox = process.env.PAYMENTS_SANDBOX === '1' || process.env.PAYMENTS_SANDBOX === 'true';
    if (this.gateway) {
      const g = await this.gateway.resolve(tenantId, branchId ?? null);   // wave 3 §13: tenant + branch → merchant account
      if (g.processor) return { processor: g.processor, sandbox: false, merchantAccountId: (g as any).merchantAccountId ?? null };
      if (sandbox) return { processor: new SandboxPaymentProcessor(), sandbox: true };
      if (process.env.PAYMENTS_ALLOW_ENV_FALLBACK === '1') { const env = processorFromEnv(); if (env) return { processor: env, sandbox: false }; }
      return { sandbox: false };
    }
    // no gateway wired (unit tests that construct the service bare): the old behaviour
    const live = processorFromEnv();
    if (live) return { processor: live, sandbox: false };
    if (sandbox) return { processor: new SandboxPaymentProcessor(), sandbox: true };
    return { sandbox: false };
  }

  private toTenant(ctx: SLCtx, event: EventName, payload: any) { try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined } as any, event, payload); } catch { /* bus must not break actions */ } }
  /** Constitution 9: an owner alert ROW was written — owner clients must refetch alerts/dashboard. `owner_alert_updated`
   *  was already emitted on status change; the CREATE side was silent, so a new cash alert never reached an open Owner App. */
  private ownerAlert(ctx: SLCtx, code: string): void { try { this.realtime?.toOwner(ctx.tenantId, EVENTS.ownerAlertCreated, { code }); } catch { /* best-effort */ } }
  private toTech(id: string | null, event: EventName, payload: any) { try { if (id) this.realtime?.toTechnician(id, event, payload); } catch { /* */ } }
  private toCustomer(id: string | null, event: EventName, payload: any) { try { if (id) (this.realtime as any)?.toCustomer?.(id, event, payload); } catch { /* */ } }
  // BUILD_PLAN Phase 9 (Constitution 2 audit bug 6): no OWNER / SUPER_ADMIN shortcut. An owner's session carries every
  // tenant capability, so the permission alone admits them — and a DENY on the owner-level template now means something.
  // (Super Admin never reaches a /pos or /tech route: its session is refused outside the platform realm.)
  private has(ctx: SLCtx, perm: string) { return hasPermission(ctx as any, perm); }
  /** Award loyalty for a paid ticket (best-effort — never breaks the payment). Returns points awarded. */
  private async awardLoyalty(ctx: SLCtx, ticketId: string, customerId: string | null, amountCents: number, paymentId: string): Promise<number> {
    let r: { awarded: number; balance: number } | null = null;
    try { r = await this.repo.awardLoyaltyForPayment(ctx, customerId, amountCents, paymentId, ticketId); } catch { /* loyalty must never break a payment */ }
    if (r && r.awarded > 0) {
      if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.loyaltyPointsAdded, { ticketId, customerId, points: r.awarded, balance: r.balance });   // §343: else the projection delivers loyalty.points_earned
      if (!this.repo.emitsDomainEvents?.()) this.toCustomer(customerId, SLC_EVENTS.loyaltyPointsAdded, { points: r.awarded, balance: r.balance });   // §343: else the projection delivers loyalty.points_earned
      await this.repo.audit(ctx, 'skip_line_loyalty_awarded', ticketId, { customerId, points: r.awarded, balance: r.balance });
      return r.awarded;
    }
    return 0;
  }

  // ================= CUSTOMER =================
  async customerActiveBill(ctx: SLCtx): Promise<{ bill: Bill | null; enabledMethods: string[]; settings: SkipLineSettings; surcharge: { applies: boolean; ratePercent: number } }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw new SkipLineError('not_a_customer', 'Not a customer account.', 403);
    const settings = await this.repo.getSettings(ctx.tenantId);
    const bill = await this.repo.activeBillForCustomer(ctx, customerId);
    // §343 exempt: a VIEW signal (the customer opened their bill in the app) — nothing about the ticket changed
    if (bill) this.toTenant(ctx, SLC_EVENTS.billOpened, { ticketId: bill.ticketId, customerId });
    const enabledMethods = ['card', 'apple_pay', 'google_pay', 'gift_card', 'split_payment'];
    // Cash-to-technician is the ONLY way a customer settles without the front desk (card payments are started
    // by the front desk via sendAppPayment). So "require front desk approval" means exactly: do not offer it.
    if (settings.allowCashToTechnician && !settings.requireFrontDeskApproval) enabledMethods.push('cash_to_technician');
    // Payment master build §9.4 / N.J.S.A. 56:8-156.2: the app must show the conditional credit-card surcharge BEFORE payment
    const surcharge = bill && this.repo.cardSurchargeDisclosure ? await this.repo.cardSurchargeDisclosure(ctx.tenantId, bill.ticketId) : { applies: false, ratePercent: 0 };
    return { bill, enabledMethods, settings, surcharge };
  }

  /** Customer chooses to pay cash to their technician. Creates the intent + a pending cash-confirmation for the tech. */
  async payCashToTech(ctx: SLCtx, ticketId: string): Promise<{ intentId: string; confirmationId: string; technicianId: string | null; technicianName: string; amountCents: number; status: string }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw new SkipLineError('not_a_customer', 'Not a customer account.', 403);
    const settings = await this.repo.getSettings(ctx.tenantId);
    if (!settings.featureEnabled) throw new SkipLineError('feature_disabled', 'Skip-the-Line Checkout is disabled.', 403);
    if (!settings.allowCashToTechnician) throw new SkipLineError('cash_disabled', 'Cash to technician is not enabled.', 403);
    // Enforced HERE, not only by hiding the button: a customer app with a stale menu, or a direct API call, must
    // not be able to close its own ticket when the salon requires the front desk to be involved. This setting was
    // previously stored, displayed and editable — and read by nothing.
    if (settings.requireFrontDeskApproval) {
      throw new SkipLineError('front_desk_approval_required', 'This salon asks you to settle your bill at the front desk.', 403);
    }
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Bill not found.', 404);
    if (bill.customerId !== customerId) throw new SkipLineError('forbidden', 'This is not your bill.', 403);
    if (bill.paid) throw new SkipLineError('already_paid', 'This ticket is already paid.', 409);
    const amount = bill.totalDueCents;
    const intent = await this.repo.createIntent(ctx, { ticketId, customerId, amountCents: amount, method: 'cash_to_technician', status: 'cash_pending_tech_confirmation' });
    const conf = await this.repo.createCashConfirmation(ctx, { ticketId, paymentIntentId: intent.id, customerId, technicianId: bill.technicianId, amountCents: amount });
    await this.repo.audit(ctx, 'skip_line_cash_to_tech_selected', ticketId, { intentId: intent.id, confirmationId: conf.id, amountCents: amount });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.cashSelected, { ticketId, amountCents: amount });   // §343: else the projection delivers skip_line.cash_to_tech_requested
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.cashPending, { ticketId, technicianId: bill.technicianId, amountCents: amount });   // §343: else the projection delivers skip_line.cash_to_tech_requested
    if (!this.repo.emitsDomainEvents?.()) this.toTech(bill.technicianId, SLC_EVENTS.cashPending, { ticketId, confirmationId: conf.id, amountCents: amount, customerName: bill.customerName });   // §343: else the projection delivers skip_line.cash_to_tech_requested
    return { intentId: intent.id, confirmationId: conf.id, technicianId: bill.technicianId, technicianName: bill.technicianName, amountCents: amount, status: 'cash_pending_tech_confirmation' };
  }

  async paymentStatus(ctx: SLCtx, intentId: string): Promise<{ intentId: string; status: string; amountCents: number; method: string }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    const intent = await this.repo.getIntent(ctx, intentId);
    if (!intent) throw new SkipLineError('not_found', 'Payment not found.', 404);
    if (customerId && intent.customer_id && intent.customer_id !== customerId) throw new SkipLineError('forbidden', 'Not your payment.', 403);
    return { intentId: intent.id, status: intent.status, amountCents: Number(intent.amount_cents), method: intent.method };
  }

  // ================= TECHNICIAN =================
  async techCashPending(ctx: SLCtx): Promise<{ items: any[] }> {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw new SkipLineError('not_a_technician', 'Not a technician account.', 403);
    return { items: await this.repo.cashPendingForTechnician(ctx, technicianId) };
  }

  async confirmCashReceived(ctx: SLCtx, ticketId: string): Promise<{ paid: true; paymentId: string; amountCents: number; ticketStatus: string; loyaltyAwarded: number }> {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw new SkipLineError('not_a_technician', 'Not a technician account.', 403);
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404);
    // assignment check — the tech must own the ticket unless they hold the cash-override permission
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Ticket not found.', 404);
    if (bill.paid) throw new SkipLineError('already_paid', 'This ticket is already paid.', 409);
    const amount = bill.totalDueCents; // backend-authoritative balance at confirmation time
    const { paymentId } = await this.repo.recordPaymentAndCloseTicket(ctx, ticketId, 'cash', amount, bill.tipCents);
    if (conf.payment_intent_id) await this.repo.setIntentStatus(ctx, conf.payment_intent_id, 'cash_confirmed_by_tech');
    await this.repo.setCashConfirmationStatus(ctx, conf.id, 'confirmed', ctx.userId ?? null);
    await this.repo.audit(ctx, 'skip_line_cash_confirmed', ticketId, { confirmationId: conf.id, paymentId, amountCents: amount, technicianId });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.cashConfirmed, { ticketId, amountCents: amount });   // §343: else the projection delivers payment.captured (cash)
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketPaid, { ticketId, paymentId });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketClosed, { ticketId });   // §343: else the projection delivers checkout.completed
    if (!this.repo.emitsDomainEvents?.()) this.toCustomer(bill.customerId, SLC_EVENTS.cashConfirmed, { ticketId, amountCents: amount });   // §343: else the projection delivers payment.captured (cash)
    const loyaltyAwarded = await this.awardLoyalty(ctx, ticketId, bill.customerId, amount, paymentId);
    return { paid: true, paymentId, amountCents: amount, ticketStatus: 'paid', loyaltyAwarded };
  }

  async reportCashNotPaid(ctx: SLCtx, ticketId: string, notes?: string): Promise<{ reported: true; status: string }> {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw new SkipLineError('not_a_technician', 'Not a technician account.', 403);
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404);
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403);
    if (conf.payment_intent_id) await this.repo.setIntentStatus(ctx, conf.payment_intent_id, 'cash_issue_needs_front_desk');
    await this.repo.setCashConfirmationStatus(ctx, conf.id, 'customer_did_not_pay', ctx.userId ?? null, notes ?? null);
    await this.repo.alert(ctx, 'warning', 'skip_line_cash_not_paid', `Cash not received for ${ticketId} — needs front desk`, { ticketId, confirmationId: conf.id, technicianId });
    this.ownerAlert(ctx, 'skip_line_cash_not_paid');
    await this.repo.audit(ctx, 'skip_line_cash_not_paid', ticketId, { confirmationId: conf.id, technicianId, notes: notes ?? null });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.cashIssue, { ticketId });   // §343: else the projection delivers skip_line.cash_to_tech_not_paid
    return { reported: true, status: 'cash_issue_needs_front_desk' };
  }

  // ================= POS =================
  async posSkipLineState(ctx: SLCtx) { if (!this.has(ctx, 'pos.checkout.view')) throw new SkipLineError('forbidden', 'Missing pos.checkout.view', 403); return this.repo.skipLineState(ctx); }

  async sendAppPayment(ctx: SLCtx, ticketId: string): Promise<{ intentId: string; status: string }> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw new SkipLineError('forbidden', 'Missing pos.checkout.take_payment', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Ticket not found.', 404);
    if (bill.paid) throw new SkipLineError('already_paid', 'Already paid.', 409);
    const intent = await this.repo.createIntent(ctx, { ticketId, customerId: bill.customerId, amountCents: bill.totalDueCents, method: 'card', status: 'sent_to_customer' });
    await this.repo.audit(ctx, 'skip_line_app_payment_sent', ticketId, { intentId: intent.id, amountCents: bill.totalDueCents });
    // §343 exempt: a delivery notice (the payment prompt reached the customer) — the payment intent row is the record
    this.toTenant(ctx, SLC_EVENTS.promptSent, { ticketId, intentId: intent.id });
    // §343 exempt: the prompt itself, delivered to the customer's app — the payment intent row is the record
    this.toCustomer(bill.customerId, SLC_EVENTS.promptSent, { ticketId, intentId: intent.id, amountCents: bill.totalDueCents });
    return { intentId: intent.id, status: 'sent_to_customer' };
  }

  async cancelAppPayment(ctx: SLCtx, ticketId: string): Promise<{ cancelled: boolean }> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw new SkipLineError('forbidden', 'Missing pos.checkout.take_payment', 403);
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (conf?.payment_intent_id) await this.repo.setIntentStatus(ctx, conf.payment_intent_id, 'cancelled');
    if (conf) await this.repo.setCashConfirmationStatus(ctx, conf.id, 'cancelled', ctx.userId ?? null);
    await this.repo.audit(ctx, 'skip_line_app_payment_cancelled', ticketId, {});
    return { cancelled: true };
  }

  // ================= SETTINGS =================
  async getSettings(ctx: SLCtx) { if (!this.has(ctx, 'pos.checkout.view')) throw new SkipLineError('forbidden', 'Missing pos.checkout.view', 403); return this.repo.getSettings(ctx.tenantId); }
  async updateSettings(ctx: SLCtx, patch: Partial<SkipLineSettings>) { if (!this.has(ctx, 'pos.checkout.take_payment')) throw new SkipLineError('forbidden', 'Missing permission', 403); const next = await this.repo.updateSettings(ctx.tenantId, patch); await this.repo.audit(ctx, 'skip_line_settings_changed', null, { patch }); return next; }
  // super-admin variants (guarded by SuperAdminGuard at the controller; tenantId from the path)
  async adminGetSettings(tenantId: string) { return this.repo.getSettings(tenantId); }
  async adminUpdateSettings(ctx: SLCtx, tenantId: string, patch: Partial<SkipLineSettings>) { const next = await this.repo.updateSettings(tenantId, patch); await this.repo.audit({ ...ctx, tenantId }, 'skip_line_settings_changed', null, { patch, bySuperAdmin: true }); return next; }

  async posTicketPaymentStatus(ctx: SLCtx, ticketId: string) {
    if (!this.has(ctx, 'pos.checkout.view')) throw new SkipLineError('forbidden', 'Missing pos.checkout.view', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Ticket not found.', 404);
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    return { ticketId, paid: bill.paid, totalDueCents: bill.totalDueCents, pendingCash: conf ? { confirmationId: conf.id, amountCents: Number(conf.amount_cents), status: conf.status } : null };
  }

  async techCashPaymentForTicket(ctx: SLCtx, ticketId: string) {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw new SkipLineError('not_a_technician', 'Not a technician account.', 403);
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404);
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    return { ticketId, confirmationId: conf.id, amountCents: Number(conf.amount_cents), customerName: bill?.customerName || '', ticketNumber: bill?.ticketNumber || '', services: bill?.services || [], status: conf.status };
  }

  // ================= CUSTOMER CARD / APPLE PAY / GOOGLE PAY =================
  /** Create the payment intent for an in-app card/wallet charge. Returns gateway availability so the app can render. */
  /** Customer-added tip (425). Reuses the tenant's EXISTING tip policy — validateCustomTip + maxTipPercent from
   *  checkout settings — no new rules. 0/absent = no tip (always allowed in-app). Junk or over-cap REJECTS. */
  private async validatedCustomerTip(ctx: SLCtx, bill: { subtotalCents: number }, raw: unknown): Promise<number> {
    if (raw === undefined || raw === null || raw === '') return 0;
    const tip = Number(raw);
    if (!Number.isInteger(tip) || tip < 0) throw new SkipLineError('bad_tip', 'Tip must be a whole number of cents, zero or more.', 400);
    if (tip === 0) return 0;
    const maxPercent = await this.repo.maxTipPercent(ctx.tenantId, ctx.branchId ?? null);
    const v = validateCustomTip(tip, bill.subtotalCents, maxPercent);
    if (!v.ok) throw new SkipLineError('bad_tip', 'Tip rejected: ' + (v.reason || 'over the allowed maximum.'), 400);
    return tip;
  }

  async startAppPayment(ctx: SLCtx, ticketId: string, body: any): Promise<{ intentId: string; ticketId: string; method: string; amountCents: number; tipCents: number; gateway: string | null; configured: boolean; status: string }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw new SkipLineError('not_a_customer', 'Not a customer account.', 403);
    const method = String(body?.method || 'card');
    if (!this.cardMethods.has(method)) throw new SkipLineError('bad_method', 'Use pay-cash-to-tech for cash payments.', 400);
    const settings = await this.repo.getSettings(ctx.tenantId);
    if (!settings.featureEnabled) throw new SkipLineError('feature_disabled', 'Skip-the-Line Checkout is disabled.', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Bill not found.', 404);
    if (bill.customerId !== customerId) throw new SkipLineError('forbidden', 'This is not your bill.', 403);
    if (bill.paid) throw new SkipLineError('already_paid', 'This ticket is already paid.', 409);
    const customerTip = await this.validatedCustomerTip(ctx, bill, body?.tipCents);
    const amountWithTip = bill.totalDueCents + customerTip;
    const { processor } = await this.resolveProcessor(ctx.tenantId, ctx.branchId ?? null);
    const intent = await this.repo.createIntent(ctx, { ticketId, customerId, amountCents: amountWithTip, method: method as any, status: processor ? 'processing' : 'requires_action', gateway: processor?.name ?? null, customerTipCents: customerTip });
    await this.repo.audit(ctx, 'skip_line_app_payment_started', ticketId, { intentId: intent.id, method, amountCents: amountWithTip, customerTipCents: customerTip });
    // §343 exempt: a momentary 'customer is paying' signal — the outcome is the fact (payment.captured / payment.failed)
    this.toTenant(ctx, SLC_EVENTS.paymentStarted, { ticketId, intentId: intent.id, method });
    return { intentId: intent.id, ticketId, method, amountCents: amountWithTip, tipCents: customerTip, gateway: processor?.name ?? null, configured: !!processor, status: intent.status };
  }

  /** Charge the card/wallet via the tenant processor (tokenized; never raw PAN). On success: record + close the ticket. */
  async confirmAppPayment(ctx: SLCtx, ticketId: string, body: any): Promise<any> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw new SkipLineError('not_a_customer', 'Not a customer account.', 403);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw new SkipLineError('not_found', 'Bill not found.', 404);
    if (bill.customerId !== customerId) throw new SkipLineError('forbidden', 'This is not your bill.', 403);
    if (bill.paid) throw new SkipLineError('already_paid', 'This ticket is already paid.', 409);
    const method = this.cardMethods.has(String(body?.method)) ? String(body.method) : 'card';
    // wave 3 PAYI §29–§31 (P0 PCI): a raw card number is never accepted as a "token" — refused before anything is created
    if (looksLikeRawPan(String(body?.token ?? body?.account ?? ''))) throw new SkipLineError('raw_card_rejected', 'Card numbers are never accepted directly — enter the card in the secure card form.', 400);
    const { processor, merchantAccountId } = await this.resolveProcessor(ctx.tenantId, ctx.branchId ?? null);
    // locate the start() intent or create one. The customer tip comes from the INTENT (chosen at start) — the
    // confirm body cannot change it; only the no-intent path validates a body tip, exactly once.
    let intentId = '';
    let customerTip = 0;
    const provided = body?.intentId ? String(body.intentId) : '';
    if (provided) { const i = await this.repo.getIntent(ctx, provided); if (i && i.ticket_id === ticketId) { intentId = provided; customerTip = Math.max(0, Math.trunc(Number((i as any).customer_tip_cents) || 0)); } }
    if (!intentId) {
      customerTip = await this.validatedCustomerTip(ctx, bill, body?.tipCents);
      const created = await this.repo.createIntent(ctx, { ticketId, customerId, amountCents: bill.totalDueCents + customerTip, method: method as any, status: processor ? 'processing' : 'requires_action', gateway: processor?.name ?? null, customerTipCents: customerTip });
      intentId = created.id;
    }
    const amount = bill.totalDueCents + customerTip; // backend-authoritative balance + the customer's stored tip choice
    if (!processor) return { configured: false, disabledReason: 'Card processor is not configured yet.', intentId, status: 'requires_action' };
    // resolve a tokenized card: client-tokenized (hosted fields / wallet) or a saved method
    let token = body?.token || body?.account; let expiry = body?.expiry; let savedCard = false;
    // Payment master build §8D: a saved card is chargeable only where it was provider-verified (same merchant account), with recorded
    // consent and not revoked — the repository refuses anything else (legacy / synthetic rows included).
    if (!token && body?.paymentMethodId) { const saved = await this.repo.savedCardToken(ctx, customerId, String(body.paymentMethodId), merchantAccountId ?? null); if (saved) { savedCard = true; token = saved.token; expiry = expiry || saved.expiry; } }
    if (!token) throw new SkipLineError('card_token_required', 'A tokenized card is required (hosted fields or a saved method).', 400);
    await this.repo.setIntentStatus(ctx, intentId, 'processing');
    // §343 exempt: a momentary 'processing…' signal — the outcome is the fact (payment.captured / payment.failed)
    this.toTenant(ctx, SLC_EVENTS.paymentProcessing, { ticketId, intentId });
    const idem = `slc-${ticketId}-${amount}`;
    // The customer is paying from their phone: card-not-present (ecomind 'E'), the cardholder name when the bill knows it,
    // and — for a SAVED card — the Stored Credential framework fields: cardholder-initiated, unscheduled.
    const auth = await processor.authorizeAndCapture({ account: String(token), expiry, amountCents: amount, orderId: ticketId, idempotencyKey: idem,
      ecomind: 'E', name: bill.customerName || undefined, ...(savedCard ? { cof: 'C' as const, cofscheduled: 'N' as const } : {}) });
    // Payment master build §7.3 / §8D: a non-answer is not a decline. respstat 'B' (retry) or anything that is neither approved nor
    // declined leaves the intent 'processing' for provider inquiry — the customer is NOT told "declined" and invited to
    // pay again, and nothing is recorded as paid.
    const providerFee = Math.max(0, auth.surchargeCents ?? 0);
    if (!auth.approved && !auth.declined) {
      await this.repo.audit(ctx, 'skip_line_app_payment_unknown', ticketId, { intentId, respstat: auth.respstat, retref: auth.retref ?? null });
      return { paid: false, status: 'unknown', intentId, message: 'We could not confirm this payment yet. Please do not pay again — the salon will verify it.' };
    }
    if (auth.approved && (!auth.retref || (auth.amountCents != null && auth.amountCents !== amount + providerFee))) {
      await this.repo.audit(ctx, 'skip_line_app_payment_amount_mismatch', ticketId, { intentId, requestedCents: amount, providerFeeCents: providerFee, approvedCents: auth.amountCents ?? null, retref: auth.retref ?? null });
      return { paid: false, status: 'unknown', intentId, message: 'We could not confirm this payment yet. Please do not pay again — the salon will verify it.' };
    }
    if (!auth.approved) {
      await this.repo.recordDeclinedPayment(ctx, ticketId, method, amount, bill.tipCents + customerTip, auth.retref ?? null, idem, auth.respText, customerId);
      await this.repo.setIntentStatus(ctx, intentId, 'failed');
      await this.repo.audit(ctx, 'skip_line_app_payment_declined', ticketId, { intentId, respText: auth.respText });
      if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.paymentFailed, { ticketId, intentId });   // §343: else the projection delivers the recorded fact
      if (!this.repo.emitsDomainEvents?.()) this.toCustomer(customerId, SLC_EVENTS.paymentFailed, { ticketId, intentId, reason: auth.respText });   // §343: else the projection delivers payment.failed
      return { paid: false, status: 'failed', declineReason: auth.respText, intentId };
    }
    const { paymentId } = await this.repo.recordPaymentAndCloseTicket(ctx, ticketId, method, amount + providerFee, bill.tipCents + customerTip, { processorTxnId: auth.retref ?? null, idempotencyKey: idem, surchargeCents: providerFee });
    await this.repo.setIntentStatus(ctx, intentId, 'succeeded');
    await this.repo.audit(ctx, 'skip_line_app_payment_succeeded', ticketId, { intentId, paymentId, amountCents: amount, method });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.paymentSucceeded, { ticketId, paymentId });   // §343: else the projection delivers payment.captured
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketPaid, { ticketId, paymentId });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketClosed, { ticketId });   // §343: else the projection delivers checkout.completed
    if (!this.repo.emitsDomainEvents?.()) this.toCustomer(customerId, SLC_EVENTS.paymentSucceeded, { ticketId, paymentId, amountCents: amount });   // §343: else the projection delivers payment.captured
    const loyaltyAwarded = await this.awardLoyalty(ctx, ticketId, customerId, amount, paymentId);
    return { paid: true, status: 'succeeded', paymentId, amountCents: amount, processorTransactionId: auth.retref ?? null, intentId, loyaltyAwarded };
  }
}
