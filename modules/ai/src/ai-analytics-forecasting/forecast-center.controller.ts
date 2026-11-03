// forecast-center.controller.ts — AI Analytics & Forecasting guide (Nov 2 2026): `/pos/ai-analytics/center/*`.
// Guards: TenantAuthGuard + RolePermissionGuard, the same AI package gate as the forecasts; tenant / branch / role from req.ctx.
//   pos.ai_analytics.view   summary · runs · run · check   (the center re-checks per forecast type: reports.view for
//                           appointments, pos.reports.financial_view for revenue, inventory.view or reports.view for products)
// Read-only: nothing here forecasts, books, prices or orders. The check writes only its own evidence row.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AppointmentForecastService } from './appointment-forecast.service';
import { RevenueForecastService } from './revenue-forecast.service';
import { AiForecastError } from './ai-analytics-forecasting.dto';
import { ForecastCenter, ForecastCenterError, FC_DOMAINS, FC_STATUSES, FC_PRESETS, type FcCtx } from './forecast-center';

export const FORECAST_CENTER = 'ForecastCenter';
export const FC_EMPTY_BODY: BodySchema = S.object({});
function ctxFrom(req: any): FcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function authed(ctx: FcCtx) { if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof ForecastCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    if (e instanceof AiForecastError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const isForbidden = (e: unknown) => (e as { status?: number })?.status === 403 || (e instanceof AiForecastError && e.status === 403);
const RUNS = { filters: { domain: { type: 'enum', values: FC_DOMAINS }, status: { type: 'enum', values: FC_STATUSES }, preset: { type: 'enum', values: FC_PRESETS } },
  search: { maxLength: 80 }, sorts: { newest: null, oldest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage('ai_analytics_forecasting')
@Controller('pos/ai-analytics/center')
export class ForecastCenterController {
  constructor(
    @Inject(FORECAST_CENTER) private readonly fc: ForecastCenter | null,
    private readonly appointments: AppointmentForecastService,
    private readonly revenue: RevenueForecastService,
  ) {}
  private c(): ForecastCenter { if (!this.fc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Forecast history needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.fc; }

  /** runs ever / last 30 days, last run per forecast, matured days waiting for an actual, evaluated days */
  @Get('summary') @RequirePermission('pos.ai_analytics.view')
  summary(@Req() q: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().summary(c)); }

  /** the forecast history: search · type · status · presets / From-To on the generated date · newest first · numbered pages */
  @Get('runs') @RequirePermission('pos.ai_analytics.view') @ListQuery(RUNS)
  runs(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().list(c, f ?? {})); }

  /** one run: each day's forecast, 80% range, actual and error */
  @Get('run') @RequirePermission('pos.ai_analytics.view') @ListQuery({ maxLimit: 100, defaultLimit: 100, params: ['runId'] } as const)
  one(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); authed(c); return run(() => this.c().run(c, String(f?.runId ?? ''))); }

  /** Check AI Analytics & Forecasting System — read-only */
  @Post('check') @RequirePermission('pos.ai_analytics.view')
  check(@Req() q: any, @Body(ValidatedBody(FC_EMPTY_BODY, { strict: true })) _b: unknown) {
    const c = ctxFrom(q); authed(c);
    const fctx = { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId ?? null, role: c.role ?? null, permissions: c.permissions ?? [] } as Parameters<AppointmentForecastService['readiness']>[0];
    return run(() => this.c().check(c, {
      appointments: () => this.appointments.readiness(fctx),
      revenue: async () => { try { return await this.revenue.readiness(fctx); } catch (e) { if (isForbidden(e)) return { restricted: true as const }; throw e; } },
    }));
  }
}
