// tenant-messaging.controller.ts — Super-Admin surface to configure each tenant's Twilio credentials. Guarded by
// SuperAdminGuard; the auth token is write-only (never returned). Reads show masked hints only.
import { Controller, Get, Put, Post, Param, Body, Req, UseGuards, HttpException, HttpStatus, Query } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { TenantNumberService } from './tenant-number.service';
import { ListQueries } from '@aipowersalon/database';
import { TenantMessagingControllerListQueries } from './tenant-messaging.list-queries';
import { MESSAGING_CREDS_BODY, MESSAGING_TEST_BODY, PHONE_NUMBER_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@ListQueries(TenantMessagingControllerListQueries)
@Controller('super-admin/tenants')
export class TenantMessagingController {
  constructor(private readonly svc: TenantMessagingCredentialsService, private readonly numbers: TenantNumberService) {}

  @Get(':tenantId/number') getNumber(@Param('tenantId') tenantId: string) { return this.numbers.get(tenantId); }
  @Get(':tenantId/number/search') searchNumbers(@Param('tenantId') tenantId: string, @Query('areaCode') areaCode?: string, @Query('country') country?: string) { return this.numbers.search(tenantId, { areaCode, country }); }
  @Post(':tenantId/number/buy') buyNumber(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PHONE_NUMBER_BODY)) b: any) {
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.buyAndRegister(r?.ctx?.userId || 'super-admin', tenantId, b.phoneNumber);
  }
  @Post(':tenantId/number/register') registerNumber(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PHONE_NUMBER_BODY)) b: any) {
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.registerExisting(r?.ctx?.userId || 'super-admin', tenantId, b.phoneNumber);
  }

  @Get(':tenantId/messaging-credentials')
  get(@Param('tenantId') tenantId: string) { return this.svc.getMasked(tenantId); }

  @Put(':tenantId/messaging-credentials')
  async set(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MESSAGING_CREDS_BODY)) b: any) {
    try {
      return await this.svc.set(r?.ctx?.userId || 'super-admin', tenantId, { accountSid: b?.accountSid, authToken: b?.authToken, fromNumber: b?.fromNumber, verifyServiceSid: b?.verifyServiceSid, apiKeySid: b?.apiKeySid, apiKeySecret: b?.apiKeySecret });
    } catch (e: any) {
      if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  /** Phase 4: "Test Verify" from Super Admin (the salon default's Verify Service). */
  @Post(':tenantId/messaging-credentials/test-verify')
  testVerify(@Req() r: any, @Param('tenantId') tenantId: string) { return this.svc.testVerify(r?.ctx?.userId || 'super-admin', tenantId, null); }

  @Post(':tenantId/messaging-credentials/test')
  async test(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MESSAGING_TEST_BODY)) b: any) {
    try {
      return await this.svc.testSend(r?.ctx?.userId || 'super-admin', tenantId, b?.to);
    } catch (e: any) {
      if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
