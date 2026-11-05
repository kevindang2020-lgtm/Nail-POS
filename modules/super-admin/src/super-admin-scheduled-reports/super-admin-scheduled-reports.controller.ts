// super-admin-scheduled-reports.controller.ts — SuperAdminGuard-only. Schedule CRUD, manual run, external
// run-due trigger, run history, and in-app artifact download. Validation errors surface as 400.

import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminScheduledReportsService } from './super-admin-scheduled-reports.service';
import { SR_SCHEDULE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

const ctxFrom = (r: any) => ({ userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email });

@Controller('super-admin/scheduled-reports')
@UseGuards(SuperAdminGuard)
export class SuperAdminScheduledReportsController {
  constructor(private readonly svc: SuperAdminScheduledReportsService) {}

  @Get() list() { return this.svc.list(); }

  @Post() async create(@Req() r: any, @Body(ValidatedBody(SR_SCHEDULE_BODY)) body: any) {
    try { return await this.svc.create(ctxFrom(r), body || {}); }
    catch (e: any) { throw new BadRequestException(e?.message || 'Invalid schedule.'); }
  }

  // Static routes declared before parameterised ones.
  @Post('run-due') runDue(@Req() r: any) { return this.svc.runDue(ctxFrom(r)); }

  @Get('runs/:runId/download') async download(@Param('runId') runId: string) {
    const art = await this.svc.getRunArtifact(runId);
    if (!art) throw new NotFoundException('No downloadable artifact for that run.');
    return art;
  }

  @Get(':id/runs') runs(@Param('id') id: string) { return this.svc.listRuns(id); }

  @Post(':id/run-now') async runNow(@Req() r: any, @Param('id') id: string) {
    const res = await this.svc.runNow(ctxFrom(r), id);
    if (!res) throw new NotFoundException('Schedule not found.');
    return res;
  }

  @Patch(':id') async update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SR_SCHEDULE_BODY)) body: any) {
    let row;
    try { row = await this.svc.update(ctxFrom(r), id, body || {}); }
    catch (e: any) { throw new BadRequestException(e?.message || 'Invalid schedule.'); }
    if (!row) throw new NotFoundException('Schedule not found.');
    return row;
  }

  @Delete(':id') async remove(@Req() r: any, @Param('id') id: string) {
    const ok = await this.svc.remove(ctxFrom(r), id);
    if (!ok) throw new NotFoundException('Schedule not found.');
    return { ok: true };
  }
}
