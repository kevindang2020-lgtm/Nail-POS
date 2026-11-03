// ai-business-revenue.dto.ts — response contracts for the revenue tools. Pure types only.
// These wrap the AUTHORITATIVE SalesKpis produced by the existing ReportsService with metric-registry evidence
// (§22) and an explicit contribution bridge (§12). No revenue is recomputed here — the tools read ReportsService.
import type { DatePreset } from '@aipowersalon/reports';
import type { MetricDefinition } from './ai-business-metrics';

/** Evidence block attached to every answer so it is trustworthy without exposing DB internals (§22). */
export interface RevenueEvidence {
  metricId: string;
  definition: string;                 // human-readable metric definition from the registry
  preset: DatePreset;
  comparePreset?: DatePreset;
  /** 'previous' = the equivalent previous period of comparePreset (same length, to the same point) */
  compareWindow?: 'previous' | 'current';
  freshnessClass: MetricDefinition['freshness'];
  partialCurrentPeriod: boolean;      // true when the current window includes an incomplete day (§10)
  drilldownRoute: string;             // real POS report route
  branchScope: 'server_derived';      // branch is always ctx-derived, never client-supplied (§5)
}

/** Structured revenue summary — explicit money terms (§9): net vs gross vs service vs product, tips/taxes separate. */
export interface RevenueSummary {
  netSalesCents: number;
  grossSalesCents: number;
  serviceSalesCents: number;
  productSalesCents: number;
  discountsCents: number;
  refundsCents: number;
  tipsCents: number;                  // shown separately; NOT part of net sales
  taxCollectedCents: number;          // shown separately; NOT part of net sales
  ticketsCount: number;
  customersCount: number;
  averageTicketCents: number;
  evidence: RevenueEvidence;
}

export type ContributionConfidence = 'confirmed' | 'contextual';

/** One line of the revenue-change bridge. `confirmed` items sum to the total change; `contextual` items are already
 *  contained within net sales and are shown for context (never double-counted). */
export interface ContributionItem {
  factor: string;
  deltaCents: number;                 // signed effect on net sales (confirmed) or signed change (contextual)
  direction: 'up' | 'down' | 'flat';
  confidence: ContributionConfidence;
  note: string;
}

export interface RevenueChangeExplanation {
  currentNetCents: number;
  previousNetCents: number;
  changeCents: number;
  changePercent: number | null;       // null when the previous period is zero (undefined ratio)
  contributors: ContributionItem[];   // confirmed price×volume bridge + contextual refund/discount deltas
  caveats: string[];                   // partial-period + correlation-not-causation, only when applicable
  evidence: RevenueEvidence;
}
