// ai-analytics-forecasting.dto.ts — shared context, error taxonomy, and the source ports the forecasting services read
// from. Context is server-derived (never client). Source ports abstract the AUTHORITATIVE historical series (ReportsService
// trends) so services are unit-testable and, in production, the numbers are by construction the same ones the reports show.
export interface AiForecastContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}

export enum AiForecastErrorCode {
  INSUFFICIENT_PERMISSION = 'INSUFFICIENT_PERMISSION',
  INSUFFICIENT_HISTORY = 'INSUFFICIENT_HISTORY',
  FORECAST_UNAVAILABLE = 'FORECAST_UNAVAILABLE',
  INVALID_HORIZON = 'INVALID_HORIZON',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AiForecastError extends Error {
  constructor(public code: AiForecastErrorCode, message: string, public status = 400) {
    super(message);
    this.name = 'AiForecastError';
  }
}

import type { SeriesPoint } from './forecast-core';
import type { HourCellInput } from './busy-period.core';

/** Historical daily appointment demand for the ctx tenant+branch. Implemented by a ReportsService adapter in prod. */
export interface AppointmentSeriesSource {
  /** Daily booked-appointment counts for the last `lookbackDays`, oldest→newest. MUST be tenant+branch scoped. */
  getDailyAppointments(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]>;
}

/** Deterministic in-memory source for tests, keyed by tenant→branch so isolation is exercised. */
export class InMemoryAppointmentSource implements AppointmentSeriesSource {
  public lastCtx: AiForecastContext | null = null;
  constructor(private data: Record<string, Record<string, SeriesPoint[]>> = {}) {}
  seed(tenantId: string, branchId: string, series: SeriesPoint[]) { (this.data[tenantId] ??= {})[branchId] = series; }
  async getDailyAppointments(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    this.lastCtx = ctx;
    const rows = this.data[ctx.tenantId]?.[ctx.branchId] ?? [];
    return rows.slice(-lookbackDays).map((p) => ({ ...p }));
  }
}

/** Historical daily net revenue (cents) for the ctx tenant+branch. Implemented by a financial-gated ReportsService
 *  adapter in prod (getRevenueOverview → requireFinancial), so revenue forecasts require pos.reports.financial_view. */
export interface RevenueSeriesSource {
  getDailyRevenue(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]>;
  /** extras (AI Analytics Forecasting 06): the canonical report's OWN sales totals for a salon-day window — read, never recomputed */
  getSalesTotals?(ctx: AiForecastContext, from: string, to: string): Promise<RevenueSourceTotals>;
}
/** the Sales report's totals for the forecast's history window (cents; tickets = paid tickets) */
export interface RevenueSourceTotals { grossSalesCents: number; discountsCents: number; refundsCents: number; netSalesCents: number; ticketsCount: number }

export class InMemoryRevenueSource implements RevenueSeriesSource {
  public lastCtx: AiForecastContext | null = null;
  constructor(private data: Record<string, Record<string, SeriesPoint[]>> = {}) {}
  seed(tenantId: string, branchId: string, series: SeriesPoint[]) { (this.data[tenantId] ??= {})[branchId] = series; }
  async getDailyRevenue(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    this.lastCtx = ctx;
    const rows = this.data[ctx.tenantId]?.[ctx.branchId] ?? [];
    return rows.slice(-lookbackDays).map((p) => ({ ...p }));
  }
}

/** Historical daily DEMAND (units consumed: retail_sale + service_usage) for one product at the ctx branch, from the
 *  ai_inventory movements ledger. Read-only; tenant+branch scoped. */
export interface ProductDemandSource {
  getDailyDemand(ctx: AiForecastContext, productId: string, lookbackDays: number): Promise<SeriesPoint[]>;
}

/** Live inventory position for one product (from the ai_inventory module) — closes the loop demand↔stock. */
export interface ProductPositionProvider {
  getProductPosition(ctx: AiForecastContext, productId: string): Promise<{ sellableOnHand: number; confirmedInbound: number; name: string | null } | null>;
}

export class InMemoryProductDemandSource implements ProductDemandSource {
  public lastCtx: AiForecastContext | null = null;
  constructor(private data: Record<string, Record<string, Record<string, SeriesPoint[]>>> = {}) {}
  seed(tenantId: string, branchId: string, productId: string, series: SeriesPoint[]) { ((this.data[tenantId] ??= {})[branchId] ??= {})[productId] = series; }
  async getDailyDemand(ctx: AiForecastContext, productId: string, lookbackDays: number): Promise<SeriesPoint[]> {
    this.lastCtx = ctx;
    const rows = this.data[ctx.tenantId]?.[ctx.branchId]?.[productId] ?? [];
    return rows.slice(-lookbackDays).map((p) => ({ ...p }));
  }
}

/** Historical hour-of-week booked-appointment demand for the ctx branch. Tenant+branch scoped. */
export interface HourlyDemandSource {
  getHourOfWeekDemand(ctx: AiForecastContext, lookbackDays: number): Promise<HourCellInput[]>;
}

export class InMemoryHourlyDemandSource implements HourlyDemandSource {
  public lastCtx: AiForecastContext | null = null;
  constructor(private data: Record<string, Record<string, HourCellInput[]>> = {}) {}
  seed(tenantId: string, branchId: string, cells: HourCellInput[]) { (this.data[tenantId] ??= {})[branchId] = cells; }
  async getHourOfWeekDemand(ctx: AiForecastContext, _lookbackDays: number): Promise<HourCellInput[]> {
    this.lastCtx = ctx;
    return (this.data[ctx.tenantId]?.[ctx.branchId] ?? []).map((c) => ({ ...c }));
  }
}
