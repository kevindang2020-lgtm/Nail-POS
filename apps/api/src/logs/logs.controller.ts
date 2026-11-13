// logs.controller.ts — read-only Device & Integration log surface (`/pos/logs`). Filters: category, severity, source,
// search, limit. Writes are system-internal (no HTTP write path).
import { withCode, type ListQuery } from '@aipowersalon/api-contracts';
import type { LogRetryQueueView } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { Controller, Get, Header, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { LogsService, ForbiddenError, ValidationError, ExportUnavailableError } from './logs.service';
import type { LogsContext } from './logs.dto';
import { ListQueries } from '@aipowersalon/database';
import { LogsControllerListQueries } from './logs.list-queries';

function ctxFrom(req: any): LogsContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(LogsControllerListQueries)
@Controller('pos/logs')
export class LogsController {
  constructor(private readonly svc: LogsService) {}
  @Get('') @RequirePermission('pos.logs.view')
  list(@Req() r: any, @Query() q: any) {
    return (async () => { try { return await this.svc.query(ctxFrom(r), q || {}); } catch (e) { if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); if (e instanceof ValidationError) throw withCode(new HttpException('Pick a start date on or before the end date.', HttpStatus.BAD_REQUEST), 'LOGS_INVALID_PERIOD'); throw e; } })();
  }
  /** Device Integration Logs backlog · 09: the salon's work waiting in the existing retry stores (read-only) */
  @Get('retries') @RequirePermission('pos.logs.view')
  retries(@Req() r: any, @Query() q: ListQuery): Promise<LogRetryQueueView> {
    return (async () => { try { return await this.svc.retryQueue(ctxFrom(r), (q || {}) as { page?: unknown; pageSize?: unknown }); } catch (e) { if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; } })();
  }
  /** Device Integration Logs backlog · 08: the sanitized CSV of one fixed date range (from + to, at most 31 days), with
   *  the page's filters; pos.logs.view + pos.reports.export; the export is audited before the file is returned. */
  @AsyncExport({ kind: 'pos.logs.export' }) @Get('export') @RequirePermission('pos.reports.export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="device-integration-logs.csv"')
  exportCsv(@Req() r: any, @Query() q: ListQuery): Promise<string> {
    return (async () => { try { return await this.svc.exportCsv(ctxFrom(r), q || {}); } catch (e) {
      if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof ValidationError) throw withCode(new HttpException(e.code === 'LOGS_EXPORT_RANGE_TOO_LONG' ? 'Pick a range of 31 days or less to export.' : 'Pick a start and an end date (start on or before end) to export.', HttpStatus.BAD_REQUEST), e.code === 'LOGS_EXPORT_RANGE_TOO_LONG' ? 'DATE_RANGE_TOO_LARGE' : 'LOGS_INVALID_PERIOD');
      if (e instanceof ExportUnavailableError) throw withCode(new HttpException('The export could not be recorded, so no file was made. Try again.', HttpStatus.SERVICE_UNAVAILABLE), 'SERVICE_UNAVAILABLE');
      throw e; } })();
  }
}
