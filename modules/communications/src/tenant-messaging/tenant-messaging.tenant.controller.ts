// tenant-messaging.tenant.controller.ts — self-service surface: a salon configures ITS OWN Twilio account. Behind
// TenantAuthGuard; the tenant is taken from the session (req.ctx), never the client, so a salon can only ever touch its
// own credentials. Writes require settings.edit. Auth token remains write-only (masked reads only).
import { Controller, Get, Put, Post, Delete, Body, Req, UseGuards, ForbiddenException, HttpException, HttpStatus, Query, Param } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { TenantNumberService } from './tenant-number.service';
import { ListQueries } from '@aipowersalon/database';
import { TenantMessagingSelfControllerListQueries } from './tenant-messaging.tenant.list-queries';
import { MESSAGING_CREDS_BODY, MESSAGING_TEST_BODY, PHONE_NUMBER_BODY } from '../request-schemas';

function ctxFrom(req: any): { tenantId: string; userId: string; permissions: string[] } {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, userId: c.userId, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard)
@ListQueries(TenantMessagingSelfControllerListQueries)
@Controller('tenant/messaging')
export class TenantMessagingSelfController {
  constructor(private readonly svc: TenantMessagingCredentialsService, private readonly numbers: TenantNumberService) {}

  @RequirePermission('settings.view') @Get('number') getNumber(@Req() r: any) { return this.numbers.get(ctxFrom(r).tenantId); }
  @RequirePermission('settings.view') @Get('number/search') searchNumbers(@Req() r: any, @Query('areaCode') areaCode?: string, @Query('country') country?: string) { return this.numbers.search(ctxFrom(r).tenantId, { areaCode, country }); }
  @RequirePermission('settings.edit') @Post('number/buy') buyNumber(@Req() r: any, @Body(ValidatedBody(PHONE_NUMBER_BODY)) b: any) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.buyAndRegister(ctx.userId, ctx.tenantId, b.phoneNumber);
  }
  @RequirePermission('settings.edit') @Post('number/register') registerNumber(@Req() r: any, @Body(ValidatedBody(PHONE_NUMBER_BODY)) b: any) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.registerExisting(ctx.userId, ctx.tenantId, b.phoneNumber);
  }

  // Phase 4: the salon's own Twilio, including the Verify Service booking verification sends through. The plain routes
  // address the salon default every branch inherits; `credentials/branches/:branchId/…` a branch's own credentials.
  // A PATH parameter, not `?branchId=`: the session middleware strips tenantId/branchId from every tenant request's
  // body and query (a client must never name its scope) — the first version used the query and, live, every branch
  // operation silently hit the salon default. The service checks the branch is this salon's.
  @RequirePermission('settings.view') @Get('credentials')
  get(@Req() r: any) { return this.svc.getMasked(ctxFrom(r).tenantId, null); }

  @Get('credentials/branches')
  @RequirePermission('settings.view')
  branches(@Req() r: any) { return this.svc.listBranchOverrides(ctxFrom(r).tenantId); }

  @Get('credentials/branches/:branchId')
  @RequirePermission('settings.view')
  getBranch(@Req() r: any, @Param('branchId') branchId: string) { return this.svc.getMasked(ctxFrom(r).tenantId, branchId); }

  @RequirePermission('settings.edit') @Put('credentials')
  set(@Req() r: any, @Body(ValidatedBody(MESSAGING_CREDS_BODY)) b: any) { return this.save(r, b, null); }

  @Put('credentials/branches/:branchId')
  @RequirePermission('settings.edit')
  setBranch(@Req() r: any, @Body(ValidatedBody(MESSAGING_CREDS_BODY)) b: any, @Param('branchId') branchId: string) { return this.save(r, b, branchId); }

  private async save(r: any, b: any, branchId: string | null) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    try {
      return await this.svc.set(ctx.userId, ctx.tenantId, {
        accountSid: b?.accountSid, authToken: b?.authToken, fromNumber: b?.fromNumber,
        verifyServiceSid: b?.verifyServiceSid, apiKeySid: b?.apiKeySid, apiKeySecret: b?.apiKeySecret,
      }, branchId);
    } catch (e: any) {
      if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  /** Disconnect this scope's Twilio (a branch falls back to the salon default). */
  @Delete('credentials')
  @RequirePermission('settings.edit')
  disconnect(@Req() r: any) { return this.drop(r, null); }

  @Delete('credentials/branches/:branchId')
  @RequirePermission('settings.edit')
  disconnectBranch(@Req() r: any, @Param('branchId') branchId: string) { return this.drop(r, branchId); }

  private async drop(r: any, branchId: string | null) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    try { return await this.svc.disconnect(ctx.userId, ctx.tenantId, branchId); }
    catch (e: any) { if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST); throw e; }
  }

  /** "Test Verify": fetch the Verify Service with these credentials and record the outcome. */
  @Post('credentials/test-verify')
  @RequirePermission('settings.edit')
  testVerify(@Req() r: any) { const ctx = ctxFrom(r); return this.svc.testVerify(ctx.userId, ctx.tenantId, null); }

  @Post('credentials/branches/:branchId/test-verify')
  @RequirePermission('settings.edit')
  testVerifyBranch(@Req() r: any, @Param('branchId') branchId: string) { const ctx = ctxFrom(r); return this.svc.testVerify(ctx.userId, ctx.tenantId, branchId); }

  @RequirePermission('settings.edit') @Post('credentials/test')
  async test(@Req() r: any, @Body(ValidatedBody(MESSAGING_TEST_BODY)) b: any) {
    const ctx = ctxFrom(r);
    if (!ctx.permissions.includes('settings.edit')) throw new ForbiddenException('settings.edit required');
    try {
      return await this.svc.testSend(ctx.userId, ctx.tenantId, b?.to);
    } catch (e: any) {
      if (e instanceof CredentialsInputError) throw new HttpException({ code: 'VALIDATION_FAILED', message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
