import { checkCampaignLimits } from './campaign-limits-core';
import { systemContext } from '@aipowersalon/tenant-context';
// campaigns.service.ts — Campaign Center business logic. CRUD + a validated lifecycle (schedule/activate/complete/
// cancel via the state machine in the DTO), tenant-scoped reads with derived metrics + KPI roll-up, and durable audit
// of every mutation. Permission-gated; AuditService is injected (optional so direct-construction tests still work).
import type { CampaignsContext, CampaignsRepositoryPort } from './campaigns.repository';
import { hasPermission } from '@aipowersalon/permissions';
import type { AuditService } from '@aipowersalon/audit';
import { buildMarketingOverview, splitByOwner, type CampaignLike as MarketingCampaignLike } from './marketing-oversight-core';
import type { PlatformAnnouncementsService } from './platform-announcements.service';
import type { CampaignComplianceService } from './campaign-compliance.service';
import { estimateSmsSegments, LARGE_CAMPAIGN_RECIPIENTS, type CampaignCostPreview, foldVi, withCode } from '@aipowersalon/api-contracts';   // wave 3 PAYI §81
import type { CampaignDeliveryService } from './campaign-delivery.service';
import {
  type CampaignRow, type CampaignFilters, type CreateCampaignRequest, type UpdateCampaignRequest, type CampaignStatus, type CampaignKpis,
  canTransition, deriveMetrics, deriveKpis, normalizeChannel,
} from './campaigns.dto';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
/** A campaign refused by a platform limit. `code` says which; `message` is written for the salon owner. */
export class CampaignLimitError extends Error { constructor(public code: string, msg: string) { super(msg); this.name = 'CampaignLimitError'; } }
export class NotFoundError extends Error { constructor(msg = 'Campaign not found') { super(msg); this.name = 'NotFoundError'; } }
/** §81: the activate call must carry confirmEstimate: true for a large SMS campaign — the preview rides along (409). */
export class CampaignConfirmationRequiredError extends Error {
  readonly code = 'CAMPAIGN_CONFIRMATION_REQUIRED' as const;
  constructor(public readonly preview: CampaignCostPreview) { super(`This campaign will text ${preview.deliverable.toLocaleString()} customers (about ${preview.estimatedSegments.toLocaleString()} segments). Review the estimate and confirm before sending.`); this.name = 'CampaignConfirmationRequiredError'; }
}

export interface CampaignsState { kpis: CampaignKpis; campaigns: CampaignRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }

export class CampaignsService {
  constructor(private readonly repo: CampaignsRepositoryPort, private readonly auditSvc?: AuditService, private readonly announcements?: PlatformAnnouncementsService, private readonly compliance?: CampaignComplianceService, private readonly delivery?: CampaignDeliveryService) {}

  private assertUser(ctx: CampaignsContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated'); }
  private need(ctx: CampaignsContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }

  private audit(ctx: CampaignsContext, action: string, id?: string, metadata?: any) {
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'campaigns', action, resourceType: 'campaign', resourceId: id, metadata },
    );
  }

  async getState(ctx: CampaignsContext, f: CampaignFilters = {}): Promise<CampaignsState> {
    this.need(ctx, 'pos.marketing.view');
    const page = await this.repo.list(ctx.tenantId, f);
    const campaigns = page.items.map(deriveMetrics);
    // KPIs are computed across the unfiltered tenant set so the header tiles are stable regardless of table filters.
    const allForKpis = (await this.repo.list(ctx.tenantId, {})).items;
    return { kpis: deriveKpis(allForKpis), campaigns, pagination: page.pagination };
  }

  async list(ctx: CampaignsContext, f: CampaignFilters = {}): Promise<CampaignRow[]> {
    this.need(ctx, 'pos.marketing.view');
    return (await this.repo.list(ctx.tenantId, f)).items.map(deriveMetrics);
  }

  async detail(ctx: CampaignsContext, id: string): Promise<CampaignRow> {
    this.need(ctx, 'pos.marketing.view');
    const row = await this.repo.get(ctx, id);
    if (!row) throw new NotFoundError();
    return deriveMetrics(row);
  }

  async create(ctx: CampaignsContext, req: CreateCampaignRequest): Promise<CampaignRow> {
    this.need(ctx, 'pos.marketing.manage');
    if (!req?.name || !req.name.trim()) throw withCode(new ValidationError('Campaign name is required'), 'CAMPAIGN_NAME_REQUIRED');
    const row = await this.repo.create(ctx, { ...req, name: req.name.trim() });
    this.audit(ctx, 'campaign.created', row.id, { channel: row.channel, audienceSize: row.audienceSize });
    return deriveMetrics(row);
  }

  async update(ctx: CampaignsContext, id: string, patch: UpdateCampaignRequest): Promise<CampaignRow> {
    this.need(ctx, 'pos.marketing.manage');
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError();
    if (current.status === 'completed' || current.status === 'cancelled') throw withCode(new ValidationError('A ' + current.status + ' campaign cannot be edited'), 'CAMPAIGN_NOT_EDITABLE');
    const row = await this.repo.update(ctx, id, patch);
    if (!row) throw new NotFoundError();
    this.audit(ctx, 'campaign.updated', id);
    return deriveMetrics(row);
  }

  // Single transition entrypoint enforcing the lifecycle state machine.
  async transition(ctx: CampaignsContext, id: string, to: CampaignStatus): Promise<CampaignRow> {
    this.need(ctx, 'pos.marketing.manage');
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError();
    if (current.status === to) return deriveMetrics(current);
    if (!canTransition(current.status, to)) throw withCode(new ValidationError(`Cannot move a campaign from ${current.status} to ${to}`), 'CAMPAIGN_STATE_INVALID');
    if (to === 'in_progress') await this.enforceLimits(ctx, current);
    const row = await this.repo.setStatus(ctx, id, to);
    if (!row) throw new NotFoundError();
    this.audit(ctx, 'campaign.status_changed', id, { from: current.status, to });
    return deriveMetrics(row);
  }

  /**
   * Platform campaign limits, enforced at the ONE chokepoint every send passes through: the move into
   * 'in_progress'. The owner's Activate button and the background send sweep (systemTransition) both land here,
   * so neither can bypass a cap or a quiet window. Policy and reasoning: campaign-limits-core.ts.
   *
   * A limits READ ERROR refuses the start. The display screen tolerates a failed read; the send path must not,
   * because "could not read the limits" silently becoming "no limits" would lift every cap at once.
   */
  private async enforceLimits(ctx: CampaignsContext, campaign: CampaignRow): Promise<void> {
    if (!this.compliance) return;   // not wired (unit tests); production always injects it
    let limits;
    try { limits = await this.compliance.getLimitsStrict(); }
    catch { throw withCode(new CampaignLimitError('limits_unavailable', 'Campaign limits could not be checked right now, so this campaign was not started. Try again shortly.'), 'CAMPAIGN_LIMITS_UNAVAILABLE'); }
    if (!limits) return;
    const timeZone = await this.repo.salonTimezone(ctx, campaign.branchId);
    const facts = await this.repo.limitFacts(ctx, timeZone);
    const verdict = checkCampaignLimits(limits, { ...facts, audienceSize: campaign.audienceSize }, new Date(), timeZone);
    if (!verdict.ok) {
      this.audit(ctx, 'campaign.limit_blocked', campaign.id, { code: verdict.code });
      throw new CampaignLimitError(verdict.code, verdict.message);
    }
  }
  /** Campaign Center guide §08 / §18: nothing moves toward sending unless it is approved, unchanged since approval and has a
   *  real audience snapshot with ≥ 1 eligible customer. Applies to the existing schedule / activate routes too. */
  private async requireSendReady(ctx: CampaignsContext, id: string) {
    if (!this.repo.sendReadiness) return;   // in-memory adapter (unit tests of the legacy lifecycle)
    const r = await this.repo.sendReadiness(ctx, id);
    if (!r.ok) throw withCode(new CampaignLimitError(r.code, r.message), r.code);
  }
  /** the platform-limit check, without moving anything — Campaign Center's Launch calls it so a refusal shows immediately */
  async preflightLimits(ctx: CampaignsContext, id: string): Promise<void> {
    this.need(ctx, 'pos.marketing.manage');
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError();
    await this.enforceLimits(ctx, current);
  }
  async schedule(ctx: CampaignsContext, id: string) { this.need(ctx, 'pos.marketing.manage'); await this.requireSendReady(ctx, id); return this.transition(ctx, id, 'scheduled'); }
  /** §81: a large SMS campaign is activated only with an explicit, authorized confirmation of its cost preview. */
  async activate(ctx: CampaignsContext, id: string, opts: { confirmEstimate?: boolean } = {}) {
    this.need(ctx, 'pos.marketing.manage');
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError();
    if (current.status !== 'in_progress' && normalizeChannel(current.channel) === 'sms') {
      const preview = await this.costPreview(ctx, id);
      if (preview.requiresConfirmation && !opts.confirmEstimate) {
        this.audit(ctx, 'campaign.confirmation_required', id, { recipients: preview.deliverable, estimatedSegments: preview.estimatedSegments, estimatedCostCents: preview.estimatedCostCents });
        throw new CampaignConfirmationRequiredError(preview);
      }
      if (preview.requiresConfirmation) this.audit(ctx, 'campaign.cost_confirmed', id, { recipients: preview.deliverable, estimatedSegments: preview.estimatedSegments, estimatedCostCents: preview.estimatedCostCents });
    }
    await this.requireSendReady(ctx, id);
    return this.transition(ctx, id, 'in_progress');
  }

  /**
   * §81 Marketing Campaign Cost Preview: recipients, opted-out numbers (never texted — §68), the segment estimate for
   * the message as it will go out (offer + the STOP footer), and the cost when the platform has priced marketing
   * segments. Honest: an unpriced platform yields null cost, never a guess; no marketing allowance is modelled yet, so
   * includedRemaining is null and every segment is overage.
   */
  async costPreview(ctx: CampaignsContext, id: string): Promise<CampaignCostPreview> {
    this.need(ctx, 'pos.marketing.view');
    const c = await this.repo.get(ctx, id);
    if (!c) throw new NotFoundError();
    const facts = this.repo.costFacts ? await this.repo.costFacts(ctx) : { optedOutSms: 0, segmentPriceCents: null, salonName: null };
    const text = `${facts.salonName ? facts.salonName + ': ' : ''}${c.offer || c.name} Reply STOP to opt out`;
    const est = estimateSmsSegments(text);
    const recipients = Math.max(0, Number(c.audienceSize || 0));
    const optedOut = Math.min(recipients, Math.max(0, facts.optedOutSms));
    const deliverable = recipients - optedOut;
    const estimatedSegments = deliverable * est.segments;
    const priced = facts.segmentPriceCents != null;
    return {
      campaignId: c.id, channel: normalizeChannel(c.channel), recipients, optedOut, deliverable,
      segmentsPerMessage: est.segments, encoding: est.encoding, estimatedSegments,
      includedRemaining: null, estimatedOverageSegments: priced ? estimatedSegments : null,
      unitPriceCents: facts.segmentPriceCents, estimatedCostCents: priced ? estimatedSegments * (facts.segmentPriceCents as number) : null,
      requiresConfirmation: normalizeChannel(c.channel) === 'sms' && deliverable >= LARGE_CAMPAIGN_RECIPIENTS, confirmationThreshold: LARGE_CAMPAIGN_RECIPIENTS,
    };
  }
  complete(ctx: CampaignsContext, id: string) { return this.transition(ctx, id, 'completed'); }
  cancel(ctx: CampaignsContext, id: string) { return this.transition(ctx, id, 'cancelled'); }

  // --- system (worker) path -------------------------------------------------------------------------------
  // For TRUSTED internal jobs only (e.g. the AI Marketing send sweep). These carry no user and skip the
  // pos.marketing.* permission check — the guarded user methods above are unchanged. They remain tenant-scoped
  // (explicit tenantId), enforce the SAME state machine, and audit with actor 'system'. Never expose on a route.
  private systemCtx(tenantId: string): CampaignsContext {
    return systemContext({ tenantId, actor: 'campaigns' }) as unknown as CampaignsContext;
  }
  async systemDetail(tenantId: string, id: string): Promise<CampaignRow> {
    const row = await this.repo.get(this.systemCtx(tenantId), id);
    if (!row) throw new NotFoundError();
    return deriveMetrics(row);
  }
  async systemTransition(tenantId: string, id: string, to: CampaignStatus): Promise<CampaignRow> {
    const ctx = this.systemCtx(tenantId);
    const current = await this.repo.get(ctx, id);
    if (!current) throw new NotFoundError();
    if (current.status === to) return deriveMetrics(current);
    if (!canTransition(current.status, to)) throw withCode(new ValidationError(`Cannot move a campaign from ${current.status} to ${to}`), 'CAMPAIGN_STATE_INVALID');
    // The send sweep's start goes through the SAME platform limits as the owner's Activate (it never did before — the comment
    // on enforceLimits promised it): a capped day or a quiet window leaves the campaign scheduled for the next tick.
    if (to === 'in_progress') await this.enforceLimits(ctx, current);
    const row = await this.repo.setStatus(ctx, id, to);
    if (!row) throw new NotFoundError();
    this.audit(ctx, 'campaign.status_changed', id, { from: current.status, to, actor: 'system' });
    return deriveMetrics(row);
  }

  // Super-Admin cross-tenant explorer (the controller enforces the guard).
  async listPlatform(f: CampaignFilters & { tenantId?: string } = {}) {
    const page = await this.repo.listPlatform(f);
    return { campaigns: page.items.map(deriveMetrics), pagination: page.pagination };
  }

  // Marketing & Campaigns oversight (reference page): 13 KPIs + platform/tenant directory split + channel mix +
  // revenue/top campaigns, computed via the pure engine over the cross-tenant campaigns set. Reuses listPlatform;
  // adds no new table. Delivery rate / opt-out / compliance / delivery failures have no backing column → NotConnected.
  async getMarketingOverview(f: (CampaignFilters & { tenantId?: string; page?: number; pageSize?: number; ownerType?: string; channel?: string; status?: string }) = {}) {
    const items = (await this.repo.listPlatform({ tenantId: f.tenantId })).items as any[];
    const tenantRows: MarketingCampaignLike[] = items.map((c) => ({
      id: c.id, ownerType: (c.ownerType as any) ?? 'tenant', tenantId: c.tenantId ?? null, tenantName: c.tenantName ?? null,
      branchId: c.branchId ?? null, branchName: c.branchName ?? null, name: c.name, channel: c.channel || 'other',
      audienceSize: Number(c.audienceSize || 0), status: c.status || 'draft', scheduledAt: c.scheduledAt ?? null,
      sentCount: Number(c.sentCount || 0), openCount: Number(c.openCount || 0), clickCount: Number(c.clickCount || 0),
      bookingCount: Number(c.bookingCount || 0), revenueCents: Number(c.revenueCents || 0),
    }));
    // Union platform announcements (ownerType 'platform') when the tenant filter is not scoping to one tenant.
    const platformRows: MarketingCampaignLike[] = (!f.tenantId && this.announcements)
      ? (await this.announcements.listForOversight()).map((a) => ({ ...a }))
      : [];
    const rows: MarketingCampaignLike[] = [...platformRows, ...tenantRows];

    const overview = buildMarketingOverview(rows, this.delivery ? await this.delivery.deliveryKpis(String(f.tenantId ?? '')) : undefined);
    const { platform, tenant } = splitByOwner(rows);

    // Apply directory-level filters (channel / status / ownerType) then paginate the combined platform-first list.
    const applyFilters = (r: import('./marketing-oversight-core').DirectoryRow) =>
      (!f.channel || r.channel === f.channel) && (!f.status || r.status === f.status) && (!f.ownerType || r.ownerType === f.ownerType);
    const platformF = platform.filter(applyFilters);
    const tenantF = tenant.filter(applyFilters);
    const combined = [...platformF, ...tenantF];
    const page = Math.max(1, f.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, f.pageSize ?? 10));
    const start = (page - 1) * pageSize;

    return {
      kpis: overview.kpis,
      channelMix: overview.channelMix,
      revenueByCampaign: overview.revenueByCampaign,
      topCampaigns: overview.topCampaigns,
      rankingMetric: overview.rankingMetric,
      counts: overview.counts,
      directory: {
        platform: platformF,
        tenant: tenantF,
        page: combined.slice(start, start + pageSize),
      },
      directoryTotal: combined.length,
      pagination: { page, pageSize, totalItems: combined.length, totalPages: Math.max(1, Math.ceil(combined.length / pageSize)) },
      // Honest: no schema → NotConnected; real when the delivery model is present.
      deliveryFailures: this.delivery ? await this.delivery.failureSummary(String(f.tenantId ?? '')) : { available: false },
      // Scoped to the tenant in the filter. When there is none this returns NOTHING rather than every tenant's
      // flags — the failure mode of a scoping bug must be "see less", never "see all".
      complianceAlerts: this.compliance ? await this.compliance.alertsSummary(String(f.tenantId ?? '')) : { available: false },
      performanceTrend: this.delivery ? await this.delivery.performanceTrend(7) : { available: false, points: [] },
    };
  }

  // Super-Admin Campaign Manager state (S10): platform KPIs over the unfiltered cross-tenant set (stable regardless of
  // table filters) + the filtered/paginated campaign rows. Optional tenantId scopes the whole view to one tenant.
  async getPlatformState(f: CampaignFilters & { tenantId?: string } = {}) {
    const all = (await this.repo.listPlatform({ tenantId: f.tenantId })).items;
    const page = await this.repo.listPlatform(f);
    // platform-wide channel & status distributions over the unfiltered set (stable regardless of table filters)
    const chMap = new Map<string, { count: number; reach: number }>();
    const stMap = new Map<string, number>();
    for (const c of all as any[]) {
      const ch = c.channel || 'other'; const e = chMap.get(ch) || { count: 0, reach: 0 };
      e.count++; e.reach += Number(c.audience_size ?? c.audienceSize ?? 0); chMap.set(ch, e);
      const stt = c.status || 'unknown'; stMap.set(stt, (stMap.get(stt) || 0) + 1);
    }
    const byChannel = [...chMap.entries()].map(([channel, v]) => ({ channel, count: v.count, reach: v.reach })).sort((a, b) => b.reach - a.reach);
    const byStatus = [...stMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
    // --- additional S10 rollups over the unfiltered set (all real, derived from the campaign rows) ---
    const A = all;
    const sum = (f: (r: any) => number) => A.reduce((a, r) => a + (Number(f(r)) || 0), 0);
    const totalSent = sum((r) => r.sentCount); const bookingsTotal = sum((r) => r.bookingCount);
    const clicksTotal = sum((r) => r.clickCount); const openTotal = sum((r) => r.openCount); const repliesTotal = sum((r) => r.replyCount);
    const revenueTotal = sum((r) => r.revenueCents);
    const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    // monthly revenue + bookings (last 6 calendar months by createdAt)
    const mMap = new Map<string, { revenueCents: number; bookings: number; sortKey: string }>();
    for (const c of A) {
      const d = new Date(c.createdAt); if (isNaN(+d)) continue;
      const key = d.toLocaleString('en-US', { month: 'short' }); const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const e = mMap.get(key) || { revenueCents: 0, bookings: 0, sortKey }; e.revenueCents += Number(c.revenueCents || 0); e.bookings += Number(c.bookingCount || 0); e.sortKey = sortKey; mMap.set(key, e);
    }
    const byMonth = [...mMap.entries()].map(([month, v]) => ({ month, revenueCents: v.revenueCents, bookings: v.bookings, sortKey: v.sortKey })).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(-6).map(({ sortKey, ...x }) => x);
    // promotion / offer performance (by offer label)
    const oMap = new Map<string, { redemptions: number; revenueCents: number }>();
    for (const c of A) { const o = (c.offer || '').trim(); if (!o) continue; const e = oMap.get(o) || { redemptions: 0, revenueCents: 0 }; e.redemptions += Number(c.bookingCount || 0); e.revenueCents += Number(c.revenueCents || 0); oMap.set(o, e); }
    const byOffer = [...oMap.entries()].map(([offer, v]) => ({ offer, redemptions: v.redemptions, revenueCents: v.revenueCents })).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 6);
    // customer segments (by campaign audience label → total audience reached)
    const aMap = new Map<string, number>();
    for (const c of A) { const lbl = (c.audienceLabel || '').trim(); if (!lbl) continue; aMap.set(lbl, (aMap.get(lbl) || 0) + Number(c.audienceSize || 0)); }
    const bySegment = [...aMap.entries()].map(([label, size]) => ({ label, size })).sort((a, b) => b.size - a.size).slice(0, 6);
    // upcoming scheduled campaigns
    const scheduled = A.filter((c) => c.status === 'scheduled' && c.scheduledAt).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))
      .slice(0, 6).map((c) => ({ name: c.name, scheduledAt: c.scheduledAt, audienceLabel: c.audienceLabel || '—', status: c.status, branchId: c.branchId }));
    // recent marketing activity
    const recentActivity = [...A].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6)
      .map((c) => ({ name: c.name, status: c.status, channel: c.channel, at: c.updatedAt, action: new Date(c.createdAt).getTime() === new Date(c.updatedAt).getTime() ? 'created' : 'updated' }));
    return {
      kpis: deriveKpis(all), campaigns: page.items.map(deriveMetrics), pagination: page.pagination, byChannel, byStatus,
      extraKpis: { bookingsTotal, revenueTotalCents: revenueTotal, clicksTotal, openTotal, repliesTotal, avgCtr: pctOf(clicksTotal, totalSent), conversionRate: pctOf(bookingsTotal, totalSent), totalReach: sum((r) => r.audienceSize) },
      byMonth, byOffer, bySegment, scheduled, recentActivity,
    };
  }

  // Super-Admin Promotions & Offers (S11). No dedicated coupon/bundle schema exists yet, so promotions are the
  // offer-bearing campaigns across all tenants. Real promotion metrics come from those rows (redemptions = bookings
  // driven, attributed revenue); coupon codes, redemption-rate analytics, bundles and loyalty offers are not modelled.
  async getPlatformPromotions(f: { status?: string; search?: string; page?: number; pageSize?: number; tenantId?: string } = {}) {
    const all = (await this.repo.listPlatform({ tenantId: f.tenantId })).items;
    const offerOf = (c: any) => (c.offer ?? '').toString().trim();
    let promos = all.filter((c) => offerOf(c).length > 0);
    if (f.status) promos = promos.filter((c) => c.status === f.status);
    if (f.search) { const q = foldVi(f.search); promos = promos.filter((c) => foldVi(c.name).includes(q) || foldVi(offerOf(c)).includes(q)); }   // accent-insensitive (§41)
    const active = promos.filter((c) => c.status === 'in_progress' || c.status === 'scheduled').length;
    const scheduled = promos.filter((c) => c.status === 'scheduled').length;
    const redemptions = promos.reduce((a, c) => a + Number(c.bookingCount ?? 0), 0);
    const revenue = promos.reduce((a, c) => a + Number(c.revenueCents ?? 0), 0);
    // offer breakdown by the human offer text (best available "type" signal)
    const offerMap = new Map<string, { count: number; redemptions: number; revenue: number }>();
    for (const c of promos) { const key = offerOf(c); const e = offerMap.get(key) || { count: 0, redemptions: 0, revenue: 0 }; e.count++; e.redemptions += Number(c.bookingCount ?? 0); e.revenue += Number(c.revenueCents ?? 0); offerMap.set(key, e); }
    const byOffer = [...offerMap.entries()].map(([offer, v]) => ({ offer, ...v })).sort((a, b) => b.revenue - a.revenue);
    // --- additional S11 rollups (all real, derived from the offer-bearing campaign rows) ---
    const sentTotal = promos.reduce((a, c) => a + Number(c.sentCount ?? 0), 0);
    const reachTotal = promos.reduce((a, c) => a + Number(c.audienceSize ?? 0), 0);
    const costTotal = promos.reduce((a, c) => a + Number(c.costCents ?? 0), 0);
    const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    // monthly promo revenue + redemptions (last 6 months by createdAt)
    const mMap = new Map<string, { revenueCents: number; redemptions: number; sortKey: string }>();
    for (const c of promos) { const d = new Date(c.createdAt); if (isNaN(+d)) continue; const key = d.toLocaleString('en-US', { month: 'short' }); const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const e = mMap.get(key) || { revenueCents: 0, redemptions: 0, sortKey }; e.revenueCents += Number(c.revenueCents ?? 0); e.redemptions += Number(c.bookingCount ?? 0); e.sortKey = sortKey; mMap.set(key, e); }
    const byMonth = [...mMap.entries()].map(([month, v]) => ({ month, revenueCents: v.revenueCents, redemptions: v.redemptions, sortKey: v.sortKey })).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(-6).map(({ sortKey, ...x }) => x);
    // customer segments responding best (by audience label → redemptions & response rate)
    const segMap = new Map<string, { redemptions: number; reach: number }>();
    for (const c of promos) { const lbl = (c.audienceLabel || '').trim(); if (!lbl) continue; const e = segMap.get(lbl) || { redemptions: 0, reach: 0 }; e.redemptions += Number(c.bookingCount ?? 0); e.reach += Number(c.audienceSize ?? 0); segMap.set(lbl, e); }
    const bySegment = [...segMap.entries()].map(([label, v]) => ({ label, redemptions: v.redemptions, responseRate: pctOf(v.redemptions, v.reach) })).sort((a, b) => b.redemptions - a.redemptions).slice(0, 6);
    // upcoming scheduled promos + recent activity
    const scheduledList = promos.filter((c) => c.status === 'scheduled' && c.scheduledAt).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).slice(0, 6)
      .map((c) => ({ name: c.name, scheduledAt: c.scheduledAt, audienceLabel: c.audienceLabel || '—', status: c.status, branchId: c.branchId }));
    const recentActivity = [...promos].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6)
      .map((c) => ({ name: c.name, status: c.status, offer: offerOf(c) || null, at: c.updatedAt, action: new Date(c.createdAt).getTime() === new Date(c.updatedAt).getTime() ? 'created' : 'updated' }));
    const page = Math.max(1, f.page || 1); const ps = Math.min(100, f.pageSize || 50);
    const sorted = [...promos].sort((a, b) => Number(b.revenueCents ?? 0) - Number(a.revenueCents ?? 0));
    const rows = sorted.slice((page - 1) * ps, page * ps).map((c) => ({
      id: c.id, tenantId: c.tenantId, name: c.name, offer: offerOf(c) || null, audience: c.audienceLabel || null,
      status: c.status, scheduledAt: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
      redemptions: Number(c.bookingCount ?? 0), revenueCents: Number(c.revenueCents ?? 0),
    }));
    return {
      kpis: { activePromotions: active, scheduledPromotions: scheduled, totalPromotions: promos.length, totalRedemptions: redemptions, promoRevenueCents: revenue, avgRedemptionsPerPromo: promos.length ? Math.round(redemptions / promos.length) : 0 },
      extraKpis: { rebookingConversion: pctOf(redemptions, sentTotal), avgOrderValueCents: redemptions ? Math.round(revenue / redemptions) : 0, roi: costTotal > 0 ? Math.round((revenue / costTotal) * 10) / 10 : 0, redemptionRate: pctOf(redemptions, reachTotal), totalReach: reachTotal },
      promotions: rows, byOffer, byMonth, bySegment, scheduled: scheduledList, recentActivity,
      pagination: { page, pageSize: ps, total: promos.length, totalPages: Math.max(1, Math.ceil(promos.length / ps)) },
    };
  }
}
