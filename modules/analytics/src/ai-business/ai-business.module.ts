// ai-business.module.ts — AI Business Assistant module.
//   • Slice 1: the read-only metric-registry backbone (pure metadata; no DB).
//   • Slice 2: authorized revenue DATA tools that REUSE the existing ReportsService (imported below) — so AI revenue
//     answers are, by construction, the same authoritative numbers the Sales report shows. No second revenue calc.
// Later slices add more tools the same way (inject the existing report service; never recompute a KPI).
import { AiModule, AiAssistantService } from '@aipowersalon/ai';
import { ReportsModule, ReportsService } from '@aipowersalon/reports';
import { Module } from '@nestjs/common';
import { AiBusinessController } from './ai-business.controller';
import { AiBusinessService } from './ai-business.service';
import { AiBusinessRevenueService } from './ai-business-revenue.service';
import { AiBusinessBriefService } from './ai-business-brief.service';
import { AiBusinessAppointmentsService } from './ai-business-appointments.service';
import { AiBusinessBranchesService } from './ai-business-branches.service';
import { AiBusinessCustomersService } from './ai-business-customers.service';
import { AiBusinessTechniciansService } from './ai-business-technicians.service';
import { AiBusinessAssistantService, type BusinessToolset } from './ai-business-assistant.service';
import { AiBusinessSavedQuestionsService } from './ai-business-saved-questions.service';
import { InMemorySavedQuestionsRepository, type SavedQuestionsRepositoryPort } from './ai-business-saved-questions.repository';
import { KyselySavedQuestionsRepository } from './ai-business-saved-questions.kysely.repository';
import { AiBusinessAlertsService } from './ai-business-alerts.service';
import { AiBusinessAlertEvaluator } from './ai-business-alerts-evaluator';
import { InMemoryAlertsRepository, type AlertsRepositoryPort } from './ai-business-alerts.repository';
import { KyselyAlertsRepository } from './ai-business-alerts.kysely.repository';
import { AiBusinessAdminController, AiBusinessAdminService } from './ai-business-admin.controller';
import { InMemoryAiBusinessAdminRepository, type AiBusinessAdminRepositoryPort } from './ai-business-admin.repository';
import { KyselyAiBusinessAdminRepository } from './ai-business-admin.kysely.repository';
import { AiBusinessReportsService } from './ai-business-reports.service';
import { InMemoryReportsJobRepository, type ReportsJobRepositoryPort } from './ai-business-reports.repository';
import { KyselyReportsJobRepository } from './ai-business-reports.kysely.repository';
import { OwnerServiceBranchScopeResolver } from './ai-business-branch-scope';
import { OwnerModule } from '../owner/owner.module';
import { OwnerService } from '../owner/owner.service';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { BusinessCenter } from './business-center';
import { BusinessCenterController, BUSINESS_CENTER } from './business-center.controller';
import { BusinessAlertsScheduleJob } from './business-alerts-schedule.job';
import { BranchInsights, BRANCH_INSIGHTS } from './branch-insights';
import { ConversationHistory, searchRecords, profitAndExpenses, periodOf, checkBusinessData, ASSISTANT_EXTRAS, type AssistantExtrasRoutes } from './ai-business-assistant-extras';
import { KyselyAiAccessRepo, evaluateAiAccess } from '@aipowersalon/ai';
import { BusinessAlertIncidents, BUSINESS_ALERT_INCIDENTS, type AlertMessenger } from './business-alert-incidents';

@Module({
  imports: [ReportsModule, OwnerModule, AiModule],
  controllers: [AiBusinessController, AiBusinessAdminController, BusinessCenterController],
  providers: [
    { provide: AiBusinessService, useFactory: () => new AiBusinessService() },
    { provide: AiBusinessRevenueService, useFactory: (reports: ReportsService) => new AiBusinessRevenueService(reports), inject: [ReportsService] },
    { provide: AiBusinessBriefService, useFactory: (reports: ReportsService) => new AiBusinessBriefService(reports), inject: [ReportsService] },
    { provide: AiBusinessAppointmentsService, useFactory: (reports: ReportsService) => new AiBusinessAppointmentsService(reports), inject: [ReportsService] },
    // Branch-scope resolver reuses OwnerService (owner_branch_access authorization) — no duplicate branch auth.
    { provide: 'BranchScopeResolver', useFactory: (owner: OwnerService) => new OwnerServiceBranchScopeResolver(owner), inject: [OwnerService] },
    { provide: AiBusinessBranchesService, useFactory: (reports: ReportsService, scope: OwnerServiceBranchScopeResolver) => new AiBusinessBranchesService(reports, scope), inject: [ReportsService, 'BranchScopeResolver'] },
    { provide: AiBusinessCustomersService, useFactory: (reports: ReportsService) => new AiBusinessCustomersService(reports), inject: [ReportsService] },
    { provide: AiBusinessTechniciansService, useFactory: (reports: ReportsService) => new AiBusinessTechniciansService(reports), inject: [ReportsService] },
    // Saved questions — the first WRITE surface. Kysely-backed on the PRIMARY db when present, else in-memory.
    { provide: 'SavedQuestionsRepositoryPort', useFactory: (db: AppDatabase): SavedQuestionsRepositoryPort => (db ? new KyselySavedQuestionsRepository(db) : new InMemorySavedQuestionsRepository()), inject: [DATABASE] },
    { provide: AiBusinessSavedQuestionsService, useFactory: (repo: SavedQuestionsRepositoryPort) => new AiBusinessSavedQuestionsService(repo), inject: ['SavedQuestionsRepositoryPort'] },
    // Alerts — write surface + evaluation core. The evaluator reuses the revenue/appointments/customers tools to
    // resolve a metric's current value; the scheduled dispatch worker is a later slice that calls evaluateNow().
    { provide: 'AlertsRepositoryPort', useFactory: (db: AppDatabase): AlertsRepositoryPort => (db ? new KyselyAlertsRepository(db) : new InMemoryAlertsRepository()), inject: [DATABASE] },
    {
      provide: AiBusinessAlertEvaluator,
      useFactory: (revenue: AiBusinessRevenueService, appts: AiBusinessAppointmentsService, customers: AiBusinessCustomersService) =>
        new AiBusinessAlertEvaluator({
          getRevenueSummary: (ctx, preset) => revenue.getRevenueSummary(ctx, preset),
          getAppointmentMetrics: (ctx, preset) => appts.getAppointmentMetrics(ctx, preset),
          getCustomerGrowth: (ctx, preset) => customers.getCustomerGrowth(ctx, preset),
        }),
      inject: [AiBusinessRevenueService, AiBusinessAppointmentsService, AiBusinessCustomersService],
    },
    { provide: AiBusinessAlertsService, useFactory: (repo: AlertsRepositoryPort, evaluator: AiBusinessAlertEvaluator) => new AiBusinessAlertsService(repo, evaluator), inject: ['AlertsRepositoryPort', AiBusinessAlertEvaluator] },
    // Super Admin adoption overview — aggregate reads on the READ replica (analytics path). Platform counts only.
    { provide: 'AiBusinessAdminRepositoryPort', useFactory: (db: AppDatabase): AiBusinessAdminRepositoryPort => (db ? new KyselyAiBusinessAdminRepository(db) : new InMemoryAiBusinessAdminRepository()), inject: [DATABASE_READ] },
    { provide: AiBusinessAdminService, useFactory: (repo: AiBusinessAdminRepositoryPort) => new AiBusinessAdminService(repo), inject: ['AiBusinessAdminRepositoryPort'] },
    // Generated reports — write surface. Job rows on the PRIMARY db; content composed from the tools inline.
    { provide: 'ReportsJobRepositoryPort', useFactory: (db: AppDatabase): ReportsJobRepositoryPort => (db ? new KyselyReportsJobRepository(db) : new InMemoryReportsJobRepository()), inject: [DATABASE] },
    {
      provide: AiBusinessReportsService,
      useFactory: (repo: ReportsJobRepositoryPort, brief: AiBusinessBriefService, revenue: AiBusinessRevenueService, appts: AiBusinessAppointmentsService, customers: AiBusinessCustomersService, branches: AiBusinessBranchesService) =>
        new AiBusinessReportsService(repo, {
          getDailyBrief: (ctx, preset) => brief.getDailyBrief(ctx, preset),
          getRevenueSummary: (ctx, preset) => revenue.getRevenueSummary(ctx, preset),
          getAppointmentMetrics: (ctx, preset) => appts.getAppointmentMetrics(ctx, preset),
          getCustomerGrowth: (ctx, preset) => customers.getCustomerGrowth(ctx, preset),
          compareBranches: (ctx, preset) => branches.compareBranches(ctx, preset === 'custom' && ctx.range ? { from: ctx.range.from, to: ctx.range.to, all: true } : { preset, all: true }),
        }),
      inject: ['ReportsJobRepositoryPort', AiBusinessBriefService, AiBusinessRevenueService, AiBusinessAppointmentsService, AiBusinessCustomersService, AiBusinessBranchesService],
    },
    // Assistant: a thin toolset facade delegates to the six services; the shared AiAssistantService runs the model
    // behind the access gate + usage logging, seeing only the structured tool result.
    {
      provide: AiBusinessAssistantService,
      useFactory: (
        brief: AiBusinessBriefService, revenue: AiBusinessRevenueService, appts: AiBusinessAppointmentsService,
        branches: AiBusinessBranchesService, customers: AiBusinessCustomersService, techs: AiBusinessTechniciansService,
        assistant: AiAssistantService, db: AppDatabase,
      ) => {
        const toolset: BusinessToolset = {
          getDailyBrief: (ctx, preset) => brief.getDailyBrief(ctx, preset),
          getRevenueSummary: (ctx, preset) => revenue.getRevenueSummary(ctx, preset),
          explainRevenueChange: (ctx, preset, comparePreset) => revenue.explainRevenueChange(ctx, preset, comparePreset),
          getAppointmentMetrics: (ctx, preset) => appts.getAppointmentMetrics(ctx, preset),
          compareBranches: (ctx, preset) => branches.compareBranches(ctx, preset === 'custom' && ctx.range ? { from: ctx.range.from, to: ctx.range.to, all: true } : { preset, all: true }),
          getCustomerGrowth: (ctx, preset) => customers.getCustomerGrowth(ctx, preset),
          getTechnicianPerformance: (ctx, preset) => techs.getTechnicianPerformance(ctx, preset),
        };
        // A4 (Nov 6 2026): stored history, record search, profit & expenses (database-backed only)
        return new AiBusinessAssistantService(toolset, assistant, db ? {
          history: new ConversationHistory(db), searchRecords: (ctx, q) => searchRecords(db, ctx, q),
          profitAndExpenses: (ctx, p, net) => profitAndExpenses(db, ctx, p, net), periodOf: (ctx, p) => periodOf(db, ctx, p),
        } : {});
      },
      inject: [AiBusinessBriefService, AiBusinessRevenueService, AiBusinessAppointmentsService, AiBusinessBranchesService, AiBusinessCustomersService, AiBusinessTechniciansService, AiAssistantService, DATABASE],
    },
    // AI Business Reports + Alerts guides (Nov 3 2026): history / search / pages, Verify Numbers, alert history + acknowledgement,
    // explanations and the read-only system checks — over the same services and the canonical ReportsService.
    {
      provide: BUSINESS_CENTER,
      useFactory: (db: AppDatabase, reports: AiBusinessReportsService, alerts: AiBusinessAlertsService, revenue: AiBusinessRevenueService, appointments: AiBusinessAppointmentsService, sales: ReportsService, incidents: BusinessAlertIncidents | null) =>
        (db ? new BusinessCenter(db, { reports, alerts, revenue, appointments, sales, incidents }) : null),
      inject: [DATABASE, AiBusinessReportsService, AiBusinessAlertsService, AiBusinessRevenueService, AiBusinessAppointmentsService, ReportsService, BUSINESS_ALERT_INCIDENTS],
    },
    // A2 (Nov 6 2026): incidents + notifications through the salon's messenger (TENANT_MESSENGER, by token)
    { provide: BUSINESS_ALERT_INCIDENTS, useFactory: (db: AppDatabase, messenger: AlertMessenger | null) => (db ? new BusinessAlertIncidents(db, messenger) : null),
      inject: [DATABASE, { token: 'TENANT_MESSENGER', optional: true }] },
    // A4 (Nov 6 2026): conversation history + Check Business Data for the assistant
    { provide: ASSISTANT_EXTRAS, useFactory: (db: AppDatabase, revenue: AiBusinessRevenueService): AssistantExtrasRoutes | null => {
        if (!db) return null;
        const repo = new KyselyAiAccessRepo(db);
        return { history: new ConversationHistory(db), check: (ctx) => checkBusinessData(db, ctx, {
          access: async () => { const d = evaluateAiAccess(await repo.loadSnapshot(ctx.tenantId, 'ai_business_assistant', ctx.userId, { branchId: ctx.branchId || null })); return { allowed: d.allowed, reason: String(d.reason) }; },
          sales: () => revenue.getRevenueSummary(ctx, 'today'),
        }) };
      }, inject: [DATABASE, AiBusinessRevenueService] },
    // A3 (Nov 6 2026): branch scorecard / explanation / advisor / data check
    { provide: BRANCH_INSIGHTS, useFactory: (db: AppDatabase, branches: AiBusinessBranchesService) => (db ? new BranchInsights(db, branches) : null), inject: [DATABASE, AiBusinessBranchesService] },
    BusinessAlertsScheduleJob,   // A2 (Nov 5 2026): the background evaluator
  ],
  exports: [AiBusinessService, AiBusinessRevenueService, AiBusinessBriefService, AiBusinessAppointmentsService, AiBusinessBranchesService, AiBusinessCustomersService, AiBusinessTechniciansService, AiBusinessAssistantService, AiBusinessSavedQuestionsService, AiBusinessAlertsService, AiBusinessReportsService],
})
export class AiBusinessModule {}
