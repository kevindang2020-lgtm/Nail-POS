import { Controller, Post, Get, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ReportTemplateService, TemplateError } from './report-template.service';
import { ReportRunService } from './report-run.service';
import { ListQueries } from '@aipowersalon/database';
import { ReportTemplateControllerListQueries } from './report-template.list-queries';
import { AI_REPORT_TEMPLATE_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof TemplateError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(ReportTemplateControllerListQueries)
@Controller('super-admin/ai-report-templates')
export class ReportTemplateController {
  constructor(private readonly svc: ReportTemplateService) {}
  @Get() list(@Query('reportKey') reportKey: string) { return run(() => this.svc.listByKey(reportKey || '')); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(AI_REPORT_TEMPLATE_BODY)) b: any) { return run(() => this.svc.createDraft({ reportKey: b?.reportKey, name: b?.name, sections: b?.sections }, r?.ctx?.userId || null)); }
  @Post(':id/publish') publish(@Param('id') id: string) { return run(() => this.svc.publish(id)); }
  @Post(':id/archive') archive(@Param('id') id: string) { return run(() => this.svc.archive(id)); }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-reports')
export class ReportNarrativeController {
  constructor(private readonly templates: ReportTemplateService, private readonly runs: ReportRunService) {}
  // Grounded narrative for a real run: fills the current published template using ONLY that run's stored metrics.
  @Get('runs/:runId/narrative') narrative(@Param('runId') runId: string) {
    return run(async () => {
      const r = await this.runs.getRun(runId);
      const metrics = (r.metricsSnapshot || {}) as Record<string, unknown>;
      return { runId, reportKey: r.reportKey, ...(await this.templates.buildNarrative(r.reportKey, metrics)) };
    });
  }
}
