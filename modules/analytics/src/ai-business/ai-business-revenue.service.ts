// ai-business-revenue.service.ts — the first authorized DATA tools for the AI Business Assistant:
//   • getRevenueSummary(ctx, preset)            — structured, explicit money terms for one period
//   • explainRevenueChange(ctx, preset, cmp)    — exact price×volume contribution bridge between two periods
//
// Reuse-don't-duplicate (spec §3, §21): revenue is NOT recomputed here. Both tools call the existing
// ReportsService.getSales(), which returns the authoritative SalesKpis and self-enforces pos.reports.financial_view.
// So the AI answer's revenue is, by construction, the SAME number the Sales report shows — the spec's core
// metric-consistency requirement (§52 metric-consistency, §60). We only add evidence + an exact algebraic bridge.
//
// Isolation (spec §5): the ReportsContext is built ONLY from the trusted ctx (tenantId/branchId/role/permissions).
// No client-supplied tenant or branch is ever accepted here; branch scope stays server-derived.
import { type ReportsContext, type ReportFilters, type DatePreset, type SalesKpis, type SalesTrend, ForbiddenError } from '@aipowersalon/reports';
import { getMetric } from './ai-business-metrics';
import {
  AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext, presetAllowed, rangeFilters } from './ai-business.dto';
import type {
  RevenueSummary, RevenueEvidence, RevenueChangeExplanation, ContributionItem,
} from './ai-business-revenue.dto';

/** Minimal structural port for the reused reports service (ReportsService satisfies this). Keeps the tool unit-
 *  testable with a fake, and keeps the runtime dependency one-way (ai-business → reports). */
export interface RevenueSource {
  getSales(ctx: ReportsContext, f?: ReportFilters): Promise<{ kpis: SalesKpis; trend: SalesTrend }>;
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'];

function reportsCtx(ctx: AiBusinessContext): ReportsContext {
  return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
}
const dir = (n: number): ContributionItem['direction'] => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

export class AiBusinessRevenueService {
  constructor(private readonly reports: RevenueSource) {}

  private assertAuthed(ctx: AiBusinessContext): void {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
  }
  private resolvePreset(input: string | undefined, fallback: DatePreset, ctx?: AiBusinessContext): DatePreset {
    if (input == null) return fallback;
    if (!(ctx ? presetAllowed(ctx, input, VALID_PRESETS) : VALID_PRESETS.includes(input as DatePreset))) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    return input as DatePreset;
  }
  /** Pull authoritative KPIs, translating the reports layer's ForbiddenError into the stable ai_business taxonomy. */
  private async sales(ctx: AiBusinessContext, preset: DatePreset, period: 'current' | 'previous' = 'current'): Promise<SalesKpis> {
    try {
      const { kpis } = await this.reports.getSales(reportsCtx(ctx), { preset, period, ...rangeFilters(ctx, preset) });
      return kpis;
    } catch (e) {
      if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
      throw e;
    }
  }
  private evidence(metricId: string, preset: DatePreset, comparePreset?: DatePreset): RevenueEvidence {
    const m = getMetric(metricId)!; // metricId is a literal we control
    return {
      metricId: m.id, definition: m.description, preset, comparePreset,
      freshnessClass: m.freshness, partialCurrentPeriod: preset === 'today',
      drilldownRoute: m.drilldownRoute, branchScope: 'server_derived',
    };
  }

  async getRevenueSummary(ctx: AiBusinessContext, presetInput?: string): Promise<RevenueSummary> {
    this.assertAuthed(ctx);
    const preset = this.resolvePreset(presetInput, 'today', ctx);
    const k = await this.sales(ctx, preset);
    return {
      netSalesCents: k.netSalesCents, grossSalesCents: k.grossSalesCents,
      serviceSalesCents: k.serviceSalesCents, productSalesCents: k.productSalesCents,
      discountsCents: k.discountsCents, refundsCents: k.refundsCents,
      tipsCents: k.tipsCents, taxCollectedCents: k.taxCollectedCents,
      ticketsCount: k.ticketsCount, customersCount: k.customersCount, averageTicketCents: k.averageTicketCents,
      evidence: this.evidence('net_sales', preset),
    };
  }

  /** Exact contribution bridge: Δnet = volumeEffect + rateEffect, where
   *    volumeEffect = (tickets_cur − tickets_prev) × avgTicket_prev
   *    rateEffect   = (avgTicket_cur − avgTicket_prev) × tickets_cur
   *  These two ALWAYS sum to the net change (standard price×volume decomposition), so no cause is invented. Refund
   *  and discount deltas are shown as CONTEXTUAL (already inside net) and never double-counted. */
  async explainRevenueChange(ctx: AiBusinessContext, presetInput?: string, comparePresetInput?: string): Promise<RevenueChangeExplanation> {
    this.assertAuthed(ctx);
    const preset = this.resolvePreset(presetInput, 'today');
    // Nov 3 audit: with no explicit comparison, compare with the EQUIVALENT PREVIOUS period (This Month → last month to the
    // same day). It used to default to 'month', so This Month was compared with itself and This Week / This Year with an
    // overlapping month. An explicit comparison preset that equals the current one also means "the previous one".
    const explicit = comparePresetInput ? this.resolvePreset(comparePresetInput, preset) : null;
    const usePrevious = !explicit || explicit === preset;
    const comparePreset: DatePreset = usePrevious ? preset : explicit!;
    const cur = await this.sales(ctx, preset);
    const prev = await this.sales(ctx, comparePreset, usePrevious ? 'previous' : 'current');

    const changeCents = cur.netSalesCents - prev.netSalesCents;
    const volumeEffect = (cur.ticketsCount - prev.ticketsCount) * prev.averageTicketCents;
    const rateEffect = changeCents - volumeEffect; // guarantees volume+rate === Δnet exactly, avoids rounding drift
    const refundsDelta = cur.refundsCents - prev.refundsCents;
    const discountsDelta = cur.discountsCents - prev.discountsCents;

    const contributors: ContributionItem[] = [
      {
        factor: 'Appointment/ticket volume', deltaCents: volumeEffect, direction: dir(volumeEffect),
        confidence: 'confirmed',
        note: `${cur.ticketsCount - prev.ticketsCount >= 0 ? '+' : ''}${cur.ticketsCount - prev.ticketsCount} tickets at the prior average ticket.`,
      },
      {
        factor: 'Average ticket', deltaCents: rateEffect, direction: dir(rateEffect),
        confidence: 'confirmed',
        note: `Average ticket moved from ${prev.averageTicketCents}\u00A2 to ${cur.averageTicketCents}\u00A2.`,
      },
    ];
    if (refundsDelta !== 0) contributors.push({
      factor: 'Refunds (within net)', deltaCents: -refundsDelta, direction: dir(-refundsDelta), confidence: 'contextual',
      note: 'Refunds already reduce net sales; shown for context, not added on top.',
    });
    if (discountsDelta !== 0) contributors.push({
      factor: 'Discounts (within net)', deltaCents: -discountsDelta, direction: dir(-discountsDelta), confidence: 'contextual',
      note: 'Discounts already reduce net sales; shown for context, not added on top.',
    });

    const caveats: string[] = [];
    if (preset === 'today') caveats.push('The current period includes an incomplete day; today\u2019s figures are partial and not directly comparable to a full prior period.');
    caveats.push('This bridge shows which measured factors account for the change. It does not establish that any operational choice caused it \u2014 association is not proof of causation.');

    return {
      currentNetCents: cur.netSalesCents, previousNetCents: prev.netSalesCents,
      changeCents, changePercent: prev.netSalesCents === 0 ? null : (changeCents / prev.netSalesCents) * 100,
      contributors, caveats, evidence: { ...this.evidence('net_sales', preset, comparePreset), compareWindow: usePrevious ? 'previous' : 'current' },
    };
  }
}
