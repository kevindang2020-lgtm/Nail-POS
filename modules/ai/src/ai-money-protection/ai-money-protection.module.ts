// ai-money-protection.module.ts — wires the deterministic detection foundation. Kysely repo when a DB handle is
// present, in-memory otherwise (dev/offline/tests). Reads use the primary handle for read-after-write correctness
// on newly-created alerts.
import { AiModule } from '../ai/ai.module';
import { AiPlatform } from '../ai/ai-platform';
import { moneyExplainAdapter } from '../ai/ai-platform.adapters';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MoneyProtectionCenter, type McCtx } from './money-protection-center';
import { MoneyProtectionCenterController, MONEY_PROTECTION_CENTER } from './money-protection-center.controller';
import { MoneyProtectionDetectionScheduler, detectionScheduled } from './money-protection-detection.scheduler';
import { MoneyProtectionController } from './ai-money-protection.controller';
import { MoneyProtectionService } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository, type MoneyProtectionRepositoryPort } from './ai-money-protection.repository';
import { KyselyMoneyProtectionRepository } from './ai-money-protection.kysely.repository';
import { InMemoryInvestigationRepository, type MoneyProtectionInvestigationRepositoryPort } from './ai-money-protection-investigations.repository';
import { KyselyInvestigationRepository } from './ai-money-protection-investigations.kysely.repository';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { MoneyProtectionExplainService } from './ai-money-protection-explain.service';
import { InMemoryEntitlement, KyselyEntitlement, type EntitlementPort } from './ai-money-protection-entitlement';
import { moneyProtectionFlags } from './ai-money-protection-flags';
import { ReportsModule, ReportsService, ForbiddenError as ReportsForbiddenError, type ReportsContext } from '@aipowersalon/reports';
import { systemContext } from '@aipowersalon/tenant-context';   // §72: the one system context

/** extras (AI Fraud Money Protection 09): Net Sales per branch from the Sales report — its own definition, financial gate
 *  (pos.reports.financial_view) and branch access; a refusal becomes 'forbidden', every other failure propagates. */
export function reportsBranchNetSales(reports: ReportsService) {
  return async (ctx: McCtx, branchId: string, from: string, to: string): Promise<{ netSalesCents: number } | 'forbidden'> => {
    const rctx: ReportsContext = { tenantId: ctx.tenantId, branchId, userId: String(ctx.userId ?? ''), role: ctx.role ?? '', permissions: ctx.permissions ?? [] };
    try { return { netSalesCents: (await reports.getSales(rctx, { from, to })).kpis.netSalesCents }; }
    catch (e) { if (e instanceof ReportsForbiddenError) return 'forbidden'; throw e; }
  };
}

@Module({
  imports: [AiModule, ReportsModule],
  controllers: [MoneyProtectionController, MoneyProtectionCenterController],
  providers: [
    {
      provide: 'MoneyProtectionRepositoryPort',
      useFactory: (db: AppDatabase): MoneyProtectionRepositoryPort =>
        db ? new KyselyMoneyProtectionRepository(db) : new InMemoryMoneyProtectionRepository(),
      inject: [DATABASE],
    },
    {
      provide: 'MoneyProtectionInvestigationRepositoryPort',
      useFactory: (db: AppDatabase): MoneyProtectionInvestigationRepositoryPort =>
        db ? new KyselyInvestigationRepository(db) : new InMemoryInvestigationRepository(),
      inject: [DATABASE],
    },
    {
      provide: 'MoneyProtectionEntitlementPort',
      useFactory: (db: AppDatabase): EntitlementPort => db ? new KyselyEntitlement(db) : new InMemoryEntitlement(),
      inject: [DATABASE],
    },
    {
      provide: MoneyProtectionService,
      useFactory: (repo: MoneyProtectionRepositoryPort, ent: EntitlementPort) => new MoneyProtectionService(repo, ent, moneyProtectionFlags()),
      inject: ['MoneyProtectionRepositoryPort', 'MoneyProtectionEntitlementPort'],
    },
    // the six Money Protection guides (Nov 3 2026): the center (overview, alerts, investigations, rules, detection runs, check)
    {
      provide: MONEY_PROTECTION_CENTER,
      useFactory: (db: AppDatabase, svc: MoneyProtectionService, ent: EntitlementPort, reports: ReportsService) => (db ? new MoneyProtectionCenter(db as never, {
        flags: () => moneyProtectionFlags(), entitlement: ent, scheduled: () => detectionScheduled(),
        detect: async (tenantId: string) => {
          const sys = { ...systemContext({ tenantId, actor: 'ai.money_protection.detect', permissions: ['ai_money_protection.manage_rules'] }), branchId: null } as never;   // every location
          const d = await svc.evaluateDeterministic(sys);
          const r = await svc.evaluateReconciliation(sys);
          return { evaluated: d.evaluated + r.evaluated, created: d.created + r.created, updated: d.updated + r.updated, layers: { deterministic: d, reconciliation: r } };
        },
        previewRule: (ctx: McCtx, ruleId: string, thresholds: Record<string, unknown>) => svc.previewThresholds({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: String(ctx.userId ?? ''), role: ctx.role ?? '', permissions: ctx.permissions ?? [] } as never, ruleId, thresholds),
        branchNetSales: reportsBranchNetSales(reports),
        saveRule: (ctx: McCtx, ruleId: string, input) => svc.updateSetting({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: String(ctx.userId ?? ''), role: ctx.role ?? '', permissions: ctx.permissions ?? [] } as never, ruleId, input),
      }) : null),
      inject: [DATABASE, MoneyProtectionService, 'MoneyProtectionEntitlementPort', ReportsService],
    },
    MoneyProtectionDetectionScheduler,
    {
      provide: InvestigationService,
      useFactory: (invRepo: MoneyProtectionInvestigationRepositoryPort, alertRepo: MoneyProtectionRepositoryPort, center: MoneyProtectionCenter | null) =>
        new InvestigationService(invRepo, alertRepo, center ? (ctx, e) => center.recordInvestigationEvent(ctx as never, e) : null),
      inject: ['MoneyProtectionInvestigationRepositoryPort', 'MoneyProtectionRepositoryPort', MONEY_PROTECTION_CENTER],
    },
    {
      provide: MoneyProtectionExplainService,
      // Constitution 10 §6: through the platform, which enforces entitlement, routing, validation and usage.
      useFactory: (alertRepo: MoneyProtectionRepositoryPort, platform: AiPlatform) => new MoneyProtectionExplainService(alertRepo, moneyExplainAdapter(platform)),
      inject: ['MoneyProtectionRepositoryPort', AiPlatform],
    },
  ],
  exports: [MoneyProtectionService, InvestigationService, MoneyProtectionExplainService],
})
export class MoneyProtectionModule {}
