// super-admin-staff.controller.ts — SuperAdminGuard-only, READ-ONLY cross-tenant Staff / Technicians overview (Phase 9).
// Two routes: the platform aggregation that powers the Super Admin Staff screen, and a read-only technician drill-down.
// No write routes (tenants manage their own staff via the POS/Owner surfaces). Mirrors super-admin-memberships.
import { Controller, Get, Post, Delete, Body, BadRequestException, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminStaffService, SuperAdminStaffError, type AdminCtx } from './super-admin-staff.service';
import { SuperAdminStaffControllerListQueries } from './super-admin-staff.list-queries';
import { WF_ACCESS_SUPPORT_BODY, WF_CROSS_TRANSFER_BODY, WF_DECISION_BODY, WF_DUPLICATE_REVIEW_BODY, WF_REASON_BODY, WF_SAVED_VIEW_BODY, WF_SECURITY_REVIEW_BODY, WF_TRANSFER_BODY } from '../request-schemas-workforce';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof SuperAdminStaffError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'invalid') throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminStaffControllerListQueries)
@Controller('super-admin/staff')
export class SuperAdminStaffController {
  constructor(private readonly svc: SuperAdminStaffService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), { search: q?.search, status: q?.status, limit: q?.limit }).then((o) => ({ ok: true, ...o }));
  }

  @Get('workforce-overview') workforceOverview(@Req() r: any) {
    return this.svc.getWorkforceOverview(ctxFrom(r), { scope: r?.ctx?.scope }).then((o) => ({ ok: true, ...o }));
  }

  @Get('workforce') workforceDirectory(@Req() r: any, @Query() q: any) {
    return this.svc.getWorkforceDirectory(ctxFrom(r), { ...(q || {}), scope: r?.ctx?.scope }).then((o) => ({ ok: true, ...o }));
  }

  @Get('workforce/:userId') workforceProfile(@Req() r: any, @Param('userId') id: string) {
    return run(async () => ({ ok: true, profile: await this.svc.getWorkforceProfile(ctxFrom(r), id) }));
  }

  @Post('workforce/:userId/access-support') accessSupport(@Req() r: any, @Param('userId') id: string, @Body(ValidatedBody(WF_ACCESS_SUPPORT_BODY, { strict: true })) body: any) {
    return run(() => this.svc.accessSupport(ctxFrom(r), id, body || {}));
  }

  @Get('workforce-deactivation-queue') deactivationQueue(@Req() r: any) {
    return run(async () => ({ ok: true, rows: await this.svc.getDeactivationQueue(ctxFrom(r), r?.ctx?.scope) }));
  }

  @Post('workforce/:userId/deactivate-access') deactivateAccess(@Req() r: any, @Param('userId') id: string, @Body(ValidatedBody(WF_REASON_BODY, { strict: true })) body: any) {
    return run(() => this.svc.deactivateAccess(ctxFrom(r), id, body || {}));
  }

  @Get('workforce-duplicates') duplicates(@Req() r: any) {
    return run(async () => ({ ok: true, groups: await this.svc.getDuplicateGroups(ctxFrom(r), r?.ctx?.scope) }));
  }

  @Post('workforce-duplicates/review') reviewDuplicate(@Req() r: any, @Body(ValidatedBody(WF_DUPLICATE_REVIEW_BODY, { strict: true })) body: any) {
    return run(() => this.svc.reviewDuplicate(ctxFrom(r), body || {}));
  }

  @Get('workforce-transfers') transfers(@Req() r: any) {
    return run(async () => ({ ok: true, pipeline: await this.svc.getWorkforceTransfers(ctxFrom(r), r?.ctx?.scope) }));
  }

  @Post('workforce/:userId/transfer') requestTransfer(@Req() r: any, @Param('userId') id: string, @Body(ValidatedBody(WF_TRANSFER_BODY, { strict: true })) body: any) {
    return run(() => this.svc.requestWorkerTransfer(ctxFrom(r), id, body || {}));
  }

  @Post('workforce-transfers/:id/decision') decideTransfer(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WF_DECISION_BODY, { strict: true })) body: any) {
    return run(() => this.svc.decideWorkerTransfer(ctxFrom(r), id, body || {}));
  }

  @Get('workforce-cross-transfers') crossTransfers(@Req() r: any) {
    return run(async () => ({ ok: true, rows: await this.svc.getCrossTenantTransfers(ctxFrom(r), r?.ctx?.scope) }));
  }

  @Post('workforce/:userId/cross-transfer') requestCrossTransfer(@Req() r: any, @Param('userId') id: string, @Body(ValidatedBody(WF_CROSS_TRANSFER_BODY, { strict: true })) body: any) {
    return run(() => this.svc.requestCrossTenantTransfer(ctxFrom(r), id, body || {}));
  }

  @Post('workforce-cross-transfers/:id/decision') decideCrossTransfer(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WF_DECISION_BODY, { strict: true })) body: any) {
    return run(() => this.svc.decideCrossTenantTransfer(ctxFrom(r), id, body || {}));
  }

  @Get('workforce-payroll-sync') payrollSync(@Req() r: any) {
    return run(async () => ({ ok: true, ...(await this.svc.getPayrollSync(ctxFrom(r), r?.ctx?.scope)) }));
  }

  @Post('workforce-payroll-sync/:id/retry') retryPayrollSync(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WF_REASON_BODY, { strict: true })) body: any) {
    return run(() => this.svc.retryPayrollSync(ctxFrom(r), id, body || {}));
  }

  @Get('workforce-security-activity') securityActivity(@Req() r: any) {
    return run(async () => ({ ok: true, ...(await this.svc.getSecurityActivity(ctxFrom(r), r?.ctx?.scope)) }));
  }

  @Post('workforce-security-activity/review') reviewSecurity(@Req() r: any, @Body(ValidatedBody(WF_SECURITY_REVIEW_BODY, { strict: true })) body: any) {
    return run(() => this.svc.reviewSecurityAlert(ctxFrom(r), body || {}));
  }

  @Get('workforce-connectivity') connectivity(@Req() r: any) {
    return run(async () => ({ ok: true, ...(await this.svc.getTechnicianConnectivity(ctxFrom(r), r?.ctx?.scope)) }));
  }

  @Get('workforce-views') savedViews(@Req() r: any) {
    return run(async () => ({ ok: true, views: await this.svc.getSavedViews(ctxFrom(r), 'workforce') }));
  }

  @Post('workforce-views') saveView(@Req() r: any, @Body(ValidatedBody(WF_SAVED_VIEW_BODY, { strict: true })) body: any) {
    return run(() => this.svc.saveView(ctxFrom(r), 'workforce', body || {}));
  }

  @Delete('workforce-views/:id') deleteView(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.deleteView(ctxFrom(r), id));
  }

  @Get('technicians/:technicianId') technician(@Req() r: any, @Param('technicianId') id: string) {
    return run(async () => ({ ok: true, technician: await this.svc.getStaffDetail(ctxFrom(r), id) }));
  }
}
