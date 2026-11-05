// payroll.module.ts — payroll runs / commission ledger. Kysely-backed when Postgres is present, else in-memory. Audit
// is global (durable audit of mutations). Exports the service for cross-module reuse.
// Wave 2 (Oct 12 2026): PayrollWorkflowService (review / approval / lock / payout / export / exceptions / inquiries / pay
// plans) — database-only; the compensation recovery worker (missing snapshots, chargeback reversals, §196–§197).
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { PushModule, PushService } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { PayrollController, SuperAdminPayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { InMemoryPayrollRepository, type PayrollRepositoryPort } from './payroll.repository';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PayrollAutoBuildAdapter } from '../compensation/compensation-autobuild.adapter';
import { CompensationService } from '../compensation/compensation.service';
import { KyselyCompensationPorts } from '../compensation/compensation.kysely.ports';
import { CompensationRecoveryWorker } from '../compensation/compensation-recovery';
import { AuditService } from '@aipowersalon/audit';

@Module({
  imports: [EventsCoreModule, PushModule],
  controllers: [PayrollController, SuperAdminPayrollController],
  providers: [
    { provide: 'PayrollRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): PayrollRepositoryPort => (db ? new KyselyPayrollRepository(db, outbox) : new InMemoryPayrollRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: PayrollService, useFactory: (repo: PayrollRepositoryPort, audit: AuditService, db: AppDatabase, push: PushService) => new PayrollService(repo, audit, db ? new PayrollAutoBuildAdapter(db) : undefined, push), inject: ['PayrollRepositoryPort', AuditService, DATABASE, PushService] },
    { provide: PayrollWorkflowService, useFactory: (db: AppDatabase, outbox: OutboxWriter, audit: AuditService, push: PushService, payroll: PayrollService) => {
      if (!db) return null;
      const wf = new PayrollWorkflowService(db as any, { outbox, audit, push, builder: payroll, autoBuild: new PayrollAutoBuildAdapter(db), snapshots: new CompensationService(new KyselyCompensationPorts(db)) });
      payroll.useWorkflow(wf);   // the Owner App's approve / lock / reopen go through the same workflow
      return wf;
    }, inject: [DATABASE, OutboxWriter, AuditService, PushService, PayrollService] },
    { provide: CompensationRecoveryWorker, useFactory: (db: AppDatabase) => new CompensationRecoveryWorker(db ? (db as any) : null, db ? new CompensationService(new KyselyCompensationPorts(db)) : null), inject: [DATABASE] },
  ],
  exports: [PayrollService, PayrollWorkflowService],
})
export class PayrollModule {}
