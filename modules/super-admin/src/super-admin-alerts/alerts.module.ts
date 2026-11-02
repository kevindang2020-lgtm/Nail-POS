// alerts.module.ts — wires Super-Admin Alerts. Kysely adapter when a DB handle exists, else the in-memory adapter.
import { Module } from '@nestjs/common';
import { SuperAdminAlertsController } from './alerts.controller';
import { SuperAdminAlertsService } from './alerts.service';
import { InMemoryAlertsRepo, type AlertsRepo } from './alerts.repository';
import { KyselyAlertsRepo } from './alerts.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminAlertsController],
  providers: [
    { provide: 'AlertsRepo', useFactory: (db: AppDatabase): AlertsRepo => (db ? new KyselyAlertsRepo(db) : new InMemoryAlertsRepo()), inject: [DATABASE] },
    { provide: SuperAdminAlertsService, useFactory: (repo: AlertsRepo) => new SuperAdminAlertsService(repo), inject: ['AlertsRepo'] },
  ],
  exports: [SuperAdminAlertsService],
})
export class SuperAdminAlertsModule {}
