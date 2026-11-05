import { Controller, Post, Get, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ReportRunService, ReportRunError } from './report-run.service';
import { AI_REPORT_GENERATE_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof ReportRunError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-reports')
export class ReportRunController {
  constructor(private readonly svc: ReportRunService) {}
  @Post('generate') generate(@Req() r: any, @Body(ValidatedBody(AI_REPORT_GENERATE_BODY)) b: any) {
    const by = r?.ctx?.userId || r?.userId || null;
    return run(() => this.svc.generate({ reportKey: b?.reportKey, scopeType: b?.scopeType, tenantId: b?.tenantId, branchId: b?.branchId, start: b?.start, end: b?.end, source: b?.source }, by));
  }
  @Get('runs/:id') getRun(@Param('id') id: string) { return run(() => this.svc.getRun(id)); }
}
