// devices.module.ts — tenant Devices & Integrations controller + service + repository. The repository is the
// Kysely-backed adapter when a Postgres handle exists, else the in-memory adapter (dev/offline/tests default) —
// identical to the Services/Bundles modules.
import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { InMemoryDevicesRepository, type DevicesRepositoryPort } from './devices.repository';
import { KyselyDevicesRepository } from './devices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [DevicesController],
  providers: [
    { provide: 'DevicesRepositoryPort', useFactory: (db: AppDatabase): DevicesRepositoryPort => (db ? new KyselyDevicesRepository(db as any) : new InMemoryDevicesRepository()), inject: [DATABASE] },
    { provide: DevicesService, useFactory: (repo: DevicesRepositoryPort) => new DevicesService(repo), inject: ['DevicesRepositoryPort'] },
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
