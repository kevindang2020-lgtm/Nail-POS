import { Controller, Post, Get, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ReportDeliveryService, DeliveryError } from './report-delivery.service';
import { ReportRunService } from './report-run.service';
import { AI_REPORT_DELIVER_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof DeliveryError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-reports')
export class ReportDeliveryController {
  constructor(private readonly svc: ReportDeliveryService, private readonly runs: ReportRunService) {}
  // Resolve the run's real scope from the stored run, then enqueue — the client cannot spoof the scope.
  @Post('runs/:runId/deliver') deliver(@Param('runId') runId: string, @Body(ValidatedBody(AI_REPORT_DELIVER_BODY)) b: any) {
    return run(async () => {
      const r = await this.runs.getRun(runId);
      return this.svc.enqueue(runId, { scopeType: r.scopeType, tenantId: r.tenantId }, Array.isArray(b?.recipients) ? b.recipients : [], { allowExternal: !!b?.allowExternal, channel: b?.channel });
    });
  }
  @Get('runs/:runId/deliveries') list(@Param('runId') runId: string) { return run(async () => ({ deliveries: await this.svc.listByRun(runId), summary: await this.svc.summary(runId) })); }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-report-deliveries')
export class ReportDeliveryRetryController {
  constructor(private readonly svc: ReportDeliveryService) {}
  @Post(':id/retry') retry(@Param('id') id: string) { return run(() => this.svc.retry(id)); }
}

