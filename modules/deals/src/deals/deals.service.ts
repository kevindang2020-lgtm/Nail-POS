// deals.service.ts — the deals domain service: creating and managing deals (salon + technician, deals, coupons, automatic
// promotions, announcements), the backend enforcement of the salon's technician-deal policy and of every deal term, the
// status machine, book-a-deal reservations, the customer marketplace and Super Admin oversight. All money is integer
// cents; nothing here trusts a client-supplied price.
//
// BUILD_PLAN Phase 5 (deals_engine) — what changed here:
//   bug 1  reservations count every place taken (held, booked, redeemed) — engine/deals-ledger.kysely.ts
//   bug 4  a booked deal at checkout is APPLIED (redeemed only when the ticket is paid; reversed on void/refund)
//   bug 5  eligibility (new/existing customers, members, per customer, minimum spend, days, hours, lead time, services,
//          channels, rules) is judged at reservation — engine/eligibility.ts — with every reason
//   bug 6  the date window (and the appointment's own date) is enforced; the lifecycle job activates and expires deals
//   bug 7  the branch and the services must be this salon's
//   bug 8  the original price comes from the catalog
//  bug 17  Super Admin suspend needs a reason, is audited, and stops booked deals too
//  bug 18  an auto-approved technician deal goes live
//  bug 21  bad input is a 400 (validateDealInput), never a database error
import type { DealsRepositoryPort } from './deals.repository';
import type { DealContext, CreateDealInput, DealView, DealSettingsView, ReservationFacts } from './deals.dto';
import {
  computeFinalPriceCents, nextStatus, initialStatus, validateTechDealAgainstSettings, validateDealInput, publishTarget,
  type DealAction, type DealStatus, type DealSettings,
} from './deals.core';
import { buildNearbyFeed, clampRadius, type NearbyDealCard, type NearbySort } from './deals-nearby-core';
import { HOLD_TTL_MS } from './deals-redemption-core';
import { evaluateEligibility, validateRules, zonedEpoch, type Channel, type EligibilityResult } from '../engine/eligibility';
import { priceTicket, ruleDiscount, type OfferRequest, type PricingResult } from '../engine/pricing';
import { dealRule, termsSnapshot, LedgerRefusal, type DealRecord } from '../engine/deals-ledger.kysely';
import { hashCode, codeHint, validateSharedCode, walletQrPayload, generateCodes, normalizeCode, MAX_BATCH } from '../engine/coupons';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class DealForbiddenError extends Error { constructor(m?: string) { super(m); this.name = 'DealForbiddenError'; } }
export class DealValidationError extends Error { constructor(m?: string) { super(m); this.name = 'DealValidationError'; } }
export class DealConflictError extends Error { constructor(m?: string) { super(m); this.name = 'DealConflictError'; } }

const APPROVE_STATES: DealStatus[] = ['pending_approval'];
/** the engine note that turns a refusal into "changes requested" (see useApprovals → onReject) */
export const CHANGES_MARK = 'Changes requested: ';
/** Reasons that mean "not now / not any more" (409) rather than "not for you / not like this" (400). */
const CONFLICT_REASONS = new Set(['engine_off', 'tenant_disabled', 'suspended', 'not_active', 'not_started', 'ended', 'sold_out', 'budget_exhausted', 'per_customer_limit', 'tech_frozen']);
const EDITABLE_LIVE = new Set(['title', 'shortDescription', 'terms', 'imageUrl', 'endsAt', 'maxRedemptions', 'budgetCents', 'priority']);

/** BUILD_PLAN Phase 9: the salon approvals engine as deals sees it (string token 'TENANT_APPROVALS', @Optional — structural,
 *  so deals neither imports nor depends on the workforce module). */
export const DEAL_APPROVALS_TOKEN = 'TENANT_APPROVALS';
type ApprovalActorLike = { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] };
export interface DealApprovalsPort {
  registerExecutor(kind: 'deal_publish', executor: {
    prepare?(actor: ApprovalActorLike, input: { subjectType: string; subjectId: string | null; reason: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>>;
    execute(actor: ApprovalActorLike, request: { id: string; subjectId: string | null; decisionNote?: string | null }): Promise<Record<string, unknown> | void>;
    onReject?(actor: ApprovalActorLike, request: { id: string; subjectId: string | null }, note: string | null): Promise<void>;
  }): void;
  request(actor: ApprovalActorLike, body: unknown): Promise<{ request: { id: string }; created: boolean }>;
  liveFor(actor: ApprovalActorLike, kind: 'deal_publish', subjectType: string, subjectId: string): Promise<{ id: string; version: number; status: string } | null>;
  decide(actor: ApprovalActorLike, id: string, body: unknown): Promise<{ status: string; payload?: Record<string, unknown> }>;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const approvalActor = (ctx: DealContext): ApprovalActorLike => ({ tenantId: ctx.tenantId, branchId: ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : null, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions ?? [] });
const dealCtx = (a: ApprovalActorLike): DealContext => ({ tenantId: a.tenantId, branchId: a.branchId ?? '', userId: a.userId, role: a.role, permissions: [...a.permissions], technicianId: null });
/** An engine refusal (ApprovalError: code + HTTP status) in the deals vocabulary. */
function dealErrorOf(e: any): Error {
  const st = Number(e?.status);
  if (st === 403 || st === 404) return new DealForbiddenError(String(e?.message ?? 'Not allowed.'));
  if (st === 400) return new DealValidationError(String(e?.message ?? 'Invalid.'));
  if (st === 409) return new DealConflictError(String(e?.message ?? 'Conflict.'));
  return e;
}

export class DealsService {
  constructor(private readonly repo: DealsRepositoryPort, private readonly now: () => number = Date.now) {}

  // ── BUILD_PLAN Phase 9: deal approvals on the salon's ONE approvals engine ──────────────────────────────────────────
  // A deal entering pending_approval files a deal_publish request; the approve / reject routes (POS and Owner App) decide
  // THROUGH it when one is live, so the engine's policy applies (approver key marketing.manage, separation of duties when
  // the salon turns it on, the approver limit) and the decision is on the one Approvals screen. A deal that went pending
  // before the engine existed (no live request) is decided directly, as before. Without the engine: unchanged.
  private approvals: DealApprovalsPort | null = null;
  useApprovals(port: DealApprovalsPort | null | undefined): this {
    this.approvals = port ?? null;
    port?.registerExecutor('deal_publish', {
      prepare: async (actor, input) => {
        if (input.subjectType !== 'deal' || !input.subjectId) throw new DealValidationError('A deal approval names the deal.');
        const d = await this.repo.getDeal(dealCtx(actor), input.subjectId);
        if (!d) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
        if (d.status !== 'pending_approval') throw withCode(new DealConflictError(`This deal is not waiting for approval (it is ${d.status}).`), 'DEAL_NOT_PENDING');
        return { title: `Deal: ${d.title}`.slice(0, 140), branchId: d.branchId ?? null, payload: { dealId: d.id, title: d.title, ownerType: d.ownerType, technicianId: d.technicianId ?? null, finalPriceCents: d.finalPriceCents, dealVersion: d.version } };
      },
      execute: async (actor, request) => { const v = await this.approveDirect(dealCtx(actor), String(request.subjectId), request.decisionNote ?? null); return { dealId: v.id, status: v.status }; },
      onReject: async (actor, request, note) => {
        // Deals & Offers guide §9 "Request Changes": decided through the engine as a refusal with this marker, so the
        // salon's one Approvals screen closes the request — but the deal goes back to its technician as a draft, not rejected
        if (note && note.startsWith(CHANGES_MARK)) { await this.requestChangesDirect(dealCtx(actor), String(request.subjectId), note.slice(CHANGES_MARK.length)); return; }
        await this.rejectDirect(dealCtx(actor), String(request.subjectId), note || 'Not approved.');
      },
    });
    return this;
  }
  /** File the request for a deal that just went to pending_approval. Best-effort: a refusal (e.g. the salon switched deal
   *  approvals off) leaves the deal pending, decided directly as before. */
  private async fileDealApproval(ctx: DealContext, d: DealView): Promise<void> {
    if (!this.approvals || d.status !== 'pending_approval') return;
    try { await this.approvals.request(approvalActor(ctx), { kind: 'deal_publish', subjectType: 'deal', subjectId: d.id, reason: d.ownerType === 'technician' ? 'Technician deal submitted for approval' : 'Deal submitted for approval' }); }
    catch { /* deal stays pending; the direct path decides it */ }
  }

  private get ledger() { return this.repo.ledger; }

  // Constitution 7 §34 — the platform Deals engine kill switch. Read at most every 30 s (the public feed is hot); a failed
  // read keeps the last value. Off: the public feed is empty, new reservations are refused, and checkout does not apply
  // deals (non-fatal: the sale continues at full price, as with any other unredeemable deal).
  private engine: { at: number; off: boolean } | null = null;
  async engineOff(): Promise<boolean> {
    if (!this.repo.dealsEngineDisabled) return false;
    if (this.engine && this.now() - this.engine.at < 30_000) return this.engine.off;
    try { this.engine = { at: this.now(), off: await this.repo.dealsEngineDisabled() }; } catch { if (!this.engine) this.engine = { at: this.now(), off: false }; }
    return this.engine.off;
  }

  // Authentication only. RBAC is enforced by the controllers' @RequirePermission guards; this service enforces the
  // BUSINESS rules on the backend: the salon's technician-deal limits, ownership, the deal's terms and the status machine.
  private auth(ctx: DealContext) { if (!ctx?.userId || !ctx?.tenantId) throw new DealForbiddenError('Not authenticated.'); }

  async getSettings(ctx: DealContext): Promise<DealSettingsView> { this.auth(ctx); return (await this.tenantGate(ctx)).settings; }

  async updateSettings(ctx: DealContext, patch: Partial<DealSettings>): Promise<DealSettingsView> {
    this.auth(ctx);
    const p: any = { ...(patch || {}) };
    for (const k of ['platformDisabled', 'platformDisabledReason', 'platformMaxActiveDeals']) delete p[k];   // the platform's, not the salon's
    if (p.stackingPolicy !== undefined && !['best_single', 'stack_all', 'stack_groups', 'exclusive'].includes(p.stackingPolicy)) throw new DealValidationError('Unknown stacking policy.');
    if (p.priceFloorPercent !== undefined && !(Number.isInteger(p.priceFloorPercent) && p.priceFloorPercent >= 0 && p.priceFloorPercent <= 100)) throw withCode(new DealValidationError('The price floor is a whole percentage from 0 to 100.'), 'DEAL_PRICE_FLOOR_INVALID');
    if (p.maxTotalDiscountPercent !== undefined && p.maxTotalDiscountPercent !== null && !(Number.isInteger(p.maxTotalDiscountPercent) && p.maxTotalDiscountPercent >= 1 && p.maxTotalDiscountPercent <= 100)) throw withCode(new DealValidationError('The maximum total discount is a whole percentage from 1 to 100.'), 'DEAL_MAX_DISCOUNT_INVALID');
    if (p.allowTechnicianDeals !== undefined && !['off', 'on_with_approval', 'on_auto'].includes(p.allowTechnicianDeals)) throw new DealValidationError('Unknown technician-deal policy.');
    for (const k of ['maxDiscountPercent', 'maxFixedDiscountCents', 'minServicePriceCents', 'maxActiveDealsPerTech', 'maxRedemptionsCap', 'maxCampaignDurationDays']) {
      if (p[k] !== undefined && p[k] !== null && !(Number.isInteger(p[k]) && p[k] >= 0)) throw withCode(new DealValidationError(`${k} must be a whole number.`), 'WHOLE_NUMBER_REQUIRED');
    }
    return this.repo.upsertSettings(ctx, p);
  }

  /** Is the salon allowed to run deals right now (its own switch, the platform's)? */
  private async tenantGate(ctx: DealContext): Promise<{ disabled: boolean; reason: string | null; settings: DealSettings }> {
    const s = await this.repo.getSettings(ctx);
    const plan = this.repo.planGate ? await this.repo.planGate(ctx).catch(() => ({ featureState: null, maxActiveDeals: null })) : { featureState: null, maxActiveDeals: null };
    // the tightest live-deal limit wins: the platform's per-salon limit or the plan's
    const limits = [s.platformMaxActiveDeals, plan.maxActiveDeals].filter((x): x is number => x != null);
    const settings: DealSettings = { ...s, platformMaxActiveDeals: limits.length ? Math.min(...limits) : null };
    if (s.platformDisabled) return { disabled: true, reason: s.platformDisabledReason || 'Deals are switched off for this salon by the platform.', settings: { ...settings, platformDisabled: true } };
    if (plan.featureState === 'unavailable') return { disabled: true, reason: 'Deals are not part of this salon’s plan.', settings: { ...settings, platformDisabled: true, platformDisabledReason: 'Deals are not part of this salon’s plan.' } };
    if (s.dealsEnabled === false) return { disabled: true, reason: 'Deals are switched off in this salon’s settings.', settings };
    return { disabled: false, reason: null, settings };
  }
  /** The salon's settings with the platform's and the plan's limits folded in (what the POS settings screen shows). */
  async effectiveSettings(ctx: DealContext): Promise<DealSettingsView> { this.auth(ctx); return (await this.tenantGate(ctx)).settings; }

  // ── creating and editing ───────────────────────────────────────────────────────────────────────────────────────
  async createDeal(ctx: DealContext, input: CreateDealInput): Promise<DealView> {
    this.auth(ctx);
    const kind = input.kind ?? 'deal';
    const problems = validateDealInput({ ...input, kind });
    if (input.rules != null) problems.push(...validateRules(input.rules));
    if (kind === 'coupon' && input.code != null) { const c = validateSharedCode(input.code); if (c) problems.push(c); }
    if (problems.length) throw new DealValidationError(problems.join(' '));
    const gate = await this.tenantGate(ctx);
    if (gate.settings.platformDisabled) throw new DealConflictError(gate.reason!);
    const serviceIds = [...new Set((input.serviceIds ?? []).filter(Boolean))];
    const branchId = input.branchId || null;
    // bugs 7 + 8: the branch and services are THIS salon's, and the price is the catalog's
    let original: number | null = null;
    if (this.repo.catalogFor) {
      const cat = await this.repo.catalogFor(ctx, branchId, serviceIds);
      if (!cat.branchOk) throw withCode(new DealValidationError('That location is not part of this salon.'), 'BRANCH_NOT_FOUND');
      const known = new Set(cat.services.map((s) => s.id));
      const unknown = serviceIds.filter((id) => !known.has(id));
      if (unknown.length) throw withCode(new DealValidationError('One or more services are not part of this salon’s menu.'), 'SERVICES_NOT_ON_MENU');
      if (branchId && cat.services.some((s) => s.branchId !== branchId)) throw withCode(new DealValidationError('One or more services are not offered at that location.'), 'SERVICES_NOT_AT_LOCATION');
      original = serviceIds.length ? cat.services.reduce((n, s) => n + s.priceCents, 0) : null;
    } else {
      original = input.originalPriceCents ?? null;   // in-memory (dev/offline) port: no catalog to read
    }
    const finalCents = original == null ? 0 : computeFinalPriceCents(original, input.discountType, input.discountPercent, input.discountCents);
    const base: CreateDealInput = { ...input, kind, branchId, serviceIds, originalPriceCents: original, requiresCode: kind === 'coupon' ? true : !!input.requiresCode };
    if (this.repo.countLiveDeals && gate.settings.platformMaxActiveDeals != null && (await this.repo.countLiveDeals(ctx)) >= gate.settings.platformMaxActiveDeals) {
      // plan limit: drafting is fine, going live is not — checked again at publish
      if (input.ownerType === 'technician' && gate.settings.allowTechnicianDeals === 'on_auto') throw withCode(new DealConflictError(`Your plan allows ${gate.settings.platformMaxActiveDeals} live deals.`), 'DEAL_PLAN_LIMIT', { max: gate.settings.platformMaxActiveDeals });
    }

    let view: DealView;
    if (input.ownerType === 'technician') {
      const technicianId = input.technicianId || ctx.technicianId || null;
      if (!technicianId) throw withCode(new DealValidationError('A technician deal must be tied to a technician.'), 'DEAL_TECHNICIAN_REQUIRED');
      if (ctx.technicianId && technicianId !== ctx.technicianId) throw new DealForbiddenError('You can only create deals for yourself.');
      if (await this.repo.techDealsFrozen(ctx.tenantId, technicianId)) throw new DealForbiddenError('Your deals are currently frozen by platform administration.');
      const settings = gate.settings;
      const activeCount = await this.repo.countActiveDealsForTech(ctx, technicianId);
      const violations = validateTechDealAgainstSettings(
        { discountType: input.discountType, discountPercent: input.discountPercent, discountCents: input.discountCents,
          originalPriceCents: original, startsAt: input.startsAt, endsAt: input.endsAt,
          maxRedemptions: input.maxRedemptions, newCustomersOnly: input.newCustomersOnly, activeDealCountForTech: activeCount },
        settings,
      );
      if (violations.length) throw withCode(new DealValidationError(violations.join(' ')), settings.allowTechnicianDeals === 'off' ? 'TECH_DEALS_OFF' : 'TECH_DEAL_OVER_POLICY');   // never silently capped
      let status = initialStatus('technician', settings.allowTechnicianDeals);
      if (status === 'active') status = publishTarget(input.startsAt, this.now());
      view = await this.repo.insertDeal(ctx, { ...base, technicianId, kind: 'deal' }, status, finalCents);
      await this.fileDealApproval(ctx, view);   // on_with_approval: straight to the salon's Approvals
    } else {
      view = await this.repo.insertDeal(ctx, { ...base, ownerType: 'salon', technicianId: null }, initialStatus('salon', 'off'), finalCents);
    }
    if (kind === 'coupon' && input.code && this.ledger) {
      const code = String(input.code);
      try {
        await this.ledger.insertCodes(ctx.tenantId, view.id, { quantity: 1, prefix: null, singleUse: false, purpose: 'manual', campaignId: null, expiresAt: null, userId: ctx.userId },
          [{ hash: hashCode(ctx.tenantId, code), hint: codeHint(code) }]);
      } catch (e) {
        if (e instanceof LedgerRefusal) throw withCode(new DealValidationError('A coupon with that code already exists.'), 'COUPON_CODE_EXISTS');
        throw e;
      }
    }
    return view;
  }

  /**
   * Edit a deal. A draft (or one never used) can change anything; once a deal has been used only presentation, the end
   * date, the cap, the budget and the priority may change — unless the salon allows editing after redemption. Every
   * edit is a new version; tickets already carrying the deal keep the terms they were applied with.
   */
  async updateDeal(ctx: DealContext, id: string, patch: Partial<CreateDealInput>): Promise<DealView> {
    this.auth(ctx);
    if (!this.repo.updateDealTerms) throw withCode(new DealConflictError('Editing deals is not available here.'), 'FEATURE_NOT_AVAILABLE');
    const current = await this.repo.getDeal(ctx, id);
    if (!current) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (['canceled', 'archived', 'expired', 'rejected'].includes(current.status)) throw withCode(new DealConflictError(`A ${current.status} deal cannot be edited.`), 'DEAL_NOT_EDITABLE');
    const p: any = { ...(patch || {}) };
    for (const k of ['id', 'tenantId', 'ownerType', 'technicianId', 'kind', 'status', 'code', 'originalPriceCents', 'finalPriceCents', 'version', 'redemptionCount']) delete p[k];
    const merged: any = { ...current, ...p };
    const problems = validateDealInput(merged);
    if (p.rules != null) problems.push(...validateRules(p.rules));
    if (problems.length) throw new DealValidationError(problems.join(' '));
    const settings = await this.repo.getSettings(ctx);
    const used = current.redemptionCount > 0 || current.status === 'active' && (this.ledger ? (await this.ledger.usage(ctx.tenantId, id, null)).taken > 0 : false);
    if (current.ownerType === 'technician') {
      // Deals & Offers guide §9: the salon's technician-deal rules hold on every edit (a 15% edit under a 10% cap is refused,
      // never capped), and an approved proposal cannot be widened without a new review
      const v = validateTechDealAgainstSettings({ discountType: merged.discountType, discountPercent: merged.discountPercent, discountCents: merged.discountCents, originalPriceCents: merged.originalPriceCents,
        startsAt: merged.startsAt, endsAt: merged.endsAt, maxRedemptions: merged.maxRedemptions, newCustomersOnly: merged.newCustomersOnly, activeDealCountForTech: 0 }, settings);
      if (v.length) throw withCode(new DealValidationError(v.join(' ')), settings.allowTechnicianDeals === 'off' ? 'TECH_DEALS_OFF' : 'TECH_DEAL_OVER_POLICY');
      if (current.status !== 'draft') {
        const wider = widenedTerms(current, merged, p);
        if (wider.length) throw withCode(new DealConflictError(`Approved technician deals cannot be widened without a new review (${wider.join(', ')}). Pause or end it and submit a new proposal.`), 'DEAL_REREVIEW_REQUIRED', { fields: wider.join(', ') });
      }
    }
    if (used && !settings.editableAfterRedemption) {
      const blocked = Object.keys(p).filter((k) => !EDITABLE_LIVE.has(k));
      if (blocked.length) throw withCode(new DealConflictError(`This deal has been used — only its title, description, terms, image, end date, limit, budget and priority can change (the salon setting "editable after redemption" is off). Not allowed: ${blocked.join(', ')}.`), 'DEAL_USED_LIMITED_EDITS');
    }
    let serviceIds: string[] | null = null; let original = current.originalPriceCents;
    if (p.serviceIds !== undefined || p.branchId !== undefined) {
      serviceIds = [...new Set(((p.serviceIds ?? current.serviceIds) as string[]).filter(Boolean))];
      if (this.repo.catalogFor) {
        const cat = await this.repo.catalogFor(ctx, merged.branchId || null, serviceIds);
        if (!cat.branchOk) throw withCode(new DealValidationError('That location is not part of this salon.'), 'BRANCH_NOT_FOUND');
        if (serviceIds.some((sid) => !cat.services.find((s) => s.id === sid))) throw withCode(new DealValidationError('One or more services are not part of this salon’s menu.'), 'SERVICES_NOT_ON_MENU');
        original = serviceIds.length ? cat.services.reduce((n, s) => n + s.priceCents, 0) : null;
      }
      p.originalPriceCents = original;
    }
    const final = original == null ? null : computeFinalPriceCents(original, merged.discountType, merged.discountPercent, merged.discountCents);
    const out = await this.repo.updateDealTerms(ctx, id, p, final, serviceIds);
    if (!out) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    return out;
  }

  /**
   * Coupons & Promotions guide §10 "Duplicate": a NEW draft with the same terms — a fresh id, never the original's
   * redemption ledger, counters, budget reservations or codes (codes are unique per salon; give the copy its own code or
   * none). Salon-owned only: a technician's deal is copied by the technician through their own flow.
   */
  async duplicateDeal(ctx: DealContext, id: string, opts: { title?: string | null; code?: string | null } = {}): Promise<DealView> {
    this.auth(ctx);
    const d = await this.getDeal(ctx, id);
    if (d.ownerType !== 'salon') throw new DealForbiddenError('Only a salon-owned offer can be duplicated here.');
    const title = (opts.title ?? '').trim() || `${d.title} (copy)`.slice(0, 120);
    return this.createDeal(ctx, {
      ownerType: 'salon', branchId: d.branchId, title, shortDescription: d.shortDescription, terms: d.terms, imageUrl: d.imageUrl,
      discountType: d.discountType, discountPercent: d.discountPercent, discountCents: d.discountCents, serviceIds: [...d.serviceIds],
      startsAt: d.startsAt && Date.parse(d.startsAt) > this.now() ? d.startsAt : null, endsAt: d.endsAt && Date.parse(d.endsAt) > this.now() ? d.endsAt : null,
      newCustomersOnly: d.newCustomersOnly, memberOnly: d.memberOnly, minSpendCents: d.minSpendCents ?? null, maxRedemptions: d.maxRedemptions, maxPerCustomer: d.maxPerCustomer,
      stackable: d.stackable, kind: d.kind ?? 'deal', rules: d.rules ?? null, priority: d.priority, stackGroup: d.stackGroup ?? null, maxDiscountCents: d.maxDiscountCents ?? null,
      budgetCents: d.budgetCents ?? null, channels: d.channels ?? null, daysOfWeek: d.daysOfWeek ?? null, validFromMinute: d.validFromMinute ?? null, validToMinute: d.validToMinute ?? null,
      bookingLeadMinutes: d.bookingLeadMinutes ?? null, code: opts.code ?? null,
    });
  }

  async listDeals(ctx: DealContext, filter?: { status?: DealStatus; ownerType?: string; technicianId?: string; kind?: string }): Promise<DealView[]> {
    this.auth(ctx);
    return this.repo.listDeals(ctx, filter);
  }

  async getDeal(ctx: DealContext, id: string): Promise<DealView> {
    this.auth(ctx);
    const d = await this.repo.getDeal(ctx, id);
    if (!d) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    return d;
  }

  async versions(ctx: DealContext, id: string) { this.auth(ctx); await this.getDeal(ctx, id); return this.repo.versions ? this.repo.versions(ctx, id) : []; }

  // ---- lifecycle transitions (status machine in deals.core) ----
  private async transition(ctx: DealContext, id: string, action: DealAction, approver = false): Promise<DealView> {
    const current = await this.repo.getDeal(ctx, id);
    if (!current) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    const to = nextStatus(current.status, action);
    if (!to) throw withCode(new DealConflictError(`Can't ${action} a deal that is ${current.status}.`), 'DEAL_STATE_INVALID');
    const updated = await this.repo.transitionStatus(ctx, id, to, [current.status], approver ? ctx.userId : null);
    if (!updated) throw withCode(new DealConflictError('The deal changed underneath you — please refresh.'), 'DEAL_CHANGED_REFRESH');
    return updated;
  }

  async submit(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); const v = await this.transition(ctx, id, 'submit'); await this.fileDealApproval(ctx, v); return v; }
  pause(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); return this.transition(ctx, id, 'pause'); }
  cancel(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); return this.transition(ctx, id, 'cancel'); }
  archive(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); return this.transition(ctx, id, 'archive'); }

  /** Live now, or scheduled for its start. Refused past its end, or past the plan's live-deal limit. */
  async publish(ctx: DealContext, id: string): Promise<DealView> {
    this.auth(ctx);
    const d = await this.getDeal(ctx, id);
    if (d.endsAt && Date.parse(d.endsAt) <= this.now()) throw withCode(new DealConflictError('This deal has already ended — change its end date first.'), 'DEAL_ENDED');
    const gate = await this.tenantGate(ctx);
    if (gate.settings.platformDisabled) throw new DealConflictError(gate.reason!);
    await this.assertTechPolicy(ctx, d);   // §9: no technician deal goes live when the salon turned them off or it breaks today's rules
    if (this.repo.countLiveDeals && gate.settings.platformMaxActiveDeals != null && (await this.repo.countLiveDeals(ctx)) >= gate.settings.platformMaxActiveDeals) {
      throw withCode(new DealConflictError(`Your plan allows ${gate.settings.platformMaxActiveDeals} live deal${gate.settings.platformMaxActiveDeals === 1 ? '' : 's'} at a time.`), 'DEAL_PLAN_LIMIT', { max: gate.settings.platformMaxActiveDeals });
    }
    return this.transition(ctx, id, publishTarget(d.startsAt, this.now()) === 'scheduled' ? 'schedule' : 'publish');
  }
  async resume(ctx: DealContext, id: string): Promise<DealView> {
    this.auth(ctx);
    const d = await this.getDeal(ctx, id);
    if (d.endsAt && Date.parse(d.endsAt) <= this.now()) throw withCode(new DealConflictError('This deal has already ended.'), 'DEAL_ENDED');
    // Coupons & Promotions guide §10 "Resume: recheck dates, limits, eligibility": a used-up cap or budget is not resumed
    // (it would go live only to refuse every customer). Raise the limit (an allowed live edit) first.
    if (d.maxRedemptions != null && d.redemptionCount >= d.maxRedemptions) throw withCode(new DealConflictError('Its redemption limit is used up — raise the limit first.'), 'DEAL_SOLD_OUT');
    if (d.budgetCents != null && (d.budgetReservedCents ?? 0) >= d.budgetCents) throw withCode(new DealConflictError('Its budget is used up — raise the budget first.'), 'DEAL_BUDGET_USED');
    await this.assertTechPolicy(ctx, d);
    return this.transition(ctx, id, publishTarget(d.startsAt, this.now()) === 'scheduled' ? 'schedule' : 'resume');
  }

  /** Deals & Offers guide §9: a technician proposal is decided by someone else — never by its own technician, never by the
   *  person who filed it (the engine's separation-of-duties setting is optional; this rule is not). */
  private assertNotOwnDecision(ctx: DealContext, d: DealView): void {
    if (d.ownerType !== 'technician') return;
    if ((ctx.technicianId && d.technicianId && ctx.technicianId === d.technicianId) || (d.createdByUserId && d.createdByUserId === ctx.userId)) {
      throw withCode(new DealForbiddenError('You proposed this deal — another manager has to decide it.'), 'DEAL_SELF_APPROVAL');
    }
  }
  /** §8 "Approved activation only if all runtime rules still pass": the salon's CURRENT technician-deal rules, re-checked when a
   *  technician deal is approved, published or resumed (the cap may have been lowered, or technician deals turned off). A salon
   *  deal is never judged by the technician cap. */
  private async assertTechPolicy(ctx: DealContext, d: DealView): Promise<void> {
    if (d.ownerType !== 'technician') return;
    const settings = (await this.tenantGate(ctx)).settings;
    if (settings.allowTechnicianDeals === 'off') throw withCode(new DealForbiddenError('Technician deals are turned off for this salon.'), 'TECH_DEALS_OFF');
    // the OTHER active deals (Nov 3 audit: it counted the deal being approved itself, so a cap of 1 refused the first deal)
    const active = d.technicianId && d.status !== 'active' ? await this.repo.countActiveDealsForTech(ctx, d.technicianId, d.id) : 0;
    const v = validateTechDealAgainstSettings({ discountType: d.discountType, discountPercent: d.discountPercent, discountCents: d.discountCents, originalPriceCents: d.originalPriceCents,
      startsAt: d.startsAt, endsAt: d.endsAt, maxRedemptions: d.maxRedemptions, newCustomersOnly: d.newCustomersOnly, activeDealCountForTech: active }, settings);
    if (v.length) throw withCode(new DealValidationError(v.join(' ')), 'TECH_DEAL_OVER_POLICY');
  }

  async approve(ctx: DealContext, id: string, reason?: string | null): Promise<DealView> {
    this.auth(ctx);
    const d = await this.getDeal(ctx, id);
    this.assertNotOwnDecision(ctx, d);
    if (d.status === 'pending_approval') await this.assertTechPolicy(ctx, d);
    if (await this.decideThroughEngine(ctx, id, 'approve', reason ?? null)) return this.getDeal(ctx, id);
    return this.approveDirect(ctx, id, reason);
  }
  /** Decide the deal's live request in the engine. False when there is none (or no engine) — the caller acts directly. */
  private async decideThroughEngine(ctx: DealContext, id: string, decision: 'approve' | 'reject', note: string | null): Promise<boolean> {
    if (!this.approvals) return false;
    const live = await this.approvals.liveFor(approvalActor(ctx), 'deal_publish', 'deal', id);
    if (!live || live.status !== 'pending') return false;
    let out: { status: string; payload?: Record<string, unknown> };
    try { out = await this.approvals.decide(approvalActor(ctx), live.id, { decision, note, expectedVersion: live.version }); }
    catch (e) { throw dealErrorOf(e); }
    if (out.status === 'execution_failed') throw new DealConflictError(String((out.payload?.executionResult as any)?.error ?? 'The deal could not be approved.'));
    return true;
  }
  private async approveDirect(ctx: DealContext, id: string, reason?: string | null): Promise<DealView> {
    const current = await this.repo.getDeal(ctx, id);
    if (!current) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (!APPROVE_STATES.includes(current.status)) throw withCode(new DealConflictError(`Only a pending deal can be approved (this one is ${current.status}).`), 'DEAL_NOT_PENDING');
    this.assertNotOwnDecision(ctx, current);   // also on the engine's execute path (Approvals screen, Owner App)
    await this.assertTechPolicy(ctx, current);
    const updated = await this.transition(ctx, id, 'approve', true);
    await this.repo.recordApproval(ctx, id, { decision: 'approved', reason: reason ?? null, dealVersion: current.version });
    if (current.ownerType === 'technician' && current.technicianId) await this.repo.notifyTechnician(ctx.tenantId, current.technicianId, 'Deal approved', `Your deal "${current.title}" was approved.`);
    return updated;
  }

  async reject(ctx: DealContext, id: string, reason?: string | null): Promise<DealView> {
    this.auth(ctx);
    if (!reason || !reason.trim()) throw withCode(new DealValidationError('A rejection reason is required.'), 'REJECTION_REASON_REQUIRED');
    this.assertNotOwnDecision(ctx, await this.getDeal(ctx, id));
    if (await this.decideThroughEngine(ctx, id, 'reject', reason.trim())) return this.getDeal(ctx, id);
    return this.rejectDirect(ctx, id, reason);
  }

  /** §9 Request Changes: the proposal goes back to its technician as a DRAFT (editable, resubmittable) with the manager's note;
   *  it was never live, so nothing about customers or money changes. Decided through the engine when it holds the request. */
  async requestChanges(ctx: DealContext, id: string, reason?: string | null): Promise<DealView> {
    this.auth(ctx);
    const note = String(reason ?? '').trim();
    if (!note) throw withCode(new DealValidationError('Say what needs to change.'), 'DEAL_CHANGES_REASON_REQUIRED');
    const d = await this.getDeal(ctx, id);
    this.assertNotOwnDecision(ctx, d);
    if (d.status !== 'pending_approval') throw withCode(new DealConflictError(`Only a deal waiting for approval can be sent back (this one is ${d.status}).`), 'DEAL_NOT_PENDING');
    if (await this.decideThroughEngine(ctx, id, 'reject', CHANGES_MARK + note)) return this.getDeal(ctx, id);
    return this.requestChangesDirect(ctx, id, note);
  }
  private async requestChangesDirect(ctx: DealContext, id: string, note: string): Promise<DealView> {
    const current = await this.repo.getDeal(ctx, id);
    if (!current) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    this.assertNotOwnDecision(ctx, current);
    const updated = await this.transition(ctx, id, 'request_changes');
    await this.repo.recordApproval(ctx, id, { decision: 'changes_requested', reason: note, dealVersion: current.version });
    if (current.ownerType === 'technician' && current.technicianId) await this.repo.notifyTechnician(ctx.tenantId, current.technicianId, 'Deal needs changes', `Your deal "${current.title}" was sent back for changes: ${note}`);
    return updated;
  }
  private async rejectDirect(ctx: DealContext, id: string, reason?: string | null): Promise<DealView> {
    const current = await this.repo.getDeal(ctx, id);
    if (!current) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (!reason || !reason.trim()) throw withCode(new DealValidationError('A rejection reason is required.'), 'REJECTION_REASON_REQUIRED');
    this.assertNotOwnDecision(ctx, current);
    const updated = await this.transition(ctx, id, 'reject', true);
    await this.repo.recordApproval(ctx, id, { decision: 'rejected', reason, dealVersion: current.version });
    if (current.ownerType === 'technician' && current.technicianId) await this.repo.notifyTechnician(ctx.tenantId, current.technicianId, 'Deal needs changes', `Your deal "${current.title}" was not approved: ${reason}`);
    return updated;
  }

  // ---- Book-a-deal reservation (oversell-safe) ----
  /** Judge a deal for a booking (or a preview): eligibility with every reason, from the real facts. */
  async eligibilityFor(ctx: DealContext, deal: DealRecord, customerId: string | null, facts: ReservationFacts & { codeProvided?: boolean; excludeTicketId?: string | null }): Promise<EligibilityResult> {
    const l = this.ledger!;
    const gate = await this.tenantGate(ctx);
    const tz = await l.branchTimezone(ctx.tenantId, ctx.branchId || deal.branchId);
    const serviceAt = facts.date && facts.startTime ? zonedEpoch(facts.date, facts.startTime, tz) : null;
    const frozen = deal.ownerType === 'technician' && deal.technicianId ? await this.repo.techDealsFrozen(ctx.tenantId, deal.technicianId) : false;
    return evaluateEligibility(deal, {
      now: this.now(), channel: (facts.channel ?? 'customer_app') as Channel, branchId: ctx.branchId || null, timezone: tz,
      serviceIds: facts.serviceIds ?? [], spendCents: facts.spendCents ?? 0, serviceAt, technicianId: facts.technicianId ?? null,
      customer: await l.customerFacts(ctx.tenantId, customerId, facts.excludeTicketId ?? null),
      usage: await l.usage(ctx.tenantId, deal.id, customerId), codeProvided: facts.codeProvided ?? !deal.requiresCode,
      techFrozen: frozen, engineOff: await this.engineOff(), tenantDisabled: gate.disabled,
      settings: { allowedNewCustomer: gate.settings.allowedNewCustomer, allowedExistingCustomer: gate.settings.allowedExistingCustomer },
    });
  }

  private refusal(r: EligibilityResult): Error {
    const msg = r.reasons.map((x) => x.message).join(' ');
    return r.reasons.some((x) => CONFLICT_REASONS.has(x.code)) ? new DealConflictError(msg) : new DealValidationError(msg);
  }

  // The reservation is tenant-scoped (the deal's tenant) and called from the booking flow (customer resolved in that
  // tenant). reserve → (book) → consume; release frees capacity if booking fails.
  async reserveDeal(ctx: DealContext, dealId: string, customerId: string, idempotencyKey: string, facts: ReservationFacts = {}): Promise<{ soldOut: boolean; holdId?: string; alreadyHeld?: boolean }> {
    this.auth(ctx);
    if (await this.engineOff()) throw withCode(new DealConflictError('Deals are temporarily paused.'), 'DEALS_PAUSED');
    if (!idempotencyKey) throw new DealValidationError('An idempotency key is required to reserve a deal.');
    if (!this.ledger) return this.legacyReserve(ctx, dealId, customerId, idempotencyKey);
    const deal = await this.ledger.deal(ctx.tenantId, dealId);
    if (!deal) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (deal.kind !== 'deal') throw withCode(new DealValidationError('This offer is applied at checkout, not booked.'), 'DEAL_CHECKOUT_ONLY');
    const el = await this.eligibilityFor(ctx, deal, customerId, { ...facts, codeProvided: true });
    // capacity (the cap, one-per-customer) is decided by the ledger under the deal's lock — where a retry with the same
    // key also gets its own place back; everything else refuses here with every reason
    const other = el.reasons.filter((r) => r.code !== 'sold_out' && r.code !== 'per_customer_limit');
    if (other.length) throw this.refusal({ ...el, reasons: other });
    const r = await this.ledger.reserveForBooking(ctx.tenantId, deal.id, customerId, idempotencyKey, new Date(this.now() + HOLD_TTL_MS).toISOString(),
      { maxRedemptions: deal.maxRedemptions ?? null, maxPerCustomer: deal.maxPerCustomer ?? null }, ctx.userId);
    if (r.limitReached) throw new DealConflictError(deal.maxPerCustomer === 1 ? 'Already used — one per customer.' : 'Already used the maximum times per customer.');
    if (r.soldOut) return { soldOut: true };
    if (!r.alreadyHeld) void this.repo.recordEvent(ctx.tenantId, deal.id, customerId, 'booking_start');
    return { soldOut: false, holdId: r.holdId, alreadyHeld: r.alreadyHeld };
  }

  private async legacyReserve(ctx: DealContext, dealId: string, customerId: string, idempotencyKey: string) {
    const deal = await this.repo.getDeal(ctx, dealId);
    if (!deal) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (deal.status !== 'active') throw withCode(new DealConflictError('This deal is not currently available.'), 'DEAL_NOT_AVAILABLE');
    if (deal.endsAt && Date.parse(deal.endsAt) < this.now()) throw withCode(new DealConflictError('This deal has ended.'), 'DEAL_ENDED');
    if (deal.startsAt && Date.parse(deal.startsAt) > this.now()) throw withCode(new DealConflictError('This deal has not started yet.'), 'DEAL_NOT_STARTED');
    const r = await this.repo.reserveHold!(ctx, dealId, customerId, idempotencyKey, new Date(this.now() + HOLD_TTL_MS).toISOString());
    if (r.soldOut) return { soldOut: true };
    return { soldOut: false, holdId: r.holdId, alreadyHeld: r.alreadyHeld };
  }

  async releaseReservation(ctx: DealContext, holdId: string): Promise<{ released: boolean }> {
    this.auth(ctx);
    if (this.ledger) return { released: await this.ledger.releaseHold(ctx.tenantId, holdId, 'booking_failed') };
    return { released: await this.repo.releaseHold!(ctx, holdId) };
  }

  /** Called on a successful booking: consume the hold and stamp it with the appointment so checkout finds the deal. */
  async consumeReservation(ctx: DealContext, holdId: string, appointmentId: string): Promise<{ consumed: boolean }> {
    this.auth(ctx);
    const hold = await this.repo.getHold(ctx, holdId);
    if (!hold) throw withCode(new DealValidationError('Reservation not found.'), 'RESERVATION_NOT_FOUND');
    const deal = await this.repo.getDeal(ctx, hold.dealId);
    const consumed = this.ledger ? await this.ledger.consumeForAppointment(ctx.tenantId, holdId, appointmentId, deal?.version ?? 1) : await this.repo.consumeHold!(ctx, holdId, appointmentId, deal?.version ?? 1);
    if (consumed) void this.repo.recordEvent(ctx.tenantId, hold.dealId, null, 'booking');
    return { consumed };
  }

  // ---- User saves (shopper's personal list, cross-tenant, keyed by user_id) ----
  async saveDeal(userId: string, dealId: string): Promise<{ saved: boolean }> {
    if (!userId) throw new DealForbiddenError('Sign in to save deals.');
    const r = await this.repo.saveDeal(userId, dealId);
    if (r.saved && r.tenantId) void this.repo.recordEvent(r.tenantId, dealId, null, 'save');
    return { saved: r.saved };
  }
  async unsaveDeal(userId: string, dealId: string): Promise<{ removed: boolean }> {
    if (!userId) throw new DealForbiddenError('Sign in to manage saved deals.');
    return { removed: await this.repo.unsaveDeal(userId, dealId) };
  }
  listSavedDeals(userId: string) {
    if (!userId) throw new DealForbiddenError('Sign in to see saved deals.');
    return this.repo.listUserSaves(userId);
  }

  // ---- Analytics + Super Admin oversight ----
  getAnalytics(ctx: DealContext) { this.auth(ctx); return this.repo.dealAnalytics(ctx); }
  marketplaceOverview() { return this.repo.marketplaceOverview(); }
  listAllDealsForAdmin(f: { status?: string | null; tenantId?: string | null; kind?: string | null; search?: string | null; suspended?: boolean | null } | string | null = {}) {
    return this.repo.listAllDeals(typeof f === 'string' || f == null ? { status: f ?? null } : f);
  }
  /** Bug 17: a reason (12+ characters), audited, and every unpaid use given back so the deal stops everywhere. */
  async superSuspendDeal(dealId: string, reason?: string | null, actor: { userId?: string | null; role?: string | null } = {}) {
    const why = String(reason ?? '').trim();
    if (why.length < 12) throw new DealValidationError('A suspension needs a reason (at least 12 characters) — the salon is shown it.');
    const r = await this.repo.superSuspendDeal(dealId, why, { userId: actor.userId ?? null, role: actor.role ?? 'SUPER_ADMIN' });
    if (!r.suspended) throw new DealConflictError('Deal not found, or already suspended.');
    return r;
  }
  async setTenantPlatform(tenantId: string, patch: { disabled?: boolean; reason?: string | null; maxActiveDeals?: number | null }, actor: { userId: string | null }) {
    if (!this.repo.setTenantPlatform) throw withCode(new DealConflictError('Not available here.'), 'FEATURE_NOT_AVAILABLE');
    if (patch.disabled && String(patch.reason ?? '').trim().length < 12) throw withCode(new DealValidationError('Switching a salon’s deals off needs a reason (at least 12 characters).'), 'DEALS_OFF_REASON_REQUIRED');
    if (patch.maxActiveDeals != null && !(Number.isInteger(patch.maxActiveDeals) && patch.maxActiveDeals >= 0 && patch.maxActiveDeals <= 10_000)) throw withCode(new DealValidationError('The live-deal limit is a whole number.'), 'DEAL_LIMIT_INVALID');
    return this.repo.setTenantPlatform(tenantId, patch, actor);
  }
  tenantsOverview() { return this.repo.tenantsOverview ? this.repo.tenantsOverview() : []; }

  // ---- Checkout (compatibility: a booked deal, by appointment) ----
  /**
   * Put the deal a customer BOOKED onto the ticket. Bug 4: this APPLIES it (status 'applied', its place already held
   * by the booking); the redemption is recorded when the ticket is paid and given back on void/refund. A booked deal
   * keeps the terms it was booked with even if it has since ended — but not if the platform suspended it, the salon's
   * deals are switched off, or the technician is frozen. Non-fatal: returns applied:false with the reason.
   */
  async redeemDealAtCheckout(
    ctx: DealContext, appointmentId: string, subtotalCents: number,
    meta: { customerId: string; branchId?: string | null; ticketId?: string | null; technicianId?: string | null },
    _opts: { otherDiscountApplied?: boolean } = {},
  ): Promise<{ applied: boolean; reason?: string; discountCents?: number; redemptionId?: string; dealId?: string }> {
    this.auth(ctx);
    if (await this.engineOff()) return { applied: false, reason: 'Deals are temporarily paused.' };
    if (!this.ledger) {
      const hold = this.repo.findConsumedHoldForAppointment ? await this.repo.findConsumedHoldForAppointment(ctx, appointmentId) : null;
      if (!hold) return { applied: false, reason: 'No deal reserved for this appointment.' };
      const deal = await this.repo.getDeal(ctx, hold.dealId);
      if (!deal) return { applied: false, reason: 'Deal not found.' };
      return { applied: true, discountCents: ruleDiscount({ type: deal.discountType as any, percent: deal.discountPercent, cents: deal.discountCents }, subtotalCents), dealId: deal.id };
    }
    const hold = await this.ledger.appointmentHold(ctx.tenantId, appointmentId);
    if (!hold) return { applied: false, reason: 'No deal reserved for this appointment.' };
    const deal = await this.ledger.deal(ctx.tenantId, hold.dealId);
    if (!deal) return { applied: false, reason: 'Deal not found.' };
    const why = await this.bookedDealBlocked(ctx, deal);
    if (why) return { applied: false, reason: why };
    const discountCents = ruleDiscount(dealRule(deal), subtotalCents);
    const ticketId = meta.ticketId ?? null;
    if (!ticketId) return { applied: true, discountCents, dealId: deal.id };
    try {
      const app = await this.ledger.apply({ tenantId: ctx.tenantId, branchId: meta.branchId || ctx.branchId, ticketId, customerId: meta.customerId || null, dealId: deal.id, kind: 'deal',
        appointmentHoldId: hold.holdId, appointmentId, discountCents, lines: [], terms: termsSnapshot(deal), dealVersion: hold.dealVersion ?? deal.version, userId: ctx.userId },
        { maxRedemptions: null, maxPerCustomer: null, budgetCents: deal.budgetCents ?? null });
      return { applied: true, discountCents: app.discountCents, redemptionId: app.redemptionId, dealId: deal.id };
    } catch (e) {
      if (e instanceof LedgerRefusal) return { applied: false, reason: e.message };
      throw e;
    }
  }

  /** Why a deal the customer already booked can no longer be honoured (null = honour it). */
  async bookedDealBlocked(ctx: DealContext, deal: DealRecord): Promise<string | null> {
    if (deal.suspendedAt || deal.status === 'canceled' || deal.status === 'rejected') return 'This deal was withdrawn.';
    const gate = await this.tenantGate(ctx);
    if (gate.disabled) return gate.reason;
    if (deal.ownerType === 'technician' && deal.technicianId && await this.repo.techDealsFrozen(ctx.tenantId, deal.technicianId)) return 'This technician\'s deals are frozen by platform administration.';
    return null;
  }

  /** Resolve the appointment a POS ticket came from, so checkout can auto-find its deal. */
  appointmentForTicket(ctx: DealContext, ticketId: string): Promise<string | null> { this.auth(ctx); return this.repo.appointmentIdForTicket(ctx.tenantId, ticketId); }

  /** Cancel / no-show: free the reserved capacity if the deal was never used on a ticket (bug 12). */
  async releaseDealForAppointment(ctx: DealContext, appointmentId: string, reason = 'appointment_cancelled'): Promise<{ released: boolean }> {
    this.auth(ctx);
    if (this.ledger) return { released: (await this.ledger.releaseForAppointment(ctx.tenantId, appointmentId, reason)) > 0 };
    return { released: await this.repo.releaseForAppointment!(ctx, appointmentId) };
  }

  // ---- Customer marketplace (public / guest-browsable — no auth required) ----
  async nearbyDeals(params: { lat?: number; lng?: number; radiusMiles?: number; sort?: NearbySort; ownerType?: string | null; maxPriceCents?: number | null; categoryId?: string | null; search?: string | null }): Promise<NearbyDealCard[]> {
    if (await this.engineOff()) return [];
    const origin = typeof params.lat === 'number' && typeof params.lng === 'number' && Number.isFinite(params.lat) && Number.isFinite(params.lng) && Math.abs(params.lat) <= 90 && Math.abs(params.lng) <= 180
      ? { lat: params.lat, lng: params.lng } : null;
    const radius = clampRadius(params.radiusMiles);
    const rows = await this.repo.nearbyActiveDealRows({ origin, radiusMiles: radius, ownerType: params.ownerType === 'salon' || params.ownerType === 'technician' ? params.ownerType : null,
      maxPriceCents: Number.isInteger(params.maxPriceCents) && (params.maxPriceCents as number) > 0 ? params.maxPriceCents : null,
      categoryId: params.categoryId && /^[0-9a-f-]{36}$/i.test(params.categoryId) ? params.categoryId : null,
      search: params.search ? String(params.search).slice(0, 60) : null });
    return buildNearbyFeed(rows as any, origin, radius, params.sort ?? 'nearest');
  }

  async publicDeal(id: string, viewer?: { userId?: string | null; countView?: boolean }): Promise<Record<string, any> | null> {
    if (await this.engineOff()) return null;
    const r = await this.repo.getPublicDealRow(id);
    if (!r) return null;
    // bug 15: a detail view is counted — once per visitor per window (the controller's limiter decides; refreshes are not views)
    if (viewer?.countView !== false) void this.repo.recordEvent(String(r.tenant_id ?? r.tenantId), String(r.id), null, 'view');
    const original = r.original_price_cents == null ? (r.originalPriceCents ?? null) : Number(r.original_price_cents);
    const final = r.final_price_cents == null ? (r.finalPriceCents ?? null) : Number(r.final_price_cents);
    const saved = viewer?.userId ? await this.repo.isSaved(viewer.userId, String(r.id)).catch(() => false) : false;
    return {
      id: String(r.id), tenantId: String(r.tenant_id ?? r.tenantId), branchId: r.branch_id ?? r.branchId ?? null, kind: String(r.kind ?? 'deal'), title: String(r.title), shortDescription: r.short_description ?? null, terms: r.terms ?? null, imageUrl: r.image_url ?? null,
      ownerType: String(r.owner_type ?? r.ownerType), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.technician_name ?? null,
      salonName: r.salon_name ?? null, branchName: r.branch_name ?? null, address: r.address ?? null,
      discountType: String(r.discount_type ?? r.discountType), discountPercent: r.discount_percent == null ? null : Number(r.discount_percent),
      discountCents: r.discount_cents == null ? null : Number(r.discount_cents),
      originalPriceCents: original, finalPriceCents: final, savingsCents: original == null || final == null ? null : Math.max(0, original - final),
      startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null, endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
      newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only, allowTechSubstitution: !!r.allow_tech_substitution,
      maxPerCustomer: r.max_per_customer == null ? null : Number(r.max_per_customer), minSpendCents: r.min_spend_cents == null ? null : Number(r.min_spend_cents),
      daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week.map(Number) : null, validFromMinute: r.valid_from_minute ?? null, validToMinute: r.valid_to_minute ?? null,
      bookingLeadMinutes: r.booking_lead_minutes ?? null, serviceIds: r.service_ids ?? [],
      status: String(r.status), saved,
    };
  }

  /**
   * The customer app's "what would I pay": the deal applied to the services the customer picked, at catalog prices,
   * through the same engine checkout uses — with every reason it would not apply. Never a promise: the price at
   * checkout is decided at checkout.
   */
  async estimate(ctx: DealContext, dealId: string, input: { serviceIds: string[]; customerId?: string | null; date?: string; startTime?: string; channel?: Channel }): Promise<{ eligible: boolean; reasons: { code: string; message: string }[]; subtotalCents: number; discountCents: number; totalCents: number; lines: { serviceId: string; priceCents: number; discountCents: number }[] }> {
    if (!this.ledger || !this.repo.catalogFor) throw withCode(new DealConflictError('Not available here.'), 'FEATURE_NOT_AVAILABLE');
    const deal = await this.ledger.deal(ctx.tenantId, dealId);
    if (!deal || deal.kind === 'announcement') throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    const customerId = input.customerId ?? (ctx.userId && ctx.userId !== 'guest' ? await this.ledger.customerIdForUser(ctx.tenantId, ctx.userId) : null);
    const ids = [...new Set((input.serviceIds ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 20);
    const cat = await this.repo.catalogFor(ctx, null, ids);
    const lines = cat.services.map((s) => ({ lineId: s.id, priceCents: s.priceCents }));
    const subtotal = lines.reduce((n, l) => n + l.priceCents, 0);
    const el = await this.eligibilityFor(ctx, deal, customerId, { serviceIds: ids, date: input.date, startTime: input.startTime, channel: input.channel ?? 'customer_app', spendCents: subtotal, codeProvided: true });
    const policy = await this.policy(ctx);
    const offer: OfferRequest = { id: 'deal-' + deal.id, category: deal.kind === 'coupon' ? 'coupon' : 'deal', description: deal.title, rule: dealRule(deal), lineIds: deal.serviceIds.length ? lines.filter((l) => deal.serviceIds.includes(l.lineId)).map((l) => l.lineId) : null, stackable: deal.stackable };
    const priced = el.eligible ? priceTicket(lines, [offer], policy) : null;
    const discount = priced?.totalDiscountCents ?? 0;
    return { eligible: el.eligible, reasons: el.reasons, subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount,
      lines: lines.map((l) => ({ serviceId: l.lineId, priceCents: l.priceCents, discountCents: priced?.lines.find((x) => x.lineId === l.lineId)?.discountCents ?? 0 })) };
  }

  /** The salon's deals for its own customers (customer app Deals list, AI receptionist): live deals + announcements. */
  async salonDealsForCustomers(ctx: DealContext, channel?: 'customer_app' | 'ai_receptionist'): Promise<{ id: string; kind: string; title: string; description: string | null; terms: string | null; discountType: string; discountPercent: number | null; discountCents: number | null; originalPriceCents: number | null; finalPriceCents: number | null; endsAt: string | null; requiresCode: boolean }[]> {
    if (await this.engineOff()) return [];
    const gate = await this.tenantGate(ctx);
    if (gate.disabled) return [];
    const now = this.now();
    const all = await this.repo.listDeals(ctx, { status: 'active' });
    const all2 = all.filter((d) => (d.kind ?? 'deal') !== 'automatic' && !d.suspendedAt && (!d.startsAt || Date.parse(d.startsAt) <= now) && (!d.endsAt || Date.parse(d.endsAt) > now)
        && (!d.channels || !d.channels.length || (channel ? d.channels.includes(channel) : d.channels.includes('customer_app') || d.channels.includes('ai_receptionist'))))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    // a deal with no place or budget left is not offered (a caller or customer would only hear "sold out" when booking)
    const open: DealView[] = [];
    for (const d of all2) {
      if (d.budgetCents != null && (d.budgetReservedCents ?? 0) >= d.budgetCents) continue;
      if (d.maxRedemptions != null && this.ledger && (await this.ledger.usage(ctx.tenantId, d.id, null)).taken >= d.maxRedemptions) continue;
      open.push(d);
    }
    return open
      .map((d) => ({ id: d.id, kind: d.kind ?? 'deal', title: d.title, description: d.shortDescription, terms: d.terms, discountType: d.discountType, discountPercent: d.discountPercent,
        discountCents: d.discountCents, originalPriceCents: d.originalPriceCents, finalPriceCents: d.finalPriceCents, endsAt: d.endsAt, requiresCode: !!d.requiresCode }));
  }

  /** A signed-in customer's coupon wallet at this salon: the coupons issued to them, with a QR reference (never a code). */
  async wallet(ctx: DealContext): Promise<{ id: string; dealId: string; title: string; description: string | null; terms: string | null; codeHint: string; status: string; usable: boolean; expiresAt: string | null; qr: string; discountType: string; discountPercent: number | null; discountCents: number | null }[]> {
    this.auth(ctx);
    if (!this.ledger) return [];
    const customerId = await this.ledger.customerIdForUser(ctx.tenantId, ctx.userId);
    if (!customerId) return [];
    const rows = await this.ledger.walletFor(ctx.tenantId, customerId);
    const now = this.now();
    return rows.map((w: any) => {
      const exp = w.expires_at ? new Date(w.expires_at).toISOString() : (w.ends_at ? new Date(w.ends_at).toISOString() : null);
      const usable = w.status === 'active' && w.deal_status === 'active' && (!exp || Date.parse(exp) > now);
      return { id: String(w.id), dealId: String(w.deal_id), title: String(w.title), description: w.short_description ?? null, terms: w.terms ?? null, codeHint: String(w.code_hint),
        status: usable ? 'active' : w.status === 'active' ? 'expired' : String(w.status), usable, expiresAt: exp, qr: walletQrPayload(String(w.id)),
        discountType: String(w.discount_type), discountPercent: w.discount_percent == null ? null : Number(w.discount_percent), discountCents: w.discount_cents == null ? null : Number(w.discount_cents) };
    });
  }

  // ── coupons ────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Generate coupon codes for a coupon deal. The codes are returned ONCE (to print, export or send) and stored only as
   * hashes. With customerIds, each customer gets their own single-use coupon in their wallet (marketing / wallet).
   */
  async generateCodes(ctx: DealContext, dealId: string, input: { quantity?: number; prefix?: string | null; singleUse?: boolean; maxUses?: number | null; expiresAt?: string | null; customerIds?: string[]; purpose?: string; campaignId?: string | null }): Promise<{ batchId: string; quantity: number; codes: string[]; hints: string[] }> {
    this.auth(ctx);
    if (!this.ledger) throw withCode(new DealConflictError('Not available here.'), 'FEATURE_NOT_AVAILABLE');
    const deal = await this.ledger.deal(ctx.tenantId, dealId);
    if (!deal) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (deal.kind !== 'coupon') throw withCode(new DealValidationError('Codes belong to coupon deals.'), 'CODES_COUPON_ONLY');
    if (['canceled', 'archived', 'expired', 'rejected'].includes(deal.status)) throw withCode(new DealConflictError(`This coupon is ${deal.status}.`), 'COUPON_NOT_USABLE');
    const customers = [...new Set((input.customerIds ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
    const quantity = customers.length || Math.floor(Number(input.quantity ?? 0));
    if (!(quantity >= 1 && quantity <= MAX_BATCH)) throw withCode(new DealValidationError(`Generate between 1 and ${MAX_BATCH} codes.`), 'CODE_BATCH_SIZE_INVALID', { max: MAX_BATCH });
    if (input.expiresAt != null && Number.isNaN(Date.parse(String(input.expiresAt)))) throw withCode(new DealValidationError('The expiry date is not a valid date.'), 'DATE_INVALID');
    if (input.maxUses != null && !(Number.isInteger(input.maxUses) && input.maxUses > 0)) throw withCode(new DealValidationError('Uses per code is a whole number above zero.'), 'CODE_USES_INVALID');
    const purpose = customers.length ? (input.purpose === 'marketing' ? 'marketing' : 'wallet') : (input.purpose === 'marketing' ? 'marketing' : 'manual');
    if (customers.length && this.repo.catalogFor) {
      const known = await this.ledger.knownCustomers(ctx.tenantId, customers);
      if (known.length !== customers.length) throw withCode(new DealValidationError('One or more customers are not this salon’s.'), 'CUSTOMERS_NOT_IN_SALON');
    }
    let codes: string[];
    try { codes = generateCodes(quantity, input.prefix ?? null); } catch (e: any) { throw new DealValidationError(e.message); }
    const singleUse = customers.length ? true : input.singleUse !== false;
    const r = await this.ledger.insertCodes(ctx.tenantId, deal.id, { quantity, prefix: input.prefix ? normalizeCode(input.prefix) : null, singleUse, purpose, campaignId: input.campaignId ?? null, expiresAt: input.expiresAt ?? null, userId: ctx.userId },
      codes.map((c, i) => ({ hash: hashCode(ctx.tenantId, c), hint: codeHint(c), customerId: customers[i] ?? null, maxUses: singleUse ? null : input.maxUses ?? null })));
    return { batchId: r.batchId, quantity: r.inserted, codes, hints: codes.map(codeHint) };
  }
  async listCodes(ctx: DealContext, dealId: string) { this.auth(ctx); if (!this.ledger) return []; await this.getDeal(ctx, dealId); return this.ledger.listCodes(ctx.tenantId, dealId); }
  async revokeCode(ctx: DealContext, dealId: string, codeId: string, reason?: string | null) {
    this.auth(ctx);
    if (!this.ledger) throw withCode(new DealConflictError('Not available here.'), 'FEATURE_NOT_AVAILABLE');
    const why = String(reason ?? '').trim();
    if (why.length < 4) throw withCode(new DealValidationError('Say why the code is being cancelled.'), 'CODE_CANCEL_REASON_REQUIRED');
    if (!(await this.ledger.revokeCode(ctx.tenantId, dealId, codeId, why))) throw withCode(new DealConflictError('Code not found, or already cancelled.'), 'DEAL_CODE_NOT_FOUND');
    return { revoked: true };
  }

  /** The deals dashboard: per-deal and per-day figures (deal_daily_stats, kept by the aggregation job) + live state. */
  /** Owner App: the dashboard, the approval queue and the switches that decide whether deals run at all. */
  async ownerSummary(ctx: DealContext, days = 30) {
    this.auth(ctx);
    const [dashboard, pending, gate] = await Promise.all([this.dashboard(ctx, days), this.repo.listDeals(ctx, { status: 'pending_approval' }), this.tenantGate(ctx)]);
    const s = gate.settings;
    return { dashboard, pending, switches: { running: !gate.disabled, reason: gate.disabled ? gate.reason : null, stackingPolicy: s.stackingPolicy ?? 'best_single', allowTechnicianDeals: s.allowTechnicianDeals, maxActiveDeals: s.platformMaxActiveDeals ?? null } };
  }

  /** Reports/exports: the deal and coupon uses in the window as CSV (formula-injection safe). */
  async exportCsv(ctx: DealContext, days = 30): Promise<string> {
    this.auth(ctx);
    if (!this.ledger) return 'applied_at,redeemed_at,deal,kind,ticket_id,customer_id,status,discount,reversed,net,reversal_reason,code_last4\n';
    const rows = await this.ledger.exportRedemptions(ctx.tenantId, Math.min(366, Math.max(1, Math.floor(days) || 30)));
    const cell = (v: unknown): string => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dollars = (c: number) => (c / 100).toFixed(2);
    const lines = [['applied_at', 'redeemed_at', 'deal', 'kind', 'ticket_id', 'customer_id', 'status', 'discount', 'reversed', 'net', 'reversal_reason', 'code_last4'].join(',')];
    for (const r of rows) lines.push([r.appliedAt, r.redeemedAt, r.deal, r.kind, r.ticketId, r.customerId, r.status, dollars(r.discountCents), dollars(r.reversedCents),
      dollars(['redeemed', 'partially_reversed'].includes(r.status) ? r.discountCents - r.reversedCents : 0), r.reversalReason, r.codeHint].map(cell).join(','));
    return lines.join('\n') + '\n';
  }

  async dashboard(ctx: DealContext, days = 30) {
    this.auth(ctx);
    if (!this.ledger) return { days, totals: null, daily: [], top: [] };
    return this.ledger.dashboard(ctx.tenantId, Math.min(365, Math.max(1, Math.floor(days) || 30)));
  }

  /** Guest estimate: only for a deal a guest may see (public), priced in that deal's salon at catalog prices. */
  async publicEstimate(dealId: string, input: { serviceIds: string[]; date?: string; startTime?: string }) {
    const r = await this.repo.getPublicDealRow(dealId);
    if (!r) throw withCode(new DealValidationError('Deal not available.'), 'DEAL_NOT_AVAILABLE');
    const ctx: DealContext = { tenantId: String(r.tenant_id ?? r.tenantId), branchId: r.branch_id ? String(r.branch_id) : '', userId: 'guest', role: 'GUEST', permissions: [] };
    return this.estimate(ctx, dealId, { serviceIds: input.serviceIds, customerId: null, date: input.date, startTime: input.startTime, channel: 'customer_app' });
  }

  /** The tenant's stacking policy, as the pricing engine takes it. */
  async policy(ctx: DealContext) {
    const s = await this.repo.getSettings(ctx);
    return { mode: (s.stackingPolicy ?? 'best_single') as any, allowWithMembership: !!s.allowStackMembership, allowWithLoyalty: s.allowStackLoyalty !== false,
      priceFloorPercent: s.priceFloorPercent ?? 0, maxTotalDiscountPercent: s.maxTotalDiscountPercent ?? null };
  }

  /**
   * The simulator: a draft (or an existing deal with changes) judged against a sample customer, services and time —
   * eligibility with every reason and the price through the real engine and the salon's real stacking policy.
   */
  async preview(ctx: DealContext, draft: Partial<CreateDealInput> & { dealId?: string }, sample: { serviceIds?: string[]; customerId?: string | null; paidVisits?: number; isMember?: boolean; date?: string; startTime?: string; channel?: Channel; otherOffers?: OfferRequest[] }): Promise<{ problems: string[]; eligibility: EligibilityResult; pricing: PricingResult; originalPriceCents: number | null; finalPriceCents: number | null }> {
    this.auth(ctx);
    if (!this.ledger || !this.repo.catalogFor) throw withCode(new DealConflictError('Not available here.'), 'FEATURE_NOT_AVAILABLE');
    const existing = draft.dealId ? await this.ledger.deal(ctx.tenantId, draft.dealId) : null;
    const merged: any = { ...(existing ?? {}), ...draft, kind: draft.kind ?? existing?.kind ?? 'deal' };
    const problems = validateDealInput(merged);
    if (draft.rules != null) problems.push(...validateRules(draft.rules));
    const serviceIds = [...new Set(((draft.serviceIds ?? existing?.serviceIds ?? []) as string[]).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
    const sampleIds = [...new Set((sample.serviceIds?.length ? sample.serviceIds : serviceIds).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
    const cat = await this.repo.catalogFor(ctx, null, [...new Set([...serviceIds, ...sampleIds])]);
    if (serviceIds.some((id) => !cat.services.find((s) => s.id === id))) problems.push('One or more services are not part of this salon’s menu.');
    const original = serviceIds.length ? cat.services.filter((s) => serviceIds.includes(s.id)).reduce((n, s) => n + s.priceCents, 0) : null;
    const terms: DealRecord = {
      ...(existing ?? ({} as any)), id: existing?.id ?? 'preview', tenantId: ctx.tenantId, kind: merged.kind, status: 'active', branchId: merged.branchId ?? null,
      startsAt: merged.startsAt ?? null, endsAt: merged.endsAt ?? null, daysOfWeek: merged.daysOfWeek ?? null, validFromMinute: merged.validFromMinute ?? null, validToMinute: merged.validToMinute ?? null,
      newCustomersOnly: !!merged.newCustomersOnly, memberOnly: !!merged.memberOnly, minSpendCents: merged.minSpendCents ?? null, bookingLeadMinutes: merged.bookingLeadMinutes ?? null,
      maxRedemptions: merged.maxRedemptions ?? null, maxPerCustomer: merged.maxPerCustomer ?? null, serviceIds, channels: merged.channels ?? null, requiresCode: false,
      rules: merged.rules ?? null, suspendedAt: null, budgetCents: merged.budgetCents ?? null, budgetReservedCents: existing?.budgetReservedCents ?? 0,
      title: merged.title ?? 'Preview', discountType: merged.discountType ?? 'percent', discountPercent: merged.discountPercent ?? null, discountCents: merged.discountCents ?? null,
      maxDiscountCents: merged.maxDiscountCents ?? null, stackable: !!merged.stackable, stackGroup: merged.stackGroup ?? null, priority: merged.priority ?? 100,
    } as DealRecord;
    const tz = await this.ledger.branchTimezone(ctx.tenantId, ctx.branchId || null);
    const lines = cat.services.filter((s) => sampleIds.includes(s.id)).map((s) => ({ lineId: s.id, priceCents: s.priceCents }));
    const subtotal = lines.reduce((n, l) => n + l.priceCents, 0);
    const customer = sample.customerId ? await this.ledger.customerFacts(ctx.tenantId, sample.customerId) : { id: 'sample', paidVisits: Math.max(0, Math.floor(sample.paidVisits ?? 0)), isMember: !!sample.isMember };
    const eligibility = evaluateEligibility(terms, { now: this.now(), channel: sample.channel ?? 'pos', branchId: ctx.branchId || null, timezone: tz, serviceIds: sampleIds, spendCents: subtotal,
      serviceAt: sample.date && sample.startTime ? zonedEpoch(sample.date, sample.startTime, tz) : null, customer, usage: existing ? await this.ledger.usage(ctx.tenantId, existing.id, sample.customerId ?? null) : { taken: 0, byCustomer: 0 }, codeProvided: true });
    const offer: OfferRequest = { id: 'preview', category: terms.kind === 'coupon' ? 'coupon' : 'deal', description: terms.title, rule: dealRule(terms), stackable: terms.stackable, stackGroup: terms.stackGroup, priority: terms.priority,
      lineIds: serviceIds.length ? lines.filter((l) => serviceIds.includes(l.lineId)).map((l) => l.lineId) : null };
    const pricing = priceTicket(lines, [...(eligibility.eligible ? [offer] : []), ...(sample.otherOffers ?? [])], await this.policy(ctx));
    return { problems, eligibility, pricing, originalPriceCents: original, finalPriceCents: original == null ? null : computeFinalPriceCents(original, terms.discountType as any, terms.discountPercent, terms.discountCents) };
  }

  // ---- Technician App ("My Deals") ----
  // The technician acts only on their OWN deals. technicianId is resolved server-side from the session; a technician
  // can never target another technician's deal (ownership is re-checked on every lifecycle action).
  private async requireTech(ctx: DealContext): Promise<string> {
    const tid = await this.repo.resolveTechnicianId(ctx);
    if (!tid) throw new DealForbiddenError('No technician profile for this account.');
    return tid;
  }

  /** Settings the Tech App needs to render an honest enabled/disabled state (does NOT require manage perms). */
  /** The technician sees the salon's policy AFTER the platform/plan/salon switches: switched off anywhere reads as "off". */
  async techGetSettings(ctx: DealContext): Promise<DealSettingsView> {
    this.auth(ctx);
    const g = await this.tenantGate(ctx);
    return g.disabled ? { ...g.settings, allowTechnicianDeals: 'off' } : g.settings;
  }

  /** The services a technician deal can discount — theirs, at the catalog price (the server prices the deal: bug 8). */
  async techServices(ctx: DealContext): Promise<{ id: string; name: string; priceCents: number }[]> {
    this.auth(ctx);
    const tid = await this.requireTech(ctx);
    return this.repo.techServices ? this.repo.techServices(ctx, tid) : [];
  }

  async techListMyDeals(ctx: DealContext): Promise<DealView[]> {
    this.auth(ctx);
    const tid = await this.requireTech(ctx);
    return this.repo.listDeals(ctx, { ownerType: 'technician', technicianId: tid });
  }

  async techCreateDeal(ctx: DealContext, input: CreateDealInput): Promise<DealView> {
    this.auth(ctx);
    const tid = await this.requireTech(ctx);
    // a technician discounts only services they perform (bug 7/8: never someone else's menu, never a typed-in price)
    if (this.repo.techServices) {
      const mine = new Set((await this.repo.techServices(ctx, tid)).map((s) => s.id));
      const ids = [...new Set((input.serviceIds ?? []).filter(Boolean))];
      if (!ids.length) throw withCode(new DealValidationError('Pick at least one of your services for this deal.'), 'DEAL_SERVICES_REQUIRED');
      if (ids.some((id) => !mine.has(id))) throw withCode(new DealValidationError('You can only discount services you perform.'), 'DEAL_OWN_SERVICES_ONLY');
    }
    return this.createDeal({ ...ctx, technicianId: tid }, { ...input, ownerType: 'technician', technicianId: tid, kind: 'deal' });
  }

  private async techOwn(ctx: DealContext, id: string): Promise<{ tid: string }> {
    const tid = await this.requireTech(ctx);
    const deal = await this.repo.getDeal(ctx, id);
    if (!deal) throw withCode(new DealValidationError('Deal not found.'), 'DEAL_NOT_FOUND');
    if (deal.technicianId !== tid) throw new DealForbiddenError('This is not your deal.');
    return { tid };
  }
  async techSubmit(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); await this.techOwn(ctx, id); const v = await this.transition(ctx, id, 'submit'); await this.fileDealApproval(ctx, v); return v; }
  async techPause(ctx: DealContext, id: string): Promise<DealView> { this.auth(ctx); await this.techOwn(ctx, id); return this.transition(ctx, id, 'pause'); }
}


/** Deals & Offers guide §9 "changes after approval that increase discount or broaden eligibility": the fields of a patch that
 *  make a deal MORE generous or reach MORE customers than the terms that were approved. Narrowing (a lower discount, a later
 *  start, a lower cap) is not widening. Pure; exported for tests. */
export function widenedTerms(before: DealView, after: Record<string, any>, patch: Record<string, any>): string[] {
  const w: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const t = (v: unknown) => (v ? Date.parse(String(v)) : null);
  if (has('discountType') && after.discountType !== before.discountType) w.push('discountType');
  if (has('discountPercent') && (n(after.discountPercent) ?? 0) > (n(before.discountPercent) ?? 0)) w.push('discountPercent');
  if (has('discountCents')) {
    const a = n(after.discountCents) ?? 0, b = n(before.discountCents) ?? 0;
    if (after.discountType === 'fixed_price' ? a < b : a > b) w.push('discountCents');   // a lower fixed price is a bigger discount
  }
  if (has('serviceIds') && (after.serviceIds ?? []).some((x: string) => !(before.serviceIds ?? []).includes(x))) w.push('serviceIds');
  if (has('branchId') && (after.branchId ?? null) !== (before.branchId ?? null)) w.push('branchId');
  const was: Record<string, unknown> = { maxRedemptions: before.maxRedemptions, maxPerCustomer: before.maxPerCustomer, budgetCents: before.budgetCents, maxDiscountCents: before.maxDiscountCents };
  for (const k of ['maxRedemptions', 'maxPerCustomer', 'budgetCents', 'maxDiscountCents'] as const) {
    const a = n(after[k]), b = n(was[k]);
    if (has(k) && (a == null ? b != null : b != null && a > b)) w.push(k);   // removing a limit, or raising it
  }
  if (has('minSpendCents') && (n(after.minSpendCents) ?? 0) < (n(before.minSpendCents) ?? 0)) w.push('minSpendCents');
  if (has('newCustomersOnly') && before.newCustomersOnly && !after.newCustomersOnly) w.push('newCustomersOnly');
  if (has('memberOnly') && before.memberOnly && !after.memberOnly) w.push('memberOnly');
  if (has('startsAt') && before.startsAt && (t(after.startsAt) == null || (t(after.startsAt) as number) < (t(before.startsAt) as number))) w.push('startsAt');
  if (has('endsAt') && before.endsAt && (t(after.endsAt) == null || (t(after.endsAt) as number) > (t(before.endsAt) as number))) w.push('endsAt');
  if (has('daysOfWeek') && Array.isArray(before.daysOfWeek) && before.daysOfWeek.length && (!Array.isArray(after.daysOfWeek) || !after.daysOfWeek.length || after.daysOfWeek.some((d: number) => !before.daysOfWeek!.includes(d)))) w.push('daysOfWeek');
  if (has('rules') && JSON.stringify(after.rules ?? null) !== JSON.stringify(before.rules ?? null)) w.push('rules');
  if (has('stackable') && !before.stackable && after.stackable) w.push('stackable');
  return w;
}
