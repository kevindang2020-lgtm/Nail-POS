import { Module } from '@nestjs/common';
import { SuperAdminReconController } from './super-admin-reconciliation.controller';
import { SuperAdminReconService } from './super-admin-reconciliation.service';
import { InMemorySuperAdminReconRepository, KyselySuperAdminReconRepository, type SuperAdminReconRepositoryPort } from './super-admin-reconciliation.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminReconController],
  providers: [
    { provide: 'SuperAdminReconRepositoryPort', useFactory: (db: AppDatabase): SuperAdminReconRepositoryPort => (db ? new KyselySuperAdminReconRepository(db) : new InMemorySuperAdminReconRepository()), inject: [DATABASE_READ] },
    { provide: SuperAdminReconService, useFactory: (repo: SuperAdminReconRepositoryPort) => new SuperAdminReconService(repo), inject: ['SuperAdminReconRepositoryPort'] },
  ],
})
export class SuperAdminReconModule {}
