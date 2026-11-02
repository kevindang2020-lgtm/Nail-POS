// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type AnalyticsRange = '7d' | '30d' | '90d' | '6m' | '12m';

export type CompareMode = 'none' | 'previous_period' | 'previous_month' | 'previous_quarter' | 'previous_year';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface Gap { available: false; reason: string }

export type DemandCell = { dow: number; hour: number; count: number };

export type StateRevenue = { state: string; revenueCents: number; transactions: number };

export type CategoryRevenue = { category: string; revenueCents: number; lines: number };

// ── The analytics payload (GET /super-admin/analytics) — moved from admin-web, where it was the ONLY definition; the server
//    now returns it, so a drift is a type error. Names that collided with other server types are prefixed Analytics-.
export type AnalyticsKpi = {
  key: string; label: string; value?: number; valueCents?: number;
  format: 'money' | 'count'; deltaPct: number | null; to: string;
  lowerIsBetter?: boolean; scopedApprox?: boolean;
};
export type AnalyticsTrendPoint = { label: string; revenueCents: number; transactions: number };
export type MethodSlice = { method: string; count: number; cents: number };
export type BranchRow = { branch: string; volumeCents: number; transactions?: number; successRate?: number };
export type HourBucket = { hour: number; count: number; cents?: number };
export type AnalyticsTopTenant = { tenantId?: string; tenantName?: string; name?: string; salonName?: string; amountCents?: number; revenueCents?: number; monthlyCardVolume?: number; bookings?: number; growthPct?: number; growthPercent?: number | null };
export type AnalyticsStateRow = { state: string; tenants: number };
export type AnalyticsRecommendation = { type: string; severity: 'info' | 'warning' | 'critical'; metric: string; message: string; action: string; to: string; source: 'rule-based'; generatedAt: string };
export type AnalyticsModules = {
  revenueTransactionsTrend: Gap | { available: true; granularity: 'monthly'; dailyAvailable: boolean; series: AnalyticsTrendPoint[]; daily: AnalyticsTrendPoint[] };
  appointmentActivity: Gap | { available: true; dailySeriesAvailable: boolean; total: number; statusMix: { status: string; count: number }[]; sourceMix: { source: string; count: number }[]; note: string };
  tenantGrowth: Gap | { available: true; newByMonth: { month: string; count: number }[]; totalTenants: number; churn: Gap | { available: true; windowDays: number; suspendedWindow: number; activeNow: number; churnRatePct: number } };
  paymentMethods: Gap | { available: true; totalCents: number; byMethod: MethodSlice[] };
  topTenants: Gap | { available: true; rows: AnalyticsTopTenant[] };
  branchComparison: Gap | { available: true; metric: 'revenue'; rows: BranchRow[] };
  serviceCategoryMix: Gap | { available: true; totalCents: number; byCategory: CategoryRevenue[] };
  customerRetention: Gap | { available: true; dailyAvailable: boolean; totalCustomers: number; activeCustomers: number; newThisMonth: number; newVsReturning: Gap | { available: true; windowDays: number; newCount: number; returningCount: number } };
  peakHours: Gap | { available: true; matrixAvailable: boolean; byHour: HourBucket[]; matrix: DemandCell[] };
  deviceStatus: Gap | { available: true; total: number; online: number; offline: number; byStatus: { status: string; count: number }[] };
  aiReceptionist: { available: false; reason: string; aiCallsUsed: number; bookings: Gap | { available: true; aiBookings: number; totalBookings: number; automationRatePct: number }; reminders: Gap | { available: true; sent: number; sentThisMonth: number; delivered: number; failed: number; deliveryRatePct: number } };
  regionalPerformance: Gap | { available: true; model: 'us-state'; byState: AnalyticsStateRow[]; revenueByRegion: Gap | { available: true; byState: StateRevenue[] } };
  recommendations: { available: true; items: AnalyticsRecommendation[] };
  systemHealth: { available: true; metrics: Gap | { available: true; windowMinutes: number; sampleCount: number; apiSuccessPct: number; serverErrors: number; p50LatencyMs: number; p95LatencyMs: number }; alerts: { critical: number; warning: number; info: number; source: 'rule-based' } };
};
export type AnalyticsPayload = {
  ok: true;
  metadata: { generatedAt: string; range: AnalyticsRange; by: string | null; compare: { mode: CompareMode; label: string; offsetMonths: number } };
  scope: { tenantId: string | null; scoped: boolean };
  kpis: AnalyticsKpi[];
  modules: AnalyticsModules;
};
export type AnalyticsExportResult = { filename: string; mimeType: string; base64: string };
