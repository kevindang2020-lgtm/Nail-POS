import type { DealAnalyticsRow } from '@aipowersalon/api-contracts/tenant';
export type { DealAnalyticsRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { DealContext, CreateDealInput, DealView } from './deals.dto';
import type { NearbyDealRow } from './deals-nearby-core';
import type { DealSettings, DealStatus, DealAction } from './deals.core';
import type { KyselyDealsLedger } from '../engine/deals-ledger.kysely';

export interface RecordApprovalInput { decision: 'approved' | 'rejected' | 'changes_requested'; reason?: string | null; dealVersion: number; }
export type ReserveResult = { soldOut: true } | { soldOut: false; holdId: string; alreadyHeld: boolean };
export interface HoldRow { id: string; dealId: string; status: string; appointmentId: string | null; }
export interface ConsumedHold { id: string; dealId: string; dealVersion: number | null; }
export interface RedemptionInput { dealId: string; appointmentId: string; customerId: string; branchId?: string | null; ticketId?: string | null; technicianId?: string | null; amountDiscountedCents: number; dealVersion: number; }
export interface RedemptionResult { id: string; amountDiscountedCents: number; alreadyRedeemed: boolean; }
export type DealEventType = 'view' | 'save' | 'unsave' | 'share' | 'booking_start' | 'booking' | 'redemption' | 'cancel' | 'apply' | 'release' | 'reversal';
export interface MarketplaceOverview { totalDeals: number; active: number; pendingApproval: number; totalRedemptions: number; totalDiscountedCents: number; tenantsWithDeals: number; }
import type { AdminDealRow } from '@aipowersalon/api-contracts/platform';
export type { AdminDealRow };   // the API contract (Super Admin → Deals Oversight)
/** Bugs 7 + 8: is the branch this salon's, and what does the catalog say the services cost? */
export interface CatalogCheck { branchOk: boolean; services: { id: string; priceCents: number; branchId: string }[] }
/** Bug 16: the nearby feed is filtered in SQL around the guest (bounding box), plus the customer app's filters. */
export interface NearbyQuery { origin?: { lat: number; lng: number } | null; radiusMiles?: number; ownerType?: string | null; maxPriceCents?: number | null; categoryId?: string | null; search?: string | null; newCustomerFriendly?: boolean }
export interface SavedDealCard { id: string; title: string; imageUrl: string | null; ownerType: string; technicianName: string | null; salonName: string | null; discountType: string; discountPercent: number | null; discountCents: number | null; originalPriceCents: number | null; finalPriceCents: number | null; savingsCents: number | null; status: string; }

// Persistence port for the deals domain. Kysely-backed in production; in-memory for dev/offline/tests.
export interface DealsRepositoryPort {
  /** BUILD_PLAN Phase 5: the capacity + application ledger (Kysely). Absent in the in-memory port (dev/offline). */
  ledger?: KyselyDealsLedger;
  catalogFor?(ctx: DealContext, branchId: string | null, serviceIds: string[]): Promise<CatalogCheck>;
  updateDealTerms?(ctx: DealContext, id: string, patch: Record<string, unknown>, finalPriceCents: number | null, serviceIds: string[] | null): Promise<DealView | null>;
  versions?(ctx: DealContext, id: string): Promise<{ version: number; terms: any; changedByUserId: string | null; createdAt: string | null }[]>;
  setTenantPlatform?(tenantId: string, patch: { disabled?: boolean; reason?: string | null; maxActiveDeals?: number | null }, actor: { userId: string | null }): Promise<any>;
  tenantsOverview?(): Promise<any[]>;
  countLiveDeals?(ctx: DealContext): Promise<number>;
  planGate?(ctx: DealContext): Promise<{ featureState: string | null; maxActiveDeals: number | null }>;
  /** Constitution 7 §34 — the platform Deals engine kill switch (platform_settings 'deals.engine_disabled'). */
  dealsEngineDisabled?(): Promise<boolean>;
  resolveTechnicianId(ctx: DealContext): Promise<string | null>;
  getSettings(ctx: DealContext): Promise<DealSettings>;
  upsertSettings(ctx: DealContext, s: Partial<DealSettings>): Promise<DealSettings>;
  countActiveDealsForTech(ctx: DealContext, technicianId: string): Promise<number>;
  insertDeal(ctx: DealContext, input: CreateDealInput, initialStatus: DealStatus, finalPriceCents: number): Promise<DealView>;
  getDeal(ctx: DealContext, id: string): Promise<DealView | null>;
  listDeals(ctx: DealContext, filter?: { status?: DealStatus; ownerType?: string; technicianId?: string; kind?: string }): Promise<DealView[]>;
  // Atomic guarded status write: only flips when the row is still in `fromStates`; returns the updated view or null.
  transitionStatus(ctx: DealContext, id: string, toStatus: DealStatus, fromStates: DealStatus[], approverUserId?: string | null): Promise<DealView | null>;
  recordApproval(ctx: DealContext, dealId: string, input: RecordApprovalInput): Promise<void>;
  // Public marketplace reads (cross-tenant; active only).
  nearbyActiveDealRows(q?: NearbyQuery): Promise<NearbyDealRow[]>;
  getPublicDealRow(id: string): Promise<any | null>;
  // In-memory (dev/offline) reservation path. The Kysely port uses `ledger` instead.
  reserveHold?(ctx: DealContext, dealId: string, customerId: string, idempotencyKey: string, expiresAtIso: string): Promise<ReserveResult>;
  releaseHold?(ctx: DealContext, holdId: string): Promise<boolean>;
  consumeHold?(ctx: DealContext, holdId: string, appointmentId: string, dealVersion: number): Promise<boolean>;
  getHold(ctx: DealContext, holdId: string): Promise<HoldRow | null>;
  findConsumedHoldForAppointment?(ctx: DealContext, appointmentId: string): Promise<ConsumedHold | null>;
  recordRedemption?(ctx: DealContext, input: RedemptionInput): Promise<RedemptionResult>;
  releaseForAppointment?(ctx: DealContext, appointmentId: string): Promise<boolean>;
  // Analytics + Super Admin oversight.
  recordEvent(tenantId: string, dealId: string, customerId: string | null, eventType: DealEventType): Promise<void>;
  dealAnalytics(ctx: DealContext): Promise<DealAnalyticsRow[]>;
  marketplaceOverview(): Promise<MarketplaceOverview>;
  listAllDeals(f: { status?: string | null; tenantId?: string | null; kind?: string | null; search?: string | null; suspended?: boolean | null }): Promise<AdminDealRow[]>;
  superSuspendDeal(dealId: string, reason: string, actor: { userId: string | null; role?: string | null }): Promise<{ suspended: boolean; releasedPlaces?: number; releasedApplications?: number; tenantId?: string | null }>;
  notifyTechnician(tenantId: string, technicianId: string, title: string, body: string | null): Promise<void>;
  techDealsFrozen(tenantId: string, technicianId: string): Promise<boolean>;
  /** Phase 5 (bug 8): the services this technician performs, at catalog price — what a technician deal can discount. */
  techServices?(ctx: DealContext, technicianId: string): Promise<{ id: string; name: string; priceCents: number }[]>;
  // User-scoped saves (shopper's personal list, cross-tenant).
  saveDeal(userId: string, dealId: string): Promise<{ saved: boolean; tenantId: string | null }>;
  unsaveDeal(userId: string, dealId: string): Promise<boolean>;
  listUserSaves(userId: string): Promise<SavedDealCard[]>;
  isSaved(userId: string, dealId: string): Promise<boolean>;
  appointmentIdForTicket(tenantId: string, ticketId: string): Promise<string | null>;
}

const DEFAULT_SETTINGS: DealSettings = {
  allowTechnicianDeals: 'off', maxDiscountPercent: null, maxFixedDiscountCents: null, minServicePriceCents: null,
  maxActiveDealsPerTech: null, maxRedemptionsCap: null, maxCampaignDurationDays: null,
  allowedNewCustomer: true, allowedExistingCustomer: true,
};

// In-memory port — deterministic, no persistence. Used when no database is present (dev/offline/tests).
export class InMemoryDealsRepository implements DealsRepositoryPort {
  private settings = new Map<string, DealSettings>();
  private deals = new Map<string, DealView>();
  private seq = 0;

  async resolveTechnicianId(ctx: DealContext): Promise<string | null> { return ctx.technicianId ?? null; }
  async getSettings(ctx: DealContext): Promise<DealSettings> { return this.settings.get(ctx.tenantId) ?? { ...DEFAULT_SETTINGS }; }
  async upsertSettings(ctx: DealContext, s: Partial<DealSettings>): Promise<DealSettings> {
    const merged = { ...(this.settings.get(ctx.tenantId) ?? DEFAULT_SETTINGS), ...s };
    this.settings.set(ctx.tenantId, merged); return merged;
  }
  async countActiveDealsForTech(ctx: DealContext, technicianId: string): Promise<number> {
    return [...this.deals.values()].filter((d) => d.tenantId === ctx.tenantId && d.technicianId === technicianId && ['active', 'pending_approval', 'approved', 'scheduled', 'paused'].includes(d.status)).length;
  }
  async insertDeal(ctx: DealContext, input: CreateDealInput, initialStatus: DealStatus, finalPriceCents: number): Promise<DealView> {
    const id = 'deal_' + (++this.seq);
    const view: DealView = {
      id, tenantId: ctx.tenantId, branchId: input.branchId ?? null, ownerType: input.ownerType, technicianId: input.technicianId ?? null,
      title: input.title, shortDescription: input.shortDescription ?? null, terms: input.terms ?? null, imageUrl: input.imageUrl ?? null,
      discountType: input.discountType, discountPercent: input.discountPercent ?? null, discountCents: input.discountCents ?? null,
      originalPriceCents: input.originalPriceCents ?? null, finalPriceCents, savingsCents: (input.originalPriceCents ?? 0) - finalPriceCents,
      serviceIds: input.serviceIds ?? [], startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
      newCustomersOnly: !!input.newCustomersOnly, memberOnly: !!input.memberOnly, maxRedemptions: input.maxRedemptions ?? null, maxPerCustomer: input.maxPerCustomer ?? null,
      stackable: !!input.stackable, allowTechSubstitution: !!input.allowTechSubstitution, status: initialStatus, redemptionCount: 0, version: 1, createdAt: new Date().toISOString(),
      createdByUserId: ctx.userId ?? null, approvedByUserId: null,
    };
    this.deals.set(id, view); return view;
  }
  async getDeal(ctx: DealContext, id: string): Promise<DealView | null> {
    const d = this.deals.get(id); return d && d.tenantId === ctx.tenantId ? d : null;
  }
  async listDeals(ctx: DealContext, filter?: { status?: DealStatus; ownerType?: string; technicianId?: string }): Promise<DealView[]> {
    return [...this.deals.values()].filter((d) => d.tenantId === ctx.tenantId
      && (!filter?.status || d.status === filter.status)
      && (!filter?.ownerType || d.ownerType === filter.ownerType)
      && (!filter?.technicianId || d.technicianId === filter.technicianId));
  }
  async transitionStatus(ctx: DealContext, id: string, toStatus: DealStatus, fromStates: DealStatus[], approverUserId?: string | null): Promise<DealView | null> {
    const d = this.deals.get(id);
    if (!d || d.tenantId !== ctx.tenantId || !fromStates.includes(d.status)) return null;
    d.status = toStatus; d.version += 1; if (approverUserId) d.approvedByUserId = approverUserId; this.deals.set(id, d); return d;
  }
  async recordApproval(): Promise<void> { /* in-memory: no separate ledger */ }
  async nearbyActiveDealRows(): Promise<NearbyDealRow[]> { return []; }
  async getPublicDealRow(id: string): Promise<any | null> { const d = this.deals.get(id); return d && d.status === 'active' ? d : null; }
  private holds = new Map<string, { id: string; dealId: string; idem: string; status: string; appointmentId: string | null; expiresAt: number }>();
  async reserveHold(_c: DealContext, dealId: string, _cust: string, idem: string, expiresAtIso: string): Promise<ReserveResult> {
    for (const h of this.holds.values()) if (h.dealId === dealId && h.idem === idem && h.status === 'held') return { soldOut: false, holdId: h.id, alreadyHeld: true };
    const deal = this.deals.get(dealId); const max = deal?.maxRedemptions ?? null;
    // Phase 5, bug 1: a booked (consumed) place still counts — only released/expired places come back
    const taken = [...this.holds.values()].filter((h) => h.dealId === dealId && (h.status === 'consumed' || (h.status === 'held' && h.expiresAt > Date.now()))).length;
    if (max != null && taken >= max) return { soldOut: true };
    const id = 'hold_' + (++this.seq); this.holds.set(id, { id, dealId, idem, status: 'held', appointmentId: null, expiresAt: Date.parse(expiresAtIso) });
    return { soldOut: false, holdId: id, alreadyHeld: false };
  }
  async releaseHold(_c: DealContext, holdId: string): Promise<boolean> { const h = this.holds.get(holdId); if (!h || h.status !== 'held') return false; h.status = 'released'; return true; }
  async consumeHold(_c: DealContext, holdId: string, appointmentId: string): Promise<boolean> { const h = this.holds.get(holdId); if (!h || h.status !== 'held') return false; h.status = 'consumed'; h.appointmentId = appointmentId; return true; }
  async getHold(_c: DealContext, holdId: string): Promise<HoldRow | null> { const h = this.holds.get(holdId); return h ? { id: h.id, dealId: h.dealId, status: h.status, appointmentId: h.appointmentId } : null; }
  private redemptions: { id: string; dealId: string; appointmentId: string; amount: number }[] = [];
  async findConsumedHoldForAppointment(_c: DealContext, appointmentId: string): Promise<ConsumedHold | null> {
    for (const h of this.holds.values()) if (h.appointmentId === appointmentId && h.status === 'consumed') { const d = this.deals.get(h.dealId); return { id: h.id, dealId: h.dealId, dealVersion: d?.version ?? 1 }; }
    return null;
  }
  async recordRedemption(_c: DealContext, input: RedemptionInput): Promise<RedemptionResult> {
    const prior = this.redemptions.find((r) => r.appointmentId === input.appointmentId && r.dealId === input.dealId);
    if (prior) return { id: prior.id, amountDiscountedCents: prior.amount, alreadyRedeemed: true };
    const id = 'redemption_' + (++this.seq); this.redemptions.push({ id, dealId: input.dealId, appointmentId: input.appointmentId, amount: input.amountDiscountedCents });
    const d = this.deals.get(input.dealId); if (d) d.redemptionCount = (d.redemptionCount ?? 0) + 1;
    return { id, amountDiscountedCents: input.amountDiscountedCents, alreadyRedeemed: false };
  }
  async releaseForAppointment(_c: DealContext, appointmentId: string): Promise<boolean> {
    if (this.redemptions.some((r) => r.appointmentId === appointmentId)) return false;
    let released = false;
    for (const h of this.holds.values()) if (h.appointmentId === appointmentId && (h.status === 'consumed' || h.status === 'held')) { h.status = 'released'; released = true; }
    return released;
  }
  private events: { dealId: string; type: string }[] = [];
  async recordEvent(_t: string, dealId: string, _c: string | null, eventType: DealEventType): Promise<void> { this.events.push({ dealId, type: eventType }); }
  async dealAnalytics(ctx: DealContext): Promise<DealAnalyticsRow[]> {
    const out: DealAnalyticsRow[] = [];
    for (const d of this.deals.values()) { if (d.tenantId !== ctx.tenantId) continue;
      const ev = (t: string) => this.events.filter((e) => e.dealId === d.id && e.type === t).length;
      out.push({ dealId: d.id, title: d.title, status: d.status, views: ev('view'), saves: ev('save'), bookingStarts: ev('booking_start'), bookings: ev('booking'), redemptions: ev('redemption'), discountedCents: this.redemptions.filter((r) => r.dealId === d.id).reduce((a, r) => a + r.amount, 0) });
    }
    return out;
  }
  async marketplaceOverview(): Promise<MarketplaceOverview> {
    const all = [...this.deals.values()];
    return { totalDeals: all.length, active: all.filter((d) => d.status === 'active').length, pendingApproval: all.filter((d) => d.status === 'pending_approval').length, totalRedemptions: all.reduce((a, d) => a + (d.redemptionCount || 0), 0), totalDiscountedCents: this.redemptions.reduce((a, r) => a + r.amount, 0), tenantsWithDeals: new Set(all.map((d) => d.tenantId)).size };
  }
  async listAllDeals(f: { status?: string | null }): Promise<AdminDealRow[]> {
    const status = f?.status ?? null;
    return [...this.deals.values()].filter((d) => !status || d.status === status).map((d) => ({ id: d.id, tenantId: d.tenantId, salonName: null, title: d.title, ownerType: d.ownerType, kind: d.kind ?? 'deal', status: d.status, redemptionCount: d.redemptionCount || 0, createdAt: null,
      suspendedReason: d.suspendedReason ?? null, suspendedAt: d.suspendedAt ?? null, discountType: d.discountType, discountPercent: d.discountPercent, discountCents: d.discountCents,
      maxRedemptions: d.maxRedemptions ?? null, budgetCents: d.budgetCents ?? null, budgetReservedCents: d.budgetReservedCents ?? 0, endsAt: d.endsAt ?? null }));
  }
  async superSuspendDeal(dealId: string, reason: string): Promise<{ suspended: boolean }> {
    const d = this.deals.get(dealId); if (!d) return { suspended: false };
    d.status = 'canceled'; (d as any).suspendedReason = reason; (d as any).suspendedAt = new Date().toISOString();
    for (const h of this.holds.values()) if (h.dealId === dealId && (h.status === 'held' || h.status === 'consumed')) h.status = 'released';
    return { suspended: true };
  }
  techNotes: { technicianId: string; title: string }[] = [];
  async notifyTechnician(_t: string, technicianId: string, title: string, _b: string | null): Promise<void> { this.techNotes.push({ technicianId, title }); }
  frozenTechs = new Set<string>();
  async techDealsFrozen(_tenantId: string, technicianId: string): Promise<boolean> { return this.frozenTechs.has(technicianId); }
  private saves = new Set<string>();
  async saveDeal(userId: string, dealId: string): Promise<{ saved: boolean; tenantId: string | null }> { const d = this.deals.get(dealId); if (!d) return { saved: false, tenantId: null }; this.saves.add(userId + ':' + dealId); return { saved: true, tenantId: d.tenantId }; }
  async unsaveDeal(userId: string, dealId: string): Promise<boolean> { return this.saves.delete(userId + ':' + dealId); }
  async isSaved(userId: string, dealId: string): Promise<boolean> { return this.saves.has(userId + ':' + dealId); }
  async appointmentIdForTicket(_t: string, _ticketId: string): Promise<string | null> { return null; }
  async listUserSaves(userId: string): Promise<SavedDealCard[]> {
    const out: SavedDealCard[] = [];
    for (const key of this.saves) { if (!key.startsWith(userId + ':')) continue; const d = this.deals.get(key.split(':')[1]); if (!d) continue;
      out.push({ id: d.id, title: d.title, imageUrl: d.imageUrl ?? null, ownerType: d.ownerType, technicianName: null, salonName: null, discountType: d.discountType, discountPercent: d.discountPercent ?? null, discountCents: d.discountCents ?? null, originalPriceCents: d.originalPriceCents ?? null, finalPriceCents: d.finalPriceCents ?? null, savingsCents: (d.originalPriceCents != null && d.finalPriceCents != null) ? Math.max(0, d.originalPriceCents - d.finalPriceCents) : null, status: d.status }); }
    return out;
  }
}
