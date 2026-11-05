// super-admin-staff.module.ts — wires the read-only platform Staff / Technicians overview over the platform DB.
import { TechProfileModule, GlobalTechIdentityService } from '@aipowersalon/workforce';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminStaffService } from './super-admin-staff.service';
import { SuperAdminStaffKyselyRepository } from './super-admin-staff.kysely.repository';
import { SuperAdminStaffController } from './super-admin-staff.controller';
import { GlobalTechAdminService } from './global-tech-admin.service';
import { GlobalTechAdminController, TechMembershipAdminController } from './global-tech-admin.controller';
import { KyselyCrossTenantTransferExecutor } from './cross-tenant-transfer.executor';

@Module({
  // TechProfileModule owns the global identity. The transfer executor reuses it rather than growing a second
  // copy of "how a technician joins a salon". TechProfileModule does not import this one — no cycle.
  imports: [TechProfileModule],
  controllers: [SuperAdminStaffController, GlobalTechAdminController, TechMembershipAdminController],
  providers: [
    { provide: KyselyCrossTenantTransferExecutor, useFactory: (db: AppDatabase, id: GlobalTechIdentityService) => new KyselyCrossTenantTransferExecutor(db, id), inject: [DATABASE, GlobalTechIdentityService] },
    { provide: GlobalTechAdminService, useFactory: (db: AppDatabase) => new GlobalTechAdminService(db), inject: [DATABASE] },
    {
      provide: SuperAdminStaffService,
      useFactory: (db: AppDatabase, tx: KyselyCrossTenantTransferExecutor) => new SuperAdminStaffService(new SuperAdminStaffKyselyRepository(db as any), tx),
      inject: [DATABASE, KyselyCrossTenantTransferExecutor],
    },
  ],
  exports: [SuperAdminStaffService, GlobalTechAdminService],
})
export class SuperAdminStaffModule {}
