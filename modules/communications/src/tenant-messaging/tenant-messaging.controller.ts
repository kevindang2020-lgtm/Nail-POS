// tenant-messaging.controller.ts — Super-Admin surface to configure each tenant's Twilio credentials. Guarded by
// SuperAdminGuard; the auth token is write-only (never returned). Reads show masked hints only.
import { Controller, Get, Put, Post, Param, Body, Req, UseGuards, HttpException, HttpStatus, Query } from '@nestjs/common';
import { SuperAdminGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { TenantNumberService, NumberPurchaseError } from './tenant-number.service';
import { ERROR_REGISTRY, isRegisteredCode, codedFieldsOf } from '@aipowersalon/api-contracts';
import { ListQueries } from '@aipowersalon/database';
import { TenantMessagingControllerListQueries } from './tenant-messaging.list-queries';
import { EMPTY_BODY, MESSAGING_CREDS_BODY, MESSAGING_TEST_BODY, PHONE_NUMBER_BODY, NUMBER_QUOTE_BODY, NUMBER_BUY_BODY, PLATFORM_PROVISION_BODY, PLATFORM_OFFBOARD_BODY } from '../request-schemas';
import { PlatformMessagingProvisioner, ProvisioningConflict } from './platform-messaging-provisioner';

/** a coded refusal (credentials / number purchase) → its registry status + code (+ safe params), as on the salon routes;
 *  before, every credential refusal became a bare VALIDATION_FAILED and the "Twilio unreachable — save unverified?" choice was lost */
function codedError(e: any): unknown {
  if (e instanceof CredentialsInputError || e instanceof NumberPurchaseError) {
    const coded = codedFieldsOf(e);   // the code + params withCode attached
    const code = coded && isRegisteredCode(coded.apiCode) ? coded.apiCode : 'VALIDATION_FAILED';
    const status = coded && isRegisteredCode(coded.apiCode) ? ERROR_REGISTRY[coded.apiCode as keyof typeof ERROR_REGISTRY].status : HttpStatus.BAD_REQUEST;
    return new HttpException({ code, message: e.message, ...(coded?.apiParams ? { params: coded.apiParams } : {}) }, status);
  }
  return e;
}
async function coded<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { throw codedError(e); } }

@UseGuards(SuperAdminGuard)
@ListQueries(TenantMessagingControllerListQueries)
@Controller('super-admin/tenants')
export class TenantMessagingController {
  constructor(private readonly svc: TenantMessagingCredentialsService, private readonly numbers: TenantNumberService, private readonly provisioner: PlatformMessagingProvisioner) {}

  /** B-16 (Oct 20 2026): provision a PLATFORM-MANAGED salon's texting — its Twilio subaccount, Messaging Service and number,
   *  resumable step by step (platform-messaging-provisioner.ts). Spends money at Twilio (a number) → integrations.manage +
   *  step-up + a reason. 409 when the salon brought its own account or a run is already in progress. */
  @Post(':tenantId/messaging/platform-provision')
  @UseGuards(RolePermissionGuard) @RequirePermission('super_admin.integrations.manage') @RequireStepUp()
  async provisionPlatform(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PLATFORM_PROVISION_BODY, { strict: true })) b: any) {
    const reason = String(b?.reason ?? '').trim();
    if (reason.length < 3) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'A reason is required.' }, HttpStatus.BAD_REQUEST);
    if (b?.areaCode && !/^\d{3}$/.test(String(b.areaCode))) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'areaCode is three digits.' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.provisioner.provision(r?.ctx?.userId || 'super-admin', tenantId, { reason, areaCode: b?.areaCode || undefined, phoneNumber: b?.phoneNumber || undefined });
    } catch (e: any) {
      if (e instanceof ProvisioningConflict) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.CONFLICT);
      throw e;
    }
  }

  /** §149 (Oct 28 2026): shut down a CANCELLED salon's platform-managed texting now — release its Twilio number(s)
   *  (irreversible) and close its subaccount. The daily sweep does the same after MESSAGING_OFFBOARD_GRACE_DAYS (default
   *  30). integrations.manage + step-up + a reason; refused for a salon that is not cancelled or uses its own account. */
  @Post(':tenantId/messaging/platform-offboard')
  @UseGuards(RolePermissionGuard) @RequirePermission('super_admin.integrations.manage') @RequireStepUp()
  async offboardPlatform(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PLATFORM_OFFBOARD_BODY, { strict: true })) b: any) {
    const reason = String(b?.reason ?? '').trim();
    if (reason.length < 3) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'A reason is required.' }, HttpStatus.BAD_REQUEST);
    try {
      return await this.provisioner.offboard(r?.ctx?.userId || 'super-admin', tenantId, { reason });
    } catch (e: any) {
      if (e instanceof ProvisioningConflict) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.CONFLICT);
      throw e;
    }
  }

  @Get(':tenantId/number') getNumber(@Param('tenantId') tenantId: string) { return this.numbers.get(tenantId); }
  @Get(':tenantId/number/search') searchNumbers(@Param('tenantId') tenantId: string, @Query('areaCode') areaCode?: string, @Query('country') country?: string) { return this.numbers.search(tenantId, { areaCode, country }); }
  // Phone & Messaging guide §6.4 (gap sweep, Oct 30 2026): Super Admin buys through the SAME two-step purchase as the salon —
  // quote (availability re-check + the provider's quoted price + a single-use confirmation; buys nothing), then buy with
  // that confirmation. Before, one click on a search result bought the number with no price shown.
  @Post(':tenantId/number/quote') quoteNumber(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(NUMBER_QUOTE_BODY, { strict: true })) b: any) {
    return coded(() => this.numbers.quote(r?.ctx?.userId || 'super-admin', tenantId, String(b?.phoneNumber ?? '').trim()));
  }
  @Post(':tenantId/number/buy') buyNumber(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(NUMBER_BUY_BODY, { strict: true })) b: any) {
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return coded(() => this.numbers.confirmPurchase(r?.ctx?.userId || 'super-admin', tenantId, String(b.phoneNumber).trim(), String(b?.confirmationToken ?? '').trim()));
  }
  @Post(':tenantId/number/register') registerNumber(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(PHONE_NUMBER_BODY, { strict: true })) b: any) {
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.registerExisting(r?.ctx?.userId || 'super-admin', tenantId, b.phoneNumber);
  }

  @Get(':tenantId/messaging-credentials')
  get(@Param('tenantId') tenantId: string) { return this.svc.getMasked(tenantId); }

  @RequireStepUp()   // Security Deep Scan C7: a salon's messaging credentials are a credential change
  @Put(':tenantId/messaging-credentials')
  async set(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MESSAGING_CREDS_BODY, { strict: true })) b: any) {
    try {
      // gap sweep: confirmUnverified is forwarded (Twilio unreachable → the operator may save it as unverified, after being asked)
      return await this.svc.set(r?.ctx?.userId || 'super-admin', tenantId, { accountSid: b?.accountSid, authToken: b?.authToken, fromNumber: b?.fromNumber, verifyServiceSid: b?.verifyServiceSid, apiKeySid: b?.apiKeySid, apiKeySecret: b?.apiKeySecret, confirmUnverified: b?.confirmUnverified === true });
    } catch (e: any) {
      throw codedError(e);
    }
  }

  /** PM-02 (gap sweep, Oct 30 2026): the full Account SID for Super Admin too — the same audited reveal as the salon's,
   *  behind integrations.manage + a fresh step-up; every ordinary read stays masked (AC…1234). */
  @UseGuards(RolePermissionGuard) @RequirePermission('super_admin.integrations.manage') @RequireStepUp()
  @Post(':tenantId/messaging-credentials/reveal-sid')
  revealSid(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) {
    return coded(() => this.svc.revealAccountSid(r?.ctx?.userId || 'super-admin', tenantId, null));
  }

  /** Phase 4: "Test Verify" from Super Admin (the salon default's Verify Service). */
  @Post(':tenantId/messaging-credentials/test-verify')
  testVerify(@Req() r: any, @Param('tenantId') tenantId: string) { return this.svc.testVerify(r?.ctx?.userId || 'super-admin', tenantId, null); }

  @Post(':tenantId/messaging-credentials/test')
  async test(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MESSAGING_TEST_BODY, { strict: true })) b: any) {
    try {
      return await this.svc.testSend(r?.ctx?.userId || 'super-admin', tenantId, b?.to);
    } catch (e: any) {
      if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
