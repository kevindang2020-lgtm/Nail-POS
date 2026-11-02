// deals.super-admin.controller.ts — cross-tenant marketplace oversight, behind SuperAdminGuard (BUILD_PLAN Phase 5):
// the marketplace overview, every salon's deals (filters), suspending a deal (a reason is required; audited; booked and
// on-ticket uses are given back — bug 17), the per-salon switch and live-deal limit, and the salons' deal activity.
// Platform-role access is the guard's (super-admin/deals → the marketing domain: view to read, manage to act).
// The platform-wide kill switch stays on the Kill Switches panel (platform_settings 'deals.engine_disabled').
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { DEAL_TENANT_PLATFORM_BODY, REASON_BODY } from '../request-schemas';
import { Controller, Get, Post, Patch, Param, Query, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, RequireStepUp } from '@aipowersalon/permissions/guards';
import { DealsService, DealValidationError, DealConflictError } from './deals.service';
import { ListQueries } from '@aipowersalon/database';
import { DealsSuperAdminControllerListQueries } from './deals.super-admin.list-queries';

async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}
const actor = (r: any) => ({ userId: r?.ctx?.userId ?? r?.user?.id ?? null, role: 'SUPER_ADMIN' });

@UseGuards(SuperAdminGuard)
@ListQueries(DealsSuperAdminControllerListQueries)
@Controller('super-admin/deals')
export class DealsSuperAdminController {
  constructor(private readonly svc: DealsService) {}

  @Get('overview') overview() { return this.svc.marketplaceOverview(); }

  @Get('tenants') tenants() { return this.svc.tenantsOverview(); }

  @Get()
  list(@Query('status') status?: string, @Query('tenantId') tenantId?: string, @Query('kind') kind?: string, @Query('q') q?: string, @Query('suspended') suspended?: string) {
    return this.svc.listAllDealsForAdmin({ status: status || null, tenantId: tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null, kind: kind || null, search: q ? String(q).slice(0, 60) : null, suspended: suspended === 'true' });
  }

  @Post(':id/suspend')
  suspend(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.superSuspendDeal(id, b?.reason, actor(r))); }

  @RequireStepUp()   // switching a salon's deals off is a kill switch for that salon (Constitution 7 §34)
  @Patch('tenants/:tenantId')
  setTenant(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(DEAL_TENANT_PLATFORM_BODY, { strict: true })) b: any) {
    if (!/^[0-9a-f-]{36}$/i.test(String(tenantId))) throw new HttpException('Unknown salon.', HttpStatus.BAD_REQUEST);
    return run(() => this.svc.setTenantPlatform(tenantId, { disabled: b?.disabled === undefined ? undefined : !!b.disabled, reason: b?.reason ?? null, maxActiveDeals: b?.maxActiveDeals === undefined ? undefined : (b.maxActiveDeals === null ? null : Number(b.maxActiveDeals)) }, actor(r)));
  }
}
