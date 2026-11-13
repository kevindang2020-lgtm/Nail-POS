// devices.module.ts — tenant Devices & Integrations controller + service + repository. The repository is the
// Kysely-backed adapter when a Postgres handle exists, else the in-memory adapter (dev/offline/tests default) —
// identical to the Services/Bundles modules.
import { Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { runAsSingleOwner } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { evaluateAllDeviceAlerts } from './device-alert-routing';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { InMemoryDevicesRepository, type DevicesRepositoryPort } from './devices.repository';
import { KyselyDevicesRepository } from './devices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { DeviceFleetController, DEVICE_FLEET_CENTER } from './device-fleet.controller';   // SUNMI batch 8 (Nov 9 2026)
import { DeviceFleetCenter } from './device-fleet-center';

/** Device Integration Logs backlog · 05 (Nov 12 2026): the device / integration alert router, every 5 minutes, one owner
 *  across API instances; off with DEVICE_ALERT_ROUTING=off. The logs page also evaluates lazily (once a minute per salon). */
@Injectable()
export class DeviceAlertRoutingJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  onModuleInit() {
    if (!runsBackgroundJob('reconciliation')) return;
    if (!this.db || process.env.DEVICE_ALERT_ROUTING === 'off') return;
    const every = 5 * 60_000; const db = this.db as unknown as Kysely<any>;
    const fleet = new DeviceFleetCenter(db);
    this.timer = setInterval(() => {
      void runTick({ jobType: 'devices.alert_routing', jobClass: 'reconciliation', everyMs: every },
        () => runAsSingleOwner(db, 'devices.alert_routing', () => evaluateAllDeviceAlerts(db, (t) => fleet.alertRows(t), (e) => logException(e, { where: 'devices.alert_routing.tenant' }))))
        .catch((e) => logException(e, { where: 'devices.alert_routing.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  controllers: [DevicesController, DeviceFleetController],
  providers: [
    { provide: 'DevicesRepositoryPort', useFactory: (db: AppDatabase): DevicesRepositoryPort => (db ? new KyselyDevicesRepository(db as any) : new InMemoryDevicesRepository()), inject: [DATABASE] },
    { provide: DEVICE_FLEET_CENTER, useFactory: (db: AppDatabase) => (db ? new DeviceFleetCenter(db) : null), inject: [DATABASE] },
    { provide: DevicesService, useFactory: (repo: DevicesRepositoryPort) => new DevicesService(repo), inject: ['DevicesRepositoryPort'] },
    DeviceAlertRoutingJob,
  ],
  exports: [DevicesService],
})
export class DevicesModule {}
