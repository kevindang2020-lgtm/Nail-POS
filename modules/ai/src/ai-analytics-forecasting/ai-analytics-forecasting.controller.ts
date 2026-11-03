// ai-analytics-forecasting.controller.ts — AI Analytics & Forecasting HTTP surface (slice 1: appointment forecast).
// TenantAuthGuard + RolePermissionGuard; tenant/branch/role/permissions come ONLY from req.ctx. Feature access is the
// dedicated pos.ai_analytics.view; the data source additionally enforces reports.view. Read-only — no forecast is an
// operational action, and nothing here mutates schedules/prices/orders.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AppointmentForecastService } from './appointment-forecast.service';
import { RevenueForecastService } from './revenue-forecast.service';
import { NoShowRiskService } from './noshow-risk.service';
import { ProductDemandForecastService } from './product-demand-forecast.service';
import { ForecastRunService } from './forecast-run.service';
import { SeasonalTrendService } from './seasonal-trend.service';
import { AnomalyDetectService } from './anomaly-detect.service';
import { BusyPeriodService } from './busy-period.service';
import { AiForecastError, type AiForecastContext } from './ai-analytics-forecasting.dto';
import { ListQueries } from '@aipowersalon/database';
import { AiAnalyticsForecastingControllerListQueries } from './ai-analytics-forecasting.list-queries';

function ctxFrom(req: any): AiForecastContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AiForecastError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_analytics_forecasting')
@ListQueries(AiAnalyticsForecastingControllerListQueries)
@Controller('pos/ai-analytics')
export class AiAnalyticsForecastingController {
  constructor(
    private readonly appointments: AppointmentForecastService,
    private readonly revenue: RevenueForecastService,
    private readonly noShow: NoShowRiskService,
    private readonly productDemand: ProductDemandForecastService,
    private readonly runs: ForecastRunService,
    private readonly seasonal: SeasonalTrendService,
    private readonly anomalies: AnomalyDetectService,
    private readonly busyPeriods: BusyPeriodService,
  ) {}

  @Get('busy-periods')
  @RequirePermission('pos.ai_analytics.view')
  busyPeriodsForecast(@Req() r: any) {
    return run(() => this.busyPeriods.getBusyPeriods(ctxFrom(r)));
  }

  @Get('anomalies')
  @RequirePermission('pos.ai_analytics.view')
  businessAnomalies(@Req() r: any, @Query('windowDays') windowDays?: string) {
    const w = windowDays ? Math.max(1, Math.min(60, parseInt(windowDays, 10) || 14)) : 14;
    return run(() => this.anomalies.getAnomalies(ctxFrom(r), w));
  }

  @Get('seasonal-trends')
  @RequirePermission('pos.ai_analytics.view')
  seasonalTrends(@Req() r: any) {
    return run(() => this.seasonal.getSeasonalTrends(ctxFrom(r)));
  }

  @Get('forecast/product/:productId')
  @RequirePermission('pos.ai_analytics.view')
  productForecast(@Req() r: any, @Param('productId') productId: string, @Query('horizonDays') horizonDays?: string) {
    const h = horizonDays ? Math.max(1, Math.min(90, parseInt(horizonDays, 10) || 14)) : 14;
    return run(() => this.productDemand.getProductForecast(ctxFrom(r), productId, h));
  }

  @Get('no-show-risk')
  @RequirePermission('pos.ai_analytics.view')
  noShowRisk(@Req() r: any, @Query('days') days?: string) {
    const d = days ? Math.max(1, Math.min(30, parseInt(days, 10) || 7)) : 7;
    return run(() => this.noShow.getUpcomingRisk(ctxFrom(r), d));
  }

  @Get('forecast/appointments')
  @RequirePermission('pos.ai_analytics.view')
  appointmentForecast(@Req() r: any, @Query('horizonDays') horizonDays?: string) {
    const h = horizonDays ? Math.max(1, Math.min(90, parseInt(horizonDays, 10) || 7)) : 7;
    return run(async () => {
      const ctx = ctxFrom(r);
      const out = await this.appointments.getAppointmentForecast(ctx, h);
      await this.runs.recordForecast(ctx, 'appointments', out); // best-effort, once/day
      return out;
    });
  }

  @Get('forecast/revenue')
  @RequirePermission('pos.ai_analytics.view')
  revenueForecast(@Req() r: any, @Query('horizonDays') horizonDays?: string) {
    const h = horizonDays ? Math.max(1, Math.min(90, parseInt(horizonDays, 10) || 7)) : 7;
    return run(async () => {
      const ctx = ctxFrom(r);
      const out = await this.revenue.getRevenueForecast(ctx, h);
      await this.runs.recordForecast(ctx, 'revenue', out);
      return out;
    });
  }

  /** how much verified history each forecast has (booking calendar / sales report), the minimum, and what is short — read-only */
  @Get('forecast/readiness')
  @RequirePermission('pos.ai_analytics.view')
  readiness(@Req() r: any) {
    return run(async () => {
      const ctx = ctxFrom(r);
      const appointments = await this.appointments.readiness(ctx);
      // revenue needs the financial permission; a role without it is told so, not shown a zero
      let revenue: Awaited<ReturnType<RevenueForecastService['readiness']>> | { domain: 'revenue'; restricted: true } ;
      try { revenue = await this.revenue.readiness(ctx); }
      catch (e) { if ((e as { status?: number })?.status === 403 || (e instanceof AiForecastError && e.status === 403)) revenue = { domain: 'revenue', restricted: true }; else throw e; }
      return { appointments, revenue, sources: { appointments: 'booking_calendar', revenue: 'sales_report' }, quietDaysCounted: true, checkedAt: new Date().toISOString() };
    });
  }

  @Get('accuracy')
  @RequirePermission('pos.ai_analytics.view')
  accuracy(@Req() r: any, @Query('domain') domain?: string) {
    const d = domain === 'revenue' ? 'revenue' : 'appointments';
    return run(async () => {
      const ctx = ctxFrom(r);
      const actuals = d === 'revenue' ? await this.revenue.getActualsByDate(ctx) : await this.appointments.getActualsByDate(ctx);
      const agg = await this.runs.evaluateAccuracy(ctx, d, actuals);
      return {
        domain: d, ...agg,
        note: agg.evaluated === 0
          ? 'No matured forecasts evaluated yet — realized accuracy appears once forecasts reach their target dates.'
          : `Realized accuracy over ${agg.evaluated} matured forecast day(s).`,
      };
    });
  }
}
