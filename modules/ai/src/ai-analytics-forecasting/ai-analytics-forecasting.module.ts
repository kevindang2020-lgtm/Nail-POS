// ai-analytics-forecasting.module.ts — AI Analytics & Forecasting module.
//   Slice 1: the validated statistical forecasting ENGINE (pure) + the Appointment Forecasting domain wired end-to-end.
//   The appointment series comes from the EXISTING ReportsService (getAppointmentsTrend) via a thin adapter — so the
//   history the forecast is built on is, by construction, the same authoritative appointment data the reports show. No
//   second reporting stack, no LLM in the numeric path. Later slices add revenue/product/staffing domains the same way.
import { ReportsModule, ReportsService, type ReportsContext } from '@aipowersalon/reports';
import { Module } from '@nestjs/common';
import { AiAnalyticsForecastingController } from './ai-analytics-forecasting.controller';
import { ForecastCenterController, FORECAST_CENTER } from './forecast-center.controller';
import { ForecastCenter } from './forecast-center';
import { AppointmentForecastService } from './appointment-forecast.service';
import { RevenueForecastService } from './revenue-forecast.service';
import { NoShowRiskService, InMemoryNoShowSource, type NoShowRiskSource } from './noshow-risk.service';
import { KyselyNoShowSource } from './noshow-risk.kysely.source';
import { ProductDemandForecastService } from './product-demand-forecast.service';
import { KyselyProductDemandSource } from './product-demand.kysely.source';
import { ForecastRunService } from './forecast-run.service';
import { SeasonalTrendService } from './seasonal-trend.service';
import { AnomalyDetectService } from './anomaly-detect.service';
import { BusyPeriodService } from './busy-period.service';
import { KyselyHourlyDemandSource } from './busy-period.kysely.source';
import { InMemoryHourlyDemandSource, type HourlyDemandSource } from './ai-analytics-forecasting.dto';
import { InMemoryForecastRunRepository, type ForecastRunRepositoryPort } from './forecast-run.repository';
import { KyselyForecastRunRepository } from './forecast-run.kysely.repository';
import { InMemoryProductDemandSource, type ProductDemandSource, type ProductPositionProvider } from './ai-analytics-forecasting.dto';
import type { AppointmentSeriesSource, RevenueSeriesSource, AiForecastContext } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';
import { BookingCalendarAppointmentSource, ZeroFilledRevenueSource, ScheduleCapacitySource } from './forecast-history.kysely.source';
import { AiInventoryModule } from '../ai-inventory/ai-inventory.module';
import { AiInventoryPositionService } from '../ai-inventory/ai-inventory-position.service';
import { AiInventoryError } from '../ai-inventory/ai-inventory.dto';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

/** Adapts the ai_inventory position service into the forecasting position provider — closes the loop demand↔stock without
 *  duplicating any inventory logic. Returns null when the product has no stock record at this branch. */
export class InventoryPositionProvider implements ProductPositionProvider {
  constructor(private readonly positions: AiInventoryPositionService) {}
  async getProductPosition(ctx: AiForecastContext, productId: string) {
    try {
      const p = await this.positions.getProductPosition(ctx as any, productId);
      return { sellableOnHand: p.position.sellableOnHand, confirmedInbound: p.position.confirmedInbound, name: p.name };
    } catch (e) {
      if (e instanceof AiInventoryError) return null; // not found / not authorized at inventory layer
      throw e;
    }
  }
}

/** Adapts the existing ReportsService appointment trend into the forecasting series source. Read-only; tenant+branch
 *  scoped via the ctx it forwards. Maps each dated point's `bookings` to the demand value. */
export class ReportsAppointmentSource implements AppointmentSeriesSource {
  constructor(private readonly reports: ReportsService) {}
  async getDailyAppointments(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 86400000);
    const rctx: ReportsContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const trend = await this.reports.getAppointmentsTrend(rctx, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    return (trend?.points ?? [])
      .filter((p) => p && p.date)
      .map((p) => ({ date: p.date, value: Number(p.bookings ?? 0) }));
  }
}

/** Adapts the financial-gated ReportsService revenue overview (dated) into the forecasting series source. The financial
 *  permission check is enforced inside getRevenueOverview (requireFinancial), so this preserves revenue authorization. */
export class ReportsRevenueSource implements RevenueSeriesSource {
  constructor(private readonly reports: ReportsService) {}
  async getDailyRevenue(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    const to = new Date();
    const from = new Date(to.getTime() - lookbackDays * 86400000);
    const rctx: ReportsContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
    const overview = await this.reports.getRevenueOverview(rctx, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    return (overview?.points ?? [])
      .filter((p) => p && p.date)
      .map((p) => ({ date: p.date, value: Number(p.revenueCents ?? 0) }));
  }
}

@Module({
  imports: [ReportsModule, AiInventoryModule],
  controllers: [AiAnalyticsForecastingController, ForecastCenterController],
  providers: [
    // AI Analytics & Forecasting guide (Nov 2026): appointments come from the booking calendar, zero-filled per salon day (the sales
    // report's paid-ticket days were used before, with quiet days missing); revenue stays on the report, zero-filled
    { provide: 'AppointmentSeriesSource', useFactory: (reports: ReportsService, db: AppDatabase) => (db ? new BookingCalendarAppointmentSource(db) : new ReportsAppointmentSource(reports)), inject: [ReportsService, DATABASE_READ] },
    // extras (AI Analytics Forecasting 03): the forecast also carries workload vs scheduled technician hours (read-only)
    { provide: AppointmentForecastService, useFactory: (src: AppointmentSeriesSource, db: AppDatabase) => new AppointmentForecastService(src, db ? new ScheduleCapacitySource(db) : null), inject: ['AppointmentSeriesSource', DATABASE_READ] },
    { provide: 'RevenueSeriesSource', useFactory: (reports: ReportsService, db: AppDatabase) => new ZeroFilledRevenueSource(new ReportsRevenueSource(reports), db ?? null), inject: [ReportsService, DATABASE_READ] },
    { provide: RevenueForecastService, useFactory: (src: RevenueSeriesSource) => new RevenueForecastService(src), inject: ['RevenueSeriesSource'] },
    { provide: 'NoShowRiskSource', useFactory: (db: AppDatabase): NoShowRiskSource => (db ? new KyselyNoShowSource(db) : new InMemoryNoShowSource()), inject: [DATABASE_READ] },
    { provide: NoShowRiskService, useFactory: (src: NoShowRiskSource) => new NoShowRiskService(src), inject: ['NoShowRiskSource'] },
    { provide: 'ProductDemandSource', useFactory: (db: AppDatabase): ProductDemandSource => (db ? new KyselyProductDemandSource(db) : new InMemoryProductDemandSource()), inject: [DATABASE_READ] },
    { provide: 'ProductPositionProvider', useFactory: (positions: AiInventoryPositionService): ProductPositionProvider => new InventoryPositionProvider(positions), inject: [AiInventoryPositionService] },
    { provide: ProductDemandForecastService, useFactory: (demand: ProductDemandSource, pos: ProductPositionProvider) => new ProductDemandForecastService(demand, pos), inject: ['ProductDemandSource', 'ProductPositionProvider'] },
    { provide: 'ForecastRunRepositoryPort', useFactory: (db: AppDatabase): ForecastRunRepositoryPort => (db ? new KyselyForecastRunRepository(db) : new InMemoryForecastRunRepository()), inject: [DATABASE] },
    { provide: ForecastRunService, useFactory: (repo: ForecastRunRepositoryPort) => new ForecastRunService(repo), inject: ['ForecastRunRepositoryPort'] },
    { provide: SeasonalTrendService, useFactory: (src: AppointmentSeriesSource) => new SeasonalTrendService(src), inject: ['AppointmentSeriesSource'] },
    { provide: AnomalyDetectService, useFactory: (src: AppointmentSeriesSource) => new AnomalyDetectService(src), inject: ['AppointmentSeriesSource'] },
    { provide: 'HourlyDemandSource', useFactory: (db: AppDatabase): HourlyDemandSource => (db ? new KyselyHourlyDemandSource(db) : new InMemoryHourlyDemandSource()), inject: [DATABASE_READ] },
    // AI Analytics & Forecasting guide (Nov 2 2026): forecast history, forecast vs actual, the system check (read-only)
    { provide: FORECAST_CENTER, useFactory: (db: AppDatabase) => (db ? new ForecastCenter(db) : null), inject: [DATABASE] },
    { provide: BusyPeriodService, useFactory: (src: HourlyDemandSource) => new BusyPeriodService(src), inject: ['HourlyDemandSource'] },
  ],
  exports: [AppointmentForecastService, RevenueForecastService, NoShowRiskService, ProductDemandForecastService, ForecastRunService, SeasonalTrendService, AnomalyDetectService, BusyPeriodService],
})
export class AiAnalyticsForecastingModule {}
