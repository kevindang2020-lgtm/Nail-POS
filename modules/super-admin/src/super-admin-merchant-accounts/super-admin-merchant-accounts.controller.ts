// super-admin-merchant-accounts.controller.ts — SuperAdminGuard-only Merchant Accounts read surface. This unit is the
// read spine (overview + directory). The controlled write workflows (onboarding, submit, MID assignment, rate config,
// activation, funding update, terminal assignment) are permissioned, audited operations added in later units — they
// are NOT receptionist/checkout actions and never appear here.
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminMerchantAccountsService, type AdminCtx } from './super-admin-merchant-accounts.service';
import { SuperAdminMerchantAccountsControllerListQueries } from './super-admin-merchant-accounts.list-queries';
import { MA_FUNDING_BODY, MA_MID_BODY, MA_RATES_BODY, MA_REASON_BODY, MA_TERMINAL_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminMerchantAccountsControllerListQueries)
@Controller('super-admin/merchant-accounts')
export class SuperAdminMerchantAccountsController {
  constructor(private readonly svc: SuperAdminMerchantAccountsService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), q || {});
  }

  @Get() list(@Req() r: any, @Query() q: any) {
    return this.svc.getList(ctxFrom(r), q || {});
  }

  // Server-side audited export of the filtered directory (safe fields only; injection-guarded CSV).
  @AsyncExport({ kind: 'super-admin.merchant-accounts.export' }) @Get('export') export(@Req() r: any, @Query() q: any) {
    return this.svc.exportReport(ctxFrom(r), q || {});
  }

  // Controlled write: configure processing rates for a merchant account (permissioned, validated, history-preserving,
  // idempotent, audited). Not a receptionist/checkout action.
  @Post(':tenantId/rates') configureRates(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_RATES_BODY)) body: any) {
    return this.svc.configureRates(ctxFrom(r), tenantId, body || {});
  }

  // Controlled status lifecycle: activation enforces blocking checks; deactivation/suspension require a reason. Audited.
  @Post(':tenantId/activation') activate(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_REASON_BODY)) body: any) {
    return this.svc.setProcessingStatus(ctxFrom(r), tenantId, 'activate', body || {});
  }
  @Post(':tenantId/deactivation') deactivate(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_REASON_BODY)) body: any) {
    return this.svc.setProcessingStatus(ctxFrom(r), tenantId, 'deactivate', body || {});
  }
  @Post(':tenantId/suspension') suspend(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_REASON_BODY)) body: any) {
    return this.svc.setProcessingStatus(ctxFrom(r), tenantId, 'suspend', body || {});
  }

  // Controlled high-risk write: secure funding update (step-up gated, encrypted, masked, audited).
  @Post(':tenantId/funding-update') updateFunding(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_FUNDING_BODY)) body: any) {
    return this.svc.updateFunding(ctxFrom(r), tenantId, body || {});
  }

  // Controlled write: assign/reassign a MID (conflict-checked, branch-validated, audited).
  @Post(':tenantId/mid-assignment') assignMid(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_MID_BODY)) body: any) {
    return this.svc.assignMid(ctxFrom(r), tenantId, body || {});
  }

  // Controlled write: assign a terminal to a branch (ownership-validated, history-preserving, audited).
  @Post(':tenantId/terminals') assignTerminal(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MA_TERMINAL_BODY)) body: any) {
    return this.svc.assignTerminal(ctxFrom(r), tenantId, body || {});
  }
}
