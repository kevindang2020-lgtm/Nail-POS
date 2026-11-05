// audit.module.ts — unified audit trail. Kysely-backed when a Postgres handle exists, else the in-memory adapter
// (dev/offline/tests). Exports AuditService so any module can inject it and call record(); registers the tenant-scoped
// and Super-Admin read controllers.
import { Global, Module } from '@nestjs/common';
import { AuditController, SuperAdminAuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { InMemoryAuditRepository, type AuditRepositoryPort } from './audit.repository';
import { KyselyAuditRepository } from './audit.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Global()
@Module({
  controllers: [AuditController, SuperAdminAuditController],
  providers: [
    { provide: 'AuditRepositoryPort', useFactory: (db: AppDatabase): AuditRepositoryPort => (db ? new KyselyAuditRepository(db) : new InMemoryAuditRepository()), inject: [DATABASE] },
    { provide: AuditService, useFactory: (repo: AuditRepositoryPort) => new AuditService(repo), inject: ['AuditRepositoryPort'] },
  ],
  exports: [AuditService],
})
export class AuditModule {}
