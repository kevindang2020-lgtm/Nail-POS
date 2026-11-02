// tenant-a2p.controller.ts — Super-Admin surface to drive a salon's A2P 10DLC registration under the ISV account.
import { Controller, Get, Put, Post, Param, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TenantA2pService } from './tenant-a2p.service';
import { A2P_BUSINESS_INFO_BODY, A2P_INPUTS_BODY, A2P_NUMBER_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/tenants')
export class TenantA2pController {
  constructor(private readonly svc: TenantA2pService) {}
  private actor(r: any) { return r?.ctx?.userId || 'super-admin'; }

  @Get(':tenantId/a2p') get(@Param('tenantId') tenantId: string) { return this.svc.get(tenantId); }
  @Put(':tenantId/a2p/business-info') businessInfo(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(A2P_BUSINESS_INFO_BODY, { strict: true })) b: any) { return this.svc.saveBusinessInfo(this.actor(r), tenantId, b); }
  @Post(':tenantId/a2p/provision-profile') provision(@Req() r: any, @Param('tenantId') tenantId: string) { return this.svc.provisionSecondaryProfile(this.actor(r), tenantId); }
  @Put(':tenantId/a2p/inputs') saveInputs(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(A2P_INPUTS_BODY, { strict: true })) b: any) { return this.svc.saveInputs(this.actor(r), tenantId, b); }
  @Post(':tenantId/a2p/brand') brand(@Req() r: any, @Param('tenantId') tenantId: string) { return this.svc.submitBrand(this.actor(r), tenantId); }
  @Post(':tenantId/a2p/campaign') campaign(@Req() r: any, @Param('tenantId') tenantId: string) { return this.svc.submitCampaign(this.actor(r), tenantId); }
  @Post(':tenantId/a2p/number') number(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(A2P_NUMBER_BODY, { strict: true })) b: any) {
    if (!b?.phoneNumberSid) throw new HttpException('phoneNumberSid is required', HttpStatus.BAD_REQUEST);
    return this.svc.attachNumber(this.actor(r), tenantId, b.phoneNumberSid);
  }
  @Post(':tenantId/a2p/refresh') refresh(@Param('tenantId') tenantId: string) { return this.svc.refresh(tenantId); }
}
