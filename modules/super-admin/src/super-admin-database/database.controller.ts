// database.controller.ts — BUILD_PLAN Phase 10 (agent E): Super Admin → System Operations → Database (Constitution 1
// §94–98), behind SuperAdminGuard.
//   GET  overview | tables | indexes | slow-queries | activity | schema-health | retention-runs | growth?days   super_admin.database.view
//   POST snapshots                                         super_admin.database.manage (audited) — the size snapshot now
//   POST backends/:pid/cancel                              super_admin.database.manage + step-up + reason (audited)
//   POST tables/:table/vacuum-analyze                      super_admin.database.manage + step-up + reason (audited)
//   POST deferred-constraints/:id/retry                    super_admin.database.manage + step-up + reason (audited)
// No route accepts SQL (§98).
import { Body, Controller, Get, HttpException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { safeInet, ListQueries } from '@aipowersalon/database';
import type {
  DbActionRequest, DbActivity, DbCancelBackendResult, DbGrowth, DbIndexes, DbOverview, DbRetentionRuns, DbRetryConstraintResult, DbSchemaHealth, DbSlowQueries, DbTables, DbVacuumResult,
} from '@aipowersalon/api-contracts/platform';
import { DatabaseOpsService, DbOpsError, type DbActor } from './database.service';
import { SuperAdminDatabaseControllerListQueries } from './database.list-queries';
import { DB_ACTION_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

const actor = (req: any): DbActor => ({ userId: req?.ctx?.userId ?? null, role: req?.ctx?.role ?? null, ip: (safeInet(req?.ip) ?? undefined) || null });
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof DbOpsError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.status);
    if (e instanceof HttpException) throw e;
    // a statistics view this role cannot read, a missing ledger table on an old database: the section is unknown, not empty
    throw new HttpException({ ok: false, code: 'SECTION_UNAVAILABLE', message: `This section could not be read: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}` }, 503);
  }
}

@ListQueries(SuperAdminDatabaseControllerListQueries)
@Controller('super-admin/database')
@UseGuards(SuperAdminGuard)
export class SuperAdminDatabaseController {
  constructor(private readonly svc: DatabaseOpsService) {}

  @Get('overview') @RequirePermission('super_admin.database.view')
  overview(): Promise<DbOverview> { return run(() => this.svc.overview()); }

  @Get('tables') @RequirePermission('super_admin.database.view')
  tables(@Query('limit') limit?: string): Promise<DbTables> { return run(() => this.svc.tables(Number(limit) || 50)); }

  @Get('indexes') @RequirePermission('super_admin.database.view')
  indexes(@Query('refresh') refresh?: string): Promise<DbIndexes> { return run(() => this.svc.indexes({ refresh: refresh === '1' || refresh === 'true' })); }   // B-30: cached 10 min; refresh recomputes

  @Get('slow-queries') @RequirePermission('super_admin.database.view')
  slowQueries(): Promise<DbSlowQueries> { return run(() => this.svc.slowQueries()); }

  @Get('activity') @RequirePermission('super_admin.database.view')
  activity(): Promise<DbActivity> { return run(() => this.svc.activity()); }

  @Get('schema-health') @RequirePermission('super_admin.database.view')
  schemaHealth(): Promise<DbSchemaHealth> { return run(() => this.svc.schemaHealth()); }

  @Get('retention-runs') @RequirePermission('super_admin.database.view')
  retentionRuns(@Query('limit') limit?: string): Promise<DbRetentionRuns> { return run(() => this.svc.retentionRuns(Number(limit) || 50)); }

  @Get('growth') @RequirePermission('super_admin.database.view')
  growth(@Query('days') days?: string): Promise<DbGrowth> { return run(() => this.svc.growth(Number(days) || 90)); }

  @Post('snapshots') @RequirePermission('super_admin.database.manage')
  snapshot(@Req() r: any) { return run(() => this.svc.snapshotNow(actor(r))); }

  @RequireStepUp()
  @Post('backends/:pid/cancel') @RequirePermission('super_admin.database.manage')
  cancel(@Req() r: any, @Param('pid') pid: string, @Body(ValidatedBody(DB_ACTION_BODY, { strict: true })) b: DbActionRequest): Promise<DbCancelBackendResult> { return run(() => this.svc.cancelBackend(actor(r), pid, b?.reason)); }

  @RequireStepUp()
  @Post('tables/:table/vacuum-analyze') @RequirePermission('super_admin.database.manage')
  vacuum(@Req() r: any, @Param('table') table: string, @Body(ValidatedBody(DB_ACTION_BODY, { strict: true })) b: DbActionRequest): Promise<DbVacuumResult> { return run(() => this.svc.vacuumAnalyze(actor(r), table, b?.reason)); }

  @RequireStepUp()
  @Post('deferred-constraints/:id/retry') @RequirePermission('super_admin.database.manage')
  retry(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DB_ACTION_BODY, { strict: true })) b: DbActionRequest): Promise<DbRetryConstraintResult> { return run(() => this.svc.retryDeferred(actor(r), id, b?.reason)); }
}
