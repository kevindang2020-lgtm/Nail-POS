// forecasting-oversight.controller.ts — Super Admin: AI Analytics & Forecasting Oversight. SuperAdminGuard only; returns
// aggregate platform health. No tenant-scoped business data; per-tenant rows are operational metadata (counts + accuracy).
import { Controller, Get, Query, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { ForecastingOversightService } from './forecasting-oversight.service';
import { ListQueries } from '@aipowersalon/database';
import { ForecastingOversightControllerListQueries } from './forecasting-oversight.list-queries';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { throw new HttpException({ ok: false, message: e?.message || 'Oversight error' }, e?.status || HttpStatus.INTERNAL_SERVER_ERROR); }
}

@UseGuards(SuperAdminGuard)
@ListQueries(ForecastingOversightControllerListQueries)
@Controller('super-admin/ai-forecasting')
export class ForecastingOversightController {
  constructor(private readonly svc: ForecastingOversightService) {}

  @Get('overview')
  overview() { return run(() => this.svc.overview()); }

  @Get('tenants')
  tenants(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const l = Math.max(1, Math.min(100, parseInt(limit || '25', 10) || 25));
    const o = Math.max(0, parseInt(offset || '0', 10) || 0);
    return run(() => this.svc.tenants(l, o));
  }
}
