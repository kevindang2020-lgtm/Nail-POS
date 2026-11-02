import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module } from '@nestjs/common';
import { CompensationController } from './compensation.controller';
import { CompensationPreviewService } from './compensation-preview.service';
import { CompensationReportsService } from './compensation-reports.service';
import { CompensationSnapshotRepository } from './compensation-snapshot.repository';
import { CompensationTipPolicyService } from './compensation-tip-policy.service';
import { RetailCommissionService } from './compensation-retail-policy.service';
import { CompensationRulesService } from './compensation-rules.service';
import { KyselyCompensationRulesRepo, InMemoryCompensationRulesRepo, type CompensationRulesRepo } from './compensation-rules.repository';
import { TierPlansService } from './compensation-tier-plans.service';
import { KyselyTierPlansRepo, InMemoryTierPlansRepo, type TierPlansRepo } from './compensation-tier-plans.repository';
import { BonusRulesService } from './compensation-bonus-rules.service';
import { KyselyBonusRulesRepo, InMemoryBonusRulesRepo, type BonusRulesRepo } from './compensation-bonus-rules.repository';
import { makeBonusFactsLoader, makeBonusAdjustmentAppender, makeBonusPeriodResolver } from './compensation-bonus-facts.adapter';
import { ComplianceService } from './compensation-compliance.service';
import { KyselyClassificationRepo, InMemoryClassificationRepo, type ClassificationRepo } from './compensation-classification.repository';
import { AgreementsService } from './compensation-agreements.service';
import { KyselyAgreementsRepo, InMemoryAgreementsRepo, type AgreementsRepo } from './compensation-agreements.repository';
import { TechAgreementsController } from './compensation-tech-agreements.controller';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { TipAllocationController } from './compensation-tip-allocation.controller';
import { TipAllocationService } from './compensation-tip-allocation.service';

/** Owner-facing compensation preview/validation (the engine exposed for the setup wizard + §28 calculator). Pure-compute. */
@Module({
  controllers: [CompensationController, TechAgreementsController, TipAllocationController],
  providers: [
    { provide: CompensationPreviewService, useFactory: () => new CompensationPreviewService() },
    { provide: CompensationReportsService, useFactory: (db: AppDatabase) => new CompensationReportsService(db ? new CompensationSnapshotRepository(db) : undefined), inject: [DATABASE] },
    { provide: CompensationTipPolicyService, useFactory: (db: AppDatabase, rt: RealtimeEmitter) => new CompensationTipPolicyService(db || null, rt), inject: [DATABASE, REALTIME] },
    { provide: RetailCommissionService, useFactory: (db: AppDatabase, rt: RealtimeEmitter) => new RetailCommissionService(db || null, rt), inject: [DATABASE, REALTIME] },
    { provide: 'CompensationRulesRepo', useFactory: (db: AppDatabase): CompensationRulesRepo => (db ? new KyselyCompensationRulesRepo(db) : new InMemoryCompensationRulesRepo()), inject: [DATABASE] },
    { provide: CompensationRulesService, useFactory: (repo: CompensationRulesRepo, db: AppDatabase, audit?: AuditService) => new CompensationRulesService(repo, db || null, audit), inject: ['CompensationRulesRepo', DATABASE, { token: AuditService, optional: true }] },
    { provide: TipAllocationService, useFactory: (db: AppDatabase, audit?: AuditService) => new TipAllocationService(db || null, audit), inject: [DATABASE, { token: AuditService, optional: true }] },
    { provide: 'TierPlansRepo', useFactory: (db: AppDatabase): TierPlansRepo => (db ? new KyselyTierPlansRepo(db) : new InMemoryTierPlansRepo()), inject: [DATABASE] },
    { provide: TierPlansService, useFactory: (repo: TierPlansRepo) => new TierPlansService(repo), inject: ['TierPlansRepo'] },
    { provide: 'BonusRulesRepo', useFactory: (db: AppDatabase): BonusRulesRepo => (db ? new KyselyBonusRulesRepo(db) : new InMemoryBonusRulesRepo()), inject: [DATABASE] },
    { provide: BonusRulesService, useFactory: (repo: BonusRulesRepo, db: AppDatabase) => new BonusRulesService(repo, db ? makeBonusFactsLoader(db) : undefined, db ? makeBonusAdjustmentAppender(db) : undefined, db ? makeBonusPeriodResolver(db) : undefined), inject: ['BonusRulesRepo', DATABASE] },
    { provide: 'ClassificationRepo', useFactory: (db: AppDatabase): ClassificationRepo => (db ? new KyselyClassificationRepo(db) : new InMemoryClassificationRepo()), inject: [DATABASE] },
    { provide: ComplianceService, useFactory: (repo: ClassificationRepo, db: AppDatabase, rt: RealtimeEmitter) => new ComplianceService(repo, db || null, rt), inject: ['ClassificationRepo', DATABASE, REALTIME] },
    { provide: 'AgreementsRepo', useFactory: (db: AppDatabase): AgreementsRepo => (db ? new KyselyAgreementsRepo(db) : new InMemoryAgreementsRepo()), inject: [DATABASE] },
    { provide: AgreementsService, useFactory: (repo: AgreementsRepo) => new AgreementsService(repo), inject: ['AgreementsRepo'] },
  ],
  exports: [CompensationPreviewService, CompensationReportsService, CompensationTipPolicyService, CompensationRulesService, TierPlansService, RetailCommissionService, BonusRulesService, ComplianceService, AgreementsService, TipAllocationService],
})
export class CompensationModule {}
