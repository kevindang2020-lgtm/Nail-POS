// devices.module.ts — tenant Devices & Integrations controller + service + repository. The repository is the
// Kysely-backed adapter when a Postgres handle exists, else the in-memory adapter (dev/offline/tests default) —
// identical to the Services/Bundles modules.
import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { InMemoryDevicesRepository, type DevicesRepositoryPort } from './devices.repository';
import { KyselyDevicesRepository } from './devices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { DeviceFleetController, DEVICE_FLEET_CENTER } from './device-fleet.controller';   // SUNMI batch 8 (Nov 9 2026)
import { DeviceFleetCenter } from './device-fleet-center';

@Module({
  controllers: [DevicesController, DeviceFleetController],
  providers: [
    { provide: 'DevicesRepositoryPort', useFactory: (db: AppDatabase): DevicesRepositoryPort => (db ? new KyselyDevicesRepository(db as any) : new InMemoryDevicesRepository()), inject: [DATABASE] },
    { provide: DEVICE_FLEET_CENTER, useFactory: (db: AppDatabase) => (db ? new DeviceFleetCenter(db) : null), inject: [DATABASE] },
    { provide: DevicesService, useFactory: (repo: DevicesRepositoryPort) => new DevicesService(repo), inject: ['DevicesRepositoryPort'] },
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
