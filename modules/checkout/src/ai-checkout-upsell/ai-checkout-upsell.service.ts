// ai-checkout-upsell.service.ts — orchestration for the AI Checkout Upsell Assistant. Read-only recommendation
// generation this stage: derive trusted context, load the authoritative ticket, run the pure recommenders over
// already-scoped/priced records from the injected domain ports, apply fatigue + safety caps, cache (tenant + checkout +
// permission scoped), and audit. It NEVER mutates a cart, computes a final total, or invents a price. Charge-producing
// recommendations freeze once payment begins (§10). Mutations (confirmation-gated) arrive in stage 3.
import {
  recommendAddOns, addOnMinutesAvailable, addOnConflictsWithSchedule, recommendProducts, recommendMembership, recommendLoyaltyEnrollment,
  recommendLoyaltyRedemption, recommendGiftCard, recommendNextAppointment, applyFatigueLimits,
  type RecommendationCard, type AddOnCandidate, type ProductCandidate, type MembershipCandidate,
  type LoyaltyEnrollInput, type LoyaltyRedeemInput, type GiftCardInput, type NextApptInput,
  enforceAddedValueCap, detectRecordChecks, type RecordCheck, type RequestedService,
} from './ai-checkout-upsell-core';
import { resolveSettings, settingSources, PLATFORM_DEFAULTS, effectiveAddedValueCapCents, type UpsellSettingsLayer, type EffectiveUpsellSettings } from './ai-checkout-upsell-settings';
import { UpsellCache, contextFingerprint } from './ai-checkout-upsell.cache';
import { isPaymentStage, type AiCheckoutUpsellContext, type CheckoutTicketView } from './ai-checkout-upsell.dto';
import { runOnce, idempotencyKey, type IdempotencyStore } from './ai-checkout-upsell.idempotency';
import { newRecord } from './ai-checkout-upsell.records';
import { hasPermission } from '@aipowersalon/permissions';
import type { CachePort } from '@aipowersalon/ai';

export class AiCheckoutUpsellForbiddenError extends Error { constructor(m: string) { super(m); this.name = 'AiCheckoutUpsellForbiddenError'; } }

// Coarse capabilities the service gates on (the controller adds granular @RequirePermission on top).
const VIEW = 'pos.checkout.view';

// ---- injected ports (the module wires these to the real domain services; harness fakes them) ----
export interface ServiceAddOnLite { addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean; }
export interface CheckoutReadPort { getTicket(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<CheckoutTicketView | null>; }
export interface AddOnCatalogPort { getAddOns(ctx: AiCheckoutUpsellContext, serviceId: string): Promise<ServiceAddOnLite[]>; }
export interface ProductRecoPort { candidates(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<ProductCandidate[]>; }
export interface MembershipRecoPort { candidates(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<MembershipCandidate[]>; }
export interface LoyaltyRecoPort { state(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<{ enroll: LoyaltyEnrollInput; redeem: LoyaltyRedeemInput }>; }
export interface GiftCardRecoPort { options(ctx: AiCheckoutUpsellContext): Promise<GiftCardInput>; }
export interface NextAppointmentPort { context(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<NextApptInput | null>; }
/** Functional Decision 27: when does this technician's next appointment start (minutes from now, salon time)? null = none today. */
/** Checkout Upsell 09: what the customer asked for on the booking / check-in this ticket came from (read-only). */
export interface RequestedServicesPort { requested(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<RequestedService[]>; }
export interface TechnicianSchedulePort { nextAppointment(ctx: AiCheckoutUpsellContext, technicianId: string): Promise<{ startsInMinutes: number; startTime: string } | null>; }
export interface UpsellSettingsPort {
  layers(ctx: AiCheckoutUpsellContext): Promise<{ tenant?: UpsellSettingsLayer; branch?: UpsellSettingsLayer; device?: UpsellSettingsLayer; user?: UpsellSettingsLayer }>;
  setLayer?(ctx: AiCheckoutUpsellContext, level: 'tenant' | 'branch' | 'device' | 'user', patch: UpsellSettingsLayer, expectedVersion?: number | null): Promise<unknown>;
  /** the stored row for one layer (Checkout Upsell Settings guide: version + what the salon saved, not the resolved value) */
  stored?(ctx: AiCheckoutUpsellContext, level: 'tenant' | 'branch' | 'device' | 'user'): Promise<{ enabled: boolean | null; tunables: Record<string, unknown> | null; version: number; updatedAt: string | null; updatedByUserId: string | null }>;
}

export interface DismissalPort {
  dismissed(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<string[]>;
  record?(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string, reason: string): Promise<void>;
  recordFeedback?(ctx: AiCheckoutUpsellContext, checkoutId: string, recommendationId: string, rating: string, reason: string): Promise<void>;
}

export class DefaultUpsellSettings implements UpsellSettingsPort { async layers() { return {}; } }
export class DefaultDismissals implements DismissalPort { async dismissed() { return []; } async record() {} async recordFeedback() {} }

// ---- mutation ports (stage 3) — each wraps an EXISTING authoritative domain service; never a new cart/pricing path.
export interface AddOnMutationPort { addServiceLine(ctx: AiCheckoutUpsellContext, checkoutId: string, input: { addOnId: string; sourceServiceId: string }): Promise<{ lineId: string }>; }
export interface MembershipMutationPort { enroll(ctx: AiCheckoutUpsellContext, input: { customerId: string; planId: string; checkoutId: string }): Promise<{ membershipId: string }>; }
export interface LoyaltyMutationPort {
  enroll(ctx: AiCheckoutUpsellContext, input: { customerId: string; checkoutId: string }): Promise<{ enrolled: true }>;
  /** requestKey = the upsell's own idempotency key for this redeem, so a retried request reuses the same redemption */
  redeem(ctx: AiCheckoutUpsellContext, input: { customerId: string; rewardId: string; checkoutId: string; requestKey?: string }): Promise<{ redemptionId: string }>;
}
export interface PromotionMutationPort { apply(ctx: AiCheckoutUpsellContext, checkoutId: string, promotionId: string): Promise<{ applied: true }>; }
export interface NextAppointmentMutationPort { openBooking(ctx: AiCheckoutUpsellContext, input: { customerId: string; serviceId: string }): Promise<{ bookingDraftId: string }>; }
export interface RecalcPort { recalculate(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<{ totalCents: number; subtotalCents: number; taxCents: number }>; }

export interface MutationDeps {
  idem: IdempotencyStore;
  addOn: AddOnMutationPort;
  membership: MembershipMutationPort;
  loyalty: LoyaltyMutationPort;
  promotion: PromotionMutationPort;
  booking: NextAppointmentMutationPort;
  recalc: RecalcPort;
}

// Persistence for recommendation records (§44) — populates the analytics table the Super Admin oversight reads. Best-
// effort: a persistence failure never blocks or breaks a recommendation or a mutation.
export interface RecommendationRecordPort {
  persistGenerated(ctx: AiCheckoutUpsellContext, records: import('./ai-checkout-upsell.records').RecommendationRecord[]): Promise<void>;
  markApplied(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string, resultRef: string): Promise<void>;
  markDismissed(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string): Promise<void>;
}

export interface UpsellAuditPort { record(who: { tenantId: string; branchId: string; userId: string; role: string }, ev: { module: string; action: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> }): void | Promise<void>; }

export interface RecommendationsResult {
  enabled: boolean; disabledAtLevel: string | null; frozen: boolean; freezeReason: string | null;
  cards: RecommendationCard[]; generatedAt: string;
  /** Checkout Upsell 09: record discrepancies (requested but not on the ticket) — a separate workflow from `cards`, for a
   *  person to resolve; never priced, never added or charged here. Shown even while payment is in progress. */
  recordChecks?: RecordCheck[];
}

export class AiCheckoutUpsellService {
  private readonly cache: UpsellCache;
  constructor(
    private readonly checkout: CheckoutReadPort,
    private readonly addOns: AddOnCatalogPort,
    private readonly products: ProductRecoPort,
    private readonly memberships: MembershipRecoPort,
    private readonly loyalty: LoyaltyRecoPort,
    private readonly giftCards: GiftCardRecoPort,
    private readonly booking: NextAppointmentPort,
    private readonly settings: UpsellSettingsPort = new DefaultUpsellSettings(),
    private readonly dismissals: DismissalPort = new DefaultDismissals(),
    cache?: CachePort | null,
    private readonly auditSvc?: UpsellAuditPort,
    private readonly mut?: MutationDeps,
    private readonly records?: RecommendationRecordPort,
    private readonly schedule?: TechnicianSchedulePort,
    private readonly requested?: RequestedServicesPort,
  ) { this.cache = new UpsellCache(cache ?? null); }

  /** Decision 27: minutes before any of this ticket's technicians must start their next appointment (null = none / unknown). */
  private async addOnMinutes(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<number | null> {
    if (!this.schedule || !ticket.technicianIds?.length) return null;
    const next = await Promise.all(ticket.technicianIds.map((id) => this.schedule!.nextAppointment(ctx, id).catch(() => null)));
    return addOnMinutesAvailable(next);
  }

  private need(ctx: AiCheckoutUpsellContext, cap: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new AiCheckoutUpsellForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, cap)) throw new AiCheckoutUpsellForbiddenError('Missing ' + cap);
  }
  private audit(ctx: AiCheckoutUpsellContext, action: string, checkoutId: string, meta?: Record<string, unknown>) {
    void this.auditSvc?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'ai_checkout_upsell', action, resourceType: 'pos_checkout_ticket', resourceId: checkoutId, metadata: meta });
  }

  /** Checkout Upsell Settings guide (Nov 2026): fails CLOSED — an unreadable settings table used to resolve to the platform
   *  defaults (enabled, every category on) even for a salon that had switched the assistant off. Now the assistant is off
   *  for that request (`disabledAtLevel: 'settings_unreadable'`) and checkout itself is untouched. */
  private async effectiveSettings(ctx: AiCheckoutUpsellContext): Promise<EffectiveUpsellSettings> {
    let layers: Awaited<ReturnType<UpsellSettingsPort['layers']>>;
    try { layers = await this.settings.layers(ctx); }
    catch (e) {
      this.audit(ctx, 'ai_upsell_settings_unreadable', '-', { error: String((e as Error)?.message ?? e).slice(0, 120) });
      return { enabled: false, disabledAtLevel: 'settings_unreadable', tunables: { ...PLATFORM_DEFAULTS } };
    }
    return resolveSettings({ platform: PLATFORM_DEFAULTS, ...layers });
  }

  /** Load the ticket and enforce tenant + branch ownership (§5). The port scopes by tenant; we additionally require the
   *  ticket's branch to match the caller's branch so a user cannot pull another branch's ticket. */
  private async loadTicket(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<CheckoutTicketView> {
    const t = await this.checkout.getTicket(ctx, checkoutId);
    if (!t) throw new Error('CHECKOUT_NOT_FOUND');
    if (t.branchId !== ctx.branchId) throw new Error('BRANCH_NOT_AUTHORIZED');
    return t;
  }

  /** Checkout Upsell 09: requested-but-not-on-ticket services. A failed read is reported as "unknown" (undefined), never
   *  as "nothing missing". */
  private async recordChecks(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<RecordCheck[] | undefined> {
    if (!this.requested) return undefined;
    let req: RequestedService[];
    try { req = await this.requested.requested(ctx, ticket.checkoutId); }
    catch (e) { this.audit(ctx, 'ai_upsell_record_check_unreadable', ticket.checkoutId, { error: String((e as Error)?.message ?? e).slice(0, 120) }); return undefined; }
    return detectRecordChecks(req, { serviceIds: [...ticket.serviceLines.map((l) => l.serviceId), ...ticket.cartAddOnIds], serviceNames: ticket.serviceLines.map((l) => l.serviceName) });
  }

  async recommendations(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<RecommendationsResult> {
    this.need(ctx, VIEW);
    const now = () => new Date().toISOString();
    const st = await this.effectiveSettings(ctx);
    if (!st.enabled) { this.audit(ctx, 'ai_upsell_disabled_blocked', checkoutId, { level: st.disabledAtLevel }); return { enabled: false, disabledAtLevel: st.disabledAtLevel, frozen: false, freezeReason: null, cards: [], generatedAt: now() }; }

    const ticket = await this.loadTicket(ctx, checkoutId);
    if (isPaymentStage(ticket.status)) { // §10 — never modify the cart during payment
      this.audit(ctx, 'ai_upsell_frozen_payment_stage', checkoutId, { status: ticket.status });
      return { enabled: true, disabledAtLevel: null, frozen: true, freezeReason: 'PAYMENT_IN_PROGRESS', cards: [], generatedAt: now(), recordChecks: await this.recordChecks(ctx, ticket) };
    }
    const recordChecks = await this.recordChecks(ctx, ticket);
    const underRecordCheck = new Set((recordChecks ?? []).map((r) => r.serviceId).filter((x): x is string => !!x));

    const t = st.tunables;
    const cx = contextFingerprint({ serviceIds: ticket.serviceLines.map(s => s.serviceId), addOnIds: ticket.cartAddOnIds, subtotalCents: ticket.subtotalCents, customerId: ticket.customerId });
    const cached = await this.cache.get<RecommendationsResult>(ctx, checkoutId, 'recommendations', cx);
    if (cached) return cached;

    const cards: RecommendationCard[] = [];

    // add-ons — approved compatibility per completed/in-cart service (§11/§12)
    if (t.addOnsEnabled) {
      const candidates: AddOnCandidate[] = [];
      for (const line of ticket.serviceLines) {
        const a = await this.addOns.getAddOns(ctx, line.serviceId).catch(() => [] as ServiceAddOnLite[]);
        for (const ao of a) if (!underRecordCheck.has(ao.addOnId)) candidates.push({ ...ao, sourceServiceId: line.serviceId, sourceServiceName: line.serviceName });   // Checkout Upsell 09: never sell a record gap
      }
      const availableMinutes = await this.addOnMinutes(ctx, ticket);   // Decision 27: never run into the next appointment
      cards.push(...recommendAddOns({ candidates, cartAddOnIds: ticket.cartAddOnIds, sameVisitFeasible: t.allowAfterServiceDone, maxAddOns: t.maxAddOn, ticketSubtotalCents: ticket.subtotalCents, maxPriceCents: effectiveAddedValueCapCents(t, ticket.subtotalCents), availableMinutes }));
    }
    if (t.productsEnabled) cards.push(...recommendProducts({ candidates: await this.products.candidates(ctx, ticket).catch(() => []), max: t.maxProduct }));
    if (t.membershipEnabled) cards.push(...recommendMembership({ candidates: await this.memberships.candidates(ctx, ticket).catch(() => []), max: t.maxMembership }));
    const loy = await this.loyalty.state(ctx, ticket).catch(() => null);
    if (loy) {
      if (t.loyaltyEnrollEnabled) { const c = recommendLoyaltyEnrollment(loy.enroll); if (c) cards.push(c); }
      if (t.loyaltyRedeemEnabled) { const c = recommendLoyaltyRedemption(loy.redeem); if (c) cards.push(c); }
    }
    if (t.giftCardEnabled) { const c = recommendGiftCard(await this.giftCards.options(ctx).catch(() => ({ enabled: false, allowedAmountsCents: [] }))); if (c) cards.push(c); }
    if (t.rebookingEnabled) { const nx = await this.booking.context(ctx, ticket).catch(() => null); if (nx) { const c = recommendNextAppointment(nx); if (c) cards.push(c); } }

    const dismissed = await this.dismissals.dismissed(ctx, checkoutId).catch(() => []);
    let ranked = applyFatigueLimits(cards, { maxTotal: t.maxTotal, maxProduct: t.maxProduct, maxAddOn: t.maxAddOn, maxMembership: t.maxMembership }, dismissed);
    ranked = enforceAddedValueCap(ranked, effectiveAddedValueCapCents(t, ticket.subtotalCents)); // Functional Decision 27: ≤ min($30, 30% of booked services) by default

    const result: RecommendationsResult = { enabled: true, disabledAtLevel: null, frozen: false, freezeReason: null, cards: ranked, generatedAt: now(), recordChecks };
    await this.cache.set(ctx, checkoutId, 'recommendations', cx, result);
    if (this.records && ranked.length) {
      const nowIso = new Date().toISOString();
      const recs = ranked.map(card => newRecord({ recommendationId: `${checkoutId}:${card.type}:${card.targetId}:${cx}`, tenantId: ctx.tenantId, branchId: ctx.branchId, checkoutId, customerId: ticket.customerId, card, contextFingerprint: cx, nowIso }));
      void this.records.persistGenerated(ctx, recs).catch(() => {}); // best-effort analytics; never blocks
    }
    this.audit(ctx, 'ai_upsell_recommendations_generated', checkoutId, { count: ranked.length });
    return result;
  }

  /** Drop trailing charge-producing cards once the cumulative recommended added value would exceed the safety ceiling. */
  /** Read-only checkout context for the panel (§42 get_checkout_context). */
  async context(ctx: AiCheckoutUpsellContext, checkoutId: string) {
    this.need(ctx, VIEW);
    const st = await this.effectiveSettings(ctx);
    const ticket = await this.loadTicket(ctx, checkoutId);
    return {
      checkoutId, branchId: ticket.branchId, customerId: ticket.customerId, status: ticket.status,
      paymentStage: isPaymentStage(ticket.status), enabled: st.enabled, disabledAtLevel: st.disabledAtLevel,
      serviceLines: ticket.serviceLines, subtotalCents: ticket.subtotalCents,
    };
  }

  /** dismiss (§52) — record a dismissal (tenant/branch/user scoped) and invalidate so it won't resurface this checkout. */
  async dismiss(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string, reason: string) {
    this.need(ctx, VIEW);
    await this.dismissals.record?.(ctx, checkoutId, targetId, String(reason || '').slice(0, 64)).catch(() => {});
    void this.records?.markDismissed(ctx, checkoutId, targetId).catch(() => {});
    await this.cache.invalidateTenant(ctx.tenantId);
    this.audit(ctx, 'ai_upsell_recommendation_dismissed', checkoutId, { targetId, reason });
    return { dismissed: true };
  }

  private static FEEDBACK = new Set(['helpful', 'not_helpful', 'wrong_product', 'wrong_service', 'wrong_membership', 'wrong_timing', 'wrong_customer', 'outdated_price', 'out_of_stock', 'not_interested', 'too_many', 'unsafe']);
  /** record_recommendation_feedback (§53) — version-aware, tenant/branch/user attributed. Never rewrites rules directly. */
  async recordFeedback(ctx: AiCheckoutUpsellContext, checkoutId: string, recommendationId: string, rating: string, reason = '') {
    this.need(ctx, VIEW);
    if (!AiCheckoutUpsellService.FEEDBACK.has(rating)) throw new Error('INVALID_FEEDBACK');
    await this.dismissals.recordFeedback?.(ctx, checkoutId, recommendationId, rating, String(reason || '').slice(0, 200)).catch(() => {});
    this.audit(ctx, 'ai_upsell_recommendation_feedback', checkoutId, { recommendationId, rating });
    return { recorded: true };
  }

  /** get_settings (§70) — effective settings for this scope. */
  async getEffectiveSettings(ctx: AiCheckoutUpsellContext) {
    this.need(ctx, VIEW);
    // the settings PAGE must not show defaults it could not read — a read failure is an error there (503), not "Enabled"
    const layers = await this.settings.layers(ctx);
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...layers });
    const stored = this.settings.stored ? await this.settings.stored(ctx, 'tenant') : null;
    return { ...eff, sources: settingSources(layers), salon: stored, platformDefaults: PLATFORM_DEFAULTS };
  }

  /** update_settings (§70/§88) — persist a per-scope override / kill switch. Manage-gated (settings.edit); requires the
   *  DB-backed settings port. Invalidates so a changed cap/toggle/disable takes effect immediately. */
  async updateSettings(ctx: AiCheckoutUpsellContext, level: 'tenant' | 'branch' | 'device' | 'user', patch: UpsellSettingsLayer, expectedVersion?: number | null) {
    this.need(ctx, 'settings.edit');
    if (!this.settings.setLayer) throw new Error('SETTINGS_NOT_PERSISTED');
    if (level === 'branch' && !ctx.branchId) throw new Error('BRANCH_NOT_AUTHORIZED');
    await this.settings.setLayer(ctx, level, patch, expectedVersion ?? null);
    await this.cache.invalidateTenant(ctx.tenantId);
    this.audit(ctx, 'ai_upsell_settings_updated', '-', { level, enabled: patch.enabled, keys: Object.keys(patch.tunables ?? {}) });
    return this.getEffectiveSettings(ctx);
  }

  // ============================ CONFIRMATION-GATED MUTATIONS (stage 3) ============================ (controller adds granular @RequirePermission(pos.ai_checkout_upsell.*), mapped in security-core).
  private static CAP = {
    addon: 'pos.checkout.reopen_service', membership: 'pos.memberships.enroll',
    loyalty_redeem: 'pos.loyalty.redeem', loyalty_enroll: 'pos.loyalty.enroll',
    promotion: 'pos.deals.apply' /* Phase 5: the front-desk deals key, same as the cashier's */, booking: 'pos.booking.create',
  } as const;

  private requireMut(): MutationDeps { if (!this.mut) throw new Error('INTERNAL_ERROR'); return this.mut; }
  private requireConfirm(confirm: unknown) { if (confirm !== true) throw new Error('HUMAN_CONFIRMATION_REQUIRED'); }
  private async editableTicket(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<CheckoutTicketView> {
    const t = await this.loadTicket(ctx, checkoutId);
    if (isPaymentStage(t.status)) throw new Error('CHECKOUT_NOT_EDITABLE'); // never mutate during payment (§10)
    return t;
  }
  private idem(ctx: AiCheckoutUpsellContext, checkoutId: string, operation: string, targetId: string, clientKey: string) {
    return idempotencyKey({ tenantId: ctx.tenantId, branchId: ctx.branchId, checkoutId, operation, targetId, clientKey: clientKey || 'none' });
  }
  private afterMutation(ctx: AiCheckoutUpsellContext, action: string, checkoutId: string, targetId: string, resultRef: string, meta: Record<string, unknown>) {
    void this.cache.invalidateTenant(ctx.tenantId); // recommendations are now stale against the changed cart (§45)
    void this.records?.markApplied(ctx, checkoutId, targetId, resultRef).catch(() => {}); // outcome analytics (§44)
    this.audit(ctx, action, checkoutId, meta);
  }

  /** add_service_addon (§27) — revalidate compatibility + no-duplicate, delegate to the authoritative add-line service. */
  async addServiceAddon(ctx: AiCheckoutUpsellContext, checkoutId: string, addOnId: string, opts: { confirm?: boolean; idempotencyKey?: string }) {
    this.need(ctx, AiCheckoutUpsellService.CAP.addon);
    this.requireConfirm(opts.confirm);
    const mut = this.requireMut();
    const ticket = await this.editableTicket(ctx, checkoutId);
    if (ticket.cartAddOnIds.includes(addOnId)) throw new Error('DUPLICATE_CART_ACTION'); // idempotent line-level guard (§47)
    // revalidate the add-on is approved + active for a service ON THIS ticket (never trust a model-supplied add-on)
    let sourceServiceId = ''; let found = false; let addedMinutes = 0;
    for (const line of ticket.serviceLines) {
      const list = await this.addOns.getAddOns(ctx, line.serviceId).catch(() => []);
      const hit = list.find(a => a.addOnId === addOnId && a.isActive);
      if (hit) { sourceServiceId = line.serviceId; found = true; addedMinutes = hit.durationDeltaMinutes; break; }
    }
    if (!found) throw new Error('SERVICE_ADDON_INCOMPATIBLE');
    // Decision 27: re-checked here, not only when suggesting — a screen left open must not book the add-on into the next customer.
    if (addOnConflictsWithSchedule(addedMinutes, await this.addOnMinutes(ctx, ticket))) { this.audit(ctx, 'ai_upsell_addon_schedule_conflict', checkoutId, { addOnId, addedMinutes }); throw new Error('ADDON_SCHEDULE_CONFLICT'); }
    const result = await runOnce(mut.idem, this.idem(ctx, checkoutId, 'add_addon', addOnId, opts.idempotencyKey || ''), { addOnId, sourceServiceId }, async () => {
      const line = await mut.addOn.addServiceLine(ctx, checkoutId, { addOnId, sourceServiceId }); // domain service prices it — no model price
      const totals = await mut.recalc.recalculate(ctx, checkoutId);                                // authoritative totals (§30/§50)
      return { lineId: line.lineId, totals };
    });
    this.afterMutation(ctx, 'ai_upsell_addon_added', checkoutId, addOnId, String(result.lineId || ''), { addOnId, lineId: result.lineId });
    return { added: true, ...result };
  }

  /** enroll_membership (§16) — revalidate eligibility + not-already-active, delegate to MembershipsService. Recurring. */
  async enrollMembership(ctx: AiCheckoutUpsellContext, checkoutId: string, planId: string, opts: { confirm?: boolean; idempotencyKey?: string }) {
    this.need(ctx, AiCheckoutUpsellService.CAP.membership);
    this.requireConfirm(opts.confirm);
    const mut = this.requireMut();
    const ticket = await this.editableTicket(ctx, checkoutId);
    if (!ticket.customerId) throw new Error('CUSTOMER_NOT_FOUND');
    const cands = await this.memberships.candidates(ctx, ticket).catch(() => []);
    const plan = cands.find(c => c.planId === planId);
    if (!plan) throw new Error('MEMBERSHIP_NOT_ELIGIBLE');
    if (plan.customerAlreadyHasActive) throw new Error('MEMBERSHIP_ALREADY_ACTIVE');
    if (!plan.eligibleToday) throw new Error('MEMBERSHIP_NOT_ELIGIBLE');
    const result = await runOnce(mut.idem, this.idem(ctx, checkoutId, 'enroll_membership', planId, opts.idempotencyKey || ''), { planId, customerId: ticket.customerId }, async () => {
      const m = await mut.membership.enroll(ctx, { customerId: ticket.customerId!, planId, checkoutId });
      const totals = await mut.recalc.recalculate(ctx, checkoutId);
      return { membershipId: m.membershipId, totals };
    });
    this.afterMutation(ctx, 'ai_upsell_membership_enrolled', checkoutId, planId, String(result.membershipId || ''), { planId, membershipId: result.membershipId });
    return { enrolled: true, ...result };
  }

  /** redeem_loyalty (§18) — revalidate live balance + reward, delegate to LoyaltyService. Never invents points. */
  async redeemLoyalty(ctx: AiCheckoutUpsellContext, checkoutId: string, rewardId: string, opts: { confirm?: boolean; idempotencyKey?: string }) {
    this.need(ctx, AiCheckoutUpsellService.CAP.loyalty_redeem);
    this.requireConfirm(opts.confirm);
    const mut = this.requireMut();
    const ticket = await this.editableTicket(ctx, checkoutId);
    if (!ticket.customerId) throw new Error('CUSTOMER_NOT_FOUND');
    const loy = await this.loyalty.state(ctx, ticket);
    if (!loy.redeem.enrolled) throw new Error('LOYALTY_NOT_ELIGIBLE');
    const reward = loy.redeem.rewards.find(r => r.rewardId === rewardId);
    if (!reward) throw new Error('LOYALTY_NOT_ELIGIBLE');
    if (reward.pointsCost > loy.redeem.balancePoints) throw new Error('LOYALTY_BALANCE_INSUFFICIENT'); // revalidate against authoritative balance
    const key = this.idem(ctx, checkoutId, 'redeem_loyalty', rewardId, opts.idempotencyKey || '');
    const result = await runOnce(mut.idem, key, { rewardId, customerId: ticket.customerId }, async () => {
      const red = await mut.loyalty.redeem(ctx, { customerId: ticket.customerId!, rewardId, checkoutId, requestKey: key });
      const totals = await mut.recalc.recalculate(ctx, checkoutId);
      return { redemptionId: red.redemptionId, totals };
    });
    this.afterMutation(ctx, 'ai_upsell_loyalty_redeemed', checkoutId, rewardId, String(result.redemptionId || ''), { rewardId, redemptionId: result.redemptionId });
    return { redeemed: true, ...result };
  }

  /** apply_promotion (§29) — delegate to CheckoutService.applyPromotion. AI only surfaces approved promotions. */
  async applyPromotion(ctx: AiCheckoutUpsellContext, checkoutId: string, promotionId: string, opts: { confirm?: boolean; idempotencyKey?: string }) {
    this.need(ctx, AiCheckoutUpsellService.CAP.promotion);
    this.requireConfirm(opts.confirm);
    const mut = this.requireMut();
    await this.editableTicket(ctx, checkoutId);
    const result = await runOnce(mut.idem, this.idem(ctx, checkoutId, 'apply_promo', promotionId, opts.idempotencyKey || ''), { promotionId }, async () => {
      await mut.promotion.apply(ctx, checkoutId, promotionId);
      const totals = await mut.recalc.recalculate(ctx, checkoutId);
      return { totals };
    });
    this.afterMutation(ctx, 'ai_upsell_promotion_applied', checkoutId, promotionId, '', { promotionId });
    return { applied: true, ...result };
  }

  /** open_next_appointment (§21) — SEPARATE from the cart. Opens the AI Booking flow; never touches checkout totals. */
  async openNextAppointment(ctx: AiCheckoutUpsellContext, checkoutId: string, serviceId: string, opts: { confirm?: boolean; idempotencyKey?: string }) {
    this.need(ctx, AiCheckoutUpsellService.CAP.booking);
    this.requireConfirm(opts.confirm);
    const mut = this.requireMut();
    const ticket = await this.loadTicket(ctx, checkoutId); // booking allowed even at payment stage — it's not a cart change
    if (!ticket.customerId) throw new Error('CUSTOMER_NOT_FOUND');
    const result = await runOnce(mut.idem, this.idem(ctx, checkoutId, 'open_booking', serviceId, opts.idempotencyKey || ''), { serviceId, customerId: ticket.customerId }, async () => {
      return mut.booking.openBooking(ctx, { customerId: ticket.customerId!, serviceId }); // AI Booking owns availability/conflict/duplicate/creation
    });
    this.audit(ctx, 'ai_upsell_next_appointment_opened', checkoutId, { serviceId, bookingDraftId: result.bookingDraftId });
    return { opened: true, ...result };
  }
}
