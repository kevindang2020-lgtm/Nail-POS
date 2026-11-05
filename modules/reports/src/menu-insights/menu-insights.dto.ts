// menu-insights.dto.ts — contracts for the AI Pricing & Menu Insights surface. The compute logic and types live in
// menu-insights-core; this re-exports them so the controller/service/repository share one source of truth.
export {
  computeMenuInsights, marginPct, fmtUsd,
  TOP_SHARE_MIN, LOW_MARGIN_PCT, RAISE_MIN_HEADROOM_CENTS, RAISE_CAP_CENTS, BUNDLE_LIFT_MIN, MAX_INSIGHTS,
} from './menu-insights-core';
export type {
  InsightKind, InsightSeverity, InsightSubjectType, InsightImpactUnit,
  ServiceMetric, ProductMetric, ComboMetric, MenuInsightsInput, MenuInsight, MenuInsightsCoverage, MenuInsightsResult,
} from './menu-insights-core';

export interface MenuInsightsGathered {
  services: import('./menu-insights-core').ServiceMetric[];
  products: import('./menu-insights-core').ProductMetric[];
  combos: import('./menu-insights-core').ComboMetric[];
}
