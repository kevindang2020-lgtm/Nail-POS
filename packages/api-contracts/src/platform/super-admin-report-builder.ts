// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type DimensionKey = 'month' | 'payment_method' | 'branch' | 'tenant' | 'us_state' | 'hour_of_day' | 'device_status';

export type MeasureKey = 'revenue_cents' | 'transactions' | 'avg_ticket_cents' | 'tenant_count' | 'device_count';

export type VisualizationKey = 'table' | 'bar' | 'line' | 'donut' | 'kpi';

export type RunResult =
  | { ok: true; available: true; spec: { dimension: string; measure: string; visualization: string; limit: number }; columns: [string, string]; format: 'money' | 'count'; source: string; rows: { label: string; value: number }[]; generatedAt: string }
  | { ok: true; available: false; reason: string; spec: { dimension: string; measure: string; visualization: string; limit: number }; generatedAt: string };
