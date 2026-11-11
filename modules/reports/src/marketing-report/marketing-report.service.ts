// marketing-report.service.ts — composes campaigns + salon promotions + reviews into one marketing view.
// Reuses each domain's own service.getState (no duplicated aggregation). The controller enforces
// pos.marketing.view; each sub-service is tenant-scoped from ctx.
import { composeHeadline, localDay, campaignsInWindow, reviewsInWindow, promotionsInWindow, type MarketingReportContext, type MarketingReportState, type MarketingPeriod } from './marketing-report.dto';
import { deriveKpis, type CampaignsService, type CampaignRow } from '@aipowersalon/communications';
import { buildSalonPromotionsSummary, type SalonPromotionsService } from '@aipowersalon/deals';
import { buildReviewsSummary, type ReviewsService } from '@aipowersalon/customers';
import { branchTimeZone } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { presetRange } from '../reports/reports.kysely.repository';

export class MarketingReportForbiddenError extends Error {}
export class MarketingReportValidationError extends Error {}
export interface MarketingReportQuery { preset?: string; from?: string; to?: string }
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS = new Set(['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month']);

export class MarketingReportService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly promotions: SalonPromotionsService,
    private readonly reviews: ReviewsService,
    private readonly db: unknown = null,   // read handle — only for the salon's time zone when a period is asked
  ) {}

  /** the window a query names, in salon-local days — null = all time (the report's original view) */
  async resolvePeriod(ctx: MarketingReportContext, q: MarketingReportQuery = {}, now = new Date()): Promise<MarketingPeriod | null> {
    const preset = (q.preset || '').trim();
    if (!preset || preset === 'all') return null;
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null);
    if (preset === 'custom') {
      const from = String(q.from || ''), to = String(q.to || '');
      if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) throw withCode(new MarketingReportValidationError('The start date must be on or before the end date.'), 'DATE_RANGE_INVALID');
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 366) throw withCode(new MarketingReportValidationError('Choose a range of 366 days or fewer.'), 'DATE_RANGE_TOO_LARGE');
      return { from, to, preset: 'custom', timeZone: tz, today: localDay(now.toISOString(), tz)! };
    }
    if (!PRESETS.has(preset)) throw withCode(new MarketingReportValidationError('Choose a period from the list.'), 'DATE_RANGE_INVALID');
    return { ...presetRange(preset, now, tz), preset, timeZone: tz, today: localDay(now.toISOString(), tz)! };
  }

  /** every campaign row (the Campaigns list pages at 200) — a period is applied to the rows, not to a first page */
  private async allCampaigns(subCtx: MarketingReportContext): Promise<CampaignRow[]> {
    const out: CampaignRow[] = [];
    for (let page = 1; page <= 50; page++) {
      const st = await this.campaigns.getState(subCtx, { page, pageSize: 200 });
      out.push(...st.campaigns);
      if (page >= (st.pagination?.totalPages ?? 1)) break;
    }
    return out;
  }

  async getState(ctx: MarketingReportContext, q: MarketingReportQuery = {}): Promise<MarketingReportState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new MarketingReportForbiddenError('Not authenticated');
    // The controller guard already enforced pos.marketing.view for this endpoint. The sub-services do
    // their own defense-in-depth check against the granular permission string, so pass a context that
    // carries it (all three pillars share the same pos.marketing.view gate — no privilege is widened).
    const subCtx = { ...ctx, permissions: Array.from(new Set([...(ctx.permissions || []), 'pos.marketing.view'])) };
    const period = await this.resolvePeriod(ctx, q);
    const [campAll, promo, revs] = await Promise.all([
      period ? null : this.campaigns.getState(subCtx),
      this.promotions.getState(subCtx),
      this.reviews.getState(subCtx),
    ]);
    // with a period the pillars are rebuilt by each domain's OWN summary function over the rows inside the window
    const camp = campAll ?? { kpis: deriveKpis(campaignsInWindow(await this.allCampaigns(subCtx), period!, period!.timeZone)) };
    const pk = period ? buildSalonPromotionsSummary(promotionsInWindow(promo.promotions, period, period.timeZone), new Date().toISOString()) : promo.kpis;
    const rk = period ? buildReviewsSummary(reviewsInWindow(revs.reviews, period, period.timeZone)) : revs.kpis;
    const campaigns = {
      totalCampaigns: camp.kpis.totalCampaigns, activeCampaigns: camp.kpis.activeCampaigns, totalSent: camp.kpis.totalSent,
      campaignRevenueCents: camp.kpis.campaignRevenueCents, totalCostCents: camp.kpis.totalCostCents,
      avgRoi: camp.kpis.avgRoi, avgOpenRate: camp.kpis.avgOpenRate,
    };
    const promotions = {
      total: pk.total, active: pk.active, paused: pk.paused,
      totalRedemptions: pk.totalRedemptions, expiringSoon: pk.expiringSoon,
    };
    const reviews = {
      totalReviews: rk.totalReviews, averageRating: rk.averageRating, fiveStarPercent: rk.fiveStarPercent,
      publicCount: rk.publicCount, hiddenCount: rk.hiddenCount,
    };
    return { period, ...(period ? { redemptionsAllTime: true } : {}), headline: composeHeadline(campaigns, promotions, reviews), campaigns, promotions, reviews };
  }
}
