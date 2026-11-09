// logs.controller.ts — read-only Device & Integration log surface (`/pos/logs`). Filters: category, severity, source,
// search, limit. Writes are system-internal (no HTTP write path).
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { LogsService, ForbiddenError, ValidationError } from './logs.service';
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
}
