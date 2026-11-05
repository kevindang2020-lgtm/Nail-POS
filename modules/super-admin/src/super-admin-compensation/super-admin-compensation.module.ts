// super-admin-compensation.module.ts — §27 cross-tenant compensation-config oversight (SuperAdminGuard).
import { Module } from '@nestjs/common';
import { SuperAdminCompensationController } from './super-admin-compensation.controller';
import { SuperAdminCompensationService } from './super-admin-compensation.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminCompensationController],
  providers: [
    { provide: SuperAdminCompensationService, useFactory: (db: AppDatabase) => new SuperAdminCompensationService(db || null), inject: [DATABASE] },
  ],
})
export class SuperAdminCompensationModule {}
