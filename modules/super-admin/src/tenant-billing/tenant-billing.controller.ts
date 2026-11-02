// tenant-billing.controller.ts — tenant self-service view of its OWN platform billing invoices
// (GET /tenant/account/invoices/state, settings.view). Reuses SuperAdminBillingService.tenantBillingProfile
// for the caller's SERVER-DERIVED tenant; never accepts a tenantId from the client. Read-only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminBillingService } from '../super-admin-billing/billing.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/account/invoices')
export class TenantBillingController {
  constructor(private readonly billing: SuperAdminBillingService) {}
  @Get('state') @RequirePermission('settings.view')
  async state(@Req() r: any) {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    try {
      const profile = await this.billing.tenantBillingProfile({ userId: c.userId, role: c.role }, c.tenantId);
      // Tenant-facing invoice view: invoices + what's owed + available credits + current plan. (The full
      // billing profile also carries discounts/audit; those stay on the super-admin surface.)
      return {
        tenantId: profile.tenantId, currency: profile.currency,
        plan: profile.subscription?.plan ?? null, planStatus: profile.subscription?.status ?? null,
        outstandingCents: profile.outstandingCents ?? 0,
        invoices: profile.invoices ?? [],
        credits: profile.credits ?? [],
      };
    } catch (e: any) {
      throw new HttpException(e?.message || 'Cannot load invoices', HttpStatus.BAD_REQUEST);
    }
  }
}
