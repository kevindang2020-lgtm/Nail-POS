// super-admin-ai-checkout-upsell.controller.ts — SuperAdminGuard-only oversight. Platform counts + audited support-mode
// per-tenant drill-down. No cross-tenant customer data.
import { Controller, Get, Query, Param, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminAiCheckoutUpsellService } from './super-admin-ai-checkout-upsell.service';
import { SuperAdminAiCheckoutUpsellControllerListQueries } from './super-admin-ai-checkout-upsell.list-queries';

function ctxFrom(r: any) { return { userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email, ip: safeInet(r?.ip) ?? undefined }; }

@ListQueries(SuperAdminAiCheckoutUpsellControllerListQueries)
@Controller('super-admin/ai-checkout-upsell')
@UseGuards(SuperAdminGuard)
export class SuperAdminAiCheckoutUpsellController {
  constructor(private readonly svc: SuperAdminAiCheckoutUpsellService) {}

  @Get('overview')
  overview(@Req() r: any) { return this.svc.platformOverview(ctxFrom(r)); }

  @Get('tenants/:tenantId')
  tenantView(@Req() r: any, @Param('tenantId') tenantId: string, @Query('reason') reason: string) { return this.svc.tenantView(ctxFrom(r), tenantId, reason); }
}
