/**
 * super-admin-customer-data.controller.ts
 * ---------------------------------------------------------------------------
 * HTTP surface for Customer Data Oversight. Mounted behind the `super-admin` guard — this is the explicit
 * authorized cross-tenant monitoring path. A tenantId query param hard-scopes the response to one tenant.
 * Thin: all derivation lives in the service + pure engine/aggregate.
 */

import { LegalHoldService, CustomerReconciliationService } from '@aipowersalon/customers';
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { CustomerDataOversightService, type OverviewQuery } from './super-admin-customer-data.service';
import { CustomerImportService } from './customer-import.service';
import { CustomerDeletionService } from './customer-deletion.service';
import { SuperAdminCustomerDataControllerListQueries } from './super-admin-customer-data.list-queries';
import { CD_CONFLICT_STATUS_BODY, CD_DELETION_BODY, CD_EXECUTE_DELETION_BODY, CD_IMPORT_BODY, CD_LEGAL_HOLD_BODY, CD_PROCESS_IMPORTS_BODY, CD_REASON_BODY, CD_RELEASE_HOLD_BODY, CD_SYNC_MERGE_BODY, CD_SYNC_RUN_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

const int = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const actorFrom = (req: any) => ({ userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined });

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminCustomerDataControllerListQueries)
@Controller('super-admin')
export class SuperAdminCustomerDataController {
  constructor(private readonly svc: CustomerDataOversightService, private readonly holds: LegalHoldService, private readonly imports: CustomerImportService, private readonly deletions: CustomerDeletionService, private readonly sync: CustomerReconciliationService) {}

  // ── §20/§35/§36/§37 Customer Sync & Reconciliation (inside Customer Data Oversight — no new sidebar module) ──
  @Get('customer-data-oversight/sync/dashboard') @RequirePermission('super_admin.customer_sync.view')
  syncDashboard() { return this.sync.dashboard(); }

  @Get('customer-data-oversight/sync/runs') @RequirePermission('super_admin.customer_sync.view')
  syncRuns(@Query('limit') limit?: string) { return this.sync.listRuns(int(limit) ?? 20); }

  /** §22 tenant-by-tenant breakdown for one run. */
  @Get('customer-data-oversight/sync/runs/:id') @RequirePermission('super_admin.customer_sync.view')
  syncRunDetail(@Param('id') id: string) { return this.sync.runDetail(id); }

  @Get('customer-data-oversight/sync/conflicts') @RequirePermission('super_admin.customer_sync.review')
  syncConflicts(@Query('status') status?: string, @Query('limit') limit?: string) { return this.sync.listConflicts(status || null, int(limit) ?? 50); }

  /** §24 side-by-side compare before a human decides. Masked values only. */
  @Get('customer-data-oversight/sync/merge-preview') @RequirePermission('super_admin.customer_sync.review')
  syncMergePreview(@Query('a') a: string, @Query('b') b: string) {
    if (!a || !b) throw new BadRequestException('Two global customer ids are required');
    return this.sync.mergePreview(String(a), String(b));
  }

  /** §24 MERGE — explicit confirmation required; reversible (the source is retired, never deleted); legal holds
   *  are consulted first. */
  @Post('customer-data-oversight/sync/merge') @RequirePermission('super_admin.customer_sync.merge')
  syncMerge(@Body(ValidatedBody(CD_SYNC_MERGE_BODY)) body: any, @Req() req: any) {
    const source = body?.sourceGlobalCustomerId ? String(body.sourceGlobalCustomerId) : '';
    const target = body?.targetGlobalCustomerId ? String(body.targetGlobalCustomerId) : '';
    if (!source || !target) throw new BadRequestException('sourceGlobalCustomerId and targetGlobalCustomerId are required');
    return this.sync.mergeIdentities(source, target, actorFrom(req).userId ?? null, body?.confirm === true);
  }

  /** §19 conflict lifecycle: RESOLVED / KEEP_SEPARATE / IGNORED / FALSE_POSITIVE / REVIEWING. */
  @Post('customer-data-oversight/sync/conflicts/:id/status') @RequirePermission('super_admin.customer_sync.resolve_conflict')
  syncResolveConflict(@Param('id') id: string, @Body(ValidatedBody(CD_CONFLICT_STATUS_BODY)) body: any, @Req() req: any) {
    const allowed = ['NEW', 'REVIEWING', 'RESOLVED', 'MERGED', 'KEEP_SEPARATE', 'IGNORED', 'FALSE_POSITIVE'];
    const status = String(body?.status || '');
    if (!allowed.includes(status)) throw new BadRequestException('Unknown conflict status');
    return this.sync.resolveConflict(id, status, actorFrom(req).userId ?? null);
  }

  /** §35 manual run: ALL tenants, ONE tenant (§37 re-sync tenant), or ONE customer (§36 re-sync customer).
   *  The advisory lock is what prevents simultaneous duplicate runs — the service reports a skip honestly. */
  @Post('customer-data-oversight/sync/run') @RequirePermission('super_admin.customer_sync.run')
  syncRun(@Body(ValidatedBody(CD_SYNC_RUN_BODY)) body: any, @Req() req: any) {
    const userId = actorFrom(req).userId ?? null;
    const tenantId = body?.tenantId ? String(body.tenantId) : null;
    const customerId = body?.customerId ? String(body.customerId) : null;
    if (customerId && !tenantId) throw new BadRequestException('tenantId is required when re-syncing one customer');
    const scope = customerId ? { kind: 'customer' as const, tenantId: tenantId!, customerId }
      : tenantId ? { kind: 'tenant' as const, tenantId }
      : { kind: 'all' as const };
    return this.sync.runReconciliation('manual', scope, userId);
  }

  @Get('customer-data-oversight/overview')
  overview(@Query() q: any) {
    const query: OverviewQuery = {
      tenantId: q?.tenantId || undefined, branchId: q?.branchId || undefined, status: q?.status || undefined,
      search: q?.search || undefined, phoneStatus: q?.phoneStatus || undefined, emailStatus: q?.emailStatus || undefined,
      consentStatus: q?.consentStatus || undefined, duplicateRisk: q?.duplicateRisk || undefined,
      sort: q?.sort || undefined, direction: q?.direction === 'asc' ? 'asc' : q?.direction === 'desc' ? 'desc' : undefined,
      page: int(q?.page), pageSize: int(q?.pageSize),
    };
    return this.svc.getOverview(query);
  }

  @Get('customer-data-oversight/merges')
  listMerges(@Query() q: any) { return this.svc.listMerges({ tenantId: q?.tenantId || undefined }); }

  @Get('customer-data-oversight/audit')
  listActivity(@Query() q: any) { return this.svc.listActivity({ tenantId: q?.tenantId || undefined }); }


  // ---- Legal Hold (apply requires matter ref + reason + scope; release requires a reason; both audited) ----
  @Get('customer-data-oversight/legal-holds')
  listHolds(@Query() q: any) { return this.holds.listHolds({ tenantId: q?.tenantId || undefined, status: q?.status || undefined }); }

  @Post('customer-data-oversight/legal-holds')
  applyHold(@Body(ValidatedBody(CD_LEGAL_HOLD_BODY)) body: any, @Req() req: any) {
    return this.holds.applyHold({
      tenantId: body?.tenantId, customerId: body?.customerId ?? null, branchId: body?.branchId ?? null,
      matterRef: body?.matterRef, reason: body?.reason, scope: body?.scope, reviewAt: body?.reviewAt ?? null,
      internalNotes: body?.internalNotes ?? null, approvedByUserId: body?.approvedByUserId ?? null,
    }, actorFrom(req));
  }

  @Post('customer-data-oversight/legal-holds/:id/release')
  releaseHold(@Param('id') id: string, @Body(ValidatedBody(CD_RELEASE_HOLD_BODY)) body: any, @Req() req: any) {
    if (!id) throw new BadRequestException('hold id is required');
    return this.holds.releaseHold(id, body?.reason, actorFrom(req));
  }

  // ---- Imports (staging → approval → idempotent retry; all audited) ----
  @Get('customer-data-oversight/imports')
  listImports(@Query() q: any) { return this.imports.listJobs({ tenantId: q?.tenantId || undefined, status: q?.status || undefined }); }

  @Post('customer-data-oversight/imports')
  createImport(@Body(ValidatedBody(CD_IMPORT_BODY)) body: any, @Req() req: any) {
    return this.imports.createJob({ tenantId: body?.tenantId, branchId: body?.branchId ?? null, source: body?.source, filename: body?.filename, rows: body?.rows }, actorFrom(req));
  }

  @Post('customer-data-oversight/imports/:id/approve')
  approveImport(@Param('id') id: string, @Req() req: any) {
    if (!id) throw new BadRequestException('import id is required');
    return this.imports.approveJob(id, actorFrom(req));
  }

  @Post('customer-data-oversight/imports/:id/retry')
  retryImport(@Param('id') id: string, @Req() req: any) {
    if (!id) throw new BadRequestException('import id is required');
    return this.imports.retryJob(id, actorFrom(req));
  }

  @Post('customer-data-oversight/imports/:id/reject')
  rejectImport(@Param('id') id: string, @Body(ValidatedBody(CD_REASON_BODY)) body: any, @Req() req: any) {
    if (!id) throw new BadRequestException('import id is required');
    return this.imports.rejectJob(id, body?.reason, actorFrom(req));
  }

  // Manual drain of the queued-import backlog (the background worker does this every 15s when armed; this lets ops
  // process on demand). Idempotent and safe to call repeatedly.
  @Post('customer-data-oversight/imports/process')
  processImports(@Body(ValidatedBody(CD_PROCESS_IMPORTS_BODY)) body: any) {
    return this.imports.processPendingImportJobs(Number(body?.batch) || 5);
  }

  // ---- Permanent deletion (dual-approval + typed confirmation + retention + legal-hold guard; all audited) ----
  @Get('customer-data-oversight/deletions')
  listDeletions(@Query() q: any) { return this.deletions.list({ tenantId: q?.tenantId || undefined, status: q?.status || undefined }); }

  @Post('customer-data-oversight/deletions')
  requestDeletion(@Body(ValidatedBody(CD_DELETION_BODY)) body: any, @Req() req: any) {
    return this.deletions.requestDeletion({ tenantId: body?.tenantId, customerId: body?.customerId, reason: body?.reason }, actorFrom(req));
  }

  @Post('customer-data-oversight/deletions/:id/approve')
  approveDeletion(@Param('id') id: string, @Req() req: any) {
    if (!id) throw new BadRequestException('deletion id is required');
    return this.deletions.approveDeletion(id, actorFrom(req));
  }

  @Post('customer-data-oversight/deletions/:id/reject')
  rejectDeletion(@Param('id') id: string, @Body(ValidatedBody(CD_REASON_BODY)) body: any, @Req() req: any) {
    if (!id) throw new BadRequestException('deletion id is required');
    return this.deletions.rejectDeletion(id, body?.reason, actorFrom(req));
  }

  @Post('customer-data-oversight/deletions/:id/execute')
  executeDeletion(@Param('id') id: string, @Body(ValidatedBody(CD_EXECUTE_DELETION_BODY)) body: any, @Req() req: any) {
    if (!id) throw new BadRequestException('deletion id is required');
    return this.deletions.executeDeletion(id, body?.typedConfirmation, actorFrom(req));
  }
}
