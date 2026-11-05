import { Controller, Get, Param, Query, UseGuards, Module } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { DeviceManagementService } from './device-management.service';
import { InMemoryDeviceMgmtRepo } from './device-management.repository';
import { KyselyDeviceMgmtRepo } from './device-management.kysely.repository';
import { DeviceManagementControllerListQueries } from './super-admin-device-management.module.list-queries';

@UseGuards(SuperAdminGuard)
@ListQueries(DeviceManagementControllerListQueries)
@Controller('super-admin/device-management')
export class DeviceManagementController {
  constructor(private readonly svc: DeviceManagementService) {}

  @Get('overview') overview(@Query() q: any) { return this.svc.getOverview({ tenantId: q?.tenantId || undefined, branchId: q?.branchId || undefined }); }
  @Get('devices') devices(@Query() q: any) {
    return this.svc.getDirectory({ tenantId: q?.tenantId || undefined, branchId: q?.branchId || undefined, deviceType: q?.deviceType || undefined, status: q?.status || undefined });
  }
  @Get('devices/:id') device(@Param('id') id: string) { return this.svc.get(id); }
}

@Module({
  controllers: [DeviceManagementController],
  providers: [{
    provide: DeviceManagementService,
    // Real DB in production (reads live device inventory + migration-246 support tables); falls back to the
    // in-memory seed only when no database is configured (dev/tests), matching the platform-wide pattern.
    useFactory: (db: AppDatabase) => new DeviceManagementService(db ? new KyselyDeviceMgmtRepo(db) : new InMemoryDeviceMgmtRepo()),
    inject: [DATABASE],
  }],
  exports: [DeviceManagementService],
})
export class SuperAdminDeviceManagementModule {}
