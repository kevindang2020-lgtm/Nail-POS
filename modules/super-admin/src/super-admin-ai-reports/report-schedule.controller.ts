import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ReportScheduleService, ScheduleError } from './report-schedule.service';
import { AI_REPORT_SCHEDULE_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof ScheduleError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-report-schedules')
export class ReportScheduleController {
  constructor(private readonly svc: ReportScheduleService) {}
  @Get() list() { return run(() => this.svc.list(20)); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(AI_REPORT_SCHEDULE_BODY, { strict: true })) b: any) { return run(() => this.svc.create({ name: b?.name, reportKey: b?.reportKey, frequency: b?.frequency, runAtTime: b?.runAtTime, timezone: b?.timezone, scopeType: b?.scopeType, tenantId: b?.tenantId, branchId: b?.branchId, owner: b?.owner }, r?.ctx?.userId || null)); }
  @Patch(':id/pause') pause(@Param('id') id: string) { return run(() => this.svc.pause(id)); }
  @Patch(':id/resume') resume(@Param('id') id: string) { return run(() => this.svc.resume(id)); }
}
