// audit-engine.controller.ts — Super Admin surface for the Security Audit Engine.
// Guarded like the rest of the security module (SuperAdminGuard). Manual trigger + run history + findings list;
// finding REVIEW happens in the existing incidents workflow (critical/high findings arrive there automatically).
import { Controller, Get, Post, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { AuditEngineService } from './audit-engine.service';
import { ListQueries } from '@aipowersalon/database';
import { AuditEngineControllerListQueries } from './audit-engine.list-queries';

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) { throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR); }
}

@UseGuards(SuperAdminGuard)
@ListQueries(AuditEngineControllerListQueries)
@Controller('super-admin/security/audit')
export class AuditEngineController {
  constructor(private readonly svc: AuditEngineService) {}
  @Post('run') trigger(@Req() r: any) { return run(() => this.svc.runAudit('manual', r?.ctx?.userId ?? null)); }
  @Get('runs') runs(@Query('limit') limit?: string) { return run(() => this.svc.listRuns(limit ? parseInt(limit, 10) || 20 : 20)); }
  @Get('findings') findings(@Query('status') status?: string, @Query('limit') limit?: string) { return run(() => this.svc.listFindings(status ?? null, limit ? parseInt(limit, 10) || 50 : 50)); }
}
