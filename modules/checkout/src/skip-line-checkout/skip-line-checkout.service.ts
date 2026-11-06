// skip-line-checkout.service.ts — Skip-the-Line orchestration. Backend-authoritative money, tenant/branch derived from
// the session + ticket + assignment, realtime events on the shared bus. Reuses the bill math, the payments table, and
// the tenant audit/alert surfaces via the repository. Card/app charge (start/confirm via the processor) is added next.
import { processorFromEnv, type PaymentProcessor, SandboxPaymentProcessor, authorizeOutcome, decideIntentFromRecord } from '@aipowersalon/payments';
import { type RealtimeEmitter, EVENTS, type EventName } from '@aipowersalon/realtime-contracts';
import { SkipLineCheckoutRepository, type SLCtx } from './skip-line-checkout.repository';
import { validateCustomTip } from '../checkout/checkout-display.dto';
import { hasPermission } from '@aipowersalon/permissions';
import { Bill, SkipLineSettings, SLC_EVENTS, SkipLineError } from './skip-line-checkout.dto';
import { looksLikeRawPan } from '@aipowersalon/payments';
import { randomUUID } from 'node:crypto';
import { systemContext } from '@aipowersalon/tenant-context';
import { LockHeldElsewhereError, type CheckoutLockService } from '../checkout-lock/checkout-lock.service';   // wave 3 PAYI §31: the one PCI card-data rule
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const CASH_PERM_OVERRIDE = 'pos.checkout.take_payment';
/** B-80: an app charge with no answer for this long is "stranded" — the sweep asks the processor; a not-found record then means nothing was charged. */
export const SKIP_LINE_STRANDED_MS = 15 * 60_000; // lets a manager confirm cash on a ticket not assigned to them

export class SkipLineCheckoutService {
  constructor(private readonly repo: SkipLineCheckoutRepository, private readonly realtime?: RealtimeEmitter,
              private readonly gateway?: { resolve(tenantId: string, branchId?: string | null): Promise<{ processor?: PaymentProcessor }> }) {}
  /** B-81 (Oct 23 2026): the SAME per-ticket checkout lock the POS takes while it records a tender. The guest's app charge
   *  holds it from the unsettled-tender check to the recorded answer, so a POS cash / card / split on the same bill and the
   *  guest's card can never interleave (the database allows one active lock per ticket). Absent (tests) → no lock. */
  private locks: Pick<CheckoutLockService, 'acquire' | 'release'> | null = null;
  useLocks(locks: Pick<CheckoutLockService, 'acquire' | 'release'> | null): this { this.locks = locks; return this; }
  private cardMethods = new Set(['card', 'apple_pay', 'google_pay']);
  /**
   * The SALON's own processor — the same per-tenant gateway checkout, top-ups and membership renewals use (so its
   * platform kill switch applies too). BUG FIXED (Sep 28 2026): this used processorFromEnv(), one server-wide processor,
   * so a skip-line card payment would have charged whatever merchant account the server's environment named instead of
   * the salon's own, and ignored the payment kill switch. With the gateway injected (always, in the module): the
   * tenant's processor, else a clearly-labeled sandbox only when PAYMENTS_SANDBOX=1, else the server-wide processor only
   * when PAYMENTS_ALLOW_ENV_FALLBACK=1 (the resolver's own dev rule), else none (honest "not configured").
   */
  private async resolveProcessor(tenantId: string, branchId?: string | null): Promise<{ processor?: PaymentProcessor; sandbox: boolean }> {
    const sandbox = process.env.PAYMENTS_SANDBOX === '1' || process.env.PAYMENTS_SANDBOX === 'true';
    if (this.gateway) {
      const g = await this.gateway.resolve(tenantId, branchId ?? null);   // wave 3 §13: tenant + branch → merchant account
      if (g.processor) return { processor: g.processor, sandbox: false };
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
  private toCustomer(id: string | null, event: EventName, payload: any) { try { if (id) this.realtime?.toCustomer?.(id, event, payload); } catch { /* */ } }
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
  async customerActiveBill(ctx: SLCtx): Promise<{ bill: Bill | null; enabledMethods: string[]; settings: SkipLineSettings }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw withCode(new SkipLineError('not_a_customer', 'Not a customer account.', 403), 'PERMISSION_DENIED');
    const settings = await this.repo.getSettings(ctx.tenantId);
    const bill = await this.repo.activeBillForCustomer(ctx, customerId);
    // §343 exempt: a VIEW signal (the customer opened their bill in the app) — nothing about the ticket changed
    if (bill) this.toTenant(ctx, SLC_EVENTS.billOpened, { ticketId: bill.ticketId, customerId });
    const enabledMethods = ['card', 'apple_pay', 'google_pay', 'gift_card', 'split_payment'];
    // Cash-to-technician is the ONLY way a customer settles without the front desk (card payments are started
    // by the front desk via sendAppPayment). So "require front desk approval" means exactly: do not offer it.
    if (settings.allowCashToTechnician && !settings.requireFrontDeskApproval) enabledMethods.push('cash_to_technician');
    return { bill, enabledMethods, settings };
  }

  /** Customer chooses to pay cash to their technician. Creates the intent + a pending cash-confirmation for the tech. */
  async payCashToTech(ctx: SLCtx, ticketId: string): Promise<{ intentId: string; confirmationId: string; technicianId: string | null; technicianName: string; amountCents: number; status: string }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw withCode(new SkipLineError('not_a_customer', 'Not a customer account.', 403), 'PERMISSION_DENIED');
    const settings = await this.repo.getSettings(ctx.tenantId);
    if (!settings.featureEnabled) throw withCode(new SkipLineError('feature_disabled', 'Skip-the-Line Checkout is disabled.', 403), 'SKIP_LINE_DISABLED');
    if (!settings.allowCashToTechnician) throw withCode(new SkipLineError('cash_disabled', 'Cash to technician is not enabled.', 403), 'CASH_TO_TECH_DISABLED');
    // Enforced HERE, not only by hiding the button: a customer app with a stale menu, or a direct API call, must
    // not be able to close its own ticket when the salon requires the front desk to be involved. This setting was
    // previously stored, displayed and editable — and read by nothing.
    if (settings.requireFrontDeskApproval) {
      throw withCode(new SkipLineError('front_desk_approval_required', 'This salon asks you to settle your bill at the front desk.', 403), 'PAY_AT_FRONT_DESK');
    }
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Bill not found.', 404), 'TICKET_NOT_FOUND');
    if (bill.customerId !== customerId) throw withCode(new SkipLineError('forbidden', 'This is not your bill.', 403), 'PERMISSION_DENIED');
    if (bill.paid) throw withCode(new SkipLineError('already_paid', 'This ticket is already paid.', 409), 'TICKET_ALREADY_PAID');
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
    if (!intent) throw withCode(new SkipLineError('not_found', 'Payment not found.', 404), 'PAYMENT_NOT_FOUND');
    if (customerId && intent.customer_id && intent.customer_id !== customerId) throw withCode(new SkipLineError('forbidden', 'Not your payment.', 403), 'PERMISSION_DENIED');
    return { intentId: intent.id, status: intent.status, amountCents: Number(intent.amount_cents), method: intent.method };
  }

  // ================= TECHNICIAN =================
  async techCashPending(ctx: SLCtx): Promise<{ items: any[] }> {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw withCode(new SkipLineError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    return { items: await this.repo.cashPendingForTechnician(ctx, technicianId) };
  }

  async confirmCashReceived(ctx: SLCtx, ticketId: string): Promise<{ paid: true; paymentId: string; amountCents: number; ticketStatus: string; loyaltyAwarded: number }> {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw withCode(new SkipLineError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw withCode(new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404), 'NO_PENDING_CASH_PAYMENT');
    // assignment check — the tech must own the ticket unless they hold the cash-override permission
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw withCode(new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403), 'TICKET_NOT_ASSIGNED_TO_YOU');
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Ticket not found.', 404), 'TICKET_NOT_FOUND');
    if (bill.paid) throw withCode(new SkipLineError('already_paid', 'This ticket is already paid.', 409), 'TICKET_ALREADY_PAID');
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
    if (!technicianId) throw withCode(new SkipLineError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw withCode(new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404), 'NO_PENDING_CASH_PAYMENT');
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw withCode(new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403), 'TICKET_NOT_ASSIGNED_TO_YOU');
    if (conf.payment_intent_id) await this.repo.setIntentStatus(ctx, conf.payment_intent_id, 'cash_issue_needs_front_desk');
    await this.repo.setCashConfirmationStatus(ctx, conf.id, 'customer_did_not_pay', ctx.userId ?? null, notes ?? null);
    await this.repo.alert(ctx, 'warning', 'skip_line_cash_not_paid', `Cash not received for ${ticketId} — needs front desk`, { ticketId, confirmationId: conf.id, technicianId });
    this.ownerAlert(ctx, 'skip_line_cash_not_paid');
    await this.repo.audit(ctx, 'skip_line_cash_not_paid', ticketId, { confirmationId: conf.id, technicianId, notes: notes ?? null });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.cashIssue, { ticketId });   // §343: else the projection delivers skip_line.cash_to_tech_not_paid
    return { reported: true, status: 'cash_issue_needs_front_desk' };
  }

  // ================= POS =================
  async posSkipLineState(ctx: SLCtx) { if (!this.has(ctx, 'pos.checkout.view')) throw withCode(new SkipLineError('forbidden', 'Missing pos.checkout.view', 403), 'PERMISSION_DENIED'); return this.repo.skipLineState(ctx); }

  async sendAppPayment(ctx: SLCtx, ticketId: string): Promise<{ intentId: string; status: string }> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new SkipLineError('forbidden', 'Missing pos.checkout.take_payment', 403), 'PERMISSION_DENIED');
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Ticket not found.', 404), 'TICKET_NOT_FOUND');
    if (bill.paid) throw withCode(new SkipLineError('already_paid', 'Already paid.', 409), 'TICKET_ALREADY_PAID');
    const intent = await this.repo.createIntent(ctx, { ticketId, customerId: bill.customerId, amountCents: bill.totalDueCents, method: 'card', status: 'sent_to_customer' });
    await this.repo.audit(ctx, 'skip_line_app_payment_sent', ticketId, { intentId: intent.id, amountCents: bill.totalDueCents });
    // §343 exempt: a delivery notice (the payment prompt reached the customer) — the payment intent row is the record
    this.toTenant(ctx, SLC_EVENTS.promptSent, { ticketId, intentId: intent.id });
    // §343 exempt: the prompt itself, delivered to the customer's app — the payment intent row is the record
    this.toCustomer(bill.customerId, SLC_EVENTS.promptSent, { ticketId, intentId: intent.id, amountCents: bill.totalDueCents });
    return { intentId: intent.id, status: 'sent_to_customer' };
  }

  async cancelAppPayment(ctx: SLCtx, ticketId: string): Promise<{ cancelled: boolean }> {
    if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new SkipLineError('forbidden', 'Missing pos.checkout.take_payment', 403), 'PERMISSION_DENIED');
    // §74 (write sweep): another salon's ticket id answered {cancelled:true} and wrote an audit row — it is not ours
    if (!(await this.repo.billForTicket(ctx, ticketId))) throw withCode(new SkipLineError('not_found', 'Ticket not found.', 404), 'TICKET_NOT_FOUND');
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (conf?.payment_intent_id) await this.repo.setIntentStatus(ctx, conf.payment_intent_id, 'cancelled');
    if (conf) await this.repo.setCashConfirmationStatus(ctx, conf.id, 'cancelled', ctx.userId ?? null);
    await this.repo.audit(ctx, 'skip_line_app_payment_cancelled', ticketId, {});
    return { cancelled: true };
  }

  // ================= SETTINGS =================
  async getSettings(ctx: SLCtx) { if (!this.has(ctx, 'pos.checkout.view')) throw withCode(new SkipLineError('forbidden', 'Missing pos.checkout.view', 403), 'PERMISSION_DENIED'); return this.repo.getSettings(ctx.tenantId); }
  async updateSettings(ctx: SLCtx, patch: Partial<SkipLineSettings>) { if (!this.has(ctx, 'pos.checkout.take_payment')) throw withCode(new SkipLineError('forbidden', 'Missing permission', 403), 'PERMISSION_DENIED'); const next = await this.repo.updateSettings(ctx.tenantId, patch); await this.repo.audit(ctx, 'skip_line_settings_changed', null, { patch }); return next; }
  // super-admin variants (guarded by SuperAdminGuard at the controller; tenantId from the path)
  async adminGetSettings(tenantId: string) { return this.repo.getSettings(tenantId); }
  async adminUpdateSettings(ctx: SLCtx, tenantId: string, patch: Partial<SkipLineSettings>) { const next = await this.repo.updateSettings(tenantId, patch); await this.repo.audit({ ...ctx, tenantId }, 'skip_line_settings_changed', null, { patch, bySuperAdmin: true }); return next; }

  async posTicketPaymentStatus(ctx: SLCtx, ticketId: string) {
    if (!this.has(ctx, 'pos.checkout.view')) throw withCode(new SkipLineError('forbidden', 'Missing pos.checkout.view', 403), 'PERMISSION_DENIED');
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Ticket not found.', 404), 'TICKET_NOT_FOUND');
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    return { ticketId, paid: bill.paid, totalDueCents: bill.totalDueCents, pendingCash: conf ? { confirmationId: conf.id, amountCents: Number(conf.amount_cents), status: conf.status } : null };
  }

  async techCashPaymentForTicket(ctx: SLCtx, ticketId: string) {
    const technicianId = await this.repo.resolveTechnicianId(ctx);
    if (!technicianId) throw withCode(new SkipLineError('not_a_technician', 'Not a technician account.', 403), 'NOT_TECHNICIAN_ACCOUNT');
    const conf = await this.repo.pendingCashForTicket(ctx, ticketId);
    if (!conf) throw withCode(new SkipLineError('not_found', 'No pending cash payment for this ticket.', 404), 'NO_PENDING_CASH_PAYMENT');
    if (conf.technician_id && conf.technician_id !== technicianId && !this.has(ctx, CASH_PERM_OVERRIDE)) throw withCode(new SkipLineError('not_assigned', 'This ticket is not assigned to you.', 403), 'TICKET_NOT_ASSIGNED_TO_YOU');
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
    if (!Number.isInteger(tip) || tip < 0) throw withCode(new SkipLineError('bad_tip', 'Tip must be a whole number of cents, zero or more.', 400), 'TIP_AMOUNT_INVALID');
    if (tip === 0) return 0;
    const maxPercent = await this.repo.maxTipPercent(ctx.tenantId, ctx.branchId ?? null);
    const v = validateCustomTip(tip, bill.subtotalCents, maxPercent);
    if (!v.ok) throw withCode(new SkipLineError('bad_tip', 'Tip rejected: ' + (v.reason || 'over the allowed maximum.'), 400), 'TIP_REJECTED');
    return tip;
  }

  async startAppPayment(ctx: SLCtx, ticketId: string, body: any): Promise<{ intentId: string; ticketId: string; method: string; amountCents: number; tipCents: number; gateway: string | null; configured: boolean; status: string }> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    if (!customerId) throw withCode(new SkipLineError('not_a_customer', 'Not a customer account.', 403), 'PERMISSION_DENIED');
    const method = String(body?.method || 'card');
    if (!this.cardMethods.has(method)) throw new SkipLineError('bad_method', 'Use pay-cash-to-tech for cash payments.', 400);
    const settings = await this.repo.getSettings(ctx.tenantId);
    if (!settings.featureEnabled) throw withCode(new SkipLineError('feature_disabled', 'Skip-the-Line Checkout is disabled.', 403), 'SKIP_LINE_DISABLED');
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Bill not found.', 404), 'TICKET_NOT_FOUND');
    if (bill.customerId !== customerId) throw withCode(new SkipLineError('forbidden', 'This is not your bill.', 403), 'PERMISSION_DENIED');
    if (bill.paid) throw withCode(new SkipLineError('already_paid', 'This ticket is already paid.', 409), 'TICKET_ALREADY_PAID');
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
    if (!customerId) throw withCode(new SkipLineError('not_a_customer', 'Not a customer account.', 403), 'PERMISSION_DENIED');
    const bill = await this.repo.billForTicket(ctx, ticketId);
    if (!bill) throw withCode(new SkipLineError('not_found', 'Bill not found.', 404), 'TICKET_NOT_FOUND');
    if (bill.customerId !== customerId) throw withCode(new SkipLineError('forbidden', 'This is not your bill.', 403), 'PERMISSION_DENIED');
    if (bill.paid) throw withCode(new SkipLineError('already_paid', 'This ticket is already paid.', 409), 'TICKET_ALREADY_PAID');
    const method = this.cardMethods.has(String(body?.method)) ? String(body.method) : 'card';
    // wave 3 PAYI §29–§31 (P0 PCI): a raw card number is never accepted as a "token" — refused before anything is created
    if (looksLikeRawPan(String(body?.token ?? body?.account ?? ''))) throw withCode(new SkipLineError('raw_card_rejected', 'Card numbers are never accepted directly — enter the card in the secure card form.', 400), 'CARD_NUMBER_NOT_ACCEPTED');
    const { processor } = await this.resolveProcessor(ctx.tenantId, ctx.branchId ?? null);
    // locate the start() intent or create one. The customer tip comes from the INTENT (chosen at start) — the
    // confirm body cannot change it; only the no-intent path validates a body tip, exactly once.
    let intentId = '';
    let customerTip = 0;
    const provided = body?.intentId ? String(body.intentId) : '';
    if (provided) {
      const i = await this.repo.getIntent(ctx, provided);
      // B-80 (Oct 23 2026): an intent whose card WAS sent and whose answer is not back is never charged again — Verify
      // settles it; a failed (declined / host-retry) intent is not re-used either: the retry is a NEW intent with its own
      // processor key, so the processor cannot replay the old answer.
      if (i && i.ticket_id === ticketId && i.status === 'processing' && i.charge_started_at) throw withCode(new SkipLineError('payment_status_unknown', 'We could not confirm your payment with the card processor. Please do not pay again — the salon will confirm it.', 409), 'PAYMENT_STATUS_UNKNOWN');
      const storedTip = i ? Math.max(0, Math.trunc(Number(i.customer_tip_cents) || 0)) : 0;
      if (i && i.ticket_id === ticketId && i.status !== 'failed' && i.status !== 'cancelled' && i.status !== 'expired') { intentId = provided; customerTip = storedTip; }
      else if (i && i.ticket_id === ticketId) customerTip = storedTip;
    }
    if (!intentId) {
      if (!provided) customerTip = await this.validatedCustomerTip(ctx, bill, body?.tipCents);
      const created = await this.repo.createIntent(ctx, { ticketId, customerId, amountCents: bill.totalDueCents + customerTip, method: method as any, status: processor ? 'processing' : 'requires_action', gateway: processor?.name ?? null, customerTipCents: customerTip });
      intentId = created.id;
    }
    const amount = bill.totalDueCents + customerTip; // backend-authoritative balance + the customer's stored tip choice
    if (!processor) return { configured: false, disabledReason: 'Card processor is not configured yet.', intentId, status: 'requires_action' };
    // resolve a tokenized card: client-tokenized (hosted fields / wallet) or a saved method
    let token = body?.token || body?.account; let expiry = body?.expiry; let savedCard = false;
    if (!token && body?.paymentMethodId) { const saved = await this.repo.savedCardToken(ctx, customerId, String(body.paymentMethodId)); if (saved) { savedCard = true; token = saved.token; expiry = expiry || saved.expiry; } }
    if (!token) throw new SkipLineError('card_token_required', 'A tokenized card is required (hosted fields or a saved method).', 400);
    const lockSession = 'skip-line:' + randomUUID();
    if (this.locks) {
      const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ctx.userId)) ? String(ctx.userId) : '00000000-0000-0000-0000-000000000000';
      try { await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, ticketId, userId, sessionId: lockSession, source: 'mobile' }); }
      catch (e) {
        if (e instanceof LockHeldElsewhereError) throw withCode(new SkipLineError('checkout_in_progress', 'The salon is taking a payment for this bill right now. Please wait a moment and check your bill again.', 409), 'PAYMENT_IN_PROGRESS');
        throw e;
      }
    }
    try { return await this.chargeLocked(ctx, ticketId, intentId, customerId, method, amount, bill, customerTip, String(token), expiry, savedCard, processor); }
    // a failed release is recorded, never thrown over the payment's own answer; the lock also expires on its own (90 s)
    finally { if (this.locks) await this.locks.release(ctx.tenantId, ticketId, lockSession, 'payment_done').catch((e) => this.repo.audit(ctx, 'skip_line_checkout_lock_release_failed', ticketId, { intentId, error: String((e as Error)?.message ?? e).slice(0, 200) })); }
  }

  private async chargeLocked(ctx: SLCtx, ticketId: string, intentId: string, customerId: string, method: string, amount: number, bill: Bill, customerTip: number, token: string, expiry: string | undefined, savedCard: boolean, processor: PaymentProcessor): Promise<any> {
    // B-81: no second card while another card charge on this bill is mid-air (a POS card row, a split / Tap to Pay
    // attempt, another app intent whose card was sent) — the guest is told to wait, never charged on top.
    const unsettled = await this.repo.unsettledTendersForTicket(ctx, ticketId, intentId);
    if (unsettled.length) {
      await this.repo.audit(ctx, 'skip_line_app_payment_blocked_unsettled_card', ticketId, { intentId, blockedBy: unsettled.map((u) => ({ kind: u.kind, id: u.id, status: u.status })) });
      throw withCode(new SkipLineError('payment_status_unknown', 'A card payment for this bill is still being confirmed. Please do not pay again — the salon will confirm it.', 409), 'PAYMENT_STATUS_UNKNOWN');
    }
    // ONE charger per intent: the moment the card goes to the processor is recorded (charge_started_at); a second confirm
    // of the same intent — double tap, retry after a lost answer — is refused here and never reaches the processor.
    if (!(await this.repo.markChargeStarted(ctx, intentId))) throw withCode(new SkipLineError('payment_status_unknown', 'We could not confirm your payment with the card processor. Please do not pay again — the salon will confirm it.', 409), 'PAYMENT_STATUS_UNKNOWN');
    // §343 exempt: a momentary 'processing…' signal — the outcome is the fact (payment.captured / payment.failed)
    this.toTenant(ctx, SLC_EVENTS.paymentProcessing, { ticketId, intentId });
    // The processor key and order id are the INTENT: stable across a retry of this intent (the processor dedupes), fresh
    // for a new intent (a declined answer is never replayed), and inquireByOrderid(intentId) finds exactly this charge.
    const idem = `slc-${intentId}`;
    // The customer is paying from their phone: card-not-present (ecomind 'E'), the cardholder name when the bill knows it,
    // and — for a SAVED card — the Stored Credential framework fields: cardholder-initiated, unscheduled.
    // Deep-scan (Oct 22 2026), mandate §232 as on the POS: only an EXPLICIT decline is a decline. A host "retry" ('B')
    // charged nothing; an unknown or LOST answer may have charged the card — the intent stays 'processing' (charged) and the
    // guest is told not to pay again; staff Verify / the stranded sweep settle it from the processor's record (B-80).
    let auth: Awaited<ReturnType<PaymentProcessor['authorizeAndCapture']>>;
    try {
      auth = await processor.authorizeAndCapture({ account: String(token), expiry, amountCents: amount, orderId: intentId, idempotencyKey: idem,
        ecomind: 'E', name: bill.customerName || undefined, ...(savedCard ? { cof: 'C' as const, cofscheduled: 'N' as const } : {}) });
    } catch (e) {
      await this.repo.audit(ctx, 'skip_line_app_payment_answer_lost', ticketId, { intentId, error: String((e as Error)?.message ?? e).slice(0, 200) });
      throw withCode(new SkipLineError('payment_status_unknown', 'We could not confirm your payment with the card processor. Please do not pay again — the salon will confirm it.', 409), 'PAYMENT_STATUS_UNKNOWN');
    }
    const outcome = authorizeOutcome(auth);
    if (outcome === 'retry') {
      await this.repo.settleChargedIntent(ctx, intentId, { status: 'failed', processorRef: auth.retref ?? null, failureReason: 'host could not process it (retry) — nothing charged', settledBy: 'charge' });
      await this.repo.audit(ctx, 'skip_line_app_payment_provider_unavailable', ticketId, { intentId, respstat: auth.respstat, respText: auth.respText });
      throw withCode(new SkipLineError('card_processor_unavailable', 'The card processor is busy right now — nothing was charged. Please try again in a moment.', 503), 'PROCESSOR_BUSY');
    }
    if (outcome === 'unknown') {
      await this.repo.audit(ctx, 'skip_line_app_payment_unknown_answer', ticketId, { intentId, respstat: auth.respstat, respText: auth.respText, retref: auth.retref ?? null });
      throw withCode(new SkipLineError('payment_status_unknown', 'We could not confirm your payment with the card processor. Please do not pay again — the salon will confirm it.', 409), 'PAYMENT_STATUS_UNKNOWN');
    }
    if (!auth.approved) return this.recordDeclined(ctx, ticketId, intentId, customerId, method, amount, bill.tipCents + customerTip, auth.retref ?? null, idem, auth.respText ?? null, 'charge');
    return this.recordApproved(ctx, ticketId, intentId, customerId, method, amount, bill.tipCents + customerTip, auth.retref ?? null, idem, 'charge');
  }

  /** The one place an approved app charge becomes a paid ticket — the live answer AND a later Verify / sweep go through
   *  it. The payment row is idempotent on the intent key; the intent settle is conditional; both are safe to repeat. */
  private async recordApproved(ctx: SLCtx, ticketId: string, intentId: string, customerId: string | null, method: string, amount: number, tipCents: number, retref: string | null, idem: string, by: 'charge' | 'verify' | 'sweep'): Promise<any> {
    const { paymentId } = await this.repo.recordPaymentAndCloseTicket(ctx, ticketId, method, amount, tipCents, { processorTxnId: retref, idempotencyKey: idem });
    await this.repo.settleChargedIntent(ctx, intentId, { status: 'succeeded', processorRef: retref, settledBy: by });
    await this.repo.audit(ctx, by === 'charge' ? 'skip_line_app_payment_succeeded' : 'skip_line_app_payment_verified_approved', ticketId, { intentId, paymentId, amountCents: amount, method, by });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.paymentSucceeded, { ticketId, paymentId });   // §343: else the projection delivers payment.captured
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketPaid, { ticketId, paymentId });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.ticketClosed, { ticketId });   // §343: else the projection delivers checkout.completed
    if (!this.repo.emitsDomainEvents?.()) this.toCustomer(customerId, SLC_EVENTS.paymentSucceeded, { ticketId, paymentId, amountCents: amount });   // §343: else the projection delivers payment.captured
    const loyaltyAwarded = await this.awardLoyalty(ctx, ticketId, customerId, amount, paymentId);
    return { paid: true, status: 'succeeded', paymentId, amountCents: amount, processorTransactionId: retref, intentId, loyaltyAwarded };
  }
  private async recordDeclined(ctx: SLCtx, ticketId: string, intentId: string, customerId: string | null, method: string, amount: number, tipCents: number, retref: string | null, idem: string, respText: string | null, by: 'charge' | 'verify' | 'sweep'): Promise<any> {
    await this.repo.recordDeclinedPayment(ctx, ticketId, method, amount, tipCents, retref, idem, respText, customerId);
    await this.repo.settleChargedIntent(ctx, intentId, { status: 'failed', processorRef: retref, failureReason: respText ? 'declined: ' + respText : 'declined', settledBy: by });
    await this.repo.audit(ctx, by === 'charge' ? 'skip_line_app_payment_declined' : 'skip_line_app_payment_verified_declined', ticketId, { intentId, respText, by });
    if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.paymentFailed, { ticketId, intentId });   // §343: else the projection delivers the recorded fact
    if (!this.repo.emitsDomainEvents?.()) this.toCustomer(customerId, SLC_EVENTS.paymentFailed, { ticketId, intentId, reason: respText });   // §343: else the projection delivers payment.failed
    return { paid: false, status: 'failed', declineReason: respText, intentId };
  }

  // ================= B-80: Verify + stranded sweep for app charges =================
  /** Settle one charged intent from the processor's record (inquireByOrderid on the intent id). Never charges. */
  private async verifyIntent(ctx: SLCtx, intent: any, by: 'verify' | 'sweep', strandedMs = SKIP_LINE_STRANDED_MS): Promise<{ intentId: string; ticketId: string; status: string; outcome: 'approved' | 'declined' | 'released' | 'pending' | 'unknown' | 'review'; reason?: string; paymentId?: string }> {
    const intentId = String(intent.id), ticketId = String(intent.ticket_id);
    const fresh = await this.repo.getIntent(ctx, intentId);
    if (!fresh || fresh.status !== 'processing' || !fresh.charge_started_at) return { intentId, ticketId, status: fresh?.status ?? 'unknown', outcome: fresh?.status === 'succeeded' ? 'approved' : fresh?.status === 'failed' ? 'declined' : 'unknown' };
    const amount = Number(fresh.amount_cents);
    const { processor } = await this.resolveProcessor(ctx.tenantId, ctx.branchId ?? fresh.branch_id ?? null);
    if (!processor) return { intentId, ticketId, status: 'processing', outcome: 'unknown', reason: 'Card processor is not connected.' };
    if (!processor.inquireByOrderId) return { intentId, ticketId, status: 'processing', outcome: 'unknown', reason: `${processor.name} has no transaction inquiry — check the processor portal.` };
    let txns: Awaited<ReturnType<NonNullable<PaymentProcessor['inquireByOrderId']>>>['transactions'] | null;
    try { txns = (await processor.inquireByOrderId(intentId)).transactions; }
    catch (e: any) { txns = null; await this.repo.audit(ctx, 'skip_line_app_payment_verify_unreachable', ticketId, { intentId, by, error: String(e?.message ?? e).slice(0, 200) }); }
    await this.repo.touchIntentInquired(ctx, intentId);
    const recorded = await this.repo.recordedProcessorRefs(ctx, ticketId);
    const started = fresh.charge_started_at instanceof Date ? fresh.charge_started_at.getTime() : Date.parse(String(fresh.charge_started_at));
    const verdict = decideIntentFromRecord({ amountCents: amount, ageMs: Date.now() - started }, txns === null ? null : txns.filter((t) => !(t.retref && recorded.has(t.retref) && !t.approved)), strandedMs);
    const tip = Number(fresh.customer_tip_cents || 0);
    const bill = await this.repo.billForTicket(ctx, ticketId);
    const method = String(fresh.method || 'card'); const customerId = fresh.customer_id ? String(fresh.customer_id) : null;
    switch (verdict.action) {
      case 'approved': { const r = await this.recordApproved(ctx, ticketId, intentId, customerId, method, amount, (bill?.tipCents ?? 0) + tip, verdict.retref, `slc-${intentId}`, by); return { intentId, ticketId, status: 'succeeded', outcome: 'approved', paymentId: r.paymentId }; }
      case 'declined': await this.recordDeclined(ctx, ticketId, intentId, customerId, method, amount, (bill?.tipCents ?? 0) + tip, verdict.retref, `slc-${intentId}`, 'Declined by the processor', by); return { intentId, ticketId, status: 'failed', outcome: 'declined' };
      case 'release':
        await this.repo.settleChargedIntent(ctx, intentId, { status: 'failed', failureReason: verdict.detail, settledBy: by });
        await this.repo.audit(ctx, 'skip_line_app_payment_verified_not_found', ticketId, { intentId, by, detail: verdict.detail });
        if (!this.repo.emitsDomainEvents?.()) this.toTenant(ctx, SLC_EVENTS.paymentFailed, { ticketId, intentId });
        return { intentId, ticketId, status: 'failed', outcome: 'released', reason: verdict.detail };
      case 'review':
        await this.repo.alert(ctx, 'critical', 'skip_line_payment_review', verdict.detail, { intentId, ticketId, amountCents: amount });
        return { intentId, ticketId, status: 'processing', outcome: 'review', reason: verdict.detail };
      default: return { intentId, ticketId, status: 'processing', outcome: 'pending', reason: txns === null ? 'The processor could not be reached. Nothing was charged again; try again in a moment.' : verdict.detail };
    }
  }
  /** POS Verify (front desk): every charged intent on the ticket whose answer is not back. */
  async posVerifyAppPayment(ctx: SLCtx, ticketId: string): Promise<{ ticketId: string; results: any[] }> {
    if (!this.has(ctx, 'pos.checkout.take_payment') && !this.has(ctx, 'checkout.process_payment')) throw withCode(new SkipLineError('forbidden', 'Missing checkout.process_payment', 403), 'PERMISSION_DENIED');
    const open = await this.repo.openChargedIntentsForTicket(ctx, ticketId);
    const results = []; for (const i of open) results.push(await this.verifyIntent(ctx, i, 'verify'));
    return { ticketId, results };
  }
  /** Customer "Check status": only the customer's own intent; same rule, never a charge. */
  async customerVerifyPayment(ctx: SLCtx, intentId: string): Promise<any> {
    const customerId = await this.repo.resolveCustomerId(ctx);
    const intent = await this.repo.getIntent(ctx, intentId);
    if (!intent) throw withCode(new SkipLineError('not_found', 'Payment not found.', 404), 'PAYMENT_NOT_FOUND');
    if (customerId && intent.customer_id && intent.customer_id !== customerId) throw withCode(new SkipLineError('forbidden', 'Not your payment.', 403), 'PERMISSION_DENIED');
    return this.verifyIntent(ctx, intent, 'verify');
  }
  /** The stranded sweep's step (under the payments.stranded_attempts owner): every salon's charged app intent still
   *  'processing' past the window is settled from its processor's record. */
  async sweepStranded(now: Date = new Date(), limit = 200, strandedMs = SKIP_LINE_STRANDED_MS): Promise<{ checked: number; approved: number; declined: number; released: number; waiting: number; review: number; errors: number; lastError?: string }> {
    const r: { checked: number; approved: number; declined: number; released: number; waiting: number; review: number; errors: number; lastError?: string } = { checked: 0, approved: 0, declined: 0, released: 0, waiting: 0, review: 0, errors: 0 };
    for (const i of await this.repo.strandedChargedIntents(new Date(now.getTime() - strandedMs), limit)) {
      r.checked++;
      // the system acting (§72); its 'system:…' user id is recorded as NULL in user columns (a raw non-uuid id there broke
      // every payment insert — found by the recovery pgtest)
      const ctx: SLCtx = systemContext({ tenantId: String(i.tenant_id), branchId: i.branch_id ? String(i.branch_id) : null, actor: 'payment-attempt-sweep' });
      try {
        const out = await this.verifyIntent(ctx, i, 'sweep', strandedMs);
        if (out.outcome === 'approved') r.approved++; else if (out.outcome === 'declined') r.declined++; else if (out.outcome === 'released') r.released++; else if (out.outcome === 'review') r.review++; else r.waiting++;
      } catch (e: any) { r.errors++; r.lastError = `${i.id}: ${String(e?.message ?? e).slice(0, 200)}`; }   // reported to the scheduler's log; the next tick retries
    }
    return r;
  }
}
