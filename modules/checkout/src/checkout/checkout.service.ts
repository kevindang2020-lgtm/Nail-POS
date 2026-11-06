// checkout.service.ts — tenant POS Checkout & Payment. Resolves tenant/role from session; enforces per-action
// permissions; computes money via dto helpers; NEVER fakes a card charge; honest disabled reasons; audits everything.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { rewardCodeDiscountCents, rewardCodeProblem, normalizeRewardCode } from './loyalty-reward-code';
import { membershipDiscountRequests, type MemberLine } from './membership-benefits';
import { type PaymentProcessor, PaymentGatewayResolver } from '@aipowersalon/payments';
import { type SmsSender, type EmailSender, type TenantMessenger, isSimulatedSender, isNotConfiguredSender, senderDelivers } from '@aipowersalon/notifications';
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { secureString } from '@aipowersalon/security';
import { recordDisplayEvent, recordPaymentEvent } from '@aipowersalon/observability';   // Dual-Screen §108; wave 3 PAYI §104 payment business counters
import { APPROVE_REFUND_CAPABILITY, thresholdsFromPolicy, type RefundApprovalsPort, type RefundThresholds } from './refund-approval';
import type { ApprovalPendingResult } from '@aipowersalon/api-contracts/tenant';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  Money, PaymentMethod, DEFAULT_CHECKOUT_SETTINGS, tipForPercent, validateCustomTip, splitCardSurchargeCents, centsToUsd,
} from './checkout-display.dto';
import {
  POSCheckoutFullState, CheckoutFilters, CheckoutTicketDetail, POSCheckoutTicketRow, PaymentRecord, PaymentResult,
  POSCustomerDisplayDevice, POSCustomerDisplaySession, SetTipRequest, ApplyDiscountRequest, ReopenServiceRequest,
  SendReceiptRequest, CashPaymentRequest, CardPaymentRequest, GiftCardPaymentRequest, SplitPaymentRequest,
  RefundRequest, VoidRequest, applyGiftCard, buildIdempotencyKey, canReopenService,
  cardProcessingEnabled, isSandbox, processorTxnId, IssueGiftCardRequest, GiftCardSaleRequest, GiftCardSaleResult, GiftCardDetail, FiservStatus,
  type CardVerificationOutcome, CustomerDisplayError, DisplayBusyError, PaymentInProgressError, CheckoutInProgressError, type SendToDisplayRequest,
} from './checkout.dto';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { LockHeldElsewhereError } from '../checkout-lock/checkout-lock.service';
import { pickDisplays } from './display-send-core';
import { CheckoutContext, CheckoutRepositoryPort, SplitRedemptionError } from './checkout.repository';
import { generateCardNumber, maskCardNumber } from '@aipowersalon/gift-cards';
import { rateLimitDecision } from '@aipowersalon/auth';
import type { GiftCardLookupThrottle } from './gift-card-lookup-throttle';
import { DiscountRequest } from './checkout-discount-engine';
import { itemizedReceipt } from './checkout-discount-items';
import { priceTicket, DealRefusedError, type OfferRequest, type StackingPolicy, type PricedOffer, type TicketOfferRequest, lineNetCents } from '@aipowersalon/deals';
import { calculateRefundAllocations, looksLikeRawPan } from '@aipowersalon/payments';
import { InMemoryTerminalLeases, type TerminalLeasePort } from './terminal-lease';
import type { ProcessorAnswer } from './payment-attempt-sweep';
import { systemContext } from '@aipowersalon/tenant-context';

/** The stranded-attempt sweep's actor (§72 systemContext): role SYSTEM, user 'system:payment-attempt-sweep', holding
 *  exactly the one capability the verification needs. Not a uuid, so the persisted audit row has user_id NULL. */
export const SWEEP_ACTOR = 'system:payment-attempt-sweep';
function sweepCtx(tenantId: string, branchId: string): CheckoutContext {
  return systemContext({ tenantId, branchId, actor: 'payment-attempt-sweep', permissions: ['pos.checkout.take_payment'] });
}

interface CompensationHook {
  snapshotPaidTicket(ctx: { tenantId: string; branchId: string | null }, ticketId: string): Promise<unknown>;
  computeForTicket(ctx: { tenantId: string; branchId: string | null }, ticketId: string): Promise<{ perTechnician: { technicianId: string; serviceEarningsCents: number; cardTipCents: number; cashTipCents: number }[] } | null>;
  /** Oct 13 2026 (FLOW D6): the ONE commission preview — snapshot for a paid ticket, engine otherwise. */
  previewForTicket?(ctx: { tenantId: string; branchId: string | null }, ticketId: string): Promise<{ source: 'snapshot' | 'engine'; byTechnician: { technicianId: string | null; cents: number }[] } | null>;
  reverseForRefund(ctx: { tenantId: string; branchId: string | null }, ticketId: string, event: { type: 'full' | 'partial' | 'void'; tipRefunded?: boolean; lines?: { serviceLineId: string; refundTip?: boolean }[]; refundedCents?: number; capturedCents?: number; nonCommissionableCents?: number; refundPaymentId?: string | null }, opts: { reason: string; requestedBy: string | null }): Promise<{ ok?: boolean; error?: string } | unknown>;
}
interface MembershipCompHook { bookTicketMembershipComp(ctx: { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }, ticketId: string): Promise<unknown>; }
interface ReviewRequestHook { onVisitCompleted(ctx: { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[] }, visit: { ticketId: string; customerId: string; branchId: string | null; visitValueCents: number; completedAt: string }): Promise<void>; }


export type CheckoutPushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };
export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
// Supplied by the caller (controller) to redeem a promo code for a given subtotal, so CheckoutService
// does not need to depend on the promotions module. Mirrors SalonPromotionsService.redeem's result.
export type PromoRedeemer = (subtotalCents: number) => Promise<{ ok: boolean; reason?: string; discountCents?: number }>;
/**
 * BUILD_PLAN Phase 5 — deals and coupons on a ticket come from the deals domain (DealsCheckoutService satisfies this
 * structurally). Checkout keeps the final say on the price: it runs the ONE pricing engine over every discount on the
 * ticket under the salon's stacking policy; the deals domain supplies the offers, holds their places, and records their
 * redemption at payment and reversal on void/refund.
 */
export interface CheckoutDealsPort {
  policy(ctx: any): Promise<StackingPolicy>;
  offersForPricing(ctx: any, ticketId: string): Promise<OfferRequest[]>;
  candidate(ctx: any, ticketId: string, req: TicketOfferRequest): Promise<{ deal: { id: string; title: string }; offer: OfferRequest } & Record<string, any>>;
  reserve(ctx: any, ticketId: string, candidate: any, priced: PricedOffer): Promise<{ redemptionId: string; dealId: string; discountCents: number }>;
  release(ctx: any, redemptionIds: string[], reason: string): Promise<number>;
  syncAmounts(ctx: any, applied: PricedOffer[], rejectedRedemptionIds: string[]): Promise<void>;
  panel(ctx: any, ticketId: string, otherOffers: OfferRequest[]): Promise<any>;
  applications(ctx: any, ticketId: string): Promise<any[]>;
  onPaid(ctx: any, ticketId: string): Promise<unknown>;
  onRefunded(ctx: any, ticketId: string, lineIds: string[] | null, reason: string): Promise<unknown>;
}
/** Without the deals domain (unit tests, dev without a database): manual/membership/loyalty stack; deals compete. */
const LEGACY_POLICY: StackingPolicy = { mode: 'stack_all', allowWithMembership: true, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null };
const PROMO_CATEGORIES = new Set(['deal', 'coupon']);
/** A discount already on the ticket (from its snapshot) as an engine request. Membership CREDITS are prepaid. */
function toOffer(r: any): OfferRequest {
  const id = String(r.id);
  return { id, category: r.category, description: r.description ?? '', amountCents: Math.max(0, Math.floor(Number(r.amountCents ?? r.appliedCents ?? 0))), stackable: r.stackable !== false,
    priority: r.priority, prepaid: r.category === 'membership' && id.startsWith('membership-') && !id.startsWith('membership-benefit-'), lineIds: Array.isArray(r.lineIds) ? r.lineIds : null };
}
// Same decoupling for marketplace deals: the controller supplies a redeemer that resolves the deal locked to the
// ticket's appointment and applies its terms, so CheckoutService never depends on the deals module.
export type DealRedeemer = (input: { subtotalCents: number; customerId: string; otherDiscountApplied: boolean }) => Promise<{ ok: boolean; reason?: string; discountCents?: number }>;

type NotConfigured = { configured: false; disabledReason: string };

// Functional Decision 22: how long a charge may stay unanswered before a retry asks the processor, and how long the
// processor may have no record of it before we conclude it never arrived (and release the claim for a fresh attempt).
export const STALE_ATTEMPT_MS = 30_000;
export const NOT_FOUND_RELEASE_MS = 5 * 60_000;

export interface POSCheckoutAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

// A minimal, loosely-coupled read of the checkout-session lock. Optional: when absent (e.g. unit tests), the POS pay
// path behaves exactly as before. When wired, the POS refuses to charge a ticket a mobile device currently has open.
export interface CheckoutLockRead {
  getStatus(tenantId: string, ticketId: string): Promise<{ locked: boolean; heldBy?: { source: string } | null }>;
  /** One payment at a time per ticket (Oct 6 2026) — the POS payment paths take the ticket's lock while they record. */
  acquire?(req: { tenantId: string; branchId?: string | null; ticketId: string; userId: string; sessionId: string; source: 'pos' }): Promise<unknown>;
  release?(tenantId: string, ticketId: string, sessionId: string, reason?: string): Promise<unknown>;
}

export class CheckoutService {
  private audit: POSCheckoutAuditLog[] = [];
  private deals: CheckoutDealsPort | null = null;
  /** BUILD_PLAN Phase 5: wire the deals domain (the module does; unit tests may pass a fake). */
  useDeals(port: CheckoutDealsPort | null | undefined): this { this.deals = port ?? null; return this; }
  private approvals: RefundApprovalsPort | null = null;
  /** BUILD_PLAN Phase 9: the salon approvals engine (refund-approval.ts). A refund past the salon's limit by someone without
   *  checkout.approve_refund becomes a request; the engine runs the approved refund through executeApprovedRefund. */
  useApprovals(port: RefundApprovalsPort | null | undefined): this {
    this.approvals = port ?? null;
    port?.registerExecutor('refund', { prepare: (actor, input) => this.prepareRefundRequest(actor, input), execute: (actor, request) => this.executeApprovedRefund(actor, request) });
    return this;
  }
  /** developer merge (Oct 6 2026): a push to the customer's devices when a receipt is saved to their app. Optional —
   *  the push module is wired by CheckoutModule; the service runs without it. Best-effort, never on the money path. */
  private push: CheckoutPushLike | null = null;
  usePush(push: CheckoutPushLike | null | undefined): this { this.push = push ?? null; return this; }
  private seq = 7000;
  /** Phase 15 round 3: the money path's failures AFTER a card was charged / a ticket was paid are logged here, never
   *  swallowed silently (afterPaid steps, an approved charge that could not be recorded). Tests pass their own. */
  private moneyLog: Pick<Logger, 'error'> = new Logger('CheckoutMoneyPath');
  useMoneyPathLog(log: Pick<Logger, 'error'>): this { this.moneyLog = log; return this; }
  private postPaymentFailed(step: string, ctx: CheckoutContext, ticketId: string, e: unknown): void {
    this.moneyLog.error(`post-payment step '${step}' failed for paid ticket ${ticketId} (tenant ${ctx.tenantId}) — the payment stands; ${step === 'deals' ? 'the deals lifecycle job reconciles it' : 'retry / reconcile it'}: ${(e as Error)?.message ?? String(e)}`);
  }
  constructor(private readonly repo: CheckoutRepositoryPort, private readonly sms?: SmsSender, private readonly email?: EmailSender, private readonly processor?: PaymentProcessor, private readonly gateway?: PaymentGatewayResolver, private readonly realtime?: RealtimeEmitter, private readonly compensation?: CompensationHook, private readonly membershipComp?: MembershipCompHook, private readonly locks?: CheckoutLockRead, private readonly reviewRequestHook?: ReviewRequestHook, private readonly lookupThrottle?: GiftCardLookupThrottle,
    /** Phase 2: the tenant messenger (NotificationsService) — receipts are the SALON's text: its number, opt-outs, ledger, events. */
    private readonly messenger?: TenantMessenger) {}

  /** Post-payment hooks (spec §13–§16). Best-effort and NON-THROWING: a hook failure can never void or roll back an
   *  already-captured payment. Runs AFTER the ticket is flipped to 'paid'. Every step is idempotent on its own (deals:
   *  only 'applied' rows, locked; reward code: LOYALTY_REDEMPTION applied → used; compensation: write-once snapshot and
   *  tip rows under unique keys; membership commission: lines already booked are skipped, under a per-ticket lock;
   *  review request: idempotency key; gift-card sale: pending_payment → active only; reload: 'reload:<hold>' key), so a
   *  retried run issues nothing twice. Phase 15 round 3: a failing step is LOGGED with the ticket (it used to be swallowed
   *  without a trace), and the customer display's terminal charge runs this same method (runPostPaymentWork). */
  private async afterPaid(ctx: CheckoutContext, ticketId: string): Promise<void> {
    // The paid ticket's final money on its own row: subtotal (after discounts), tax, the card surcharge actually charged
    // and the total collected. Owner finance / reports read these columns and nothing wrote them — revenue read $0.00
    // after a full day (wave 4 PILOT, Oct 13 2026). Recomputed from the same pricing the payment used; idempotent.
    if (this.repo.setFinalTotals) {
      try {
        const totals = await this.repo.totalsFor(ctx, ticketId, 'cash');
        const paid = this.repo.paidBreakdown ? await this.repo.paidBreakdown(ctx, ticketId) : { totalCents: await this.repo.paidTotalCents(ctx, ticketId), surchargeCents: 0 };
        if (totals) await this.repo.setFinalTotals(ctx, ticketId, { subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, surchargeCents: paid.surchargeCents, totalCents: paid.totalCents });
      } catch (e) { this.postPaymentFailed('final_totals', ctx, ticketId, e); }
    }
    // BUILD_PLAN Phase 5, bug 4: the deals and coupons on the ticket are REDEEMED now — not when they were put on it.
    // A failure here is caught up by the deals lifecycle job (it redeems applications on paid tickets within a minute).
    if (this.deals) { try { await this.deals.onPaid(ctx, ticketId); } catch (e) { this.postPaymentFailed('deals', ctx, ticketId, e); } }
    // Decision 15: a reward code on the ticket is now spent.
    if (this.repo.markRewardCodesUsed) { try { await this.repo.markRewardCodesUsed(ctx, ticketId); } catch (e) { this.postPaymentFailed('reward_code', ctx, ticketId, e); } }
    // Compensation snapshot (commission/tip reconciliation). It reports a failure in its result rather than throwing;
    // a ticket with no service lines (a gift-card-only sale) has nothing to snapshot and is not a failure.
    if (this.compensation) {
      try {
        const r: any = await this.compensation.snapshotPaidTicket({ tenantId: ctx.tenantId, branchId: (ctx as any).branchId ?? null }, ticketId);
        if (r && r.ok === false && r.error && r.error !== 'no lines/meta') this.postPaymentFailed('compensation_snapshot', ctx, ticketId, new Error(String(r.error)));
      } catch (e) { this.postPaymentFailed('compensation_snapshot', ctx, ticketId, e); }
    }
    // Membership-redemption commission: book the technician's frozen 60/40 share into the payroll ledger. Idempotent and
    // a no-op when the ticket carries no redemption; it reads a frozen split and only appends — never touches the payment.
    if (this.membershipComp) {
      try { await this.membershipComp.bookTicketMembershipComp(ctx, ticketId); }
      catch (e) { this.postPaymentFailed('membership_commission', ctx, ticketId, e); }
    }
    // Post-visit review request (best-effort). Fully isolated: a failure here can never affect the captured payment.
    if (this.reviewRequestHook) {
      try {
        const tk = await this.repo.ticket(ctx, ticketId);
        if (tk?.customerId) {
          const paid = await this.repo.paidTotalCents(ctx, ticketId).catch(() => 0);
          await this.reviewRequestHook.onVisitCompleted(ctx as any, { ticketId, customerId: tk.customerId, branchId: (ctx as any).branchId ?? null, visitValueCents: Number(paid) || 0, completedAt: new Date().toISOString() });
        }
      } catch (e) { this.postPaymentFailed('review_request', ctx, ticketId, e); }
    }
    // Activate any gift cards SOLD on this ticket now that it's paid. Isolated (a failure never affects the captured
    // payment) and idempotent (only pending_payment → active), so a retried afterPaid never issues stored value twice.
    try { await this.repo.activatePendingGiftCardSales(ctx, ticketId); }
    catch (e) { this.postPaymentFailed('gift_card_sale_activation', ctx, ticketId, e); }
    // Credit any gift cards RELOADED on this ticket now that it's paid. Same isolation + idempotency guarantees.
    try { await this.repo.activatePendingGiftCardReloads(ctx, ticketId); }
    catch (e) { this.postPaymentFailed('gift_card_reload_activation', ctx, ticketId, e); }

    // Nov 5 2026: the "Payment received" (owner/manager) and "Payment completed" (customer) pushes are sent ONCE, by the
    // outbox consumer (apps/api/src/events/consumers/push-notification.consumer.ts, on checkout.completed — written in
    // the same transaction as the paid status by every path that pays a ticket). A copy here sent each of them twice.
  }

  /**
   * Phase 15 round 3 — the post-payment work for a ticket paid OUTSIDE this service: the customer display's own terminal
   * charge (TerminalCaptureService.recordApproval records the payment and the paid ticket in one transaction, then calls
   * this after it commits — exactly where the POS calls afterPaid). It IS afterPaid, not a copy: deals / coupons
   * redeemed, reward code spent, compensation snapshot, membership commission, review request, gift-card sale and reload
   * activation. Only a ticket the store says is PAID gets it (a gift card is never activated on an unpaid ticket); the
   * steps' own guards make a second call a no-op. The display is not a staff user: no actor id is written.
   */
  async runPostPaymentWork(scope: { tenantId: string; branchId: string }, ticketId: string): Promise<{ ran: boolean }> {
    const ctx = { tenantId: scope.tenantId, branchId: scope.branchId, userId: undefined, role: 'CUSTOMER_DISPLAY', permissions: [] } as unknown as CheckoutContext;
    let paid: boolean;
    try { paid = this.repo.isPaid ? await this.repo.isPaid(ctx, ticketId) : (await this.repo.ticket(ctx, ticketId))?.status === 'paid'; }
    catch (e) { this.postPaymentFailed('paid_check', ctx, ticketId, e); return { ran: false }; }
    if (!paid) return { ran: false };
    await this.afterPaid(ctx, ticketId);
    return { ran: true };
  }

  // Resolve BOTH the live processor and the EFFECTIVE payment status for THIS tenant. When a per-tenant gateway resolver
  // is wired (production), the tenant's OWN configured gateway is the single source of truth — never platform env: an
  // active tenant gateway yields a real processor, so the status is 'connected' (real authorize/capture); if the tenant
  // has no usable gateway, card processing is OFF ('not_configured'), unless an explicit platform sandbox
  // (PAYMENTS_SANDBOX=1) is enabled for local demos. Without a resolver (in-memory/dev/tests), keep the injected
  // processor and the env-derived settings.fiservStatus so existing behavior and tests are unchanged.
  //
  // Previously the charge gate keyed off settings.fiservStatus (platform-env only via cardPointeConfigured()), so a salon
  // with a fully configured, ACTIVE gateway in tenant_payment_config was told "not configured" — and PAYMENTS_SANDBOX=1
  // simulated every tenant's cards regardless of their real gateway. This helper re-grounds the decision on the resolved
  // tenant gateway (the resolver only returns a processor when the gateway is active + credentials decrypt), so g.processor
  // is a safe "this tenant can take real cards" invariant.
  private async payProc(ctx: CheckoutContext, settings: { fiservStatus: FiservStatus }): Promise<{ processor: PaymentProcessor | undefined; status: FiservStatus }> {
    if (this.gateway) {
      // Payments mandate §7 / §13 (wave 3): tenant + BRANCH → merchant account → adapter. Both ids come from the trusted
      // session (ctx), never from the request body; a branch with its own merchant account charges through it.
      const g = await this.gateway.resolve(ctx.tenantId, ctx.branchId ?? null);
      if (g.processor) return { processor: g.processor, status: 'connected' };
      return { processor: undefined, status: process.env.PAYMENTS_SANDBOX === '1' ? 'sandbox' : 'not_configured' };
    }
    return { processor: this.processor, status: settings.fiservStatus };
  }

  private assertUser(ctx: CheckoutContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Checkout is not available for this role');
  }
  private need(ctx: CheckoutContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: CheckoutContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    const entry = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() };
    this.audit.push(entry);
    if (this.audit.length > 1000) this.audit.splice(0, this.audit.length - 1000);   // the in-process copy is a short window, not the record
    // BUILD_PLAN Phase 5, bug 13: the checkout audit lived ONLY in this array — lost on every restart, invisible to the
    // tenant Audit Log. It is persisted now (audit_logs, append-only). Views are not audited (they were noise).
    // A gift card number is a bearer secret: the persisted row carries only its last four.
    if (this.repo.persistAudit && !/_viewed$/.test(actionType)) void this.repo.persistAudit(entityType === 'pos_gift_card' && entityId ? { ...entry, entityId: 'GC-****-' + String(entityId).slice(-4) } : entry).catch(() => undefined);
  }
  auditLog(): POSCheckoutAuditLog[] { return this.audit.slice(); }
  private async ticketOr404(ctx: CheckoutContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw new ValidationError('Ticket not found'); return t; }
  // POS↔mobile mutual exclusion: refuse to charge a ticket the Owner & Manager Payment App currently has open.
  // No-op when the lock read isn't wired (unit tests) or no active mobile lock exists.
  private async assertNotMobileLocked(ctx: CheckoutContext, id: string) {
    if (!this.locks) return;
    const s = await this.locks.getStatus(ctx.tenantId, id);
    if (s.locked && s.heldBy?.source === 'mobile') throw new ValidationError('This ticket is being checked out on a mobile device. Finish or cancel there before charging on the POS.');
  }
  /**
   * ONE payment at a time per ticket (Oct 6 2026). A POS payment holds the ticket's checkout lock while it is worked out
   * and recorded; the customer display's own card charge on the terminal holds the same lock for as long as the terminal
   * takes (terminal-capture.service.ts). Before this, a cash payment taken at the front desk while the customer was
   * tapping their card on the terminal could both be recorded — the guest paid twice. A ticket being checked out on the
   * manager's phone is refused as before. Released whatever happens; a lock left by a crash expires (90 s).
   */
  private async paying<T>(ctx: CheckoutContext, id: string, pay: () => Promise<T>): Promise<T> {
    this.need(ctx, 'pos.checkout.take_payment');
    if (!this.locks?.acquire || !this.locks.release) return pay();
    const sessionId = 'pos-pay:' + randomUUID();
    const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ctx.userId)) ? String(ctx.userId) : '00000000-0000-0000-0000-000000000000';
    try {
      await this.locks.acquire({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, ticketId: id, userId, sessionId, source: 'pos' });
    } catch (e) {
      if (e instanceof LockHeldElsewhereError) {
        if (e.heldBy.source === 'mobile') throw new ValidationError('This ticket is being checked out on a mobile device. Finish or cancel there before charging on the POS.');
        throw new PaymentInProgressError(e.message);
      }
      throw e;
    }
    try { return await pay(); }
    finally { await this.locks.release(ctx.tenantId, id, sessionId, 'payment_done')?.catch?.(() => undefined); }
  }
  // Guard for a tip supplied directly on a pay request (payCash/payCard/paySplit/payGiftCard). The dedicated
  // applyTip path runs the full validateCustomTip (incl. the max-% manager-approval gate); the pay paths only need
  // the money-safety floor: a negative tip would under-charge the total and a fractional tip drifts cents.
  private validTip(tipCents: Money): Money { if (!Number.isInteger(tipCents) || tipCents < 0) throw new ValidationError('Tip must be a non-negative whole number of cents'); return tipCents; }
  private pid() { return 'pay_' + (++this.seq); }

  // After a reversal, if the ticket is still marked 'paid' but its captured funds no longer cover the total due, return it
  // to a payable state so it reappears in the checkout queue (a 'paid' ticket is filtered out of the active list, which
  // would otherwise leave a voided sale both hidden AND un-payable). No-op when the ticket isn't loaded or is still covered.
  private async reopenIfNoLongerPaid(ctx: CheckoutContext, ticketId: string, method: PaymentMethod) {
    const tk = await this.repo.ticket(ctx, ticketId);
    if (!tk || tk.status !== 'paid') return;
    const tot = await this.repo.totalsFor(ctx, ticketId, method);
    if (tot && (await this.repo.paidTotalCents(ctx, ticketId)) < tot.totalDueCents) await this.repo.setStatus(ctx, ticketId, 'ready_for_payment');
  }

  // ---- read ----
  async getState(ctx: CheckoutContext, f: CheckoutFilters = {}): Promise<POSCheckoutFullState> { this.need(ctx, 'pos.checkout.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_checkout_viewed', 'pos_checkout', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: CheckoutContext) { return (await this.getState(ctx)).kpisFull; }
  /** What the canonical payments already cover on a ticket (approved + partial, every surface) — the mobile checkout's Paid / Balance Due (mandate §48/§85). */
  async paidCentsFor(ctx: CheckoutContext, id: string): Promise<number> { this.need(ctx, 'pos.checkout.view'); return this.repo.paidTotalCents(ctx, id); }
  async getSettings(ctx: CheckoutContext) { this.need(ctx, 'pos.checkout.view'); return this.repo.settings(ctx); }
  async tickets(ctx: CheckoutContext, f: CheckoutFilters = {}): Promise<{ items: POSCheckoutTicketRow[]; pagination: any }> { this.need(ctx, 'pos.checkout.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: CheckoutContext, id: string): Promise<CheckoutTicketDetail> { this.need(ctx, 'pos.checkout.view'); await this.syncMembershipDiscounts(ctx, id).catch(() => undefined); await this.syncLoyaltyReward(ctx, id).catch(() => undefined); const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Ticket not found'); this.log(ctx, 'pos_checkout_ticket_viewed', 'pos_checkout_ticket', id); return this.withAuthorityCommission(ctx, d); }

  /** Oct 13 2026 (FLOW duplicate D6 merged): the detail's commission block is the compensation AUTHORITY's answer — the
   *  immutable snapshot for a paid ticket, the engine's live computation otherwise. The repository no longer resolves a
   *  rate of its own (it used to: rules > stamp > current tech rate > service rate > a 50 % guess, on the undiscounted
   *  price — a second commission formula beside payroll). No authority wired ⇒ null (honest), never a guessed rate. */
  private async withAuthorityCommission(ctx: CheckoutContext, d: CheckoutTicketDetail): Promise<CheckoutTicketDetail> {
    if (!this.compensation?.previewForTicket) return { ...d, commission: null };
    const p = await this.compensation.previewForTicket({ tenantId: ctx.tenantId, branchId: (ctx as any).branchId ?? null }, d.ticketId).catch(() => null);
    if (!p || !p.byTechnician.length) return { ...d, commission: null };
    const nameOf = (tid: string | null) => (tid ? d.completedServices.find((l) => l.technicianId === tid)?.technicianName ?? (d.technicians?.primary?.technicianId === tid ? d.technicians.primary.name : undefined) ?? d.technicians?.helpers?.find((h) => h.technicianId === tid)?.name : undefined) ?? (tid ? 'Technician' : 'Unassigned');
    const primary = d.technicians?.primary?.name;
    const total = p.byTechnician.reduce((a, x) => a + x.cents, 0);
    const rows = p.byTechnician.map((x) => { const name = nameOf(x.technicianId); return { name, role: name === primary ? 'Primary Tech' : 'Assist Tech', percent: total > 0 ? Math.round((x.cents / total) * 100) : 0 }; });
    return { ...d, commission: { rows, estimatedPayoutCents: total, source: p.source } };
  }
  // The cardholder signature captured on the customer-display for this ticket's card payment (PNG data URL, or null).
  /** The card payment's signature and where it was taken ('terminal' — the Clover, since Oct 6 2026 — or 'customer_display' for older payments). */
  async getPaymentSignature(ctx: CheckoutContext, id: string): Promise<{ signaturePng: string | null; capturedOn: string | null }> { this.need(ctx, 'pos.checkout.view'); const s = await this.repo.paymentSignatureForTicket(ctx, id); return { signaturePng: s?.signaturePng ?? null, capturedOn: s?.capturedOn ?? null }; }

  /**
   * Technician-split PREVIEW for the checkout Review screen (spec §13). Read-only: runs the canonical compensation
   * engine for the ticket and returns the per-technician service earnings + tip allocation, plus how many technicians
   * performed services. The POS shows the review when participantCount > 2. Never mutates; safe before payment.
   */
  async technicianSplit(ctx: CheckoutContext, id: string): Promise<{ participantCount: number; technicians: { technicianId: string; displayName?: string; serviceEarningsCents: number; cardTipCents: number; cashTipCents: number }[] }> {
    this.need(ctx, 'pos.checkout.view');
    await this.ticketOr404(ctx, id);
    if (!this.compensation) return { participantCount: 0, technicians: [] };
    const result = await this.compensation.computeForTicket({ tenantId: ctx.tenantId, branchId: (ctx as any).branchId ?? null }, id).catch(() => null);
    if (!result) return { participantCount: 0, technicians: [] };
    // Names come from the ticket detail's lines (technicianId → technicianName) — reused, no extra query path.
    const detail: any = await this.repo.detail(ctx, id).catch(() => null);
    const nameById: Record<string, string> = {};
    for (const l of (detail?.lines || [])) if (l?.technicianId && l?.technicianName) nameById[l.technicianId] = l.technicianName;
    const technicians = result.perTechnician
      .map((t) => ({ technicianId: t.technicianId, displayName: nameById[t.technicianId], serviceEarningsCents: t.serviceEarningsCents, cardTipCents: t.cardTipCents, cashTipCents: t.cashTipCents }))
      .filter((t) => t.serviceEarningsCents > 0 || t.cardTipCents > 0 || t.cashTipCents > 0);
    return { participantCount: technicians.filter((t) => t.serviceEarningsCents > 0).length, technicians };
  }
  async review(ctx: CheckoutContext, id: string): Promise<CheckoutTicketDetail> { this.need(ctx, 'pos.checkout.view'); await this.ticketOr404(ctx, id); this.log(ctx, 'pos_checkout_ticket_reviewed', 'pos_checkout_ticket', id); return (await this.repo.detail(ctx, id))!; }
  async recordSatisfaction(ctx: CheckoutContext, id: string, rating: number): Promise<{ ok: true; rating: number }> { this.need(ctx, 'pos.checkout.view'); if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw new ValidationError('Rating must be between 1 and 5.'); await this.ticketOr404(ctx, id); const r = Math.round(rating); const ok = await this.repo.recordSatisfaction(ctx, id, r); if (!ok) throw new ValidationError('Could not record the rating.'); this.log(ctx, 'pos_checkout_satisfaction_recorded', 'pos_checkout_ticket', id, undefined, undefined, { rating: r }); return { ok: true, rating: r }; }

  // ---- tip / discount / recalc ----
  async applyTip(ctx: CheckoutContext, id: string, body: SetTipRequest) {
    this.need(ctx, 'pos.checkout.add_tip'); const t = await this.ticketOr404(ctx, id); const s = DEFAULT_CHECKOUT_SETTINGS;
    // Tips are editable only BEFORE money moves. Once the ticket is paid — or any payment has been captured on it
    // (a partially-paid split) — a tip change would silently alter a settled/committed amount and desync the
    // technician tip allocations computed at payment time. Settled tips follow the refund/adjustment flow.
    if (t.status === 'paid' || (await this.repo.paidTotalCents(ctx, id)) > 0) {
      throw new ValidationError('Payments have already been captured on this ticket — tip changes now go through the refund/adjustment flow.');
    }
    const subtotal = Math.max(0, t.lines.reduce((a, l) => a + l.priceCents, 0) - t.discountCents);
    let tip = 0;
    if (body.tipType === 'percent') { const pct = body.tipPercent || 0; if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ValidationError('Tip rejected: TIP_PERCENT_INVALID'); tip = tipForPercent(subtotal, pct); }
    else if (body.tipType === 'custom') { tip = body.tipAmountCents || 0; const v = validateCustomTip(tip, subtotal, s.maxTipPercent); if (!v.ok) throw new ValidationError('Tip rejected: ' + v.reason); }
    const meta = { tipType: body.tipType, tipPercent: body.tipType === 'percent' ? Math.round(body.tipPercent || 0) : null } as const;
    await this.repo.setTip(ctx, id, tip, meta); this.log(ctx, 'pos_checkout_tip_applied', 'pos_tip', id, undefined, undefined, { tipCents: tip, tipType: meta.tipType, tipPercent: meta.tipPercent, source: body.source });
    this.totalsChanged(ctx, id);
    return this.repo.totalsFor(ctx, id);
  }
  /**
   * THE ONE place a ticket's discounts are priced (BUILD_PLAN Phase 5): every discount on the ticket — bundle, membership,
   * deals and coupons (from the deals ledger, with their LOCKED terms), manual, loyalty — through the one engine, under the
   * salon's stacking policy, per line. The result does not depend on the order things were applied (bug 3). The deals
   * ledger is told what each deal/coupon actually takes off (per line) so a refund can give back exactly that.
   */
  private async _updateDiscounts(ctx: CheckoutContext, id: string, t: any, reqs: DiscountRequest[]) {
    const lines = (t.lines || []).map((l: any) => ({ lineId: String(l.serviceLineId), priceCents: Number(l.priceCents) || 0 }));
    const offers: OfferRequest[] = reqs.filter((r: any) => !(this.deals && PROMO_CATEGORIES.has(r.category))).map(toOffer);
    let policy = LEGACY_POLICY;
    if (this.deals) { offers.push(...await this.deals.offersForPricing(ctx, id)); policy = await this.deals.policy(ctx); }
    const result = priceTicket(lines, offers, policy);
    await this.repo.setDiscount(ctx, id, result.totalDiscountCents, result.snapshot);
    if (this.deals) await this.deals.syncAmounts(ctx, result.applied.filter((a) => a.redemptionId), result.rejected.map((r) => r.redemptionId).filter((x): x is string => !!x)).catch(() => undefined);
    return { totalDiscountCents: result.totalDiscountCents, snapshot: result.snapshot, appliedDiscounts: result.applied, rejected: result.rejected };
  }
  /** The non-deal discounts already on the ticket (membership / loyalty / manual / bundle), as requests. */
  private othersOnTicket(t: any, drop: string[] = []): DiscountRequest[] {
    return ((t.discountSnapshot?.applied || []) as any[]).filter((a) => !PROMO_CATEGORIES.has(a.category) && !drop.includes(a.category))
      .map((a) => ({ ...a, stackable: true, amountCents: a.appliedCents }));
  }
  /** Re-price from what is on the ticket now (after a deal was applied or removed). */
  async repriceTicket(ctx: CheckoutContext, id: string): Promise<void> {
    const t: any = await this.repo.ticket(ctx, id); if (!t || t.status === 'paid') return;
    const before = t.discountCents;
    const r = await this._updateDiscounts(ctx, id, t, this.othersOnTicket(t));
    if (r.totalDiscountCents !== before) this.totalsChanged(ctx, id);
  }

  /**
   * Functional Decision 15 — membership benefits redeemed against this ticket become 'membership' discounts through the
   * ONE stacking engine (sequence: bundle → MEMBERSHIP → deal → coupon → manual → loyalty), recorded in the ticket's
   * discount snapshot. Until Oct 1 2026 a redeemed included-service credit was recorded in the membership ledger but
   * NEVER reduced the bill — the member was charged full price unless staff discounted it by hand.
   * Covered amount per redemption = that line's price minus any upgrade the customer pays (never below 0, never more
   * than the line). Idempotent: recomputed only when the set of membership discounts would change.
   */
  // ── Decision 15, loyalty step: a customer's reward code (issued when they spent points) ──
  // Whoever takes payment may apply it (pos.checkout.redeem_reward → checkout.process_payment). The code must be this
  // ticket's customer's, unused, unexpired and worth something; it is reserved to the ticket atomically, taken off as a
  // 'loyalty' discount (the LAST step, on what the earlier steps left), marked used only when the ticket is paid, and
  // released if removed. One reward per ticket. The code text is a bearer secret — never written to the audit log.
  async applyRewardCode(ctx: CheckoutContext, id: string, rawCode: unknown): Promise<CheckoutTicketDetail> {
    this.need(ctx, 'pos.checkout.redeem_reward');
    if (!this.repo.findRewardCode || !this.repo.reserveRewardCode || !this.repo.rewardCodeForTicket) throw new ValidationError('Reward codes are not available here.');
    const t: any = await this.ticketOr404(ctx, id);
    if (t.status === 'paid') throw new ValidationError('This ticket is already paid.');
    const code = normalizeRewardCode(rawCode);
    if (!code) throw new ValidationError('Enter a reward code.');
    const current = await this.repo.rewardCodeForTicket(ctx, id);
    if (current && current.code !== code) throw new ValidationError(`This ticket already has a reward (${current.rewardTitle}). Remove it first.`);
    const row = await this.repo.findRewardCode(ctx, code);
    const problem = rewardCodeProblem(row, { ticketId: id, customerId: t.customerId || null }, Date.now());
    if (problem) { this.log(ctx, 'pos_checkout_reward_code_refused', 'pos_ticket', id, undefined, undefined, { reason: problem }); throw new ValidationError(problem); }
    if (!(await this.repo.reserveRewardCode(ctx, row!.redemptionId, id))) throw new ValidationError('That reward code was just used on another ticket.');
    await this.syncLoyaltyReward(ctx, id);
    this.log(ctx, 'pos_checkout_reward_code_applied', 'pos_ticket', id, undefined, undefined, { redemptionId: row!.redemptionId });
    this.totalsChanged(ctx, id);
    return (await this.repo.detail(ctx, id))!;
  }
  async removeRewardCode(ctx: CheckoutContext, id: string): Promise<CheckoutTicketDetail> {
    this.need(ctx, 'pos.checkout.redeem_reward');
    const t: any = await this.ticketOr404(ctx, id);
    if (t.status === 'paid') throw new ValidationError('This ticket is already paid.');
    await this.repo.releaseRewardCodes?.(ctx, id);
    await this.syncLoyaltyReward(ctx, id);
    this.log(ctx, 'pos_checkout_reward_code_removed', 'pos_ticket', id);
    this.totalsChanged(ctx, id);
    return (await this.repo.detail(ctx, id))!;
  }
  /** Keeps the loyalty discount equal to the applied code's value on what the earlier steps leave (lines can change). */
  async syncLoyaltyReward(ctx: CheckoutContext, id: string): Promise<void> {
    if (!this.repo.rewardCodeForTicket) return;
    const t: any = await this.repo.ticket(ctx, id); if (!t || t.status === 'paid') return;
    const code = await this.repo.rewardCodeForTicket(ctx, id);
    const applied: any[] = t.discountSnapshot?.applied || [];
    const others = applied.filter((a) => a.category !== 'loyalty');
    const subtotal = t.lines.reduce((n: number, l: any) => n + l.priceCents, 0);
    const before = others.reduce((n: number, a: any) => n + (a.appliedCents || 0), 0);
    const wanted: DiscountRequest[] = code ? [{ id: 'loyalty-' + code.redemptionId, category: 'loyalty' as const, amountCents: rewardCodeDiscountCents(code, subtotal - before), stackable: true, priority: 6, description: 'Reward: ' + code.rewardTitle }].filter((d) => d.amountCents > 0) : [];
    const have = applied.filter((a) => a.category === 'loyalty').map((a) => a.id + ':' + a.appliedCents).sort().join('|');
    const want = wanted.map((d) => d.id + ':' + d.amountCents).sort().join('|');
    if (have === want) return;
    await this._updateDiscounts(ctx, id, t, [...others.map((a) => ({ ...a, stackable: a.category !== 'deal', amountCents: a.appliedCents })), ...wanted]);
    this.totalsChanged(ctx, id);   // the bill changed — the POS on the same ticket and the customer display refetch
  }

  async syncMembershipDiscounts(ctx: CheckoutContext, id: string): Promise<void> {
    if (!this.repo.membershipRedemptionsForTicket) return;
    const t = await this.repo.ticket(ctx, id); if (!t || t.status === 'paid') return;
    // Decision 15 membership step: redemptions (dollar credits at what the balance paid) + the best live percent/fixed
    // member discount on lines no redemption covers — one rule, membership-benefits.ts.
    const reds = await this.repo.membershipRedemptionsForTicket(ctx, id).catch(() => []);
    const inputs = this.repo.memberDiscountInputs ? await this.repo.memberDiscountInputs(ctx, id).catch(() => ({ lines: [], benefits: [] })) : { lines: [], benefits: [] };
    const lines: MemberLine[] = inputs.lines.length ? inputs.lines : t.lines.map((l: any) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, serviceId: null, categoryName: null, isRetail: false, priceCents: l.priceCents }));
    const wanted: DiscountRequest[] = membershipDiscountRequests(lines, reds, inputs.benefits);
    const applied: any[] = t.discountSnapshot?.applied || [];
    const have = applied.filter((a) => a.category === 'membership').map((a) => a.id + ':' + a.appliedCents).sort().join('|');
    const want = wanted.map((d) => d.id + ':' + d.amountCents).sort().join('|');
    if (have === want) return;
    // keep each existing discount's stacking as checkout applies it: deals are exclusive (stackable:false), the rest stack
    const others = applied.filter((a) => a.category !== 'membership').map((a) => ({ ...a, stackable: a.category !== 'deal', amountCents: a.appliedCents }));
    await this._updateDiscounts(ctx, id, t, [...others, ...wanted]);
    this.log(ctx, 'pos_checkout_membership_discounts_synced', 'pos_ticket', id, undefined, undefined, { membership: wanted.map((d) => ({ id: d.id, cents: d.amountCents })) });
    this.totalsChanged(ctx, id);   // a membership benefit came on (or off) the bill — even from a read — so every screen showing it refetches
  }

  async applyDiscount(ctx: CheckoutContext, id: string, body: ApplyDiscountRequest) {
    this.need(ctx, 'pos.checkout.apply_discount'); const t = await this.ticketOr404(ctx, id);
    if (!Number.isInteger(body.discountCents) || body.discountCents < 0) throw new ValidationError('Discount must be a non-negative whole number of cents');
    const subtotal = t.lines.reduce((a, l) => a + l.priceCents, 0);
    if (body.discountCents > Math.round(subtotal * 0.5) && !hasPermission(ctx as any, 'pos.checkout.override_total')) throw new ForbiddenError('A discount over 50% requires override permission');
    
    // Add manual discount to existing snapshot
    const existingReqs = (t.discountSnapshot?.applied || []).map((a: any) => ({ ...a, stackable: a.category !== 'manual', amountCents: a.appliedCents }));
    const filteredReqs = existingReqs.filter((r: any) => r.category !== 'manual'); // replace existing manual
    if (body.discountCents > 0) {
      filteredReqs.push({ id: 'manual-' + Date.now(), category: 'manual', amountCents: body.discountCents, stackable: true, priority: 5, description: 'Manual Discount' });
    }
    const result = await this._updateDiscounts(ctx, id, t, filteredReqs);
    this.log(ctx, 'pos_checkout_discount_applied', 'pos_discount', id, undefined, undefined, { discountCents: result.totalDiscountCents });
    this.totalsChanged(ctx, id);
    return this.repo.totalsFor(ctx, id);
  }
  // ── BUILD_PLAN Phase 5: deals and coupons on a ticket ─────────────────────────────────────────────────────────
  // Whoever runs checkout may put a deal or a coupon on a ticket (pos.deals.apply → deals.apply, which the front desk
  // holds — bug 2: it rode pos.checkout.apply_discount, a manager key, and receptionists got a silent 403). A MANUAL
  // discount is still a manager decision (applyDiscount above).
  private requireDeals(): CheckoutDealsPort {
    if (!this.deals) throw new ValidationError('Deals and coupons are not available here.');
    return this.deals;
  }

  /**
   * Put a deal or a coupon on the ticket: by deal id, by coupon code (hashed lookup, rate-limited), by wallet coupon,
   * or the deal the customer booked. It is judged (every reason), priced through the engine with everything else on the
   * ticket under the salon's policy — if the policy would not apply it, it is refused with that reason; if it beats an
   * offer already on the ticket, that one comes off — and only then does it take its place (atomically: cap, per
   * customer, budget, the code's use). Nothing is redeemed until the ticket is paid.
   */
  async applyOffer(ctx: CheckoutContext, id: string, req: TicketOfferRequest & { source?: string | null }) {
    this.need(ctx, 'pos.deals.apply');
    const deals = this.requireDeals();
    const t: any = await this.ticketOr404(ctx, id);
    if (t.status === 'paid') throw new ValidationError('This ticket is already paid.');
    const cand = await deals.candidate(ctx, id, req);
    const current = await deals.offersForPricing(ctx, id);
    const mineNow = current.find((o) => o.dealId === cand.deal.id);
    if (mineNow) {   // idempotent: the same deal twice is one application
      return { applied: true, alreadyApplied: true, redemptionId: mineNow.redemptionId, dealId: cand.deal.id, title: cand.deal.title, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
    }
    const policy = await deals.policy(ctx);
    const lines = (t.lines || []).map((l: any) => ({ lineId: String(l.serviceLineId), priceCents: Number(l.priceCents) || 0 }));
    const others = this.othersOnTicket(t).map(toOffer);
    const trial = priceTicket(lines, [...others, ...current, cand.offer], policy);
    const mine = trial.applied.find((a) => a.id === cand.offer.id);
    if (!mine) {
      const rej = trial.rejected.find((r) => r.id === cand.offer.id);
      this.log(ctx, 'pos_checkout_offer_refused', 'pos_discount', id, undefined, undefined, { dealId: cand.deal.id, reason: rej?.reason ?? 'not_best' });
      throw new DealRefusedError(rej?.message ?? 'A better offer is already on this ticket.', 409, [{ code: rej?.reason ?? 'not_best', message: rej?.message ?? '' }]);
    }
    const app = await deals.reserve(ctx, id, cand, mine);
    const displaced = current.filter((o) => !trial.applied.some((a) => a.id === o.id)).map((o) => o.redemptionId).filter((x): x is string => !!x);
    if (displaced.length) await deals.release(ctx, displaced, 'replaced_by_better_offer');
    await this.repriceTicket(ctx, id);
    this.log(ctx, 'pos_checkout_offer_applied', 'pos_discount', id, undefined, undefined, { dealId: cand.deal.id, redemptionId: app.redemptionId, discountCents: mine.appliedCents, replaced: displaced, source: req.source ?? (req.code ? 'code' : req.couponId ? 'wallet' : req.fromAppointment ? 'booking' : 'pos') });
    this.totalsChanged(ctx, id);
    return { applied: true, redemptionId: app.redemptionId, dealId: cand.deal.id, title: cand.deal.title, discountCents: mine.appliedCents, replaced: displaced.length, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
  }

  /** Take a deal / coupon off an unpaid ticket: its place, budget and code use come back. */
  async removeOffer(ctx: CheckoutContext, id: string, redemptionId: string) {
    this.need(ctx, 'pos.deals.apply');
    const deals = this.requireDeals();
    const t: any = await this.ticketOr404(ctx, id);
    if (t.status === 'paid') throw new ValidationError('This ticket is already paid — use a refund.');
    const mine = (await deals.applications(ctx, id)).find((a: any) => a.redemptionId === redemptionId && a.status === 'applied');
    if (!mine) throw new ValidationError('That offer is not on this ticket.');
    await deals.release(ctx, [redemptionId], 'removed_at_checkout');
    await this.repriceTicket(ctx, id);
    this.log(ctx, 'pos_checkout_offer_removed', 'pos_discount', id, undefined, undefined, { redemptionId, dealId: mine.dealId });
    this.totalsChanged(ctx, id);
    return { removed: true, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
  }

  /** The checkout deals panel: applied, eligible (with value), not eligible (with WHY), and the best combination. */
  async ticketOffers(ctx: CheckoutContext, id: string) {
    this.need(ctx, 'pos.checkout.view');
    if (!this.deals) return { available: false, applied: [], eligible: [], notEligible: [], best: null };
    const t: any = await this.ticketOr404(ctx, id);
    return { available: true, ...(await this.deals.panel(ctx, id, this.othersOnTicket(t).map(toOffer))) };
  }

  /** "Best deal": apply the combination the engine says saves the customer the most under the salon's policy. */
  async applyBestOffers(ctx: CheckoutContext, id: string) {
    this.need(ctx, 'pos.deals.apply');
    const panel: any = await this.ticketOffers(ctx, id);
    if (!panel.available || !panel.best?.better) return { applied: [], unchanged: true, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
    const applied: string[] = []; const refused: { dealId: string; reason: string }[] = [];
    for (const a of panel.best.add as { dealId: string; couponId: string | null }[]) {
      try { await this.applyOffer(ctx, id, a.couponId ? { couponId: a.couponId, source: 'best_deal' } : { dealId: a.dealId, source: 'best_deal' }); applied.push(a.dealId); }
      catch (e: any) { refused.push({ dealId: a.dealId, reason: String(e?.message ?? e) }); }
    }
    return { applied, refused, unchanged: false, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
  }

  /** Compatibility: the coupon field ("apply-promotion") — a code through the deals engine. */
  async applyPromotion(ctx: CheckoutContext, id: string, code: string) {
    const trimmed = (code || '').trim();
    if (!trimmed) throw new ValidationError('A promotion code is required');
    const r: any = await this.applyOffer(ctx, id, { code: trimmed, source: 'code' });
    return { ...r, promotion: { code: '••••' + trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-4), amountCents: r.discountCents ?? 0 } };
  }

  /**
   * Compatibility: "apply-deal" — the deal this ticket's customer BOOKED. Non-fatal like before (applied:false with the
   * reason when there is none or it can't apply), so opening a ticket can try it without blocking checkout.
   */
  async applyDeal(ctx: CheckoutContext, id: string) {
    this.need(ctx, 'pos.deals.apply');
    if (!this.deals) return { applied: false, reason: 'Deals are not available here.', ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
    try { return await this.applyOffer(ctx, id, { fromAppointment: true, source: 'booking' }); }
    catch (e: any) {
      if (e instanceof DealRefusedError || e instanceof ValidationError) return { applied: false, reason: e.message, ...((await this.repo.totalsFor(ctx, id)) ?? {}) };
      throw e;
    }
  }
  /** The tip, a discount, a promotion, a deal or a reward code changed this ticket's total. The POS screens on the same
   *  ticket and the customer display showing it (through the ticket-room mirror, 23-inch spec §36) refetch. These writes
   *  emitted nothing before — found by the live display proof: a POS tip never reached the display or a second POS. */
  private totalsChanged(ctx: CheckoutContext, id: string): void {
    // §343 exempt: a momentary screen signal (the total changed; refetch) — the tip/discount write itself is the fact
    this.realtime?.toTenant(ctx, EVENTS.checkoutTotalRecalculated, { ticketId: id });
  }
  async recalculate(ctx: CheckoutContext, id: string, method?: PaymentMethod) {
    this.need(ctx, 'pos.checkout.view'); await this.ticketOr404(ctx, id); if (method) await this.repo.setMethod(ctx, id, method);
    const totals = (await this.repo.totalsFor(ctx, id, method))!; this.log(ctx, 'pos_checkout_recalculated', 'pos_checkout_ticket', id, undefined, undefined, { method });
    // Constitution 9 §246: the registry declared checkout_total_recalculated and routed it to the checkout screen,
    // but nothing emitted it — a second POS on the same ticket never saw a tip or discount change until it refetched.
    // §343 exempt: a momentary screen signal (the total changed; refetch) — the tip/discount write itself is the fact
    this.realtime?.toTenant(ctx, EVENTS.checkoutTotalRecalculated, { ticketId: id });
    return totals;
  }

  // ---- Hold Ticket / Move to Front Desk (Oct 6 2026 — both buttons used to show a message and do nothing) ----
  /** Set the ticket aside: it leaves the ready-for-payment queue with its items, tip and discounts untouched, until it is
   *  resumed (or paid — paying clears the hold). */
  async holdTicket(ctx: CheckoutContext, id: string, held: boolean): Promise<{ ticketId: string; status: string }> {
    this.need(ctx, 'pos.checkout.take_payment'); await this.ticketOr404(ctx, id);
    if (!this.repo.setHold || !(await this.repo.setHold(ctx, id, held))) throw new ValidationError(held ? 'A paid ticket cannot be held.' : 'This ticket cannot be resumed.');
    this.log(ctx, held ? 'pos_checkout_ticket_held' : 'pos_checkout_ticket_resumed', 'pos_checkout_ticket', id);
    // §343 exempt: a momentary screen signal (the checkout queue changed; refetch, ids only) — the audited hold is the fact
    this.realtime?.toTenant(ctx, EVENTS.ticketReadyCheckout, { ticketId: id, held });
    return { ticketId: id, status: held ? 'on_hold' : 'ready_for_payment' };
  }
  /** Move the ticket to a register (one of this branch's): it is to be paid there, and shows that register's name. */
  async moveToRegister(ctx: CheckoutContext, id: string, registerId: unknown): Promise<{ ticketId: string; registerId: string; station: string }> {
    this.need(ctx, 'pos.checkout.take_payment'); await this.ticketOr404(ctx, id);
    if (typeof registerId !== 'string' || !registerId) throw new ValidationError('Choose a register.');
    const moved = this.repo.moveToRegister ? await this.repo.moveToRegister(ctx, id, registerId) : null;
    if (!moved) throw new ValidationError('That register is not one of this location\'s, or the ticket is already paid.');
    this.log(ctx, 'pos_checkout_ticket_moved', 'pos_checkout_ticket', id, undefined, undefined, { registerId: moved.registerId, register: moved.name });
    // §343 exempt: a momentary screen signal (the checkout queue changed; refetch, ids only) — the audited move is the fact
    this.realtime?.toTenant(ctx, EVENTS.ticketReadyCheckout, { ticketId: id, registerId: moved.registerId });
    return { ticketId: id, registerId: moved.registerId, station: moved.name };
  }

  // ---- payments ----
  async payCash(ctx: CheckoutContext, id: string, body: CashPaymentRequest): Promise<{ payment: PaymentRecord; changeDueCents: Money }> {
    return this.paying(ctx, id, () => this.payCashNow(ctx, id, body));
  }
  private async payCashNow(ctx: CheckoutContext, id: string, body: CashPaymentRequest): Promise<{ payment: PaymentRecord; changeDueCents: Money }> {
    await this.syncMembershipDiscounts(ctx, id).catch(() => undefined);   // Decision 15: membership benefits are on the bill before money moves
    await this.syncLoyaltyReward(ctx, id).catch(() => undefined);         // … and the reward code, last in the sequence
    this.need(ctx, 'pos.checkout.take_payment'); this.need(ctx, 'pos.checkout.cash_payment'); await this.ticketOr404(ctx, id); await this.assertNotMobileLocked(ctx, id);
    if (body.tipCents != null) await this.repo.setTip(ctx, id, this.validTip(body.tipCents), { tipType: 'custom', tipPercent: null });
    const totals = (await this.repo.totalsFor(ctx, id, 'cash'))!; const paidBefore = await this.repo.paidTotalCents(ctx, id); const due = Math.max(0, totals.totalDueCents - paidBefore); if (due <= 0) throw new ValidationError('This ticket is already paid in full');
    // Amount received must be a non-negative whole number of cents — a fractional value would otherwise flow into a
    // fractional change_due (breaking the integer-cents invariant), and a negative value is meaningless.
    if (!Number.isInteger(body.amountReceivedCents) || body.amountReceivedCents < 0) throw new ValidationError('Amount received must be a non-negative whole number of cents');
    if ((body.amountReceivedCents || 0) < due) throw new ValidationError('Amount received is less than the total due');
    const change = body.amountReceivedCents - due;
    // Smooth Refresh spec §76/§107: two stations taking cash for the same visit — only the first is recorded; the other
    // gets CHECKOUT_ALREADY_IN_PROGRESS (409) instead of a second full cash payment.
    const cashRec: PaymentRecord = { paymentId: this.pid(), ticketId: id, method: 'cash', amountCents: due, tipCents: totals.tipCents, status: 'approved', changeDueCents: change, createdAt: new Date().toISOString() };
    const payment = this.repo.recordPaymentIfUnchanged ? await this.repo.recordPaymentIfUnchanged(ctx, cashRec, paidBefore) : await this.repo.recordPayment(ctx, cashRec);
    await this.repo.setStatus(ctx, id, 'paid'); this.log(ctx, 'pos_checkout_cash_payment_created', 'pos_payment', payment.paymentId, undefined, payment as any, { ticketId: id }); await this.afterPaid(ctx, id);
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.paymentApproved, { ticketId: id, method: 'cash' });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketPaid, { ticketId: id });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.reportsUpdated, {});
    return { payment, changeDueCents: change };
  }
  private fallbackLeases?: InMemoryTerminalLeases;
  private leases(): TerminalLeasePort { return this.repo.terminalLeases ?? (this.fallbackLeases ??= new InMemoryTerminalLeases()); }
  async payCard(ctx: CheckoutContext, id: string, body: CardPaymentRequest): Promise<PaymentResult | NotConfigured> {
    return this.paying(ctx, id, () => this.payCardNow(ctx, id, body));
  }
  private async payCardNow(ctx: CheckoutContext, id: string, body: CardPaymentRequest): Promise<PaymentResult | NotConfigured> {
    await this.syncMembershipDiscounts(ctx, id).catch(() => undefined);   // Decision 15: membership benefits are on the bill before money moves
    await this.syncLoyaltyReward(ctx, id).catch(() => undefined);         // … and the reward code, last in the sequence
    this.need(ctx, 'pos.checkout.take_payment'); this.need(ctx, 'pos.checkout.card_payment'); await this.ticketOr404(ctx, id); await this.assertNotMobileLocked(ctx, id);
    if (body.terminalId) {
      // Functional Decision 34: a shared terminal runs ONE transaction at a time — reserved in the database (migration
      // 485), so it holds across API instances; a second POS gets TERMINAL_BUSY until this charge releases it.
      if (!(await this.leases().acquire(ctx.tenantId, body.terminalId, 'ticket:' + id))) { recordPaymentEvent('terminal_busy'); throw new ValidationError('TERMINAL_BUSY'); }
    }
    try {
    if (body.tipCents != null) await this.repo.setTip(ctx, id, this.validTip(body.tipCents), { tipType: 'custom', tipPercent: null });
    // Idempotent replay: if the client supplied an explicit idempotency key that already has an APPROVED payment,
    // return that recorded outcome WITHOUT touching the gateway again. A retry / double-submit (network blip,
    // double-tap) then returns the original success — paymentId + retref and all — instead of an ambiguous "already
    // paid" error, which is what invites human-error double-charges. A prior DECLINE is not replayed, so the guest
    // can legitimately re-attempt the same card.
    if (body.idempotencyKey) {
      const prior = await this.repo.findPaymentByIdempotencyKey(ctx, body.idempotencyKey);
      if (prior && prior.status === 'approved') {
        this.log(ctx, 'pos_checkout_card_payment_idempotent_replay', 'pos_payment', prior.paymentId, undefined, undefined, { idempotencyKey: body.idempotencyKey });
        return { paymentId: prior.paymentId, ticketId: id, status: 'approved', processorTransactionId: prior.processorTransactionId, approvedAmountCents: prior.amountCents };
      }
    }
    const totals = (await this.repo.totalsFor(ctx, id, 'card'))!; const due = Math.max(0, totals.totalDueCents - await this.repo.paidTotalCents(ctx, id)); if (due <= 0) throw new ValidationError('PAYMENT_ALREADY_COMPLETED'); const idem = body.idempotencyKey || buildIdempotencyKey(id, 'card', due);   // §134: the taxonomy code (the controller maps it to 409 + the sentence)
    await this.repo.lockTotal(ctx, id, due);
    this.log(ctx, 'pos_checkout_card_payment_attempted', 'pos_payment', id, undefined, undefined, { idempotencyKey: idem, amountCents: due });
    const settings = await this.repo.settings(ctx);
    const { processor, status } = await this.payProc(ctx, settings);
    // real processor (CardPointe/Fiserv): authorize + capture against the live gateway — never synthesize an approval
    if (status === 'connected') {
      if (!processor) { await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: id, method: 'card', amountCents: due, tipCents: totals.tipCents, surchargeCents: totals.surchargeCents || 0, status: 'not_configured', createdAt: new Date().toISOString(), idempotencyKey: idem }); return { configured: false, disabledReason: 'Card processor is not configured yet.' }; }
      if (!body.cardToken) return { configured: false, disabledReason: 'A card token is required to charge a card.' };
      if (looksLikeRawPan(body.cardToken)) throw new ValidationError('Card numbers are never accepted directly — use the terminal or the secure card form.');   // wave 3 PAYI §31 (P0 PCI)
      // Claim-first: reserve the idempotency key by inserting an in-flight ('processing') row BEFORE charging. The
      // partial unique index lets exactly one concurrent request with this key win; a loser must not touch the
      // gateway — that sub-second double-submit is the double-charge the already-paid guard can't catch (neither
      // request has recorded yet). NOTE: if authorizeAndCapture itself throws (network/timeout), the claim row is
      // intentionally left 'processing' so a retry returns 'processing' rather than re-charging an ambiguous capture;
      // that row is for reconciliation. This is strictly safer than the prior insert-after-capture flow.
      // §246: the in-flight row is the moment the card attempt STARTS — the other POS devices on this ticket should
      // show "processing" rather than a stale total. Declared and routed since the registry was written; never emitted.
      // §343 exempt: a momentary 'processing…' signal to other POS screens — the payment's outcome is the fact (payment.captured / payment.failed)
      this.realtime?.toTenant(ctx, EVENTS.paymentProcessingStarted, { ticketId: id, method: 'card' });
      const claim = await this.repo.claimPayment(ctx, { paymentId: this.pid(), ticketId: id, method: 'card', amountCents: due, tipCents: totals.tipCents, surchargeCents: totals.surchargeCents || 0, idempotencyKey: idem });   // the surcharge it charges is recorded (wave 4 PILOT: the live path wrote 0)
      if (!claim.claimed) {
        const ex = claim.existing;
        if (ex && ex.status === 'approved') return { paymentId: ex.paymentId, ticketId: id, status: 'approved', processorTransactionId: ex.processorTransactionId, approvedAmountCents: ex.amountCents };
        if (ex && ex.status === 'declined') return { paymentId: ex.paymentId, ticketId: id, status: 'declined', processorTransactionId: ex.processorTransactionId };
        this.log(ctx, 'pos_checkout_card_payment_duplicate_inflight', 'pos_payment', ex?.paymentId || id, undefined, undefined, { idempotencyKey: idem });
        // Functional Decision 22: an attempt still 'processing' after STALE_ATTEMPT_MS lost its answer (connection
        // dropped mid-charge). Never re-charge and never void blindly — ASK the processor, then report what it says.
        if (ex && ex.status === 'processing' && Date.now() - Date.parse(ex.createdAt) >= STALE_ATTEMPT_MS) {
          const v = await this.verifyCardPayment(ctx, id);
          if (v.status === 'approved' || v.status === 'declined') return { ...v } as any;
        }
        return { paymentId: ex?.paymentId || id, ticketId: id, status: 'processing' };
      }
      recordPaymentEvent('attempt');   // §104
      let auth: Awaited<ReturnType<PaymentProcessor['authorizeAndCapture']>>;
      try { auth = await processor.authorizeAndCapture({ account: body.cardToken, expiry: body.expiry, amountCents: due, orderId: id, idempotencyKey: idem }); }
      catch (e) { recordPaymentEvent('unknown'); throw e; }   // §26: the claim stays 'processing' = PAYMENT_STATUS_UNKNOWN
      if (!auth.approved) {
        if (auth.respstat === 'B' || (!auth.declined && auth.respstat !== 'C')) {
          recordPaymentEvent('unknown');
          this.log(ctx, 'pos_checkout_card_payment_provider_unavailable', 'pos_payment', claim.paymentId, undefined, undefined, { processor: processor.name, respstat: auth.respstat, respText: auth.respText });
          return { paymentId: claim.paymentId, ticketId: id, status: 'processing', processorTransactionId: auth.retref, providerUnavailable: true, message: 'Provider unavailable / verifying — please check terminal or retry' } as any;
        }
        recordPaymentEvent('declined');
        const dp = await this.repo.finalizePayment(ctx, claim.paymentId, { status: 'declined', processorTransactionId: auth.retref });
        this.log(ctx, 'pos_checkout_card_payment_declined', 'pos_payment', claim.paymentId, undefined, dp as any, { processor: processor.name, respstat: auth.respstat, respText: auth.respText });
        return { paymentId: claim.paymentId, ticketId: id, status: 'declined', processorTransactionId: auth.retref };
      }
      // Fiserv §9: the only surcharge is the one the PROVIDER assessed (fee_amount). The approved amount must equal what
      // we asked for plus that fee; anything else is contradictory → stays 'processing' for reconciliation, never "paid".
      const providerFee = Math.max(0, auth.surchargeCents ?? 0);
      if (auth.amountCents != null && auth.amountCents !== due + providerFee) {
        recordPaymentEvent('unknown');
        this.log(ctx, 'pos_checkout_card_amount_mismatch', 'pos_payment', claim.paymentId, undefined, undefined, { processor: processor.name, requestedCents: due, providerFeeCents: providerFee, approvedCents: auth.amountCents, retref: auth.retref });
        return { paymentId: claim.paymentId, ticketId: id, status: 'processing', processorTransactionId: auth.retref, message: 'Approved amount does not match — verify with the processor before closing this ticket' } as any;
      }
      if (providerFee > 0 && this.repo.recordProviderSurcharge) await this.repo.recordProviderSurcharge(ctx, claim.paymentId, providerFee, { feeType: auth.feeType, feeValue: auth.feeValue });
      // the card is charged; if recording it fails the attempt stays 'processing' (logged) — the POS shows "verify", never "paid"
      if ((await this.completeApprovedCard(ctx, id, claim.paymentId, auth.retref, due + providerFee, processor.name, 'live', auth.authCode)) === null) { recordPaymentEvent('unknown'); return { paymentId: claim.paymentId, ticketId: id, status: 'processing' }; }
      recordPaymentEvent('approved');
      return { paymentId: claim.paymentId, ticketId: id, status: 'approved', processorTransactionId: auth.retref, approvedAmountCents: due + providerFee };
    }
    if (!cardProcessingEnabled(status)) {
      // honest: never fake an approval when no processor is wired
      await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: id, method: 'card', amountCents: due, tipCents: totals.tipCents, surchargeCents: totals.surchargeCents || 0, status: 'not_configured', createdAt: new Date().toISOString(), idempotencyKey: idem });
      return { configured: false, disabledReason: 'Card processor is not configured yet.' };
    }
    const payment = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: id, method: 'card', amountCents: due, tipCents: totals.tipCents, surchargeCents: totals.surchargeCents || 0, status: 'approved', processorTransactionId: processorTxnId(status, idem), createdAt: new Date().toISOString(), idempotencyKey: idem });
    await this.repo.setStatus(ctx, id, 'paid'); this.log(ctx, 'pos_checkout_card_payment_approved', 'pos_payment', payment.paymentId, undefined, payment as any, { sandbox: isSandbox(status) }); await this.afterPaid(ctx, id);
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.paymentApproved, { ticketId: id, method: 'card' });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketPaid, { ticketId: id });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.reportsUpdated, {});
    return { paymentId: payment.paymentId, ticketId: id, status: 'approved', processorTransactionId: payment.processorTransactionId, approvedAmountCents: due };
    } finally {
      if (body.terminalId) {
        await this.leases().release(ctx.tenantId, body.terminalId, 'ticket:' + id).catch(() => undefined);
      }
    }
  }
  /**
   * Functional Decision 22 — resolve a card charge whose outcome was never received (terminal / network lost mid-charge).
   * Asks the processor (inquire by order id = the ticket id the charge was sent with) and acts ONLY on its answer:
   *   approved transaction for this attempt's amount, not already recorded  → complete the payment (ticket paid)
   *   declined transaction for it                                           → record the decline (card re-attemptable)
   *   no record, attempt older than NOT_FOUND_RELEASE_MS                    → 'failed': it never reached the processor,
   *                                                                          the claim is released so staff can retry
   *   no record yet                                                         → 'pending' (ask again shortly)
   *   processor unreachable / no inquiry API                                → 'unknown' — nothing changes
   * It never re-charges and never voids on its own. Every resolution is audited.
   */
  async verifyCardPayment(ctx: CheckoutContext, id: string): Promise<CardVerificationOutcome> {
    this.need(ctx, 'pos.checkout.take_payment'); await this.ticketOr404(ctx, id);
    const cards = await this.repo.cardPaymentsForTicket(ctx, id);
    const stuck = cards.filter((p) => p.status === 'processing').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!stuck) return { status: 'none', ticketId: id };
    const settings = await this.repo.settings(ctx);
    const { processor, status } = await this.payProc(ctx, settings);
    if (status !== 'connected' || !processor) return { status: 'unknown', paymentId: stuck.paymentId, ticketId: id, reason: 'Card processor is not connected.' };
    if (!processor.inquireByOrderId) return { status: 'unknown', paymentId: stuck.paymentId, ticketId: id, reason: `${processor.name} has no transaction inquiry — check the processor portal.` };
    let txns: Awaited<ReturnType<NonNullable<typeof processor.inquireByOrderId>>>['transactions'];
    try { txns = (await processor.inquireByOrderId(id)).transactions; }
    catch (e: any) {
      this.log(ctx, 'pos_checkout_card_payment_verify_unreachable', 'pos_payment', stuck.paymentId, undefined, undefined, { processor: processor.name, error: String(e?.message ?? e) });
      return { status: 'unknown', paymentId: stuck.paymentId, ticketId: id, reason: 'The processor could not be reached. Nothing was charged again; try verifying in a moment.' };
    }
    // Only a transaction for THIS attempt counts: same amount, and a reference no other payment row already holds
    // (the ticket id is the order id, so an earlier decline or a later successful charge on the same ticket also match).
    const known = new Set(cards.map((p) => p.processorTransactionId).filter(Boolean) as string[]);
    const mine = txns.filter((t) => (t.amountCents == null || t.amountCents === stuck.amountCents) && !(t.retref && known.has(t.retref)));
    const approved = mine.find((t) => t.approved);
    if (approved) {
      const done = await this.completeApprovedCard(ctx, id, stuck.paymentId, approved.retref, stuck.amountCents, processor.name, 'verified', approved.authCode);
      if (done === null) return { status: 'unknown', paymentId: stuck.paymentId, ticketId: id, reason: 'The processor approved this charge but recording it failed. Nothing was charged again; verify again in a moment.' };
      return { status: 'approved', paymentId: stuck.paymentId, ticketId: id, processorTransactionId: approved.retref, approvedAmountCents: done };
    }
    const declined = mine.find((t) => t.declined);
    if (declined) {
      await this.repo.finalizePayment(ctx, stuck.paymentId, { status: 'declined', processorTransactionId: declined.retref });
      this.log(ctx, 'pos_checkout_card_payment_verified_declined', 'pos_payment', stuck.paymentId, undefined, undefined, { processor: processor.name, respText: declined.respText });
      return { status: 'declined', paymentId: stuck.paymentId, ticketId: id, processorTransactionId: declined.retref };
    }
    const ageMs = Date.now() - Date.parse(stuck.createdAt);
    if (ageMs >= NOT_FOUND_RELEASE_MS) {
      await this.repo.finalizePayment(ctx, stuck.paymentId, { status: 'failed' });
      this.log(ctx, 'pos_checkout_card_payment_verified_not_found', 'pos_payment', stuck.paymentId, undefined, undefined, { processor: processor.name, ageSeconds: Math.round(ageMs / 1000) });
      return { status: 'failed', paymentId: stuck.paymentId, ticketId: id, retryAllowed: true };
    }
    return { status: 'pending', paymentId: stuck.paymentId, ticketId: id, retryAfterSeconds: Math.ceil((NOT_FOUND_RELEASE_MS - ageMs) / 1000) };
  }

  /**
   * BUILD_PLAN Phase 11 (Constitution 4 §116) — the stranded-attempt sweep's way in to the verification above. A card
   * payment left in 'processing' past PAYMENT_ATTEMPT_STRANDED_MINUTES is verified exactly as the cashier's "Verify"
   * button would (same code, same audit), as a system actor, UNDER THE TICKET'S CHECKOUT LOCK — so a cashier charging or
   * verifying the same ticket and the sweep never act at once. A held lock answers 'busy' (the sweep tries next tick).
   */
  async reconcileStrandedCard(tenantId: string, branchId: string, ticketId: string): Promise<CardVerificationOutcome | { status: 'busy'; ticketId: string }> {
    const ctx = sweepCtx(tenantId, branchId);
    try { return await this.paying(ctx, ticketId, () => this.verifyCardPayment(ctx, ticketId)); }
    catch (e) {
      if (e instanceof PaymentInProgressError || (e instanceof ValidationError && /mobile device/.test(e.message))) return { status: 'busy', ticketId };
      throw e;
    }
  }
  /** The sweep's processor question for a split reservation: inquire by order id through the tenant's own adapter.
   *  Never charges; reports honestly when there is no gateway, no inquiry API, or no answer. */
  async inquireProcessor(tenantId: string, branchId: string, orderId: string): Promise<ProcessorAnswer> {
    const ctx = sweepCtx(tenantId, branchId);
    const { processor, status } = await this.payProc(ctx, await this.repo.settings(ctx));
    if (status !== 'connected' || !processor) return { kind: 'not_connected' };
    if (!processor.inquireByOrderId) return { kind: 'no_inquiry', processor: processor.name };
    try { return { kind: 'answer', processor: processor.name, transactions: (await processor.inquireByOrderId(orderId)).transactions }; }
    catch (e: any) { return { kind: 'unreachable', processor: processor.name, error: String(e?.message ?? e).slice(0, 200) }; }
  }

  /** The one place a card charge becomes a completed payment — used by the live approval AND by a later verification.
   *  Phase 15 round 3: the approved payment (+ payment.captured) and the paid ticket commit in ONE transaction
   *  (repo.completeCardPayment). If that fails the card IS charged but nothing is recorded: the row stays 'processing' —
   *  Decision 22's lost-answer state that Verify / the stranded-attempt sweep settle by asking the processor — the failure
   *  is logged, and null is returned (never a charged-but-open ticket, never a silent loss). */
  private async completeApprovedCard(ctx: CheckoutContext, id: string, paymentId: string, retref: string | undefined, amountCents: Money, processorName: string, how: 'live' | 'verified', authCode?: string): Promise<Money | null> {
    let cp: PaymentRecord | null;
    if (this.repo.completeCardPayment) {
      try { cp = (await this.repo.completeCardPayment(ctx, id, paymentId, retref)).payment; }
      catch (e) {
        this.moneyLog.error(`card ${how === 'verified' ? 'verified' : 'charge'} APPROVED by ${processorName} (retref ${retref ?? 'none'}, ${amountCents} cents) but recording it failed — payment ${paymentId} on ticket ${id} (tenant ${ctx.tenantId}) left 'processing' for Verify with processor: ${(e as Error)?.message ?? String(e)}`);
        return null;
      }
    } else {
      cp = await this.repo.finalizePayment(ctx, paymentId, { status: 'approved', processorTransactionId: retref });
      await this.repo.setStatus(ctx, id, 'paid');
    }
    this.log(ctx, how === 'verified' ? 'pos_checkout_card_payment_verified_approved' : 'pos_checkout_card_payment_approved', 'pos_payment', paymentId, undefined, cp as any, { sandbox: false, processor: processorName, authCode });
    await this.afterPaid(ctx, id);   // the post-payment work (loyalty earn, compensation, …) — identical for a live and a verified approval
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.paymentApproved, { ticketId: id, method: 'card' });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketPaid, { ticketId: id });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.reportsUpdated, {});
    return amountCents;
  }

  async payGiftCard(ctx: CheckoutContext, id: string, body: GiftCardPaymentRequest): Promise<{ payment: PaymentRecord; remainingDueCents: Money; giftRemainingCents: Money }> {
    return this.paying(ctx, id, () => this.payGiftCardNow(ctx, id, body));
  }
  private async payGiftCardNow(ctx: CheckoutContext, id: string, body: GiftCardPaymentRequest): Promise<{ payment: PaymentRecord; remainingDueCents: Money; giftRemainingCents: Money }> {
    await this.syncMembershipDiscounts(ctx, id).catch(() => undefined);   // Decision 15: membership benefits are on the bill before money moves
    await this.syncLoyaltyReward(ctx, id).catch(() => undefined);         // … and the reward code, last in the sequence
    this.need(ctx, 'pos.checkout.take_payment'); this.need(ctx, 'pos.checkout.gift_card_payment'); await this.ticketOr404(ctx, id); await this.assertNotMobileLocked(ctx, id);
    if (body.tipCents != null) await this.repo.setTip(ctx, id, this.validTip(body.tipCents), { tipType: 'custom', tipPercent: null });
    const code = await this.repo.resolveGiftCardCode(ctx, body.giftCardCode); if (!code) throw new ValidationError('Invalid gift card');
    const balance = await this.repo.giftBalance(ctx, code); if (balance === null) throw new ValidationError('Invalid gift card');
    if (balance <= 0) throw new ValidationError('Gift card has no balance');
    const totals = (await this.repo.totalsFor(ctx, id, 'gift_card'))!; const paidBefore = await this.repo.paidTotalCents(ctx, id); const due = Math.max(0, totals.totalDueCents - paidBefore); if (due <= 0) throw new ValidationError('This ticket is already paid in full'); const applied = applyGiftCard(due, balance);
    const full = applied.remainingDueCents === 0;
    const giftRec: PaymentRecord = { paymentId: this.pid(), ticketId: id, method: 'gift_card', amountCents: applied.appliedCents, tipCents: totals.tipCents, status: full ? 'approved' : 'partial', createdAt: new Date().toISOString() };
    // Concurrency (Oct 4 2026): the debit and the payment row commit together under the visit lock and the paid-amount
    // check, so a second simultaneous tap gets CHECKOUT_ALREADY_IN_PROGRESS instead of a second debit of the same card.
    let payment: PaymentRecord;
    if (this.repo.redeemGiftAndRecordIfUnchanged) {
      const r = await this.repo.redeemGiftAndRecordIfUnchanged(ctx, code, applied.appliedCents, (body as any).pin, giftRec, paidBefore);
      if (!r) throw new ValidationError('Gift card could not be redeemed (balance changed or card inactive)');
      payment = r;
    } else {
      const redeemed = await this.repo.decrementGift(ctx, code, applied.appliedCents, (body as any).pin);
      if (!redeemed) throw new ValidationError('Gift card could not be redeemed (balance changed or card inactive)');
      payment = await this.repo.recordPayment(ctx, giftRec);
    }
    await this.repo.setStatus(ctx, id, full ? 'paid' : 'payment_in_progress'); if (full) await this.afterPaid(ctx, id);
    this.log(ctx, 'pos_checkout_gift_card_payment_created', 'pos_payment', payment.paymentId, undefined, payment as any, { remainingDueCents: applied.remainingDueCents });
    return { payment, remainingDueCents: applied.remainingDueCents, giftRemainingCents: applied.giftRemainingCents };
  }

  // Balance/status preview before applying (spec §14). Accepts a 16-digit number or a code. Returns ONLY safe fields —
  // masked reference, masked number, balance, status, and whether it's redeemable at this salon — never the code or any
  // purchaser info. A miss returns { found: false } with no hint of "almost", so the endpoint can't confirm guesses.
  async giftCardLookup(ctx: CheckoutContext, input: string): Promise<{ found: boolean; reference?: string; cardNumberMasked?: string; balanceCents?: number; status?: string; redeemableHere?: boolean; viaNetwork?: boolean }> {
    this.need(ctx, 'pos.checkout.gift_card_payment');
    // Rate-limit failed lookups per tenant+user (spec §13/§23): a run of misses is the number-guessing signal. Successful
    // lookups of real cards never count. When wired, exceeding the window blocks further attempts with a generic message.
    const throttleKey = 'gclookup:' + ctx.tenantId + ':' + ctx.userId;
    if (this.lookupThrottle) {
      const decision = rateLimitDecision(await this.lookupThrottle.recentFailures(throttleKey), Date.now(), { maxFailures: 10, windowMs: 5 * 60_000, lockMs: 5 * 60_000 });
      if (!decision.allowed) throw new ValidationError('Too many gift-card lookups. Please wait a moment and try again.');
    }
    const digits = String(input || '').replace(/\D+/g, '');
    const cardNumberMasked = /^\d{16}$/.test(digits) ? maskCardNumber(digits) : undefined;
    const code = await this.repo.resolveGiftCardCode(ctx, input);
    const card = code ? await this.repo.getGiftCard(ctx, code) : null;
    if (code && card) {
      const redeemableHere = card.status === 'active' && card.balanceCents > 0;
      return { found: true, reference: 'GC-****-' + code.slice(-4), cardNumberMasked, balanceCents: card.balanceCents, status: card.status, redeemableHere };
    }
    // §15 Same-tenant miss — is this a card issued at ANOTHER salon in a shared program the current salon belongs to?
    const x = await this.repo.resolveCrossTenantGiftCard(ctx, input);
    if (x.found && x.crossTenant && x.eligible) {
      // Recognized as a network card from another salon; it redeems here (decrementing the issuing salon's card and
      // recording an inter-tenant clearing obligation), so we surface it as redeemable via the network.
      const netRedeemable = x.status === 'active' && (x.balanceCents ?? 0) > 0;
      return { found: true, viaNetwork: true, reference: 'GC-****-' + String(x.code || '').slice(-4), cardNumberMasked, balanceCents: x.balanceCents, status: x.status, redeemableHere: netRedeemable };
    }
    if (this.lookupThrottle) await this.lookupThrottle.recordFailure(throttleKey);
    return { found: false };
  }

  // §22 replace a lost/stolen card from the POS. Resolves the receptionist's entered number/code, then hands off to the
  // atomic repo replace (new card + transfer ledger + retire original). Returns the new card's number once, for print.
  async replaceGiftCard(ctx: CheckoutContext, input: string): Promise<{ ok: boolean; reason?: string; newReference?: string; newCardNumber?: string; newCardNumberMasked?: string; balanceCents?: Money }> {
    this.need(ctx, 'pos.checkout.gift_card_payment');
    const code = await this.repo.resolveGiftCardCode(ctx, input);
    if (!code) return { ok: false, reason: 'not_found' };
    const res = await this.repo.replaceGiftCardByCode(ctx, code);
    if (res.ok) this.log(ctx, 'pos_gift_card_replaced', 'gift_cards', undefined, undefined, undefined, { replaced: 'GC-****-' + code.slice(-4), newReference: res.newReference, balanceCents: res.balanceCents });
    return { ok: res.ok, reason: res.reason, newReference: res.newReference, newCardNumber: res.newCardNumber, newCardNumberMasked: res.newCardNumberMasked, balanceCents: res.balanceCents };
  }
  async paySplit(ctx: CheckoutContext, id: string, body: SplitPaymentRequest): Promise<{ payments: PaymentRecord[]; status: string; cardSurchargeCents: number } | NotConfigured> {
    return this.paying(ctx, id, () => this.paySplitNow(ctx, id, body));
  }
  private async paySplitNow(ctx: CheckoutContext, id: string, body: SplitPaymentRequest): Promise<{ payments: PaymentRecord[]; status: string; cardSurchargeCents: number } | NotConfigured> {
    await this.syncMembershipDiscounts(ctx, id).catch(() => undefined);   // Decision 15: membership benefits are on the bill before money moves
    await this.syncLoyaltyReward(ctx, id).catch(() => undefined);         // … and the reward code, last in the sequence
    this.need(ctx, 'pos.checkout.take_payment'); this.need(ctx, 'pos.checkout.split_payment'); await this.ticketOr404(ctx, id); await this.assertNotMobileLocked(ctx, id);
    if (body.tipCents != null) await this.repo.setTip(ctx, id, this.validTip(body.tipCents), { tipType: 'custom', tipPercent: null });
    const totals = (await this.repo.totalsFor(ctx, id, 'split'))!; const paidBefore = await this.repo.paidTotalCents(ctx, id); const due = Math.max(0, totals.totalDueCents - paidBefore); if (due <= 0) throw new ValidationError('This ticket is already paid in full');
    if (!Array.isArray(body.segments) || body.segments.length === 0) throw new ValidationError('A split requires at least one payment segment');
    // Each segment must be a positive whole number of cents. Without this, a negative segment paired with a larger
    // positive one could satisfy the sum-equals-due check below while over-charging the card (e.g. [card 12000, cash
    // -2000] for a 10000 due charges the card 12000), and a fractional segment would introduce sub-cent drift.
    for (const seg of body.segments) {
      if (!Number.isInteger(seg.amountCents) || seg.amountCents <= 0) throw new ValidationError('Each split segment must be a positive whole number of cents');
    }
    const sum = (body.segments || []).reduce((a, seg) => a + (seg.amountCents || 0), 0);
    if (sum !== due) throw new ValidationError('Split payments must total the amount due (' + due + ' cents)');
    // Exactly one card segment per split. The processor capture below charges a single card segment (its base + the
    // card-portion surcharge); allowing two card segments would record the second as paid while only the first is
    // actually captured — i.e. money never collected. Front desk should combine card dollars into one card segment.
    if ((body.segments || []).filter((seg) => seg.method === 'card').length > 1) {
      throw new ValidationError('A split can include at most one card segment — combine the card amount into a single card payment.');
    }
    const settings = await this.repo.settings(ctx);
    const { processor, status: fs } = await this.payProc(ctx, settings);
    // Fiserv master build §9 (P0 fix, Nov 4 2026): the card segment is authorized at its BASE amount only. The former
    // "Option A" added a locally computed 3% to the authorization (even for unknown funding), which an enrolled MID would
    // then surcharge AGAIN. Now the card-portion surcharge is whatever the provider assessed on that authorization
    // (fee_amount; 0 for debit/prepaid/not enrolled). Cash/gift dollars are never surcharged.
    const cardBaseCents = body.segments.filter((seg) => seg.method === 'card').reduce((a, seg) => a + (seg.amountCents || 0), 0);
    let cardSurchargeCents = 0;
    const hasCard = body.segments.some((seg) => seg.method === 'card');
    if (hasCard && !cardProcessingEnabled(fs)) {
      this.log(ctx, 'pos_checkout_card_payment_attempted', 'pos_payment', id, undefined, undefined, { split: true });
      return { configured: false, disabledReason: 'Card processor is not configured yet.' };
    }
    // Validate ALL gift segments up-front (codes + sufficient balance) BEFORE charging anything, so an invalid or
    // short gift segment is rejected without ever capturing the card.
    // Resolve each gift segment's entered value (a 16-digit number or a code) to a code up-front, so both the balance
    // validation here AND the atomic decrement below use the resolved code — a gift card can be split by the number the
    // customer reads. Errors stay generic so the entered value / resolved code is never echoed back.
    const resolvedSegments = await Promise.all(body.segments.map(async (seg) => {
      if (seg.method !== 'gift_card') return seg;
      if (!seg.giftCardCode) throw new ValidationError('Gift-card split segment requires a gift card number or code');
      const code = await this.repo.resolveGiftCardCode(ctx, seg.giftCardCode);
      if (!code) throw new ValidationError('Invalid gift card');
      return { ...seg, giftCardCode: code };
    }));
    for (const seg of resolvedSegments) {
      if (seg.method === 'gift_card' && seg.giftCardCode) {
        const bal = await this.repo.giftBalance(ctx, seg.giftCardCode);
        if (bal === null) throw new ValidationError('Invalid gift card');
        if (seg.amountCents > bal) throw new ValidationError('Gift card balance (' + bal + ' cents) is insufficient for this ' + seg.amountCents + '-cent segment');
      }
    }
    // Only after gifts validate do we capture the card segment (never synthesize a split approval).
    let cardRetref: string | undefined;
    let splitCardIdem: string | undefined;
    if (hasCard && fs === 'connected') {
      if (!processor) return { configured: false, disabledReason: 'Card processor is not configured yet.' };
      if (!body.cardToken) return { configured: false, disabledReason: 'A card token is required to charge a card.' };
      if (looksLikeRawPan(body.cardToken)) throw new ValidationError('Card numbers are never accepted directly — use the terminal or the secure card form.');   // wave 3 PAYI §31 (P0 PCI)
      const cardSeg = body.segments.find((seg) => seg.method === 'card')!;
      const cardChargeCents = cardSeg.amountCents;   // base only — never base + a local fee
      // Idempotency key on the split's card capture (keyed on the exact card charge) — passed to the processor so
      // Fiserv/CardPointe can dedupe, AND used to claim an app-level reservation BEFORE charging. The split settles
      // atomically via recordSplitAtomic, so it uses the dedicated payment_attempts table as the reservation lock
      // rather than the payments-row claim the straight card path uses.
      splitCardIdem = buildIdempotencyKey(id, 'card', cardChargeCents);
      const claim = await this.repo.claimPaymentAttempt(ctx, { ticketId: id, method: 'card', amountCents: cardChargeCents, idempotencyKey: splitCardIdem });
      if (!claim.claimed) {
        // A concurrent split with this exact card charge is already in flight. Do NOT capture — that is the
        // sub-second double-charge the already-paid guard above cannot see (neither request has recorded yet).
        this.log(ctx, 'pos_checkout_split_card_duplicate_inflight', 'pos_payment', id, undefined, undefined, { idempotencyKey: splitCardIdem });
        throw new ValidationError('A card payment for this ticket is already being processed');
      }
      const auth = await processor.authorizeAndCapture({ account: body.cardToken, expiry: body.expiry, amountCents: cardChargeCents, orderId: id, idempotencyKey: splitCardIdem });
      if (!auth.approved) {
        if (auth.respstat === 'B' || (!auth.declined && auth.respstat !== 'C')) {
          throw new ValidationError('Card processor unavailable: ' + (auth.respText || 'Provider retry (B)') + ' — please retry or check terminal');
        }
        await this.repo.releasePaymentAttempt(ctx, splitCardIdem); // a definitive decline charged nothing → free the reservation for a re-attempt
        throw new ValidationError('Card segment was declined by the processor: ' + (auth.respText || auth.respstat));
      }
      cardSurchargeCents = Math.max(0, auth.surchargeCents ?? 0);
      if (auth.amountCents != null && auth.amountCents !== cardChargeCents + cardSurchargeCents) {
        // Contradictory processor amount: keep the reservation held (a retry says "already being processed") and leave it
        // for reconciliation — never record a split as paid on an amount we did not ask for.
        this.log(ctx, 'pos_checkout_split_card_amount_mismatch', 'pos_payment', id, undefined, undefined, { requestedCents: cardChargeCents, providerFeeCents: cardSurchargeCents, approvedCents: auth.amountCents, retref: auth.retref });
        throw new ValidationError('The card was approved for a different amount than requested — verify with the processor before closing this ticket');
      }
      if (cardSurchargeCents > 0) this.log(ctx, 'pos_checkout_split_card_provider_surcharge', 'pos_payment', id, undefined, undefined, { cardBaseCents, providerFeeCents: cardSurchargeCents, feeType: auth.feeType, feeValue: auth.feeValue, retref: auth.retref });
      cardRetref = auth.retref;
    }
    // Settle all segments atomically: gift decrements + payment rows + paid status commit together (or roll back).
    let payments: PaymentRecord[];
    try {
      payments = await this.repo.recordSplitAtomic(ctx, id, resolvedSegments.map((seg) => ({ method: seg.method, amountCents: seg.amountCents, giftCardCode: seg.giftCardCode, pin: (seg as any).pin })), { cardRetref, cardSurchargeCents, expectedPaidCents: paidBefore });
    } catch (e) {
      // Compensation: the card was captured just above, OUTSIDE the DB transaction. Since the settlement rolled back,
      // void that capture so the customer is not charged for a payment the system never recorded. Best-effort — if the
      // void itself fails, log it for manual reconciliation rather than masking the original error.
      let voidedOk = true;
      if (cardRetref && processor) {
        try { await processor.voidTransaction({ retref: cardRetref }); this.log(ctx, 'pos_checkout_split_card_voided_on_rollback', 'pos_void', id, undefined, undefined, { retref: cardRetref, processor: processor.name }); }
        catch (ve) { voidedOk = false; this.log(ctx, 'pos_checkout_split_card_void_failed', 'pos_void', id, undefined, undefined, { retref: cardRetref, processor: processor.name, error: String(ve).slice(0, 200) }); }
      }
      // Free the reservation only if nothing remains charged (no card, or the void succeeded). If the void FAILED, the
      // card may still be charged — leave the reservation held so a retry returns "already being processed" instead of
      // re-charging a card we couldn't reverse (reconciliation territory).
      if (splitCardIdem && voidedOk) await this.repo.releasePaymentAttempt(ctx, splitCardIdem);
      if (e instanceof SplitRedemptionError) throw new ValidationError(e.message + (cardRetref ? ' — the card charge was voided' : ''));
      throw e;
    }
    if (splitCardIdem) await this.repo.settlePaymentAttempt(ctx, splitCardIdem); // reservation completed — mark it settled
    for (const p of payments) this.log(ctx, 'pos_checkout_split_payment_created', 'pos_payment', p.paymentId, undefined, p as any, { segment: p.method });
    await this.afterPaid(ctx, id);
    return { payments, status: 'paid', cardSurchargeCents };
  }

  // ---- gift card issuance + balance lookup ----
  // Server-enforced gift-card SALE rules (enabled, POS sales on, amount within min/max). Shared by direct issuance
  // and the payment-first POS sale so neither can bypass the tenant's configured limits.
  private async assertGiftCardSaleAllowed(ctx: CheckoutContext, amount: number): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Gift card amount must be a positive whole number of cents');
    const gc = await this.repo.giftCardSaleSettings(ctx);
    if (!gc.enabled) throw new ValidationError('Gift cards are turned off for this salon');
    if (!gc.posSalesEnabled) throw new ValidationError('Selling gift cards at the POS is turned off');
    if (amount < gc.minAmountCents) throw new ValidationError('Gift card amount is below the minimum of $' + (gc.minAmountCents / 100).toFixed(2));
    if (amount > gc.maxAmountCents) throw new ValidationError('Gift card amount is above the maximum of $' + (gc.maxAmountCents / 100).toFixed(2));
  }
  async issueGiftCard(ctx: CheckoutContext, body: IssueGiftCardRequest): Promise<{ code: string; balanceCents: Money }> {
    this.need(ctx, 'pos.checkout.gift_card_issue');
    const amount = Number(body?.amountCents);
    await this.assertGiftCardSaleAllowed(ctx, amount);
    const code = (body.code && body.code.trim()) || 'GC-' + secureString(10)   /* H9: a gift-card code is spendable money — was Math.random() */;
    const card = await this.repo.issueGiftCard(ctx, { code, amountCents: amount, customerId: body.customerId, idempotencyKey: body.idempotencyKey, cardNumber: generateCardNumber() });
    this.log(ctx, 'pos_checkout_gift_card_issued', 'pos_gift_card', code, undefined, undefined, { amountCents: amount });
    return card;
  }
  // Payment-first POS sale: create the card PENDING against a ticket. It carries no stored value and cannot be
  // redeemed until the ticket is paid — afterPaid() then activates it. This makes "activate only after payment" structural.
  async createGiftCardSale(ctx: CheckoutContext, ticketId: string, body: GiftCardSaleRequest): Promise<GiftCardSaleResult> {
    this.need(ctx, 'pos.checkout.gift_card_issue');
    const amount = Number(body?.amountCents);
    await this.assertGiftCardSaleAllowed(ctx, amount);
    await this.ticketOr404(ctx, ticketId);
    const code = 'GC-' + secureString(10)   /* H9: a gift-card code is spendable money — was Math.random() */;
    const reference = 'GC-****-' + code.slice(-4);
    // §21 Physical card sale: a pre-printed number is supplied and must be claimed from stock. Digital sale (no number)
    // is unchanged — the system mints a fresh number the receptionist writes on a blank card.
    const physical = String(body?.cardNumber || '').replace(/\D+/g, '');
    let sale: { code: string; reference: string } | null;
    if (physical) {
      if (!/^\d{16}$/.test(physical)) throw new ValidationError('Enter a valid 16-digit physical card number.');
      sale = await this.repo.createPhysicalGiftCardSale(ctx, { code, amountCents: amount, customerId: body.customerId, ticketId, reference, cardNumber: physical, pin: (body as any).pin });
      if (!sale) throw new ValidationError('That physical card is not available in stock. Register it first, or check the number.');
    } else {
      sale = await this.repo.createPendingGiftCardSale(ctx, { code, amountCents: amount, customerId: body.customerId, ticketId, reference, cardNumber: generateCardNumber() });
    }
    this.log(ctx, 'pos_checkout_gift_card_sale_created', 'pos_gift_card', code, undefined, undefined, { amountCents: amount, ticketId, physical: !!physical });
    return { code: sale.code, reference: sale.reference, amountCents: amount, status: 'pending_payment' };
  }

  // Reload (top-up) an EXISTING card, payment-first: attach a pending reload to the ticket; the balance is credited only
  // when the ticket is paid (afterPaid → activatePendingGiftCardReloads). Never credits value up front.
  async createGiftCardReload(ctx: CheckoutContext, ticketId: string, body: { code: string; amountCents: Money }): Promise<{ reference: string; amountCents: Money; balanceCents: Money; status: string }> {
    this.need(ctx, 'pos.checkout.gift_card_issue');
    const amount = Number(body?.amountCents);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Reload amount must be a positive whole number of cents');
    await this.ticketOr404(ctx, ticketId);
    const card = await this.repo.getGiftCard(ctx, String(body?.code || ''));
    if (!card) throw new ValidationError('Gift card not found');
    if (card.status === 'void') throw new ValidationError('Cannot reload a voided gift card');
    const reference = 'GC-****-' + String(body.code).slice(-4);
    const pend = await this.repo.createPendingGiftCardReload(ctx, { code: body.code, amountCents: amount, ticketId, reference });
    this.log(ctx, 'pos_checkout_gift_card_reload_created', 'pos_gift_card', body.code, undefined, undefined, { amountCents: amount, ticketId });
    return { reference: pend.reference, amountCents: amount, balanceCents: card.balanceCents, status: 'pending_payment' };
  }
  async giftCardBalance(ctx: CheckoutContext, code: string): Promise<GiftCardDetail> {
    this.need(ctx, 'pos.checkout.gift_card_payment');
    const detail = await this.repo.getGiftCard(ctx, code);
    if (!detail) throw new ValidationError('Gift card not found');
    return detail;
  }
  async reloadGiftCard(ctx: CheckoutContext, code: string, amountCents: Money): Promise<GiftCardDetail> {
    this.need(ctx, 'pos.checkout.gift_card_issue');
    const amount = Number(amountCents);
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Reload amount must be a positive whole number of cents');
    const existing = await this.repo.getGiftCard(ctx, code);
    if (!existing) throw new ValidationError('Gift card not found');
    if (existing.status === 'void') throw new ValidationError('Cannot reload a voided gift card');
    const detail = await this.repo.reloadGiftCard(ctx, code, amount);
    this.log(ctx, 'pos_checkout_gift_card_reloaded', 'pos_gift_card', code, undefined, undefined, { amountCents: amount, balanceCents: detail.balanceCents });
    return detail;
  }
  async voidGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail> {
    this.need(ctx, 'pos.checkout.gift_card_issue');
    const existing = await this.repo.getGiftCard(ctx, code);
    if (!existing) throw new ValidationError('Gift card not found');
    if (existing.status === 'void') return existing; // idempotent
    const detail = await this.repo.voidGiftCard(ctx, code);
    this.log(ctx, 'pos_checkout_gift_card_voided', 'pos_gift_card', code, undefined, undefined, { priorBalanceCents: existing.balanceCents });
    return detail;
  }

  /** Best-effort §21 reversal after a refund succeeds. Only a FULL refund auto-reverses attribution; a partial refund
   *  needs per-line refund detail (follow-on). Never throws — the refund has already been processed. */
  /** What the ticket has captured and how much of it has been refunded so far (all tenders). */
  private async ticketRefundPosition(ctx: CheckoutContext, ticketId: string): Promise<{ capturedCents: number; refundedCents: number; originals: PaymentRecord[] }> {
    const originals = (await this.repo.paymentsForTicket(ctx, ticketId)).filter((x) => x.status === 'approved' || x.status === 'partial');
    let refunded = 0; for (const o of originals) refunded += await this.repo.refundedTotalCents(ctx, o.paymentId);
    return { capturedCents: originals.reduce((n, o) => n + o.amountCents, 0), refundedCents: refunded, originals };
  }

  /**
   * The ONE place a refund's side effects happen (commission reversal + loyalty reversal), judged against the WHOLE
   * ticket. Before Oct 1 2026 each tender's refund judged "full" against its own payment: on a $60 card + $40 cash
   * ticket, refunding the whole $40 cash tender counted as a FULL refund and reversed ALL technician commission for
   * the ticket (Functional Decision 10: refunds reverse the CORRESPONDING commission).
   */
  private async afterRefund(ctx: CheckoutContext, ticketId: string, refundedNowCents: number, body: Pick<RefundRequest, 'reason' | 'serviceLineIds' | 'tipRefunded'>, refundPaymentId?: string | null) {
    const pos = await this.ticketRefundPosition(ctx, ticketId);
    const wholeTicketRefunded = pos.capturedCents > 0 && pos.refundedCents >= pos.capturedCents;
    await this.reverseCompForRefund(ctx, ticketId, wholeTicketRefunded ? pos.capturedCents : refundedNowCents, pos.capturedCents, body.reason, { serviceLineIds: body.serviceLineIds, tipRefunded: body.tipRefunded, refundPaymentId });
    await this.repo.reverseLoyaltyPoints(ctx, ticketId, refundedNowCents, body.reason || 'Refund');
    // BUILD_PLAN Phase 5, bug 4: the deals and coupons on the ticket are given back — all of them on a full refund, the
    // ones on the refunded lines on a line refund. A refund of an amount with no lines keeps them (the visit happened).
    if (this.deals && (wholeTicketRefunded || body.serviceLineIds?.length)) {
      try { await this.deals.onRefunded(ctx, ticketId, wholeTicketRefunded ? null : Array.from(new Set(body.serviceLineIds!)), body.reason || 'refund'); } catch { /* best-effort: the refund already happened */ }
    }
  }

  /**
   * BUILD_PLAN Phase 5 — what each service was actually PAID: its price minus every discount allocated to it (the pricing
   * snapshot), plus the tax charged on that (the ticket's tax is the rate on the discounted subtotal). A refund of a
   * service gives back this — not the menu price, and not the price without its tax (the Phase 5 live proof caught a
   * line refund that kept the customer's tax).
   */
  private async linePaidCents(ctx: CheckoutContext, tk: any): Promise<Map<string, { netCents: number; taxCents: number; paidCents: number }>> {
    const rate = Number((await this.repo.settings(ctx).catch(() => null) as any)?.taxRatePercent) || 0;
    const out = new Map<string, { netCents: number; taxCents: number; paidCents: number }>();
    for (const l of tk?.lines || []) {
      const net = lineNetCents(tk?.discountSnapshot, l.serviceLineId, l.priceCents);
      const tax = Math.round(net * (rate / 100));
      out.set(l.serviceLineId, { netCents: net, taxCents: tax, paidCents: net + tax });
    }
    return out;
  }

  /** Functional Decision 20 — how a ticket-level refund of `amountCents` would split across the original tenders. */
  async refundAllocationPreview(ctx: CheckoutContext, ticketId: string, amountCents: number) {
    this.need(ctx, 'pos.checkout.refund'); await this.ticketOr404(ctx, ticketId);
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new ValidationError('Refund amount must be a positive whole number of cents');
    const pos = await this.ticketRefundPosition(ctx, ticketId);
    const tenders = await Promise.all(pos.originals.map(async (o) => ({ paymentId: o.paymentId, method: o.method, amountCents: o.amountCents, refundedCents: await this.repo.refundedTotalCents(ctx, o.paymentId), captured: true, ...(o.giftCardLast4 ? { giftCardLast4: o.giftCardLast4 } : {}) })));
    // which gift card each allocation goes back to (Oct 6 2026), by payment
    const last4 = new Map(tenders.filter((t) => t.giftCardLast4).map((t) => [t.paymentId, t.giftCardLast4 as string]));
    let allocations;
    try { allocations = calculateRefundAllocations(amountCents, tenders).map((a) => (last4.has(a.paymentId) ? { ...a, giftCardLast4: last4.get(a.paymentId) } : a)); }
    catch { throw new ValidationError(`Refund exceeds what this ticket can still return (${pos.capturedCents - pos.refundedCents} cents remain)`); }
    const tk: any = await this.repo.ticket(ctx, ticketId);
    // BUILD_PLAN Phase 5: what each service actually cost after its discounts — a line refund gives back THAT, not the menu price
    const paid = await this.linePaidCents(ctx, tk);
    const lines = (tk?.lines || []).map((l: any) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, priceCents: l.priceCents, ...(paid.get(l.serviceLineId) ?? { netCents: l.priceCents, taxCents: 0, paidCents: l.priceCents }) }));
    return { ticketId, amountCents, refundableCents: pos.capturedCents - pos.refundedCents, allocations, tenders: tenders.map((t) => ({ ...t, remainingCents: t.amountCents - t.refundedCents })), lines };
  }

  /**
   * Functional Decision 20 — refund an AMOUNT from a ticket; the backend splits it across the original tenders
   * proportionally (never more than a tender paid) and refunds each to its own method through the canonical per-payment
   * refund (atomic cap, approvals, processor). Cards are refunded FIRST and the run stops at the first tender that does
   * not complete, so cash is never handed back for a card refund the processor then declines. Commission / loyalty
   * reversal runs ONCE for what was actually refunded, judged against the whole ticket.
   */
  async refundTicket(ctx: CheckoutContext, ticketId: string, body: RefundRequest & { amountCents?: Money }) {
    this.need(ctx, 'pos.checkout.refund'); if (!body?.reason?.trim()) throw new ValidationError('Refund requires a reason');
    // BUILD_PLAN Phase 5 — a refund of SERVICES (lines) with no amount refunds what those services were actually paid
    // (their price minus every discount allocated to them), never the menu price.
    if ((body.amountCents == null || (body.amountCents as any) === '') && body.serviceLineIds?.length) {
      const tk: any = await this.ticketOr404(ctx, ticketId);
      const ids = new Set(body.serviceLineIds);
      const unknown = [...ids].filter((x) => !(tk.lines || []).some((l: any) => l.serviceLineId === x));
      if (unknown.length) throw new ValidationError('One or more services are not on this ticket.');
      const paid = await this.linePaidCents(ctx, tk);
      const pos = await this.ticketRefundPosition(ctx, ticketId);
      body = { ...body, amountCents: Math.min(pos.capturedCents - pos.refundedCents, (tk.lines || []).filter((l: any) => ids.has(l.serviceLineId)).reduce((n: number, l: any) => n + (paid.get(l.serviceLineId)?.paidCents ?? 0), 0)) };
    }
    const preview = await this.refundAllocationPreview(ctx, ticketId, Number(body.amountCents));
    const order = [...preview.allocations].sort((a, b) => (a.method === 'card' ? 0 : 1) - (b.method === 'card' ? 0 : 1));
    const results: { paymentId: string; method: string; amountCents: number; status: string; refundId?: string; error?: string; giftCardLast4?: string; approvalId?: string }[] = [];
    const card = (a: { giftCardLast4?: string }) => (a.giftCardLast4 ? { giftCardLast4: a.giftCardLast4 } : {});
    let refunded = 0;
    for (const a of order) {
      try {
        const r: any = await this.refund(ctx, a.paymentId, { reason: body.reason, managerPin: body.managerPin, amountCents: a.amountToRefundCents }, { deferSideEffects: true });
        if (r?.status === 'refunded') { refunded += a.amountToRefundCents; results.push({ ...card(a as any), paymentId: a.paymentId, method: a.method, amountCents: a.amountToRefundCents, status: 'refunded', refundId: r.refundId }); continue; }
        results.push({ ...card(a as any), paymentId: a.paymentId, method: a.method, amountCents: a.amountToRefundCents, status: r?.configured === false ? 'not_configured' : String(r?.status ?? 'not_refunded'), error: r?.disabledReason ?? (r?.status === 'approval_pending' ? r.message : undefined), ...(r?.approvalId ? { approvalId: String(r.approvalId) } : {}) });
      } catch (e: any) {
        results.push({ ...card(a as any), paymentId: a.paymentId, method: a.method, amountCents: a.amountToRefundCents, status: 'failed', error: String(e?.message ?? e) });
      }
      break;   // stop at the first tender that did not complete
    }
    // body carries serviceLineIds when lines were refunded; the first refund tender's payment row keys the ledger reversal (idempotent on replay)
    if (refunded > 0) await this.afterRefund(ctx, ticketId, refunded, body, results.find((x) => x.status === 'refunded')?.refundId ?? null);
    this.log(ctx, 'pos_checkout_ticket_refund', 'pos_refund', ticketId, undefined, undefined, { requestedCents: body.amountCents, refundedCents: refunded, reason: body.reason, tenders: results.map((r) => ({ method: r.method, amountCents: r.amountCents, status: r.status })) });
    return { ticketId, requestedCents: body.amountCents, refundedCents: refunded, complete: refunded === body.amountCents, tenders: results };
  }

  /** §21 reversal after a refund succeeds (Payroll mandate §51–§54). Idempotent per refund payment (the refund row id
   *  is the ledger key — a replayed hook inserts nothing). FULL → everything; PARTIAL with line ids → those lines whole;
   *  PARTIAL without line ids → PRO-RATA across every line (refunded/captured). Never throws — the refund has already
   *  been processed — but a failure is logged on the money path, never silent. */
  private async reverseCompForRefund(ctx: CheckoutContext, ticketId: string, amount: number, capturedCents: number, reason: string, detail?: { serviceLineIds?: string[]; tipRefunded?: boolean; refundPaymentId?: string | null }): Promise<void> {
    if (!this.compensation?.reverseForRefund) return;
    const compCtx = { tenantId: ctx.tenantId, branchId: (ctx as any).branchId ?? null };
    const opts = { reason, requestedBy: ctx.userId ?? null };
    // the refund payment row id is the ledger idempotency key (UUID column); a non-UUID (in-memory repo) carries no key
    const refundPaymentId = detail?.refundPaymentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail.refundPaymentId) ? detail.refundPaymentId : null;
    try {
      let r: any;
      if (amount >= capturedCents) {
        // FULL refund: reverse everything (lines, if sent, are redundant and ignored).
        r = await this.compensation.reverseForRefund(compCtx, ticketId, { type: 'full', tipRefunded: true, refundPaymentId }, opts);
      } else if (detail?.serviceLineIds?.length) {
        // PARTIAL with line detail (Jul 29, 2026): reverse commission on exactly the refunded lines. The engine
        // reverses each selected line WHOLE — the caller names lines, never invents proportions. Tip reversal on
        // those lines follows the caller's explicit tipRefunded flag (default: tip stays).
        const lines = Array.from(new Set(detail.serviceLineIds)).map((serviceLineId) => ({ serviceLineId, refundTip: !!detail.tipRefunded }));
        r = await this.compensation.reverseForRefund(compCtx, ticketId, { type: 'partial', lines, refundPaymentId }, opts);
      } else {
        // PARTIAL without lines (merge Oct 12 2026): pro-rata across all lines by refunded/captured. "Nothing reverses"
        // WAS the bug — a $5 goodwill refund left the technician credited for the full ticket (mandate §52).
        // Oct 13 2026 (live money-chain proof): the ratio is measured against the COMMISSIONABLE capture — the ticket's
        // tip, tax, surcharge and gift-card charge are not commission basis (captured − subtotal), so a $45 refund of a
        // $45 service paid as $60.24 reverses the whole commission, not 45/60.24 of it.
        const tot = await this.repo.totalsFor(ctx, ticketId).catch(() => null);
        const nonCommissionableCents = tot ? Math.max(0, capturedCents - Number(tot.subtotalCents || 0)) : undefined;
        r = await this.compensation.reverseForRefund(compCtx, ticketId, { type: 'partial', refundedCents: amount, capturedCents, ...(nonCommissionableCents != null ? { nonCommissionableCents } : {}), tipRefunded: !!detail?.tipRefunded, refundPaymentId }, opts);
      }
      if (r && r.ok === false) this.postPaymentFailed('compensation_reversal', ctx, ticketId, new Error(String(r.error || 'unknown')));
    } catch (e) { this.postPaymentFailed('compensation_reversal', ctx, ticketId, e); }
  }

  /** A void that leaves NOTHING captured on the ticket reverses its deals and coupons (places, budget, code uses). */
  private async dealsAfterVoid(ctx: CheckoutContext, ticketId: string, reason: string): Promise<void> {
    if (!this.deals) return;
    try {
      const pos = await this.ticketRefundPosition(ctx, ticketId);
      if (pos.capturedCents - pos.refundedCents <= 0) await this.deals.onRefunded(ctx, ticketId, null, 'void: ' + (reason || ''));
    } catch { /* best-effort: the void already happened */ }
  }

  // ---- refund / void (honest: processor not configured) ----
  async refund(ctx: CheckoutContext, paymentId: string, body: RefundRequest, opts?: { deferSideEffects?: boolean; approvalId?: string }): Promise<NotConfigured | { refundId: string; status: string } | ApprovalPendingResult> {
    this.need(ctx, 'pos.checkout.refund'); if (!body?.reason?.trim()) throw new ValidationError('Refund requires a reason');
    const p = await this.repo.findPayment(ctx, paymentId); if (!p) throw new ValidationError('Payment not found');
    const amount = body.amountCents != null ? body.amountCents : p.amountCents;
    // Money-integrity guards (apply to every method): a refund must be a positive whole-cent amount, the original must
    // actually have captured funds (approved/partial), and cumulative refunds can never exceed the captured amount —
    // which also prevents refunding the same payment twice.
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Refund amount must be a positive whole number of cents');
    if (p.status !== 'approved' && p.status !== 'partial') throw new ValidationError('Only an approved or partial payment can be refunded (payment is ' + p.status + ')');
    // Line-attribution detail (partial refunds): every named line must belong to this payment's ticket — a typo'd id
    // must fail the REQUEST, not silently reverse nothing while the money still moves.
    if (body.serviceLineIds?.length) {
      const t = await this.repo.ticket(ctx, p.ticketId);
      const known = new Set((t?.lines ?? []).map((l) => l.serviceLineId));
      const bad = Array.from(new Set(body.serviceLineIds)).filter((id) => !known.has(id));
      if (bad.length) throw new ValidationError('Refund lines must belong to this ticket: ' + bad.join(', '));
    }
    // BUILD_PLAN Phase 9: the SALON's limits (its refund policy) and who may pass them — the caller's own key, or an approved
    // request the engine is executing (opts.approvalId is set ONLY by executeApprovedRefund, never from a request body).
    const approved = !!opts?.approvalId;
    const thresholds: RefundThresholds = thresholdsFromPolicy(this.approvals ? await this.approvals.policy(ctx.tenantId, 'refund').catch(() => null) : null);
    // The cumulative-refund cap is enforced ATOMICALLY at reservation time (reserveRefundAtomic, advisory-locked),
    // so two concurrent same-payment refunds can never both pass it — closing the over-refund race. Cash and gift-card
    // refunds never touch the gateway: reserve (which enforces the cap) then record the ledger entry, then finalize.
    if (p.method === 'cash' || p.method === 'gift_card') {
      const reserved = await this.repo.reserveRefundAtomic(ctx, { canApprove: approved || hasPermission(ctx as any, APPROVE_REFUND_CAPABILITY), thresholds, paymentId: p.paymentId, capturedCents: p.amountCents, amountCents: amount, reason: body.reason, method: p.method, processorType: null });
      if (!reserved.ok && (reserved as any).approvalRequired) return this.refundNeedsApproval(ctx, p, amount, body);
      if (!reserved.ok) throw new ValidationError('Refund exceeds the refundable balance (' + reserved.refundable + ' cents remain)');
      const r = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: p.ticketId, method: p.method, amountCents: amount, tipCents: 0, status: 'refunded', refundedCents: amount, createdAt: new Date().toISOString() });
      await this.repo.finalizeRefund(ctx, reserved.refundId, r.paymentId);
      recordPaymentEvent('refund'); this.log(ctx, 'pos_checkout_refund_created', 'pos_refund', paymentId, undefined, r as any, { reason: body.reason, method: p.method, refundedCents: amount, approvalId: opts?.approvalId ?? null });
      if (!opts?.deferSideEffects) await this.afterRefund(ctx, p.ticketId, amount, body, r.paymentId);
      return { refundId: r.paymentId, status: 'refunded' };
    }
    const { processor, status } = await this.payProc(ctx, await this.repo.settings(ctx));
    if (status === 'connected') {
      if (!processor) { this.log(ctx, 'pos_checkout_refund_created', 'pos_refund', paymentId, undefined, undefined, { reason: body.reason, status: 'not_configured' }); return { configured: false, disabledReason: 'Refund processing is not configured yet.' }; }
      if (!p.processorTransactionId) throw new ValidationError('Original transaction reference is missing; cannot refund this payment.');
      // Reserve the refundable amount BEFORE hitting the gateway (claim-first): the cap is enforced atomically, so a
      // concurrent same-payment refund is rejected here rather than both reaching the gateway and over-refunding.
      const reserved = await this.repo.reserveRefundAtomic(ctx, { canApprove: approved || hasPermission(ctx as any, APPROVE_REFUND_CAPABILITY), thresholds, paymentId: p.paymentId, capturedCents: p.amountCents, amountCents: amount, reason: body.reason, method: p.method, processorType: processor.name });
      if (!reserved.ok && (reserved as any).approvalRequired) return this.refundNeedsApproval(ctx, p, amount, body);
      if (!reserved.ok) throw new ValidationError('Refund exceeds the refundable balance (' + reserved.refundable + ' cents remain)');
      let pr: any;
      const refundIdem = buildIdempotencyKey(p.paymentId, 'refund', amount);
      try { pr = await processor.refund({ retref: p.processorTransactionId, amountCents: amount, idempotencyKey: refundIdem }); }
      catch (e: any) {
        // Unknown result on gateway error/timeout — keep reservation reserved for review/sweep, do NOT blindly release
        this.log(ctx, 'pos_checkout_card_refund_unknown', 'pos_refund', paymentId, undefined, undefined, { reason: body.reason, processor: processor.name, error: String(e?.message ?? e).slice(0, 200), refundId: reserved.refundId });
        throw new ValidationError('Card processor did not respond; refund is under review. Please do not retry immediately.');
      }
      if (!pr.ok) { await this.repo.releaseRefund(ctx, reserved.refundId); throw new ValidationError('Refund was declined by the processor: ' + (pr.respText || pr.respstat)); }
      const r = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: p.ticketId, method: p.method, amountCents: amount, tipCents: 0, status: 'refunded', processorTransactionId: pr.retref || p.processorTransactionId, refundedCents: amount, createdAt: new Date().toISOString() });
      await this.repo.finalizeRefund(ctx, reserved.refundId, pr.retref || r.paymentId);
      recordPaymentEvent('refund'); this.log(ctx, 'pos_checkout_refund_created', 'pos_refund', paymentId, undefined, r as any, { reason: body.reason, sandbox: false, processor: processor.name, refundedCents: amount, approvalId: opts?.approvalId ?? null });
      if (!opts?.deferSideEffects) await this.afterRefund(ctx, p.ticketId, amount, body, r.paymentId);
      return { refundId: r.paymentId, status: 'refunded' };
    }
    if (cardProcessingEnabled(status)) {
      const reserved = await this.repo.reserveRefundAtomic(ctx, { canApprove: approved || hasPermission(ctx as any, APPROVE_REFUND_CAPABILITY), thresholds, paymentId: p.paymentId, capturedCents: p.amountCents, amountCents: amount, reason: body.reason, method: p.method, processorType: 'fiserv' });
      if (!reserved.ok && (reserved as any).approvalRequired) return this.refundNeedsApproval(ctx, p, amount, body);
      if (!reserved.ok) throw new ValidationError('Refund exceeds the refundable balance (' + reserved.refundable + ' cents remain)');
      const r = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: p.ticketId, method: p.method, amountCents: amount, tipCents: 0, status: 'refunded', processorTransactionId: (isSandbox(status) ? 'sbx_rfnd_' : 'rfnd_') + paymentId, refundedCents: amount, createdAt: new Date().toISOString() });
      await this.repo.finalizeRefund(ctx, reserved.refundId, r.processorTransactionId || null);
      recordPaymentEvent('refund'); this.log(ctx, 'pos_checkout_refund_created', 'pos_refund', paymentId, undefined, r as any, { reason: body.reason, sandbox: isSandbox(status), refundedCents: amount, approvalId: opts?.approvalId ?? null });
      if (!opts?.deferSideEffects) await this.afterRefund(ctx, p.ticketId, amount, body, r.paymentId);   // sandbox approvals earn loyalty/commission, so sandbox refunds reverse them too
      return { refundId: r.paymentId, status: 'refunded' };
    }
    this.log(ctx, 'pos_checkout_refund_created', 'pos_refund', paymentId, undefined, undefined, { reason: body.reason, status: 'not_configured' });
    return { configured: false, disabledReason: 'Refund processing is not configured yet.' }; // card refund needs a configured gateway; original preserved
  }
  /** Past the limit and no key: with the engine, file (or find) the request and say so; without it, the old 403. */
  private async refundNeedsApproval(ctx: CheckoutContext, p: { paymentId: string; ticketId: string; method: string }, amount: number, body: RefundRequest): Promise<ApprovalPendingResult> {
    this.log(ctx, 'pos_checkout_refund_approval_required', 'pos_refund', p.paymentId, undefined, undefined, { amountCents: amount, method: p.method });
    if (!this.approvals) throw new ForbiddenError('This refund needs an owner or manager: it would take the refunds on this payment past the approval limit.');
    const payload: Record<string, unknown> = { paymentId: p.paymentId, ticketId: p.ticketId, amountCents: amount, reason: body.reason, method: p.method,
      ...(body.serviceLineIds?.length ? { serviceLineIds: body.serviceLineIds, tipRefunded: !!body.tipRefunded } : {}) };
    const branchId = typeof ctx.branchId === 'string' && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null;
    const { request, created } = await this.approvals.request({ tenantId: ctx.tenantId, branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions },
      { kind: 'refund', subjectType: 'payment', subjectId: p.paymentId, amountCents: amount, reason: body.reason, payload, title: `Refund $${(amount / 100).toFixed(2)} (${p.method})` });
    return { status: 'approval_pending', approvalId: request.id, expiresAt: request.expiresAt,
      message: created ? 'Sent for approval — a manager or the owner has to approve this refund.' : 'A refund on this payment is already waiting for approval.' };
  }

  /** The engine asks before filing a refund request (from the refund route OR from POST pos/approvals — the front desk, who
   *  cannot refund, asks this way): the payment must be this salon's, captured, and the amount within what it can still
   *  return; the payload is rebuilt HERE from the payment (never the client's), so the approver sees what will happen. */
  async prepareRefundRequest(actor: { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] }, input: { subjectType: string; subjectId: string | null; amountCents: number | null; reason: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const ctx: CheckoutContext = { tenantId: actor.tenantId, branchId: actor.branchId ?? '', userId: actor.userId, role: actor.role, permissions: [...actor.permissions] };
    this.assertUser(ctx);
    if (input.subjectType !== 'payment' || !input.subjectId) throw new ValidationError('A refund request names the payment to refund.');
    const p = await this.repo.findPayment(ctx, input.subjectId); if (!p) throw new ValidationError('Payment not found');
    if (p.status !== 'approved' && p.status !== 'partial') throw new ValidationError('Only an approved or partial payment can be refunded (payment is ' + p.status + ')');
    const remaining = p.amountCents - (await this.repo.refundedTotalCents(ctx, p.paymentId));
    const amount = input.amountCents != null ? input.amountCents : remaining;
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('Refund amount must be a positive whole number of cents');
    if (amount > remaining) throw new ValidationError('Refund exceeds the refundable balance (' + Math.max(0, remaining) + ' cents remain)');
    const asked = input.payload || {};
    const lines = Array.isArray(asked.serviceLineIds) ? Array.from(new Set((asked.serviceLineIds as unknown[]).map(String))).slice(0, 50) : [];
    if (lines.length) {
      const t = await this.repo.ticket(ctx, p.ticketId);
      const known = new Set((t?.lines ?? []).map((l) => l.serviceLineId));
      const bad = lines.filter((x) => !known.has(x));
      if (bad.length) throw new ValidationError('Refund lines must belong to this ticket: ' + bad.join(', '));
    }
    return { subjectType: 'payment', subjectId: p.paymentId, amountCents: amount, title: `Refund $${(amount / 100).toFixed(2)} (${p.method})`,
      payload: { paymentId: p.paymentId, ticketId: p.ticketId, amountCents: amount, reason: input.reason, method: p.method, ...(lines.length ? { serviceLineIds: lines, tipRefunded: asked.tipRefunded === true } : {}) } };
  }

  /** The engine's executor for an approved refund request: the canonical refund, AS THE APPROVER (who must hold the approval
   *  key — the engine checked it; this re-checks so no other caller can use the path), in the request's branch. */
  async executeApprovedRefund(actor: { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] }, request: { id: string; subjectId: string | null; payload: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const ctx: CheckoutContext = { tenantId: actor.tenantId, branchId: actor.branchId ?? '', userId: actor.userId, role: actor.role, permissions: [...actor.permissions] };
    if (!hasPermission(ctx as any, APPROVE_REFUND_CAPABILITY)) throw new ForbiddenError('Approving a refund needs ' + APPROVE_REFUND_CAPABILITY);
    const b = request.payload || {};
    const paymentId = String(b.paymentId ?? request.subjectId ?? '');
    const lines = Array.isArray(b.serviceLineIds) ? (b.serviceLineIds as unknown[]).map(String) : undefined;
    const r: any = await this.refund(ctx, paymentId, { reason: String(b.reason ?? 'Approved refund'), amountCents: Number(b.amountCents), ...(lines?.length ? { serviceLineIds: lines, tipRefunded: b.tipRefunded === true } : {}) }, { approvalId: request.id });
    if (r?.status !== 'refunded') throw new ValidationError(r?.disabledReason || 'The refund did not complete (' + String(r?.status ?? 'not_configured') + ').');
    return { status: 'refunded', refundId: r.refundId, paymentId, amountCents: Number(b.amountCents) };
  }

  async void(ctx: CheckoutContext, paymentId: string, body: VoidRequest): Promise<NotConfigured | { status: string }> {
    this.need(ctx, 'pos.checkout.void'); if (!body?.reason?.trim()) throw new ValidationError('Void requires a reason');
    const p = await this.repo.findPayment(ctx, paymentId); if (!p) throw new ValidationError('Payment not found');
    // Money-integrity guards (same family the refund path enforces): only a payment that actually captured funds and
    // hasn't already been reversed can be voided. Blocks voiding a declined/not_configured payment, voiding a row that
    // is itself a void/refund, and voiding a payment that was already refunded.
    if (p.status !== 'approved' && p.status !== 'partial') throw new ValidationError('Only an approved or partial payment can be voided (payment is ' + p.status + ')');
    if ((await this.repo.refundedTotalCents(ctx, p.paymentId)) > 0) throw new ValidationError('This payment has already been refunded and cannot be voided');
    const { processor, status } = await this.payProc(ctx, await this.repo.settings(ctx));
    if (status === 'connected') {
      if (!processor) { this.log(ctx, 'pos_checkout_void_created', 'pos_void', paymentId, undefined, undefined, { reason: body.reason, status: 'not_configured' }); return { configured: false, disabledReason: 'Void processing is not configured yet.' }; }
      if (!p.processorTransactionId) throw new ValidationError('Original transaction reference is missing; cannot void this payment.');
      const pr = await processor.voidTransaction({ retref: p.processorTransactionId });
      if (!pr.ok) throw new ValidationError('Void was declined by the processor: ' + (pr.respText || pr.respstat));
      const r = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: p.ticketId, method: p.method, amountCents: 0, tipCents: 0, status: 'voided', processorTransactionId: pr.retref || p.processorTransactionId, createdAt: new Date().toISOString() });
      await this.repo.markPaymentVoided(ctx, p.paymentId); // reverse the ORIGINAL: drops it from revenue + paid-total and blocks any second void/refund
      await this.repo.reverseLoyaltyPoints(ctx, p.ticketId, p.amountCents, body.reason || 'Void', { table: 'payments', id: p.paymentId });
      await this.reopenIfNoLongerPaid(ctx, p.ticketId, p.method);
      await this.dealsAfterVoid(ctx, p.ticketId, body.reason);
      recordPaymentEvent('void'); this.log(ctx, 'pos_checkout_void_created', 'pos_void', paymentId, undefined, r as any, { reason: body.reason, sandbox: false, processor: processor.name });
      return { status: 'voided' };
    }
    if (cardProcessingEnabled(status)) {
      const r = await this.repo.recordPayment(ctx, { paymentId: this.pid(), ticketId: p.ticketId, method: p.method, amountCents: 0, tipCents: 0, status: 'voided', processorTransactionId: (isSandbox(status) ? 'sbx_void_' : 'void_') + paymentId, createdAt: new Date().toISOString() });
      await this.repo.markPaymentVoided(ctx, p.paymentId); // reverse the ORIGINAL: drops it from revenue + paid-total and blocks any second void/refund
      await this.repo.reverseLoyaltyPoints(ctx, p.ticketId, p.amountCents, body.reason || 'Void', { table: 'payments', id: p.paymentId });
      await this.reopenIfNoLongerPaid(ctx, p.ticketId, p.method);
      await this.dealsAfterVoid(ctx, p.ticketId, body.reason);
      recordPaymentEvent('void'); this.log(ctx, 'pos_checkout_void_created', 'pos_void', paymentId, undefined, r as any, { reason: body.reason, sandbox: isSandbox(status) });
      return { status: 'voided' };
    }
    this.log(ctx, 'pos_checkout_void_created', 'pos_void', paymentId, undefined, undefined, { reason: body.reason, status: 'not_configured' });
    return { configured: false, disabledReason: 'Void processing is not configured yet.' };
  }

  // ---- reopen ----
  async reopen(ctx: CheckoutContext, id: string, body: ReopenServiceRequest) {
    const t = await this.ticketOr404(ctx, id);
    const paymentStatus = t.status === 'paid' ? 'paid' : t.status === 'payment_in_progress' ? 'processing' : 'unpaid';
    const gate = canReopenService(paymentStatus, ['checkout.reopen_service']); // pure-rule check on workflow state
    if (!ctx.permissions.includes('pos.checkout.reopen_service')) throw new ForbiddenError('Missing pos.checkout.reopen_service');
    if (!gate.ok) throw new ValidationError('Cannot reopen: ' + gate.reason);
    if (!body?.reason?.trim()) throw new ValidationError('Reopen requires a reason');
    // Round 2 C: the write is conditional on the stored row (not paid, no payment in progress) — another station that paid
    // or started a payment after this read wins, and this reopen is refused (409), never written over it.
    if (!(await this.repo.setStatus(ctx, id, 'reopened'))) throw new CheckoutInProgressError();
    this.log(ctx, 'pos_checkout_service_reopened', 'pos_checkout_ticket', id, undefined, undefined, { reason: body.reason });
    return this.repo.detail(ctx, id);
  }

  // ---- receipts (honest provider status) ----
  private async sendOne(ctx: CheckoutContext, id: string, channel: 'sms' | 'email' | 'app', destination?: string): Promise<{ channel: string; configured: boolean; disabledReason?: string; delivery?: string; providerRef?: string; receiptNumber?: string; reason?: string }> {
    const t = await this.ticketOr404(ctx, id);
    // The receipt states what was CHARGED: once paid, the payments themselves (a cash ticket carries no card surcharge, a
    // split carries only its card part's). It used to quote the card total for every ticket — a cash customer's receipt
    // showed a surcharge they never paid (found Oct 6 2026, 23-inch spec Unit 6). Before payment: the ticket's own method.
    const totals = await this.repo.totalsFor(ctx, id, t.method || 'card');
    const paid = await this.repo.paidBreakdown(ctx, id);
    const total = paid.totalCents > 0 ? paid.totalCents : (totals?.totalDueCents ?? 0);
    const tipCents = totals?.tipCents ?? 0;
    const dollars = centsToUsd(total);
    // Custom Tip spec: the receipt shows the tip clearly whenever one was left.
    const tipNote = tipCents > 0 ? ` (includes ${centsToUsd(tipCents)} tip)` : '';
    const surchargeCents = paid.totalCents > 0 ? paid.surchargeCents : (totals?.surchargeCents ?? 0);
    // Card-surcharge disclosure: when a surcharge is part of the total shown, the receipt itemizes it (Visa rules
    // require disclosure; pre-payment disclosure already exists on the customer display — this closes the receipt half).
    const surchargeNote = surchargeCents > 0 ? ` (includes ${centsToUsd(surchargeCents)} card surcharge)` : '';
    // BUILD_PLAN Phase 5: itemized — each service, the deals/discounts taken off it, what the customer saved
    const items = itemizedReceipt(t as any, centsToUsd);
    const savedNote = items.savingsLine ? ' ' + items.savingsLine : '';

    const pushReceiptNotifications = async (recNum: string) => {
      if (!this.push) return;
      const label = t.ticketNumber ? `#${t.ticketNumber}` : (id ? `#${id.slice(0, 8)}` : '');
      // 1. Notify Customer (Customer app)
      if (this.repo.customerUserIdForTicket) {
        try {
          const uid = await this.repo.customerUserIdForTicket(ctx, id);
          if (uid) {
            await this.push.dispatchToUser(ctx.tenantId, uid, {
              title: 'Receipt saved',
              body: `Receipt #${recNum} is in your app.`,
              data: { kind: 'receipt_saved', ticketId: id, receiptNumber: recNum },
              reference: `receipt:${recNum}`,
              category: 'RECEIPT',
            });
          }
        } catch { /* best-effort */ }
      }
      // 2. Notify Owners / Managers (Owner app)
      if (this.repo.activeOwnerUserIds) {
        try {
          const ownerIds = await this.repo.activeOwnerUserIds(ctx);
          for (const oid of ownerIds) {
            await this.push.dispatchToUser(ctx.tenantId, oid, {
              title: 'Receipt generated',
              body: `Receipt #${recNum} generated for ticket ${label}.`,
              data: { kind: 'receipt_generated', ticketId: id, receiptNumber: recNum },
              reference: `receipt_owner:${recNum}:${oid}`,
              category: 'RECEIPT',
            });
          }
        } catch { /* best-effort */ }
      }
    };

    if (channel === 'sms') {
      const targetPhone = destination?.trim() || t.customerPhone;
      if (!targetPhone) throw new ValidationError('A valid phone is required for an SMS receipt');
      if (this.messenger) {
        // BUILD_PLAN Phase 2: through the tenant messenger — the salon's number, opt-outs, the notification ledger and
        // communication.sms_sent / sms_delivery_failed. A blocked or failed text is reported as exactly that.
        const rec = await this.repo.recordReceipt(ctx, { ticketId: id, totalCents: total });
        await pushReceiptNotifications(rec.receiptNumber);
        const r = await this.messenger.sendSms({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, customerId: t.customerId ?? null, to: targetPhone, purpose: 'receipt', body: `Thanks for visiting! Your receipt total is ${dollars}${tipNote}${surchargeNote}.${savedNote} Ref ${rec.receiptNumber}.` });
        // P-11: no texting provider in production — the channel is not configured (nothing was sent, nothing charged)
        if (!r.sent && r.reason === 'not_configured') { this.log(ctx, 'pos_checkout_receipt_sms_sent', 'pos_receipt', id, undefined, undefined, { status: 'not_configured', receiptNumber: rec.receiptNumber }); return { channel, configured: false, disabledReason: 'SMS receipts are not configured yet.', receiptNumber: rec.receiptNumber }; }
        const delivery = r.sent ? (r.simulated ? 'simulated' : 'sent') : r.status;
        this.log(ctx, 'pos_checkout_receipt_sms_sent', 'pos_receipt', id, undefined, undefined, { delivery, providerRef: r.providerId ?? null, receiptNumber: rec.receiptNumber, ...(r.sent ? {} : { reason: r.reason ?? null }) });
        // §343 exempt: a delivery notice to the checkout screen — the receipt row and its audit are the record
        if (r.sent) this.realtime?.toTenant(ctx, EVENTS.receiptSent, { ticketId: id, channel });
        return { channel, configured: true, delivery, providerRef: r.providerId, receiptNumber: rec.receiptNumber, ...(r.sent ? {} : { reason: r.reason ?? 'send_failed' }) };
      }
      if (!this.sms || isNotConfiguredSender(this.sms)) { this.log(ctx, 'pos_checkout_receipt_sms_sent', 'pos_receipt', id, undefined, undefined, { status: 'not_configured' }); return { channel, configured: false, disabledReason: 'SMS receipts are not configured yet.' }; }
      const rec = await this.repo.recordReceipt(ctx, { ticketId: id, totalCents: total });
      await pushReceiptNotifications(rec.receiptNumber);
      const res = await this.sms.send(targetPhone, `Thanks for visiting! Your receipt total is ${dollars}${tipNote}${surchargeNote}.${savedNote} Ref ${rec.receiptNumber}.`);
      const delivery = isSimulatedSender(this.sms) ? 'simulated' : 'sent';
      this.log(ctx, 'pos_checkout_receipt_sms_sent', 'pos_receipt', id, undefined, undefined, { delivery, providerRef: res.sid, receiptNumber: rec.receiptNumber });
      // Constitution 9 §246: receipt_sent was declared, versioned and routed to the checkout screen but never emitted.
      // §343 exempt: a delivery notice to the checkout screen — the receipt row and its audit are the record
      this.realtime?.toTenant(ctx, EVENTS.receiptSent, { ticketId: id, channel });
      return { channel, configured: true, delivery, providerRef: res.sid, receiptNumber: rec.receiptNumber };
    }
    if (channel === 'email') {
      const targetEmail = destination?.trim() || t.customerEmail;
      if (!targetEmail) throw new ValidationError('A valid email is required for an email receipt');
      if (!this.email || isNotConfiguredSender(this.email)) { this.log(ctx, 'pos_checkout_receipt_email_sent', 'pos_receipt', id, undefined, undefined, { status: 'not_configured' }); return { channel, configured: false, disabledReason: 'Email receipts are not configured yet.' }; }
      const rec = await this.repo.recordReceipt(ctx, { ticketId: id, totalCents: total, emailedTo: targetEmail });
      await pushReceiptNotifications(rec.receiptNumber);
      const res = await this.email.send(targetEmail, 'Your receipt', `Thanks for visiting!\n\n${items.text}\n\nTotal ${dollars}${tipNote}${surchargeNote}. Reference ${rec.receiptNumber}.`);
      const delivery = isSimulatedSender(this.email) ? 'simulated' : 'sent';
      this.log(ctx, 'pos_checkout_receipt_email_sent', 'pos_receipt', id, undefined, undefined, { delivery, providerRef: res.id, receiptNumber: rec.receiptNumber });
      // Constitution 9 §246: receipt_sent was declared, versioned and routed to the checkout screen but never emitted.
      // §343 exempt: a delivery notice to the checkout screen — the receipt row and its audit are the record
      this.realtime?.toTenant(ctx, EVENTS.receiptSent, { ticketId: id, channel });
      return { channel, configured: true, delivery, providerRef: res.id, receiptNumber: rec.receiptNumber };
    }
    if (!t.customerId) throw new ValidationError('A customer profile is required to save to the app');
    const rec = await this.repo.recordReceipt(ctx, { ticketId: id, totalCents: total });
    this.log(ctx, 'pos_checkout_receipt_app_saved', 'pos_receipt', id, undefined, undefined, { receiptNumber: rec.receiptNumber });
    // developer merge (Oct 6 2026): tell customer's and owner's phones the receipt is in their app. §61: no amount on lock screen.
    await pushReceiptNotifications(rec.receiptNumber);
    return { channel, configured: true, delivery: 'saved', receiptNumber: rec.receiptNumber };
  }
  async receiptSms(ctx: CheckoutContext, id: string, destination?: string) { this.need(ctx, 'pos.receipts.send'); return this.sendOne(ctx, id, 'sms', destination); }
  async receiptEmail(ctx: CheckoutContext, id: string, destination?: string) { this.need(ctx, 'pos.receipts.send'); return this.sendOne(ctx, id, 'email', destination); }
  async receiptApp(ctx: CheckoutContext, id: string) { this.need(ctx, 'pos.receipts.send'); return this.sendOne(ctx, id, 'app'); }
  /** 23-inch spec §97: which receipt channels can really deliver — a configured provider, not the simulated stand-in. The
   *  customer display offers only these (it never tells a customer "texted" when nothing was sent). */
  receiptChannelsLive(): { sms: boolean; email: boolean } {
    return { sms: senderDelivers(this.sms), email: senderDelivers(this.email) };   // P-11: neither the mock nor the not-configured sender
  }
  /** §97: the contact the POS's Send Receipt would use for this ticket (the same lookup), and whether a receipt went already. */
  async displayReceiptFacts(scope: { tenantId: string; branchId: string }, ticketId: string): Promise<{ phone: string | null; email: string | null; alreadySent: boolean; live: { sms: boolean; email: boolean } }> {
    const ctx = this.displayCtx(scope);
    const t = await this.repo.ticket(ctx, ticketId);
    return { phone: t?.customerPhone || null, email: t?.customerEmail || null, alreadySent: t ? await this.repo.hasReceipt(ctx, ticketId) : false, live: this.receiptChannelsLive() };
  }
  /** §97–§98: the customer chose their receipt ON the customer display — the SAME delivery as the POS's Send Receipt. The
   *  display's own credential proved the salon, branch and checkout; no staff permission is involved. */
  async sendReceiptForDisplay(scope: { tenantId: string; branchId: string }, ticketId: string, channel: 'sms' | 'email'): Promise<'sent' | 'unavailable' | 'failed'> {
    try {
      const r = await this.sendOne(this.displayCtx(scope), ticketId, channel);
      if (r.configured === false || r.delivery === 'simulated') return 'unavailable';
      // Through the messenger a send that did not leave RETURNS failed/blocked (it no longer throws): only 'sent' is sent.
      return r.delivery === 'sent' ? 'sent' : 'failed';
    } catch { return 'failed'; }
  }
  private displayCtx(scope: { tenantId: string; branchId: string }): CheckoutContext {
    return { tenantId: scope.tenantId, branchId: scope.branchId, userId: 'customer-display', role: 'CUSTOMER_DISPLAY', permissions: [] } as unknown as CheckoutContext;
  }
  async receiptSendAll(ctx: CheckoutContext, id: string, body?: SendReceiptRequest) {
    this.need(ctx, 'pos.receipts.send'); const channels = (body?.channels?.length ? body.channels : ['sms', 'email', 'app']).filter((c) => c !== 'print') as ('sms' | 'email' | 'app')[];
    const results = await Promise.all(channels.map(async (c) => { try { return await this.sendOne(ctx, id, c); } catch (e) { return { channel: c, configured: false, disabledReason: (e as Error).message }; } }));
    return { results };
  }

  // ---- customer display ----
  // 23-inch spec §82: OPERATING the display during checkout (send, switch, refresh, cancel, see its status) is front-desk
  // work — pos.customer_display.operate rides the checkout capability. Pairing and device management are the owner's.
  async devices(ctx: CheckoutContext): Promise<POSCustomerDisplayDevice[]> { this.need(ctx, 'pos.customer_display.operate'); return this.repo.devices(ctx); }
  /**
   * 23-inch spec §9–§11, §82–§83: Send to Display / Switch Display. Which display: display-send-core.ts (this POS's
   * register's dedicated display first, then the branch's shared ones; online and not in maintenance; Switch names one).
   * The first free one is reserved — another customer on it is DISPLAY_BUSY and the next is tried; nobody is displaced.
   * A checkout is never on two displays: switching ends it on the display it was on (never mid-payment there).
   */
  async sendToCustomerDisplay(ctx: CheckoutContext, id: string, body?: SendToDisplayRequest): Promise<POSCustomerDisplaySession> {
    this.need(ctx, 'pos.customer_display.operate'); await this.ticketOr404(ctx, id);
    const want = { stationId: typeof body?.stationId === 'string' ? body.stationId : null, deviceId: typeof body?.deviceId === 'string' ? body.deviceId : null };
    const devices = (await this.repo.devices(ctx)).filter((d) => d.paired);
    const open = await this.repo.openDisplaySessionsForTicket(ctx, id);
    const pick = pickDisplays(devices.map((d) => ({ deviceId: d.deviceId, label: d.label, stationId: d.stationCode || null, online: d.online !== false, maintenance: !!d.maintenance })), want, open.map((o) => o.deviceId));
    if (!pick.ok) {
      // §104 standard codes: none for this register → NOT_CONFIGURED; offline / maintenance → OFFLINE; a display that is
      // not this branch's (another branch or salon — §105) → CONTEXT_MISMATCH
      const code = pick.reason === 'not_found' ? 'DISPLAY_CONTEXT_MISMATCH' : pick.reason === 'offline' || pick.reason === 'maintenance' ? 'CUSTOMER_DISPLAY_OFFLINE' : 'CUSTOMER_DISPLAY_NOT_CONFIGURED';
      throw new CustomerDisplayError(code, pick.message, pick.reason);
    }
    let busy: DisplayBusyError | null = null;
    for (const d of pick.order) {
      const elsewhere = open.filter((o) => o.deviceId !== d.deviceId);
      if (elsewhere.some((o) => o.state === 'payment_processing' || o.state === 'payment_in_progress' || o.state === 'processing')) {
        throw new ValidationError('A payment is in progress for this customer on another display. Finish it there first.');
      }
      let session: POSCustomerDisplaySession | null;
      try { session = await this.repo.createSession(ctx, id, d.deviceId); }
      catch (e) { if (e instanceof DisplayBusyError) { busy = e; continue; } throw e; }
      if (!session) continue;
      for (const o of elsewhere) await this.endDisplaySession(ctx, o.sessionId, o.deviceId, id);
      await this.repo.setStatus(ctx, id, 'sent_to_customer_display');
      this.log(ctx, 'pos_checkout_sent_to_customer_display', 'pos_customer_display_session', session.sessionId, undefined, undefined, { ticketId: id, deviceId: d.deviceId, switchedFrom: elsewhere.map((o) => o.deviceId) });
      this.displaySessionStarted(ctx, session);
      recordDisplayEvent('session_started');   // Dual-Screen §108
      return session;
    }
    if (busy) { recordDisplayEvent('display_busy'); throw busy; }   // Dual-Screen §108
    throw new ValidationError('The customer display could not be reserved. Continue checkout on the POS.');
  }
  // 23-inch spec §29/§100: the display hears it on ITS OWN channel (an idle display listens there and nowhere else) and
  // takes the right panel over from the ads; the POS checkout screen hears it too (the "Showing … checkout" chip). Ids only.
  private displaySessionStarted(ctx: CheckoutContext, s: POSCustomerDisplaySession): void {
    if (!s?.deviceId) return;
    const payload = { sessionId: s.sessionId, ticketId: s.ticketId || null, deviceId: s.deviceId };
    // §343 exempt: a screen instruction (which ticket a display shows) — the customer_display_sessions row and the audit log are the record
    this.realtime?.toCustomerDisplayDevice?.(s.deviceId, EVENTS.customerDisplaySessionStarted, payload);
    // §343 exempt: the POS checkout screen's display chip — same screen instruction, no business fact
    this.realtime?.toTenant(ctx, EVENTS.customerDisplaySessionStarted, payload);
  }
  async createSession(ctx: CheckoutContext, ticketId: string, deviceId: string): Promise<POSCustomerDisplaySession> { this.need(ctx, 'pos.customer_display.operate'); return this.sendToCustomerDisplay(ctx, ticketId, { deviceId }); }
  async updateSession(ctx: CheckoutContext, sessionId: string, patch: Partial<POSCustomerDisplaySession>): Promise<POSCustomerDisplaySession> {
    this.need(ctx, 'pos.customer_display.operate'); const s = await this.repo.updateSession(ctx, sessionId, patch); if (!s) throw new CustomerDisplayError('DISPLAY_SESSION_NOT_FOUND', 'Session not found');
    // the session row itself changed (tip / state from the POS) — the display showing it refetches (spec §36)
    // §343 exempt: tells one display to refetch — the session row is the record
    this.realtime?.toCustomerDisplay(sessionId, EVENTS.customerDisplayCheckoutUpdated, { sessionId, ticketId: s.ticketId || null });
    return s;
  }
  async closeSession(ctx: CheckoutContext, sessionId: string): Promise<{ closed: boolean }> {
    this.need(ctx, 'pos.customer_display.operate');
    const before = await this.repo.getSession(ctx, sessionId);   // which display to tell (tenant-scoped read)
    if (!before) throw new CustomerDisplayError('DISPLAY_SESSION_NOT_FOUND', 'Session not found');
    await this.endDisplaySession(ctx, sessionId, before.deviceId || null, before.ticketId || null);
    return { closed: true };
  }
  /** spec §82 "Cancel Display Session" (and the old display on a Switch): the display drops the checkout at once and its
   *  right panel returns to the ads. */
  private async endDisplaySession(ctx: CheckoutContext, sessionId: string, deviceId: string | null, ticketId: string | null): Promise<void> {
    const ok = await this.repo.closeSession(ctx, sessionId); if (!ok) throw new CustomerDisplayError('DISPLAY_SESSION_NOT_FOUND', 'Session not found');
    const payload = { sessionId, ticketId, deviceId };
    // §343 exempt: a screen instruction (drop the checkout, back to the ads) — the closed session row is the record
    if (deviceId) this.realtime?.toCustomerDisplayDevice?.(deviceId, EVENTS.customerDisplayCanceled, payload);
    // §343 exempt: the POS checkout screen's display chip
    this.realtime?.toTenant(ctx, EVENTS.customerDisplayCanceled, payload);
  }
}
