// ai-queue-assignment-ops.controller.ts — BUILD_PLAN Phase 6: the AI queue OPS routes (agent C) under
// pos/ai-queue-assignment — overview, settings (+ versions), alerts (scan / list / acknowledge / resolve / repair), the
// old wait-thresholds route (now a view over the settings), analytics, export, usage. Guards: TenantAuthGuard +
// RolePermissionGuard (tenant / branch / role from the server-side session); every route names its permission, and the
// services check it again. The owner's branch comparison is ai-queue-assignment-owner.controller.ts (owner/ai-queue-assignment).
import { branchOrNull } from '@aipowersalon/tenant-context';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AQ_ALERT_NOTE_BODY, AQ_ALERT_REPAIR_BODY, AQ_SETTINGS_BODY, AQ_THRESHOLDS_BODY } from '../request-schemas';
import { Controller, Get, Post, Put, Param, Query, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { QueueAlertService, QueueAlertNotFoundError, QueueAlertConflictError } from './ai-queue-assignment-alerts.service';
import { QueueOpsService, QueueOpsConflictError } from './ai-queue-assignment-ops.service';
import { QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError, type QueueAssignmentContext } from './ai-queue-assignment.dto';
import { ListQueries } from '@aipowersalon/database';
import { QueueAssignmentOpsControllerListQueries } from './ai-queue-assignment-ops.list-queries';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export function opsCtxFrom(req: any): QueueAssignmentContext {
  const c = req?.ctx || {};
  // the queue is ONE location's queue: with no location on the session say so (audit bug 14), never '' into a UUID column
  const branchId = branchOrNull(c.branchId);
  if (!branchId) throw withCode(new HttpException('Choose a location first — the queue belongs to one location.', HttpStatus.BAD_REQUEST), 'BRANCH_REQUIRED');
  return { tenantId: c.tenantId, branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

/** Service errors → HTTP, in plain words. The queue domain's own errors (from a repair) keep their meaning. */
export async function opsRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof HttpException) throw e;
    if (e instanceof QueueAssignmentForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof QueueAssignmentDisabledError) throw withCode(new HttpException('AI queue assignment is not active for this salon.', HttpStatus.PAYMENT_REQUIRED), 'AI_QUEUE_NOT_ACTIVE');
    if (e instanceof QueueAssignmentValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof QueueOpsConflictError) throw new HttpException({ message: e.message, code: 'VERSION_CONFLICT', currentVersion: e.currentVersion ?? null }, HttpStatus.CONFLICT);
    if (e instanceof QueueAlertNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (e instanceof QueueAlertConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    const name = String(e?.name ?? '');
    if (/Conflict/.test(name) || e?.status === 409 || e?.code === 'VERSION_CONFLICT') throw new HttpException({ message: e?.message || 'The queue changed — reload and try again.', code: e?.code ?? 'CONFLICT' }, HttpStatus.CONFLICT);
    if (/Forbidden/.test(name)) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (/NotFound/.test(name)) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (/Validation/.test(name)) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@ListQueries(QueueAssignmentOpsControllerListQueries)
@Controller('pos/ai-queue-assignment')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class QueueAssignmentOpsController {
  constructor(private readonly ops: QueueOpsService, private readonly alerts: QueueAlertService) {}

  @Get('overview') @RequirePermission('ai_queue_assignment.view')
  overview(@Req() r: any) { return opsRun(() => this.ops.overview(opsCtxFrom(r))); }

  // ── settings ──
  @Get('settings') @RequirePermission('ai_queue_assignment.view')
  getSettings(@Req() r: any) { return opsRun(() => this.ops.getSettings(opsCtxFrom(r))); }

  @Put('settings') @RequirePermission('ai_queue_assignment.manage_rules')
  putSettings(@Req() r: any, @Body(ValidatedBody(AQ_SETTINGS_BODY, { strict: true })) b: any) { return opsRun(() => this.ops.putSettings(opsCtxFrom(r), b || {})); }

  @Get('settings/versions') @RequirePermission('ai_queue_assignment.view')
  versions(@Req() r: any, @Query('scope') scope?: string, @Query('limit') limit?: string) { return opsRun(() => this.ops.settingsVersions(opsCtxFrom(r), scope, limit ? Number(limit) : undefined)); }

  // ── alerts ──
  @Get('alerts') @RequirePermission('ai_queue_assignment.view')
  listAlerts(@Req() r: any, @Query('status') status?: string, @Query('type') type?: string) {
    // bug 9: resolved alerts are hidden unless asked for (status=all / resolved)
    return opsRun(() => this.alerts.listAlerts(opsCtxFrom(r), { status: (status as any) || 'open', type: type || undefined }));
  }

  // a scan RAISES and RESOLVES alerts — a write (Nov 3 audit: it needed only the view key)
  @Post('alerts/scan') @RequirePermission('ai_queue_assignment.resolve_alerts')
  scan(@Req() r: any) { return opsRun(() => this.alerts.scanAlerts(opsCtxFrom(r))); }

  @Post('alerts/:id/acknowledge') @RequirePermission('ai_queue_assignment.resolve_alerts')
  acknowledge(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AQ_ALERT_NOTE_BODY, { strict: true })) b: any) { return opsRun(() => this.alerts.acknowledgeAlert(opsCtxFrom(r), id, b?.note)); }

  @Post('alerts/:id/resolve') @RequirePermission('ai_queue_assignment.resolve_alerts')
  resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AQ_ALERT_NOTE_BODY, { strict: true })) b: any) { return opsRun(() => this.alerts.resolveAlert(opsCtxFrom(r), id, b?.note)); }

  @Post('alerts/:id/repair') @RequirePermission('ai_queue_assignment.resolve_alerts')
  repair(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AQ_ALERT_REPAIR_BODY, { strict: true })) b: any) { return opsRun(() => this.alerts.repair(opsCtxFrom(r), id, b || {})); }

  @Get('wait-thresholds') @RequirePermission('ai_queue_assignment.view')
  getThresholds(@Req() r: any) { return opsRun(() => this.alerts.getThresholds(opsCtxFrom(r))); }

  @Put('wait-thresholds') @RequirePermission('ai_queue_assignment.manage_rules')
  setThresholds(@Req() r: any, @Body(ValidatedBody(AQ_THRESHOLDS_BODY, { strict: true })) b: any) { return opsRun(() => this.alerts.setThresholds(opsCtxFrom(r), b || {})); }

  // ── analytics / export / usage ──
  @Get('analytics') @RequirePermission('ai_queue_assignment.view')
  analytics(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string) { return opsRun(() => this.ops.analytics(opsCtxFrom(r), { from, to })); }

  @AsyncExport({ kind: 'pos.ai-queue-assignment.export' }) @Get('export') @RequirePermission('ai_queue_assignment.export')
  exportCsv(@Req() r: any, @Query('type') type?: string, @Query('from') from?: string, @Query('to') to?: string) { return opsRun(() => this.ops.exportCsv(opsCtxFrom(r), { type, from, to })); }

  @Get('usage') @RequirePermission('ai_queue_assignment.view')
  usage(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string) { return opsRun(() => this.ops.usage(opsCtxFrom(r), { from, to })); }
}
