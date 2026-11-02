// hardware-payment.super-admin.controller.ts — §12 Super-Admin surface. Behind SuperAdminGuard.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { HW_IMPORT_VOLUME_BODY, HW_MONTH_PLAN_BODY, HW_PLAN_CREATE_BODY, HW_PLAN_ID_BODY, HW_PLAN_UPDATE_BODY, HW_RUN_MONTHLY_BODY, HW_SETTINGS_BODY } from '../request-schemas';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { HardwarePaymentService, ActorCtx } from './hardware-payment.service';
import { HardwarePaymentReconciliationJob } from './hardware-payment.reconciliation-job';
import { FiservResidualImportService } from './hardware-payment.residual-import';
import { HardwarePaymentError } from './hardware-payment.dto';

function actor(req: any): ActorCtx { const c = req?.ctx || {}; return { userId: c.userId, role: c.role || 'SUPER_ADMIN', ipAddress: req?.ip, deviceInfo: req?.headers?.['user-agent'] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof HardwarePaymentError) throw new HttpException(e.message, e.status || HttpStatus.BAD_REQUEST); throw e; } }

@UseGuards(SuperAdminGuard)
@Controller('super-admin')
export class HardwarePaymentSuperAdminController {
  constructor(private readonly svc: HardwarePaymentService, private readonly job: HardwarePaymentReconciliationJob, private readonly residual: FiservResidualImportService) {}

  // global default split/recovery settings (§3/§5)
  @Get('hardware-payment/settings') getSettings() { return run(() => this.svc.getGlobalSettings()); }
  @Patch('hardware-payment/settings') updateSettings(@Req() r: any, @Body(ValidatedBody(HW_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.updateGlobalSettings(b || {}, actor(r))); }

  // per-tenant plan (§6) + tenant override settings (§5)
  @Get('tenants/:tenantId/hardware-payment/settings') tenantSettings(@Param('tenantId') t: string) { return run(() => this.svc.getTenantSettings(t)); }
  @Patch('tenants/:tenantId/hardware-payment/settings') updateTenantSettings(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.updateTenantSettings(t, b || {}, actor(r))); }
  @Get('tenants/:tenantId/hardware-payment-plan') getPlan(@Param('tenantId') t: string, @Req() r: any) { return run(() => this.svc.ownerPlan(t)); }
  @Post('tenants/:tenantId/hardware-payment-plan') createPlan(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_PLAN_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createPlan(t, b || {}, actor(r))); }
  @Patch('tenants/:tenantId/hardware-payment-plan/:planId') updatePlan(@Req() r: any, @Param('tenantId') t: string, @Param('planId') p: string, @Body(ValidatedBody(HW_PLAN_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updatePlan(t, p, b || {}, actor(r))); }

  // reconciliation + shortfall actions (§8/§10/§12)
  @Get('tenants/:tenantId/hardware-payment/reconciliation') reconciliation(@Param('tenantId') t: string) { return run(() => this.svc.adminInvoices(t)); }
  @Post('tenants/:tenantId/hardware-payment/recalculate-month') recalc(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_MONTH_PLAN_BODY, { strict: true })) b: any) {
    if (!b?.planId || !b?.billingMonth) throw new HttpException('planId and billingMonth are required', HttpStatus.BAD_REQUEST);
    return run(() => this.svc.reconcile(t, String(b.planId), String(b.billingMonth), Number(b.cardVolumeCents || 0), actor(r)));
  }
  @Post('tenants/:tenantId/hardware-payment/charge-shortfall') chargeShortfall(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_MONTH_PLAN_BODY, { strict: true })) b: any) {
    if (!b?.planId || !b?.billingMonth) throw new HttpException('planId and billingMonth are required', HttpStatus.BAD_REQUEST);
    return run(() => this.svc.chargeShortfallNow(t, String(b.planId), String(b.billingMonth), actor(r)));
  }
  // §12 residual import + §8 monthly job
  @Post('tenants/:tenantId/hardware-payment/import-volume') importVolume(@Param('tenantId') t: string, @Body(ValidatedBody(HW_IMPORT_VOLUME_BODY, { strict: true })) b: any) {
    if (!b?.billingMonth) throw new HttpException('billingMonth is required', HttpStatus.BAD_REQUEST);
    return run(() => this.residual.importVolume(t, String(b.billingMonth), Number(b.cardVolumeCents || 0), String(b.source || 'manual')));
  }
  @Get('hardware-payment/reports') reports() { return run(() => this.svc.reportMonthlyTotals()); }
  @Post('hardware-payment/run-monthly') runMonthly(@Body(ValidatedBody(HW_RUN_MONTHLY_BODY, { strict: true })) b: any) {
    if (!b?.billingMonth) throw new HttpException('billingMonth is required', HttpStatus.BAD_REQUEST);
    return run(() => this.job.runMonthly(String(b.billingMonth)));
  }

  @Post('tenants/:tenantId/hardware-payment/pause') pause(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_PLAN_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.pausePlan(t, String(b?.planId || ''), actor(r))); }
  @Post('tenants/:tenantId/hardware-payment/resume') resume(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(HW_PLAN_ID_BODY, { strict: true })) b: any) { return run(() => this.svc.resumePlan(t, String(b?.planId || ''), actor(r))); }

  // reports (§16)
  @Get('tenants/:tenantId/hardware-payment/invoices') invoices(@Param('tenantId') t: string) { return run(() => this.svc.adminInvoices(t)); }
  @Get('tenants/:tenantId/hardware-payment/ledger') ledger(@Param('tenantId') t: string) { return run(() => this.svc.adminLedger(t)); }
}
