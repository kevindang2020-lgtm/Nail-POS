import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Module } from '@nestjs/common';
import { AiInsightsService } from './ai-insights.service';
import { InMemoryInsightRepo, type InsightRepo } from './ai-insights.repository';
import { KyselyInsightRepo } from './ai-insights.kysely.repository';
import { AiInsightsControllerListQueries } from './super-admin-ai-insights.module.list-queries';
import { AI_INSIGHTS_ASSIGN_BODY, AI_INSIGHTS_IDS_BODY, AI_INSIGHT_DISMISS_BODY, AI_INSIGHT_FEEDBACK_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

const actor = (req: any): string | null => req?.ctx?.userId || req?.user?.id || null;

@UseGuards(SuperAdminGuard)
@ListQueries(AiInsightsControllerListQueries)
@Controller('super-admin/ai-insights')
export class AiInsightsController {
  constructor(private readonly svc: AiInsightsService) {}

  @Get('overview') overview(@Query() q: any) { return this.svc.getOverview({ tenantId: q?.tenantId || undefined, branchId: q?.branchId || undefined }); }
  @Get() list(@Query() q: any) {
    return this.svc.getDirectory({ tenantId: q?.tenantId || undefined, branchId: q?.branchId || undefined, severity: q?.severity || undefined, category: q?.category || undefined, status: q?.status || undefined, search: q?.search || undefined, page: +q?.page || 1, pageSize: +q?.pageSize || 10 });
  }
  // Declared before ':id' so Nest never matches 'feedback' as an insight id.
  @Get('feedback/recent') feedbackRecent(@Query('limit') limit?: string) { return this.svc.recentFeedback(limit ? Number(limit) : 20); }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }

  // Recommendations-only actions — never execute an operational/destructive action.
  @Post('bulk-review') bulkReview(@Body(ValidatedBody(AI_INSIGHTS_IDS_BODY)) b: any, @Req() r: any) { return this.svc.markReviewed(Array.isArray(b?.ids) ? b.ids : [], actor(r)); }
  @Post('bulk-assign') bulkAssign(@Body(ValidatedBody(AI_INSIGHTS_ASSIGN_BODY)) b: any, @Req() r: any) { return this.svc.assignFollowUp(Array.isArray(b?.ids) ? b.ids : [], b?.assignedToUserId ?? actor(r)); }
  @Post(':id/dismiss') dismiss(@Param('id') id: string, @Body(ValidatedBody(AI_INSIGHT_DISMISS_BODY)) b: any, @Req() r: any) { return this.svc.dismiss(id, b?.reason || '', actor(r)); }
  @Post(':id/feedback') feedback(@Param('id') id: string, @Body(ValidatedBody(AI_INSIGHT_FEEDBACK_BODY)) b: any, @Req() r: any) { return this.svc.submitFeedback(id, b?.verdict, b?.comment, actor(r)); }
}

const INSIGHT_REPO = Symbol('INSIGHT_REPO');

@Module({
  controllers: [AiInsightsController],
  providers: [
    { provide: INSIGHT_REPO, useFactory: (db: AppDatabase): InsightRepo => (db ? new KyselyInsightRepo(db) : new InMemoryInsightRepo()), inject: [DATABASE] },
    { provide: AiInsightsService, useFactory: (repo: InsightRepo) => new AiInsightsService(repo), inject: [INSIGHT_REPO] },
  ],
  exports: [AiInsightsService],
})
export class SuperAdminAiInsightsModule {}
