// sms-tenant-plan.controller.ts — §7/§8/§29 routes. Own mount (super-admin/sms-tenant-plan) so nothing shadows
// the package-id routes on the sibling controller. Guarded: SuperAdminGuard + the §54 granular keys from P1.
import { SuperAdminGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SmsTenantPlanService, SmsTenantPlanError, type AdminCtx } from './sms-tenant-plan.service';
import { SmsReconciliationService } from './sms-reconciliation.service';
import { SmsBillingService } from './sms-billing.service';
import { ListQueries } from '@aipowersalon/database';
import { SmsTenantPlanControllerListQueries } from './sms-tenant-plan.list-queries';
import { SMS_ASSIGN_BODY, SMS_CREDIT_BODY, SMS_FINDING_RESOLVE_BODY } from '../request-schemas';

function ctxFrom(r: any): AdminCtx { return { userId: r?.ctx?.userId ?? null, ip: r?.ip ?? null }; }

@ListQueries(SmsTenantPlanControllerListQueries)
@Controller('super-admin/sms-tenant-plan')
@UseGuards(SuperAdminGuard, RolePermissionGuard)
export class SmsTenantPlanController {
  constructor(private readonly svc: SmsTenantPlanService, private readonly recon: SmsReconciliationService, private readonly billing: SmsBillingService) {}
  private async run<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string; message?: string }> {
    try { return await fn(); } catch (e) {
      if (e instanceof SmsTenantPlanError) return { ok: false, error: e.code, message: e.message };
      throw e;
    }
  }

  @Get('billing/charges') @RequirePermission('super_admin.sms_billing.view')
  charges(@Query('month') month?: string) {
    const m = /^\d{4}-\d{2}$/.test(String(month ?? '')) ? String(month) : new Date().toISOString().slice(0, 7);
    return this.billing.chargesForMonth(m);
  }

  @Get('billing/analytics') @RequirePermission('super_admin.sms_billing.view')
  analytics(@Query('month') month?: string) {
    const m = /^\d{4}-\d{2}$/.test(String(month ?? '')) ? String(month) : new Date().toISOString().slice(0, 7);
    return this.billing.revenueAnalytics(m);
  }

  @Get('reconciliation/findings') @RequirePermission('super_admin.sms_usage.view')
  findings() { return this.recon.listOpenFindings(); }

  @Post('reconciliation/findings/:findingId/resolve') @RequirePermission('super_admin.sms_usage.adjust')
  resolve(@Req() r: any, @Param('findingId') id: string, @Body(ValidatedBody(SMS_FINDING_RESOLVE_BODY)) b: any) {
    return this.recon.resolveFinding(ctxFrom(r).userId ?? null, id, b?.disposition === 'dismissed' ? 'dismissed' : 'resolved');
  }

  @Get() @RequirePermission('super_admin.sms_tenant_plan.view')
  list() { return this.run(() => this.svc.listTenantPlans()); }

  @Get(':tenantId/usage') @RequirePermission('super_admin.sms_usage.view')
  usage(@Param('tenantId') t: string, @Query('limit') limit?: string) {
    return this.run(() => this.svc.recentUsage(t, Number(limit) || 50));
  }

  @Get(':tenantId') @RequirePermission('super_admin.sms_tenant_plan.view')
  plan(@Param('tenantId') t: string) { return this.run(() => this.svc.tenantPlan(t)); }

  @Post(':tenantId/assign') @RequirePermission('super_admin.sms_tenant_plan.change')
  assign(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(SMS_ASSIGN_BODY)) b: any) {
    return this.run(() => this.svc.assignPackage(ctxFrom(r), t, String(b?.packageId ?? ''), { effective: b?.effective, reason: b?.reason }));
  }

  @Post(':tenantId/credit') @RequirePermission('super_admin.sms_usage.adjust')
  credit(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(SMS_CREDIT_BODY)) b: any) {
    return this.run(() => this.svc.addCredit(ctxFrom(r), t, Number(b?.amount), String(b?.reason ?? '')));
  }
}
