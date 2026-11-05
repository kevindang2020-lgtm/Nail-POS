import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
// tenant-sms-plan.controller.ts — §9/§10/§43: the TENANT's own view + self-service change (sms-packages P5).
// Server-derived tenant identity; inline permission checks per the tenant-controller pattern (settings.view to
// see, settings.edit to change). No Super Admin fields leak: balance() + self-service package list only.
import { Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { SmsEntitlementService } from './sms-entitlement.service';
import { SmsTenantPlanService, SmsTenantPlanError } from './sms-tenant-plan.service';
import { SMS_UPGRADE_BODY } from '../request-schemas';

function ctxFrom(r: any): { tenantId: string; userId: string | null; permissions: string[]; ip: string | null } {
  return { tenantId: String(r?.ctx?.tenantId ?? ''), userId: r?.ctx?.userId ?? null, permissions: r?.ctx?.permissions ?? [], ip: r?.ip ?? null };
}

@Controller('tenant/sms-plan')
export class TenantSmsPlanController {
  constructor(private readonly entitlement: SmsEntitlementService, private readonly plans: SmsTenantPlanService) {}

  @RequirePermission('settings.view') @Get()
  async plan(@Req() r: any) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.view')) throw new ForbiddenException('settings.view required');
    // wave 3 PAYI §76 / §77: the verification allowance (balance) and plain-SMS SEGMENT usage are reported side by side, never merged
    const [balance, packages, messaging] = await Promise.all([this.entitlement.balance(ctx.tenantId), this.plans.selfServicePackages(), this.plans.messagingUsageThisMonth(ctx.tenantId).catch(() => null)]);
    return { balance, packages, messaging };
  }

  @RequirePermission('settings.edit') @Post('upgrade')
  async upgrade(@Req() r: any, @Body(ValidatedBody(SMS_UPGRADE_BODY)) b: any) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    if (!b?.packageId) throw new HttpException('packageId is required', HttpStatus.BAD_REQUEST);
    try {
      const out = await this.plans.selfServiceChange({ userId: ctx.userId, ip: ctx.ip }, ctx.tenantId, String(b.packageId));
      return { ok: true, ...out };
    } catch (e) {
      if (e instanceof SmsTenantPlanError) return { ok: false, error: e.code, message: e.message };
      throw e;
    }
  }
}
