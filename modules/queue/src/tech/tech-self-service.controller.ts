// tech-self-service.controller.ts — Technician App own-data reads (workforce audit #26/#99):
//   GET /tech/time-clock/summary · GET /tech/performance?days=7|30|90 · GET /tech/tips?days=7|14|30 · GET /tech/customers?search=
// (GET /tech/time-clock is the Decision-9 clock state on TechController; the summary is the day/week view over the same punches.)
// Merged Oct 12 2026; guarded like every other /tech route (TenantAuthGuard + RolePermissionGuard, tech.* keys).
// The technician is resolved from the session (tech-self-service.ts); the tenant/branch come from the session too.
import { Controller, ForbiddenException, Get, Inject, Optional, Query, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { TechSelfServiceError, techCustomers, techPerformance, techTimeClock, techTips, type TechSelfCtx } from './tech-self-service';
import type { TechCustomerRow, TechPerformanceView, TechTimeClockView, TechTipsView } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import type { ListQuerySpec } from '@aipowersalon/database';

/** The window / search parameters of the list-shaped reads (Constitution 5 §47–§52). */
export const TechSelfServiceListQueries = {
  performance: { filters: { days: { type: 'text' } }, search: false },
  tips: { filters: { days: { type: 'text' } }, search: false },
  customers: { filters: { search: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;

function ctxFrom(req: any): TechSelfCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId }; }

@ListQueries(TechSelfServiceListQueries)
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tech')
export class TechSelfServiceController {
  constructor(@Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {}
  private async run<T>(fn: (db: any) => Promise<T>): Promise<T> {
    if (!this.db) throw new ServiceUnavailableException('Not available without a database');
    try { return await fn(this.db as any); } catch (e) {
      if (e instanceof TechSelfServiceError) throw new ForbiddenException(e.message);
      throw e;
    }
  }
  @RequirePermission('tech.dashboard.view') @Get('time-clock/summary') timeClock(@Req() r: any): Promise<TechTimeClockView> { return this.run((db) => techTimeClock(db, ctxFrom(r))); }
  @RequirePermission('tech.earnings.view') @Get('performance') performance(@Req() r: any, @Query('days') days?: string): Promise<TechPerformanceView> { return this.run((db) => techPerformance(db, ctxFrom(r), Number(days) || 30)); }
  @RequirePermission('tech.earnings.view') @Get('tips') tips(@Req() r: any, @Query('days') days?: string): Promise<TechTipsView> { return this.run((db) => techTips(db, ctxFrom(r), Number(days) || 14)); }
  @RequirePermission('tech.dashboard.view') @Get('customers') customers(@Req() r: any, @Query('search') search?: string): Promise<TechCustomerRow[]> { return this.run((db) => techCustomers(db, ctxFrom(r), search)); }
}
