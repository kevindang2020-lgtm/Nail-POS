// settings.module.ts — POS Settings controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default). The provider/hardware
// integration services live inside PosSettingsService and are unaffected by the persistence choice.
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module } from '@nestjs/common';
import { PosSettingsController } from './settings.controller';
import { PosSettingsService } from './settings.service';
import { InMemorySettingsRepository, type SettingsRepositoryPort } from './settings.repository';
import { KyselySettingsRepository } from './settings.kysely.repository';
import { TerminalPairingService, type TerminalPairingRepositoryPort, DevicePairingService, type DevicePairingRepositoryPort, TERMINAL_PROBE_PORT, type TerminalProbePort } from './settings.integrations';
import { KyselyTerminalPairingRepository } from './settings.terminals.kysely.repository';
import { KyselyDevicePairingRepository } from './settings.devices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { makeMediaStorage, STORAGE_QUOTA, type MediaStorage, type StorageQuotaPort } from '@aipowersalon/media';
import { InMemorySalonLogoStore, KyselySalonLogoStore, type SalonLogoStore } from './salon-logo';
import { KyselyA2pStatusReader, type A2pStatusReaderPort } from './settings.a2p.kysely';
import { KyselyMessageTemplateStore, type MessageTemplateStorePort } from './settings.templates.kysely';

/** The salon logo is shown on the salon's customer-facing display and receipts — it lives in the PUBLIC media store
 *  (served at /media/*), like technician photos and the nail showcase (salon-logo.ts; file-safety pins the writers). */
export const SALON_LOGO_MEDIA_STORAGE = 'SALON_LOGO_MEDIA_STORAGE';

@Module({
  controllers: [PosSettingsController],
  providers: [
    { provide: 'SettingsRepositoryPort', useFactory: (db: AppDatabase): SettingsRepositoryPort => (db ? new KyselySettingsRepository(db) : new InMemorySettingsRepository()), inject: [DATABASE] },
    { provide: 'TerminalPairingRepositoryPort', useFactory: (db: AppDatabase): TerminalPairingRepositoryPort => (db ? new KyselyTerminalPairingRepository(db) : new TerminalPairingService()), inject: [DATABASE] },
    { provide: 'DevicePairingRepositoryPort', useFactory: (db: AppDatabase): DevicePairingRepositoryPort => (db ? new KyselyDevicePairingRepository(db) : new DevicePairingService()), inject: [DATABASE] },
    { provide: 'SalonLogoStore', useFactory: (db: AppDatabase): SalonLogoStore => (db ? new KyselySalonLogoStore(db) : new InMemorySalonLogoStore()), inject: [DATABASE] },
    { provide: SALON_LOGO_MEDIA_STORAGE, useFactory: (): MediaStorage => makeMediaStorage() },
    // wave 3 PAYI §166: the terminal readiness probe is optional — apps/api's @Global TerminalProbeModule supplies it
    // Phone & Messaging guide (Oct 30 2026): the A2P status from the real registration record (null without a database)
    { provide: 'A2pStatusReaderPort', useFactory: (db: AppDatabase): A2pStatusReaderPort | null => (db ? new KyselyA2pStatusReader(db) : null), inject: [DATABASE] },
    { provide: 'MessageTemplateStorePort', useFactory: (db: AppDatabase): MessageTemplateStorePort | null => (db ? new KyselyMessageTemplateStore(db) : null), inject: [DATABASE] },
    { provide: PosSettingsService, useFactory: (repo: SettingsRepositoryPort, terminals: TerminalPairingRepositoryPort, devices: DevicePairingRepositoryPort, rt: RealtimeEmitter, logos: SalonLogoStore, media: MediaStorage, a2p: A2pStatusReaderPort | null, templates: MessageTemplateStorePort | null, quota?: StorageQuotaPort, probe?: TerminalProbePort) => new PosSettingsService(repo, terminals, devices, rt, logos, media, quota ?? null, probe ?? null, a2p, templates), inject: ['SettingsRepositoryPort', 'TerminalPairingRepositoryPort', 'DevicePairingRepositoryPort', REALTIME, 'SalonLogoStore', SALON_LOGO_MEDIA_STORAGE, 'A2pStatusReaderPort', 'MessageTemplateStorePort', { token: STORAGE_QUOTA, optional: true }, { token: TERMINAL_PROBE_PORT, optional: true }] },
  ],
  exports: [PosSettingsService],
})
export class PosSettingsModule {}
