import type { DimensionKey, MeasureKey, VisualizationKey } from '@aipowersalon/api-contracts/platform';
export type { DimensionKey, MeasureKey, VisualizationKey };   // owned by packages/api-contracts (Constitution 13 §13)
// report-builder-catalog.ts — the single source of truth for what the Super Admin report builder can ask for.
// It is an allow-list: every dimension, measure, and visualization the UI offers and the backend accepts is
// declared here. A (dimension × measure) pair is only "supported" when it maps to an aggregate the platform
// ALREADY computes — the builder composes from existing analytics, it does not run ad-hoc cross-tenant SQL.
// Anything allow-listed but unmapped is reported as available:false with a reason (honest, never invented).


export const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'payment_method', label: 'Payment method' },
  { key: 'branch', label: 'Branch' },
  { key: 'tenant', label: 'Tenant' },
  { key: 'us_state', label: 'US state' },
  { key: 'hour_of_day', label: 'Hour of day' },
  { key: 'device_status', label: 'Device status' },
];
export const MEASURES: { key: MeasureKey; label: string; format: 'money' | 'count' }[] = [
  { key: 'revenue_cents', label: 'Revenue', format: 'money' },
  { key: 'transactions', label: 'Transactions', format: 'count' },
  { key: 'avg_ticket_cents', label: 'Average ticket', format: 'money' },
  { key: 'tenant_count', label: 'Tenant count', format: 'count' },
  { key: 'device_count', label: 'Device count', format: 'count' },
];
export const VISUALIZATIONS: { key: VisualizationKey; label: string }[] = [
  { key: 'table', label: 'Table' }, { key: 'bar', label: 'Bar chart' }, { key: 'line', label: 'Line chart' },
  { key: 'donut', label: 'Donut chart' }, { key: 'kpi', label: 'KPI tiles' },
];

// Supported (dimension → measures) backed by a real aggregate. The value is the analytics-module source.
export const SUPPORTED: Record<DimensionKey, { measures: MeasureKey[]; source: string }> = {
  month: { measures: ['revenue_cents', 'transactions'], source: 'revenueTransactionsTrend' },
  payment_method: { measures: ['revenue_cents'], source: 'paymentMethods' },
  branch: { measures: ['revenue_cents'], source: 'branchComparison' },
  tenant: { measures: ['revenue_cents'], source: 'topTenants' },
  us_state: { measures: ['tenant_count'], source: 'regionalPerformance' },
  hour_of_day: { measures: ['transactions'], source: 'peakHours' },
  device_status: { measures: ['device_count'], source: 'deviceStatus' },
};

const DIM_KEYS = new Set(DIMENSIONS.map((d) => d.key));
const MEA_KEYS = new Set(MEASURES.map((m) => m.key));
const VIS_KEYS = new Set(VISUALIZATIONS.map((v) => v.key));

export type ReportSpec = {
  dimension: DimensionKey; measure: MeasureKey; visualization: VisualizationKey;
  range?: string; tenantId?: string | null; limit?: number;
};
export type ValidationResult = { ok: true; spec: Required<Pick<ReportSpec, 'dimension' | 'measure' | 'visualization'>> & { limit: number }; supported: boolean; source?: string; reason?: string } | { ok: false; error: string };

export function validateReportSpec(input: any): ValidationResult {
  const dimension = String(input?.dimension ?? '');
  const measure = String(input?.measure ?? '');
  const visualization = String(input?.visualization ?? 'table');
  if (!DIM_KEYS.has(dimension as DimensionKey)) return { ok: false, error: `Unknown dimension "${dimension}".` };
  if (!MEA_KEYS.has(measure as MeasureKey)) return { ok: false, error: `Unknown measure "${measure}".` };
  if (!VIS_KEYS.has(visualization as VisualizationKey)) return { ok: false, error: `Unknown visualization "${visualization}".` };
  const limRaw = Number(input?.limit);
  const limit = Number.isFinite(limRaw) ? Math.min(500, Math.max(1, Math.trunc(limRaw))) : 50;
  const entry = SUPPORTED[dimension as DimensionKey];
  const supported = entry.measures.includes(measure as MeasureKey);
  return {
    ok: true,
    spec: { dimension: dimension as DimensionKey, measure: measure as MeasureKey, visualization: visualization as VisualizationKey, limit },
    supported,
    source: supported ? entry.source : undefined,
    reason: supported ? undefined : `Measure "${measure}" is not available for dimension "${dimension}" from current platform aggregates. Supported: ${entry.measures.join(', ')}.`,
  };
}
