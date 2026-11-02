// deposit-reconciliation.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { SECRET_SEALERS, type SecretSealers } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { DepositReconciliationController } from './deposit-reconciliation.controller';
import { DepositReconciliationService } from './deposit-reconciliation.service';
import { InMemoryReconRepository, type ReconRepositoryPort } from './deposit-reconciliation.repository';
import { KyselyReconRepository } from './deposit-reconciliation.kysely.repository';
import { FeeReconciliationService } from './deposit-reconciliation.fees.service';
import { InMemoryFeeScheduleRepository, type FeeScheduleRepositoryPort } from './deposit-reconciliation.fees.repository';
import { KyselyFeeScheduleRepository } from './deposit-reconciliation.fees.repository';
import { AdjustmentsReconciliationService } from './deposit-reconciliation.adjustments.service';
import { InMemoryAdjustmentsRepository, type AdjustmentsRepositoryPort } from './deposit-reconciliation.adjustments.repository';
import { KyselyAdjustmentsRepository } from './deposit-reconciliation.adjustments.repository';
import { DuplicateDetectionService } from './deposit-reconciliation.duplicates.service';
import { ExceptionWorkflowService } from './deposit-reconciliation.exceptions.service';
import { InMemoryExceptionsRepository, type ExceptionsRepositoryPort } from './deposit-reconciliation.exceptions.repository';
import { KyselyExceptionsRepository } from './deposit-reconciliation.exceptions.repository';
import { AiExplanationService } from './deposit-reconciliation.explain.service';
import { InMemoryExplainUsageLogger, KyselyExplainUsageLogger, type ExplainUsageLogger } from './deposit-reconciliation.explain.usage';
import { MockAiProvider, type AiProvider } from '@aipowersalon/ai';
import { ReportsService } from './deposit-reconciliation.reports.service';
import { PeriodsService } from './deposit-reconciliation.periods.service';
import { InMemoryPeriodsRepository, KyselyPeriodsRepository, type PeriodsRepositoryPort } from './deposit-reconciliation.periods.repository';
import { BankWebhookController } from './deposit-reconciliation.webhook.controller';
import { BankWebhookService } from './deposit-reconciliation.webhook.service';
import { InMemoryWebhookRepository, KyselyWebhookRepository, type WebhookRepositoryPort } from './deposit-reconciliation.webhook.repository';
import { ReconSweepService } from './deposit-reconciliation.sweep.service';
import { ReconSweepScheduler } from './deposit-reconciliation.sweep.scheduler';
import { InMemorySweepRepository, KyselySweepRepository, type SweepRepositoryPort } from './deposit-reconciliation.sweep.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { ReconWorkspaceController, RECON_WORKSPACE_REPOSITORY } from '../finance-screens/recon-workspace.controller';
import { ReconWorkspaceRepository } from '../finance-screens/recon-workspace.repository';

@Module({
  controllers: [DepositReconciliationController, BankWebhookController, ReconWorkspaceController],   // + AI Deposit Reconciliation mandate (Oct 29 2026)
  providers: [
    { provide: 'ReconRepositoryPort', useFactory: (db: AppDatabase): ReconRepositoryPort => (db ? new KyselyReconRepository(db) : new InMemoryReconRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: DepositReconciliationService, useFactory: (repo: ReconRepositoryPort) => new DepositReconciliationService(repo), inject: ['ReconRepositoryPort'] },
    { provide: 'FeeScheduleRepositoryPort', useFactory: (db: AppDatabase): FeeScheduleRepositoryPort => (db ? new KyselyFeeScheduleRepository(db) : new InMemoryFeeScheduleRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: FeeReconciliationService, useFactory: (recon: ReconRepositoryPort, fees: FeeScheduleRepositoryPort) => new FeeReconciliationService(recon, fees), inject: ['ReconRepositoryPort', 'FeeScheduleRepositoryPort'] },
    { provide: 'AdjustmentsRepositoryPort', useFactory: (db: AppDatabase): AdjustmentsRepositoryPort => (db ? new KyselyAdjustmentsRepository(db) : new InMemoryAdjustmentsRepository()), inject: [DATABASE_READ] },
    { provide: AdjustmentsReconciliationService, useFactory: (repo: AdjustmentsRepositoryPort) => new AdjustmentsReconciliationService(repo), inject: ['AdjustmentsRepositoryPort'] },
    { provide: DuplicateDetectionService, useFactory: (repo: ReconRepositoryPort) => new DuplicateDetectionService(repo), inject: ['ReconRepositoryPort'] },
    { provide: 'ExceptionsRepositoryPort', useFactory: (db: AppDatabase): ExceptionsRepositoryPort => (db ? new KyselyExceptionsRepository(db) : new InMemoryExceptionsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: ExceptionWorkflowService, useFactory: (repo: ExceptionsRepositoryPort) => new ExceptionWorkflowService(repo), inject: ['ExceptionsRepositoryPort'] },
    { provide: 'ReconAiProvider', useFactory: (): AiProvider => new MockAiProvider() },
    { provide: 'ExplainUsageLogger', useFactory: (db: AppDatabase): ExplainUsageLogger => (db ? new KyselyExplainUsageLogger(db) : new InMemoryExplainUsageLogger()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: AiExplanationService, useFactory: (recon: ReconRepositoryPort, fees: FeeScheduleRepositoryPort, provider: AiProvider, usage: ExplainUsageLogger) => new AiExplanationService(recon, fees, provider, usage), inject: ['ReconRepositoryPort', 'FeeScheduleRepositoryPort', 'ReconAiProvider', 'ExplainUsageLogger'] },
    { provide: ReportsService, useFactory: (recon: ReconRepositoryPort, fees: FeeScheduleRepositoryPort, exc: ExceptionsRepositoryPort) => new ReportsService(recon, fees, exc), inject: ['ReconRepositoryPort', 'FeeScheduleRepositoryPort', 'ExceptionsRepositoryPort'] },
    { provide: 'PeriodsRepositoryPort', useFactory: (db: AppDatabase): PeriodsRepositoryPort => (db ? new KyselyPeriodsRepository(db) : new InMemoryPeriodsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: PeriodsService, useFactory: (periods: PeriodsRepositoryPort, exc: ExceptionsRepositoryPort) => new PeriodsService(periods, exc), inject: ['PeriodsRepositoryPort', 'ExceptionsRepositoryPort'] },
    { provide: 'WebhookRepositoryPort', useFactory: (db: AppDatabase, sealers: SecretSealers): WebhookRepositoryPort => (db ? new KyselyWebhookRepository(db, sealers.forPurpose('webhook')) : new InMemoryWebhookRepository()), inject: [DATABASE, SECRET_SEALERS] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: BankWebhookService, useFactory: (repo: WebhookRepositoryPort) => new BankWebhookService(repo), inject: ['WebhookRepositoryPort'] },
    { provide: 'SweepRepositoryPort', useFactory: (db: AppDatabase): SweepRepositoryPort => (db ? new KyselySweepRepository(db) : new InMemorySweepRepository()), inject: [DATABASE_READ] },
    { provide: ReconSweepService, useFactory: (sweep: SweepRepositoryPort, recon: ReconRepositoryPort, fees: FeeScheduleRepositoryPort, exc: ExceptionsRepositoryPort) => new ReconSweepService(sweep, recon, fees, exc), inject: ['SweepRepositoryPort', 'ReconRepositoryPort', 'FeeScheduleRepositoryPort', 'ExceptionsRepositoryPort'] },
    ReconSweepScheduler,
    // AI Deposit Reconciliation mandate (Oct 29 2026): the rebuilt page — allocations, bank accounts, deposits, fees, cases, reports
    { provide: RECON_WORKSPACE_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new ReconWorkspaceRepository(db, audit) : null), inject: [DATABASE, AuditService] },
  ],
  exports: [RECON_WORKSPACE_REPOSITORY, DepositReconciliationService, FeeReconciliationService, AdjustmentsReconciliationService, DuplicateDetectionService, ExceptionWorkflowService, AiExplanationService, ReportsService, PeriodsService],
})
export class DepositReconciliationModule {}
