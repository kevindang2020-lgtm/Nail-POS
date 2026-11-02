// super-admin-appointment-oversight.module.ts — wires the Appointment Oversight › Overview endpoint. It owns the
// small gap repo only; everything else composes the already-exported platform service. No duplicated cross-tenant
// aggregation. Mirrors the analytics module's factory wiring (optional DATABASE → gap repo).

import { SuperAdminPlatformModule } from '../super-admin-platform/super-admin-platform.module';
import { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import { Module } from '@nestjs/common';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminAppointmentOversightController } from './super-admin-appointment-oversight.controller';
import { SuperAdminAppointmentOversightService } from './super-admin-appointment-oversight.service';
import { KyselyAppointmentOversightGapRepo } from './super-admin-appointment-oversight.kysely.repository';

@Module({
  imports: [SuperAdminPlatformModule],
  controllers: [SuperAdminAppointmentOversightController],
  providers: [
    {
      provide: SuperAdminAppointmentOversightService,
      useFactory: (platform: SuperAdminPlatformService, db: AppDatabase) =>
        new SuperAdminAppointmentOversightService(platform, db ? new KyselyAppointmentOversightGapRepo(db) : undefined),
      inject: [SuperAdminPlatformService, DATABASE_READ],
    },
  ],
  exports: [SuperAdminAppointmentOversightService],
})
export class SuperAdminAppointmentOversightModule {}
