// skip-line-settings.controller.ts — per-tenant Skip-the-Line settings. POS (manager-gated) + Super-Admin (per tenant).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SKIP_SETTINGS_BODY } from '../request-schemas';
import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { RequirePermission, SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { slcCtx, slcRun } from './skip-line-checkout.http';

@Controller('pos/settings')
export class PosSkipLineSettingsController {
  constructor(private readonly svc: SkipLineCheckoutService) {}
  @RequirePermission('checkout.view') @Get('skip-line-checkout') get(@Req() r: any) { return slcRun(() => this.svc.getSettings(slcCtx(r))); }
  @RequirePermission('checkout.process_payment') @Patch('skip-line-checkout') update(@Req() r: any, @Body(ValidatedBody(SKIP_SETTINGS_BODY, { strict: true })) b: any) { return slcRun(() => this.svc.updateSettings(slcCtx(r), b || {})); }
}

@Controller('super-admin')
@UseGuards(SuperAdminGuard)
export class SuperAdminSkipLineSettingsController {
  constructor(private readonly svc: SkipLineCheckoutService) {}
  @Get('tenants/:tenantId/skip-line-checkout') get(@Param('tenantId') t: string) { return slcRun(() => this.svc.adminGetSettings(t)); }
  @Patch('tenants/:tenantId/skip-line-checkout') update(@Req() r: any, @Param('tenantId') t: string, @Body(ValidatedBody(SKIP_SETTINGS_BODY, { strict: true })) b: any) { return slcRun(() => this.svc.adminUpdateSettings(slcCtx(r), t, b || {})); }
}
