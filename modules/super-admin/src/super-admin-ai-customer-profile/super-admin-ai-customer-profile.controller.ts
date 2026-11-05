// super-admin-ai-customer-profile.controller.ts — SuperAdminGuard-only oversight for ai_customer_profile (§55).
// Platform counts + a controlled support-mode per-tenant drill-down. The guard restricts this surface to SUPER_ADMIN
// principals; the raw client tenantId is only used after the guard authorizes the caller.
import { Controller, Get, Query, Param, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminAiCustomerProfileService } from './super-admin-ai-customer-profile.service';
import { SuperAdminAiCustomerProfileControllerListQueries } from './super-admin-ai-customer-profile.list-queries';

function ctxFrom(r: any) { return { userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email, ip: safeInet(r?.ip) ?? undefined }; }

@ListQueries(SuperAdminAiCustomerProfileControllerListQueries)
@Controller('super-admin/ai-customer-profile')
@UseGuards(SuperAdminGuard)
export class SuperAdminAiCustomerProfileController {
  constructor(private readonly svc: SuperAdminAiCustomerProfileService) {}

  // Platform-operational overview — counts only, no cross-tenant customer data.
  @Get('overview')
  overview(@Req() r: any) { return this.svc.platformOverview(ctxFrom(r)); }

  // Controlled support-mode drill-down into a single tenant's usage + aggregate (§54). Audited.
  @Get('tenants/:tenantId')
  tenantView(@Req() r: any, @Param('tenantId') tenantId: string, @Query('reason') reason: string) {
    return this.svc.tenantView(ctxFrom(r), tenantId, reason);
  }
}
