// hardware-payment.module.ts — wires the service + Kysely repo (else in-memory) + real charge adapter, plus the
// monthly reconciliation job and the Fiserv residual import. Provide HW_ALERTS/HW_AUDIT in production for DB-backed sinks.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { HardwarePaymentService, HW_REPO, HW_CHARGE, HW_ALERTS, HW_AUDIT } from './hardware-payment.service';
import { InMemoryHardwarePaymentRepository, type HardwarePaymentDataPort } from './hardware-payment.repository';
import { KyselyHardwarePaymentRepository } from './hardware-payment.kysely.repository';
import { HardwareChargeAdapter } from './hardware-payment.charge-adapter';
import { DbAlertSink, DbAuditSink } from './hardware-payment.sinks';
import type { AlertSink, AuditSink } from './hardware-payment.dto';
import type { HardwareChargePort } from './hardware-payment.dto';
import { HardwarePaymentReconciliationJob } from './hardware-payment.reconciliation-job';
import { FiservResidualImportService } from './hardware-payment.residual-import';
import { HardwarePaymentScheduler } from './hardware-payment.scheduler';
import { HardwarePaymentCronController } from './hardware-payment.cron.controller';
import { HardwarePaymentSuperAdminController } from './hardware-payment.super-admin.controller';
import { HardwarePaymentOwnerController } from './hardware-payment.owner.controller';

@Module({
  controllers: [HardwarePaymentSuperAdminController, HardwarePaymentOwnerController, HardwarePaymentCronController],
  providers: [
    { provide: HW_REPO, useFactory: (db: AppDatabase): HardwarePaymentDataPort => (db ? new KyselyHardwarePaymentRepository(db) : new InMemoryHardwarePaymentRepository()), inject: [DATABASE] },
    { provide: HW_CHARGE, useFactory: (): HardwareChargePort => new HardwareChargeAdapter() },
    { provide: HW_ALERTS, useFactory: (db: AppDatabase): AlertSink | undefined => (db ? new DbAlertSink(db) : undefined), inject: [DATABASE] },
    { provide: HW_AUDIT, useFactory: (db: AppDatabase): AuditSink | undefined => (db ? new DbAuditSink(db) : undefined), inject: [DATABASE] },
    { provide: HardwarePaymentService, useFactory: (repo: HardwarePaymentDataPort, charge: HardwareChargePort, alerts: AlertSink, audit: AuditSink) => new HardwarePaymentService(repo, charge, alerts, audit), inject: [HW_REPO, HW_CHARGE, HW_ALERTS, HW_AUDIT] },
    { provide: FiservResidualImportService, useFactory: (repo: HardwarePaymentDataPort) => new FiservResidualImportService(repo), inject: [HW_REPO] },
    { provide: HardwarePaymentReconciliationJob, useFactory: (svc: HardwarePaymentService, repo: HardwarePaymentDataPort) => new HardwarePaymentReconciliationJob(svc, repo), inject: [HardwarePaymentService, HW_REPO] },
    { provide: HardwarePaymentScheduler, useFactory: (job: HardwarePaymentReconciliationJob, residual: FiservResidualImportService) => new HardwarePaymentScheduler(job, residual), inject: [HardwarePaymentReconciliationJob, FiservResidualImportService] },
  ],
  exports: [HardwarePaymentService, HardwarePaymentReconciliationJob, FiservResidualImportService],
})
export class HardwarePaymentModule {}
