// ai-scheduling-ops.controller.ts — BUILD_PLAN Phase 7 (agent B): the optimizer's OPERATIONS routes under
// pos/ai-scheduling-optimizer (the engine's routes are ai-scheduling.controller.ts, agent A):
//   GET  usage?from&to                          ai_scheduling.view     → SchedUsageSummary
//   GET  insights?kind&status                   ai_scheduling.view     → SchedInsightList
//   POST insights/refresh                       ai_scheduling.approve  → { queued }
//   POST insights/:kind/:id/approve             ai_scheduling.approve  (SchedInsightDecisionRequest) → SchedInsight
//   POST insights/:kind/:id/reject              ai_scheduling.approve  (same)
//   GET  export?kind=recommendations|runs|insights&from&to   ai_scheduling.export → text/csv
// TenantAuthGuard + RolePermissionGuard (tenant / location / permissions from the server-side session); the services
// check the permission again. Same AI-package gate as the engine routes.
import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SCHED_INSIGHT_DECISION_BODY } from '../request-schemas';
import type { SchedInsight, SchedInsightDecisionRequest, SchedInsightList, SchedUsageSummary } from '@aipowersalon/api-contracts/tenant';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { schedCtxFrom, schedOpsRun } from './ai-scheduling-ops.common';
import { SchedUsageService } from './ai-scheduling-usage';
import { SchedInsightService } from './ai-scheduling-insights';
import { SchedExportService } from './ai-scheduling-export';
import { ListQueries } from '@aipowersalon/database';
import { AiSchedulingOpsControllerListQueries } from './ai-scheduling-ops.list-queries';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequiresAiPackage('ai_scheduling_optimizer')
@ListQueries(AiSchedulingOpsControllerListQueries)
@Controller('pos/ai-scheduling-optimizer')
export class AiSchedulingOpsController {
  constructor(private readonly usage: SchedUsageService, private readonly insights: SchedInsightService, private readonly exporter: SchedExportService) {}

  @Get('usage') @RequirePermission('ai_scheduling.view')
  usageSummary(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string): Promise<SchedUsageSummary> { return schedOpsRun(() => this.usage.summary(schedCtxFrom(r), { from, to })); }

  @Get('insights') @RequirePermission('ai_scheduling.view')
  listInsights(@Req() r: any, @Query('kind') kind?: string, @Query('status') status?: string, @Query('limit') limit?: string): Promise<SchedInsightList> {
    return schedOpsRun(() => this.insights.list(schedCtxFrom(r), { kind, status, limit }));
  }

  @Post('insights/refresh') @RequirePermission('ai_scheduling.approve')
  refreshInsights(@Req() r: any): Promise<{ queued: boolean }> { return schedOpsRun(() => this.insights.refresh(schedCtxFrom(r))); }

  @Post('insights/:kind/:id/approve') @RequirePermission('ai_scheduling.approve')
  approveInsight(@Req() r: any, @Param('kind') kind: string, @Param('id') id: string, @Body(ValidatedBody(SCHED_INSIGHT_DECISION_BODY)) b: SchedInsightDecisionRequest): Promise<SchedInsight> {
    return schedOpsRun(() => this.insights.decide(schedCtxFrom(r), String(kind), String(id), true, b ?? ({} as any)));
  }

  @Post('insights/:kind/:id/reject') @RequirePermission('ai_scheduling.approve')
  rejectInsight(@Req() r: any, @Param('kind') kind: string, @Param('id') id: string, @Body(ValidatedBody(SCHED_INSIGHT_DECISION_BODY)) b: SchedInsightDecisionRequest): Promise<SchedInsight> {
    return schedOpsRun(() => this.insights.decide(schedCtxFrom(r), String(kind), String(id), false, b ?? ({} as any)));
  }

  @AsyncExport({ kind: 'pos.ai-scheduling.export' }) @Get('export') @RequirePermission('ai_scheduling.export')
  async exportCsv(@Req() r: any, @Res({ passthrough: true }) res: any, @Query('kind') kind?: string, @Query('from') from?: string, @Query('to') to?: string): Promise<string> {
    const out = await schedOpsRun(() => this.exporter.export(schedCtxFrom(r), { kind, from, to }));
    res?.setHeader?.('Content-Type', 'text/csv; charset=utf-8');
    res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`);
    res?.setHeader?.('Cache-Control', 'no-store');
    return out.csv;
  }
}
