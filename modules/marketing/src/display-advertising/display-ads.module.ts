// display-ads.module.ts — wires Customer Display Advertising (23-inch dual-screen spec §47–§114). The POS routes live
// here; the DEVICE routes stay with the customer display (apps/api), which authenticates the display and asks the
// exported DisplayAdsPlaylistService for that device's playlist — one owner for device identity, one for advertising.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { makeMediaStorage, type MediaStorage } from '@aipowersalon/media';
import { EntitlementsService, FeatureRegistry, SuperAdminPlansModule } from '@aipowersalon/platform';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { DisplayAdsController } from './display-ads.controller';
import { DisplayAdsRepository } from './display-ads.repository';
import { DisplayAdsService } from './display-ads.service';
import { DisplayAdsPlaylistService } from './display-ads-playlist.service';
import { DisplayAdsAvailabilityResolver, DisplayAdsNotifier, PlatformLimitsSource } from './display-ads-sources';
import { AdvertisingPolicyStore, PlatformAdvertisingService, ADVERTISING_POLICY } from './platform-advertising';
import { PlatformAdvertisingController, PLATFORM_ADVERTISING } from './platform-advertising.controller';
import { sql } from 'kysely';

export const DISPLAY_AD_MEDIA_STORAGE = Symbol('DISPLAY_AD_MEDIA_STORAGE');

@Module({
  imports: [SuperAdminPlansModule],
  controllers: [DisplayAdsController, PlatformAdvertisingController],
  providers: [
    { provide: DisplayAdsRepository, useFactory: (db: AppDatabase) => new DisplayAdsRepository(db as any), inject: [DATABASE] },
    { provide: DISPLAY_AD_MEDIA_STORAGE, useFactory: (): MediaStorage => makeMediaStorage() },
    {
      provide: DisplayAdsAvailabilityResolver,
      useFactory: (db: AppDatabase, ent: EntitlementsService) => new DisplayAdsAvailabilityResolver(db ? new FeatureRegistry(db, ent) : null, ent),
      inject: [DATABASE, EntitlementsService],
    },
    { provide: PlatformLimitsSource, useFactory: (repo: DisplayAdsRepository) => new PlatformLimitsSource(repo), inject: [DisplayAdsRepository] },
    { provide: DisplayAdsNotifier, useFactory: (repo: DisplayAdsRepository, rt?: RealtimeEmitter) => new DisplayAdsNotifier(repo, rt ?? null), inject: [DisplayAdsRepository, { token: REALTIME, optional: true }] },
    // G7 Global Advertising (Nov 5 2026): the ONE master switch + AI PowerSalon's own campaigns
    { provide: ADVERTISING_POLICY, useFactory: (db: AppDatabase) => new AdvertisingPolicyStore(db ? (db as never) : null), inject: [DATABASE] },
    {
      provide: PLATFORM_ADVERTISING,
      useFactory: (db: AppDatabase, s: MediaStorage, l: PlatformLimitsSource, p: AdvertisingPolicyStore, n: DisplayAdsNotifier) => (db ? new PlatformAdvertisingService(db as never, s, l, p, async (reason) => {
        // every salon with a registered display refetches (the switch / a live platform campaign reaches all of them)
        const t = (await sql<{ tenant_id: string }>`select distinct tenant_id from customer_display_devices where revoked_at is null`.execute(db as never)).rows;
        for (const r of t) await n.playlistChanged(String(r.tenant_id), 'all', { reason });
      }) : null),
      inject: [DATABASE, DISPLAY_AD_MEDIA_STORAGE, PlatformLimitsSource, ADVERTISING_POLICY, DisplayAdsNotifier],
    },
    {
      provide: DisplayAdsPlaylistService,
      useFactory: (repo: DisplayAdsRepository, a: DisplayAdsAvailabilityResolver, l: PlatformLimitsSource, db: AppDatabase, p: AdvertisingPolicyStore, pl: PlatformAdvertisingService | null) => new DisplayAdsPlaylistService(repo, a, l, db, undefined, p, pl),
      inject: [DisplayAdsRepository, DisplayAdsAvailabilityResolver, PlatformLimitsSource, DATABASE, ADVERTISING_POLICY, PLATFORM_ADVERTISING],
    },
    {
      provide: DisplayAdsService,
      useFactory: (repo: DisplayAdsRepository, a: DisplayAdsAvailabilityResolver, l: PlatformLimitsSource, s: MediaStorage, n: DisplayAdsNotifier, p: DisplayAdsPlaylistService, pol: AdvertisingPolicyStore) => new DisplayAdsService(repo, a, l, s, n, p, undefined, pol),
      inject: [DisplayAdsRepository, DisplayAdsAvailabilityResolver, PlatformLimitsSource, DISPLAY_AD_MEDIA_STORAGE, DisplayAdsNotifier, DisplayAdsPlaylistService, ADVERTISING_POLICY],
    },
  ],
  exports: [DisplayAdsPlaylistService],
})
export class DisplayAdvertisingModule {}
