import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceMiddleware } from './maintenance.middleware';
import { KyselyMaintenanceRepo, InMemoryMaintenanceRepo, type MaintenanceRepo } from './maintenance.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [MaintenanceController],
  providers: [
    { provide: 'MaintenanceRepo', useFactory: (db: AppDatabase): MaintenanceRepo => (db ? new KyselyMaintenanceRepo(db) : new InMemoryMaintenanceRepo()), inject: [DATABASE] },
    { provide: MaintenanceService, useFactory: (repo: MaintenanceRepo, db: AppDatabase) => new MaintenanceService(repo, db || undefined), inject: ['MaintenanceRepo', DATABASE] },
    MaintenanceMiddleware,
  ],
  exports: [MaintenanceService, MaintenanceMiddleware],
})
export class MaintenanceModule {}
