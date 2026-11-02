// ai-business-metrics.ts — the CENTRALIZED metric registry for the AI Business Assistant (spec §8, §58).
//
// Why this file exists: today the dashboard, the reports, and any AI answer could each define "revenue" differently.
// The spec's #1 accuracy requirement is that they DON'T. This registry is the single source of truth for what each
// KPI means, how refunds/voids/tips/taxes are treated, which permission gates it, where its data comes from, how
// fresh it is, and which POS report the user drills into. Authorized tools (built in later slices) resolve a metric
// by id from THIS registry and hand its `dataSource` to the existing report services — they never recompute a KPI a
// different way, and they never invent a metric that isn't declared here.
//
// This module is PURE (no DB, no tenant data, no I/O). Metric *definitions* are tenant-agnostic metadata; the actual
// tenant-scoped VALUES are fetched by the data tools using DATABASE_READ + the existing reporting services. Because
// it is pure it is trivially unit-testable and carries zero cross-tenant risk.

/** Freshness classes surfaced to the UI (spec §24). A metric declares its INTENDED class; the data-freshness tool
 *  reports the ACTUAL observed freshness at query time (replica lag, aggregation backlog, partial day, …). */
export type FreshnessClass =
  | 'realtime' | 'near_realtime' | 'within_5m' | 'hourly' | 'daily' | 'snapshot' | 'delayed' | 'unavailable';

/** Comparison modes a metric supports (spec §10). Partial-current-day comparisons are always labeled downstream. */
export type ComparisonMode =
  | 'previous_period' | 'same_period_last_year' | 'same_weekday_last_week'
  | 'rolling_7d' | 'rolling_30d' | 'rolling_90d';

/** How money-affecting events are treated in a metric's formula. Explicit per spec §9 (never silently combine). */
export interface MoneyTreatment {
  refunds: 'excluded' | 'subtracted' | 'included' | 'n/a';
  voids: 'excluded' | 'subtracted' | 'included' | 'n/a';
  discounts: 'excluded' | 'subtracted' | 'included' | 'n/a';
  taxes: 'excluded' | 'included' | 'n/a';
  tips: 'excluded' | 'included' | 'n/a';
  giftCards: 'sale_only' | 'redemption_only' | 'excluded' | 'n/a';
  memberships: 'included' | 'excluded' | 'n/a';
}

export type MetricCategory = 'revenue' | 'appointments' | 'customers' | 'technicians' | 'operations' | 'ai';

export interface MetricDefinition {
  id: string;                       // stable metric id (e.g. 'net_sales') — the contract key tools resolve by
  displayName: string;
  description: string;
  category: MetricCategory;
  formula: string;                  // human-readable formula shown as evidence (spec §22); NOT executable SQL
  includes: string[];               // records included
  excludes: string[];               // records excluded
  timeField: string;                // the timestamp column the period filter uses (tenant/branch tz applied by tool)
  unit: 'currency_cents' | 'count' | 'percent' | 'hours' | 'minutes';
  money?: MoneyTreatment;           // present for money metrics; explicit per §9
  branchBehavior: 'per_branch' | 'tenant_wide' | 'both';
  requiredPermission: string;       // granular pos.<domain>.<action>; bridged via requiredCapability() at filter time
  dataSource: string;               // which EXISTING report/read model backs this (tools reuse it; never a 2nd calc)
  freshness: FreshnessClass;        // intended class; actual is reported per-query
  comparisons: ComparisonMode[];
  drilldownRoute: string;           // a REAL pos-web route the user opens for the underlying report (§22)
  version: number;
}

// Reused defaults keep the table readable. "Sales" money treatment = the salon net-sales convention already used by
// the sales report: gross minus discounts/refunds/voids, tips and taxes excluded, a gift-card sale counted once at
// sale (not again at redemption), membership dues counted as revenue.
const SALES_MONEY: MoneyTreatment = {
  refunds: 'subtracted', voids: 'subtracted', discounts: 'subtracted',
  taxes: 'excluded', tips: 'excluded', giftCards: 'sale_only', memberships: 'included',
};
const ALL_COMPARISONS: ComparisonMode[] = [
  'previous_period', 'same_period_last_year', 'same_weekday_last_week', 'rolling_7d', 'rolling_30d', 'rolling_90d',
];

// The registry. Every metric points its dataSource at an existing report/read model and its drilldownRoute at a real
// pos-web route (all present in EXISTING_ROUTES). New metrics are appended with a bumped version; definitions are
// never silently changed (a version bump + audit is required per §56 rollback controls).
export const AI_BUSINESS_METRICS: readonly MetricDefinition[] = Object.freeze([
  // ---- revenue (spec §9, §28) ----
  {
    id: 'net_sales', displayName: 'Net sales', category: 'revenue',
    description: 'Gross sales minus discounts, refunds, and voids; excludes tips and taxes.',
    formula: 'sum(service_and_product_sales) - discounts - refunds - voids',
    includes: ['completed service lines', 'product lines', 'membership dues', 'gift-card sales'],
    excludes: ['tips', 'taxes', 'gift-card redemptions', 'canceled/void tickets'],
    timeField: 'ticket.closed_at', unit: 'currency_cents', money: SALES_MONEY,
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/sales',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/sales', version: 1,
  },
  {
    id: 'gross_sales', displayName: 'Gross sales', category: 'revenue',
    description: 'Sales before discounts, refunds, and voids; excludes tips and taxes.',
    formula: 'sum(service_and_product_sales) before adjustments',
    includes: ['service lines', 'product lines', 'membership dues', 'gift-card sales'],
    excludes: ['tips', 'taxes', 'gift-card redemptions'],
    timeField: 'ticket.closed_at', unit: 'currency_cents',
    money: { ...SALES_MONEY, refunds: 'included', voids: 'included', discounts: 'included' },
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/sales',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/sales', version: 1,
  },
  {
    id: 'completed_service_revenue', displayName: 'Completed-service revenue', category: 'revenue',
    description: 'Net sales from services on tickets whose service was actually completed (not booked/expected).',
    formula: 'net_sales restricted to completed service lines',
    includes: ['completed service lines'],
    excludes: ['product-only revenue', 'booked-but-not-completed appointments', 'tips', 'taxes'],
    timeField: 'ticket_service_line.completed_at', unit: 'currency_cents', money: SALES_MONEY,
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/services',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/services', version: 1,
  },
  {
    id: 'average_ticket', displayName: 'Average ticket', category: 'revenue',
    description: 'Net sales divided by the count of closed tickets in the period.',
    formula: 'net_sales / count(closed_tickets)',
    includes: ['closed tickets'], excludes: ['open tickets', 'void tickets'],
    timeField: 'ticket.closed_at', unit: 'currency_cents', money: SALES_MONEY,
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/sales',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/sales', version: 1,
  },

  // ---- appointments (spec §13, §29) ----
  {
    id: 'completed_appointments', displayName: 'Completed appointments', category: 'appointments',
    description: 'Appointments that reached the completed status in the period; excludes canceled/no-show/deleted.',
    formula: 'count(appointments where status = completed)',
    includes: ['completed appointments', 'completed walk-ins'],
    excludes: ['canceled', 'no-show', 'rescheduled-away', 'deleted'],
    timeField: 'appointment.completed_at', unit: 'count',
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/appointments',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/appointments', version: 1,
  },
  {
    id: 'cancellations', displayName: 'Cancellations', category: 'appointments',
    description: 'Appointments canceled in the period (cancellation timestamp within range).',
    formula: 'count(appointments where status = canceled)',
    includes: ['canceled appointments'], excludes: ['no-shows', 'completed', 'rescheduled'],
    timeField: 'appointment.canceled_at', unit: 'count',
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/appointments',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/appointments', version: 1,
  },
  {
    id: 'no_shows', displayName: 'No-shows', category: 'appointments',
    description: 'Appointments marked no-show in the period.',
    formula: 'count(appointments where status = no_show)',
    includes: ['no-show appointments'], excludes: ['cancellations', 'completed'],
    timeField: 'appointment.scheduled_at', unit: 'count',
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/appointments',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/appointments', version: 1,
  },

  // ---- customers (spec §15, §31) ----
  {
    id: 'new_customers', displayName: 'New customers', category: 'customers',
    description: 'Customers whose first-ever visit (or account creation) falls within the period.',
    formula: 'count(customers where first_visit_at in period)',
    includes: ['first-time customers'], excludes: ['returning customers'],
    timeField: 'customer.first_visit_at', unit: 'count',
    branchBehavior: 'both', requiredPermission: 'pos.customers.view', dataSource: 'reports/customers',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/customers', version: 1,
  },
  {
    id: 'returning_customers', displayName: 'Returning customers', category: 'customers',
    description: 'Customers with a prior visit before this period who also visited within the period.',
    formula: 'count(distinct customers with a visit in period AND an earlier visit)',
    includes: ['repeat customers'], excludes: ['first-time customers'],
    timeField: 'appointment.completed_at', unit: 'count',
    branchBehavior: 'both', requiredPermission: 'pos.customers.view', dataSource: 'reports/customers',
    freshness: 'near_realtime', comparisons: ALL_COMPARISONS, drilldownRoute: '/tenant/reports/customers', version: 1,
  },
  {
    id: 'customer_retention', displayName: 'Customer retention', category: 'customers',
    description: 'Share of customers acquired in a prior cohort who returned within the tenant-configured retention '
      + 'window. A customer is only "lost/inactive" past the configured inactivity threshold (never assumed).',
    formula: 'returned_within_window / cohort_size',
    includes: ['cohort customers with a qualifying return visit'],
    excludes: ['customers still inside their normal visit interval'],
    timeField: 'appointment.completed_at', unit: 'percent',
    branchBehavior: 'both', requiredPermission: 'pos.customers.view', dataSource: 'reports/customers',
    freshness: 'daily', comparisons: ['previous_period', 'same_period_last_year'],
    drilldownRoute: '/tenant/reports/customers', version: 1,
  },

  // ---- technicians (spec §16, §32) — operational only; compensation gated separately ----
  {
    id: 'technician_utilization', displayName: 'Technician utilization', category: 'technicians',
    description: 'Booked (or serviced) hours divided by available scheduled hours. Operational metric; sample-size '
      + 'warnings apply and it must never be used for automated employment decisions.',
    formula: 'booked_hours / available_hours',
    includes: ['scheduled technicians with available hours in period'],
    excludes: ['technicians with zero scheduled availability', 'off-shift time'],
    timeField: 'appointment.completed_at', unit: 'percent',
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/technicians',
    freshness: 'near_realtime', comparisons: ['previous_period', 'same_weekday_last_week', 'rolling_30d'],
    drilldownRoute: '/tenant/reports/technicians', version: 1,
  },

  // ---- ai / booking source (spec §13, §26) ----
  {
    id: 'ai_booking_conversion', displayName: 'AI booking conversion', category: 'ai',
    description: 'Share of AI-receptionist / AI-booking interactions that resulted in a booked appointment.',
    formula: 'ai_bookings_created / ai_booking_interactions',
    includes: ['AI-sourced booking interactions'], excludes: ['human-sourced bookings', 'abandoned pre-intent calls'],
    timeField: 'appointment.created_at', unit: 'percent',
    branchBehavior: 'both', requiredPermission: 'pos.reports.view', dataSource: 'reports/appointments (booking source)',
    freshness: 'near_realtime', comparisons: ['previous_period', 'rolling_7d', 'rolling_30d'],
    drilldownRoute: '/tenant/reports/appointments', version: 1,
  },
]);

const BY_ID: ReadonlyMap<string, MetricDefinition> = new Map(AI_BUSINESS_METRICS.map((m) => [m.id, m]));

export function getMetric(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}
export function listMetricIds(): string[] {
  return AI_BUSINESS_METRICS.map((m) => m.id);
}
export function metricsByCategory(category: MetricCategory): MetricDefinition[] {
  return AI_BUSINESS_METRICS.filter((m) => m.category === category);
}
