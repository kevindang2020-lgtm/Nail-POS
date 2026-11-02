import { Controller, Get, Post, Req, Body } from '@nestjs/common';
import { RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';   // Phase 9: staff self-service keys (self.profile.*)
import { AccountService } from './account.service';
import { acctCtx, acctRun } from './account.http';
import { DELETE_ACCOUNT_REQUEST_BODY } from './request-schemas';

// One controller per role prefix so each request is authenticated by the same guard chain as that app's other routes.
@Controller('customer')
export class CustomerAccountController {
  constructor(private readonly svc: AccountService) {}
  @Post('me/delete-account-request') del(@Req() r: any, @Body(ValidatedBody(DELETE_ACCOUNT_REQUEST_BODY, { strict: true })) b: any) { return acctRun(() => this.svc.requestDeletion(acctCtx(r), 'customer', b || {})); }
}
@Controller('owner')
export class OwnerAccountController {
  constructor(private readonly svc: AccountService) {}
  @RequirePermission('self.profile.edit') @Post('me/delete-account-request') del(@Req() r: any, @Body(ValidatedBody(DELETE_ACCOUNT_REQUEST_BODY, { strict: true })) b: any) { return acctRun(() => this.svc.requestDeletion(acctCtx(r), 'owner', b || {})); }
}
@Controller('tech')
export class TechAccountController {
  constructor(private readonly svc: AccountService) {}
  @RequirePermission('self.profile.edit') @Post('me/delete-account-request') del(@Req() r: any, @Body(ValidatedBody(DELETE_ACCOUNT_REQUEST_BODY, { strict: true })) b: any) { return acctRun(() => this.svc.requestDeletion(acctCtx(r), 'tech', b || {})); }
}
// Privacy export: authenticated user's own data. Exposed under each role prefix (guaranteed auth) for the app to call.
@Controller()
export class PrivacyExportController {
  constructor(private readonly svc: AccountService) {}
  @AsyncExport({ kind: 'me.privacy-export' }) @Get('me/privacy-export') root(@Req() r: any) { return acctRun(() => this.svc.privacyExport(acctCtx(r))); }
  @AsyncExport({ kind: 'customer.privacy-export' }) @Get('customer/me/privacy-export') cust(@Req() r: any) { return acctRun(() => this.svc.privacyExport(acctCtx(r))); }
  @AsyncExport({ kind: 'owner.privacy-export' }) @RequirePermission('self.profile.view') @Get('owner/me/privacy-export') own(@Req() r: any) { return acctRun(() => this.svc.privacyExport(acctCtx(r))); }
  @AsyncExport({ kind: 'tech.privacy-export' }) @RequirePermission('self.profile.view') @Get('tech/me/privacy-export') tech(@Req() r: any) { return acctRun(() => this.svc.privacyExport(acctCtx(r))); }
}
