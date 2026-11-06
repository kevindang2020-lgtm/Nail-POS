// backup-center.controller.ts — G9 Enterprise Backup & Disaster Recovery (Nov 5 2026).
//
//   Super Admin → Backup & Disaster Recovery (English only), SuperAdminGuard + a declared permission on every route:
//   GET  super-admin/backups/overview | tenants?q | recovery-points?tenantId&branchId | recovery-points/:id   backups.view
//   GET  super-admin/backups/restore-plans | restore-plans/:id                                             backups.view
//   POST super-admin/backups/restore-plans                       backups.plan    (dry run → AWAITING_APPROVAL or BLOCKED)
//   POST super-admin/backups/restore-plans/:id/cancel            backups.plan
//   POST super-admin/backups/restore-plans/:id/approve           backups.approve + step-up (a SECOND person; bound to the plan sha256)
//   POST super-admin/backups/restore-plans/:id/execute           backups.execute + step-up (idempotent; fenced one-per-tenant)
//
//   Service-to-service (network-restricted internal/ + svc.backups token or BACKUP_REPORT_TOKEN, like /internal/backups/report):
//   POST internal/backups/recovery-points                        the provider job's manifest
//   POST internal/backups/recovery-points/:id/verification       a restore test's evidence
import { Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { requireServiceCaller, ServiceAuthError } from '@aipowersalon/auth';
import { withCode } from '@aipowersalon/api-contracts';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQueries, type ListQuerySpec } from '@aipowersalon/database';
import { BackupCenterError } from './backup-center-core';
import { BackupCenterService, type BackupActor } from './backup-center.service';
import { RECOVERY_POINT_BODY, POINT_VERIFICATION_BODY, RESTORE_PLAN_BODY, RESTORE_APPROVE_BODY, RESTORE_EXECUTE_BODY, RESTORE_CANCEL_BODY } from './request-schemas';

const actor = (r: any): BackupActor => ({ userId: r?.user?.id ?? r?.user?.userId ?? null, email: r?.user?.email ?? null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof BackupCenterError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status); throw e; }
}
export const BackupCenterListQueries = {
  plans: { filters: { status: { type: 'text' }, tenantId: { type: 'id' } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize'] },
  points: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' } }, search: false },
  tenants: { filters: {}, search: { maxLength: 80 } },
} satisfies Record<string, ListQuerySpec>;

@ListQueries(BackupCenterListQueries)
@Controller('super-admin/backups')
@UseGuards(SuperAdminGuard)
export class BackupCenterController {
  constructor(private readonly svc: BackupCenterService) {}

  @Get('overview') @RequirePermission('super_admin.backups.view')
  overview() { return run(() => this.svc.overview()); }
  @Get('tenants') @RequirePermission('super_admin.backups.view')
  tenants(@Query('q') q?: string) { return run(() => this.svc.searchTenants(String(q ?? ''))); }
  @Get('recovery-points') @RequirePermission('super_admin.backups.view')
  points(@Query('tenantId') tenantId?: string, @Query('branchId') branchId?: string) { return run(() => this.svc.points({ tenantId: tenantId || null, branchId: branchId || null })); }
  @Get('recovery-points/:id') @RequirePermission('super_admin.backups.view')
  point(@Param('id') id: string) { return run(() => this.svc.point(id)); }

  @Get('restore-plans') @RequirePermission('super_admin.backups.view')
  plans(@Query('status') status?: string, @Query('tenantId') tenantId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return run(() => this.svc.plans({ status, tenantId, page: Number(page) || 1, pageSize: Number(pageSize) || 25 }));
  }
  @Get('restore-plans/:id') @RequirePermission('super_admin.backups.view')
  plan(@Param('id') id: string) { return run(() => this.svc.plan(id)); }
  @Post('restore-plans') @RequirePermission('super_admin.backups.plan')
  create(@Req() r: any, @Body(ValidatedBody(RESTORE_PLAN_BODY, { strict: true })) b: any) { return run(() => this.svc.createPlan(actor(r), b ?? {})); }
  @Post('restore-plans/:id/cancel') @RequirePermission('super_admin.backups.plan')
  cancel(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RESTORE_CANCEL_BODY, { strict: true })) b: any) { return run(() => this.svc.cancel(actor(r), id, b?.reason)); }
  @Post('restore-plans/:id/approve') @RequirePermission('super_admin.backups.approve') @RequireStepUp()
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RESTORE_APPROVE_BODY, { strict: true })) b: any) { return run(() => this.svc.approve(actor(r), id, b ?? {})); }
  @Post('restore-plans/:id/execute') @RequirePermission('super_admin.backups.execute') @RequireStepUp()
  execute(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RESTORE_EXECUTE_BODY, { strict: true })) b: any) { return run(() => this.svc.execute(actor(r), id, b ?? {})); }
}

function serviceCaller(r: any): string {
  try { return requireServiceCaller(r, 'backups.report', { name: 'BACKUP_REPORT_TOKEN', secret: process.env.BACKUP_REPORT_TOKEN, header: 'x-backup-report-token' }).principal; }
  catch (e) { if (e instanceof ServiceAuthError) { if (e.status === 503) throw withCode(new ServiceUnavailableException('Backup reporting is not configured (SERVICE_TOKEN_SECRET or BACKUP_REPORT_TOKEN).'), 'SERVICE_UNAVAILABLE'); throw withCode(new UnauthorizedException('Invalid backup report credentials.'), 'AUTH_REQUIRED'); } throw e; }
}

@Controller('internal/backups')
export class BackupCatalogIngestController {
  constructor(private readonly svc: BackupCenterService) {}
  @Post('recovery-points') @HttpCode(200)
  record(@Req() r: any, @Body(ValidatedBody(RECOVERY_POINT_BODY, { strict: true })) b: unknown) { const by = serviceCaller(r); return run(() => this.svc.recordPoint(b, by)); }
  @Post('recovery-points/:id/verification') @HttpCode(200)
  verify(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(POINT_VERIFICATION_BODY, { strict: true })) b: any) { const by = serviceCaller(r); return run(() => this.svc.recordVerification(id, b ?? {}, by)); }
}
