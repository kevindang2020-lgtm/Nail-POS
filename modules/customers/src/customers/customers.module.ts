// customers.module.ts — POS Customers controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { SuperAdminPlansModule, EntitlementsService, AutomationEngineService } from '@aipowersalon/platform';
import { CustomerIdentityModule } from '../customer-identity/customer-identity.module';
import { CustomerIdentityService } from '../customer-identity/customer-identity.service';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryCustomersRepository, type CustomersRepositoryPort } from './customers.repository';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { LoyaltyReconcileScheduler } from '../loyalty/loyalty-reconcile.scheduler';
import { LoyaltyProgramController, LOYALTY_PROGRAM_REPOSITORY } from '../loyalty/loyalty-program.controller';
import { LoyaltyProgramRepository } from '../loyalty/loyalty-program.repository';
import { LoyaltyBonusController } from '../loyalty/loyalty-bonus.controller';
import { LoyaltyBonusService, type LoyaltyBonusApprovalsPort } from '../loyalty/loyalty-bonus';
import { RetentionController, RETENTION_REPOSITORY, RETENTION_SMS_SERVICE } from '../retention/retention.controller';
import { SegmentsController } from '../segments/segments.controller';
import { RetentionRepository } from '../retention/retention.repository';
import { RetentionSmsService } from '../retention/retention-sms.service';
import { RetentionSmsWorker } from '../retention/retention-sms.worker';
import { RetentionSnapshotWorker } from '../retention/retention-snapshot.scheduler';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';

@Module({
  imports: [EventsCoreModule, SuperAdminPlansModule, CustomerIdentityModule],
  controllers: [CustomersController, LoyaltyProgramController, LoyaltyBonusController, RetentionController, SegmentsController],   // + Loyalty & Rewards, Customer Retention (Oct 29 2026), Customer Segments (Oct 30 2026)
  providers: [
    { provide: 'CustomersRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): CustomersRepositoryPort => (db ? new KyselyCustomersRepository(db, outbox) : new InMemoryCustomersRepository()), inject: [DATABASE, OutboxWriter] },
    // Loyalty & Rewards mandate (Oct 29 2026): the POS loyalty program reads / writes (null without a database → 503)
    { provide: LOYALTY_PROGRAM_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new LoyaltyProgramRepository(db, audit) : null), inject: [DATABASE, AuditService] },
    // Customer Profile & Global Loyalty Protection (Nov 4 2026): bonus points only through the owner's approval (engine kind 'loyalty_bonus')
    { provide: LoyaltyBonusService, useFactory: (db: AppDatabase, approvals?: LoyaltyBonusApprovalsPort | null) => new LoyaltyBonusService(db ? (db as unknown as ConstructorParameters<typeof LoyaltyBonusService>[0]) : null).useApprovals(approvals ?? null), inject: [DATABASE, { token: 'TENANT_APPROVALS', optional: true }] },
    // Customer Retention mandate (Oct 29 2026): cohorts + consent-checked win-back SMS (one job per recipient)
    { provide: RETENTION_REPOSITORY, useFactory: (db: AppDatabase) => (db ? new RetentionRepository(db) : null), inject: [DATABASE] },
    { provide: RETENTION_SMS_SERVICE, useFactory: (db: AppDatabase, repo: RetentionRepository | null, audit: AuditService) => (db && repo ? new RetentionSmsService(db, repo, audit) : null), inject: [DATABASE, RETENTION_REPOSITORY, AuditService] },
    // Four-Module Completion Guide CR-01: the retention.snapshot.day job handler + the env-gated nightly scheduler (off by default)
    { provide: RetentionSnapshotWorker, useFactory: (db: AppDatabase) => new RetentionSnapshotWorker(db ?? null), inject: [DATABASE] },
    { provide: RetentionSmsWorker, useFactory: (db: AppDatabase, messenger?: TenantMessenger) => new RetentionSmsWorker(db, messenger ?? null), inject: [DATABASE, { token: TENANT_MESSENGER, optional: true }] },
    // Phase 10: the daily loyalty.reconcile job (points_balance = sum of the ledger, repaired from it with an owner alert)
    { provide: LoyaltyReconcileScheduler, useFactory: (db: AppDatabase) => new LoyaltyReconcileScheduler(db ? (db as any) : null), inject: [DATABASE] },
    { provide: CustomersService, useFactory: (repo: CustomersRepositoryPort, audit: AuditService, ent: EntitlementsService, db: AppDatabase, identity: CustomerIdentityService, realtime: RealtimeEmitter) => new CustomersService(repo, audit, ent, db ? new AutomationEngineService(db as any) : null, identity, realtime), inject: ['CustomersRepositoryPort', AuditService, EntitlementsService, DATABASE, CustomerIdentityService, { token: REALTIME, optional: true }] },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
