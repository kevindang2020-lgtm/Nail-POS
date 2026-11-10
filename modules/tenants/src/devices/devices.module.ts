// devices.module.ts — tenant Devices & Integrations controller + service + repository. The repository is the
// Kysely-backed adapter when a Postgres handle exists, else the in-memory adapter (dev/offline/tests default) —
// identical to the Services/Bundles modules.
import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { InMemoryDevicesRepository, type DevicesRepositoryPort } from './devices.repository';
import { KyselyDevicesRepository } from './devices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { DeviceFleetController, DEVICE_FLEET_CENTER } from './device-fleet.controller';   // SUNMI batch 8 (Nov 9 2026)
import { DeviceFleetCenter } from './device-fleet-center';
import { ReceiptPrinters, ReceiptPrintersController, RECEIPT_PRINTERS } from './receipt-printers';   // batch 8 decision 2

@Module({
  controllers: [DevicesController, DeviceFleetController, ReceiptPrintersController],
  providers: [
    { provide: 'DevicesRepositoryPort', useFactory: (db: AppDatabase): DevicesRepositoryPort => (db ? new KyselyDevicesRepository(db as any) : new InMemoryDevicesRepository()), inject: [DATABASE] },
    { provide: RECEIPT_PRINTERS, useFactory: (db: AppDatabase, audit: AuditService | null) => (db ? new ReceiptPrinters(db, audit ? auditSinkFor(audit) : null) : null), inject: [DATABASE, { token: AuditService, optional: true }] },
    { provide: DEVICE_FLEET_CENTER, useFactory: (db: AppDatabase) => (db ? new DeviceFleetCenter(db) : null), inject: [DATABASE] },
    { provide: DevicesService, useFactory: (repo: DevicesRepositoryPort) => new DevicesService(repo), inject: ['DevicesRepositoryPort'] },
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
