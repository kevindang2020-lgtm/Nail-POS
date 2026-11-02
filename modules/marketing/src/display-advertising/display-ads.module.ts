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

export const DISPLAY_AD_MEDIA_STORAGE = Symbol('DISPLAY_AD_MEDIA_STORAGE');

@Module({
  imports: [SuperAdminPlansModule],
  controllers: [DisplayAdsController],
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
    {
      provide: DisplayAdsPlaylistService,
      useFactory: (repo: DisplayAdsRepository, a: DisplayAdsAvailabilityResolver, l: PlatformLimitsSource, db: AppDatabase) => new DisplayAdsPlaylistService(repo, a, l, db),
      inject: [DisplayAdsRepository, DisplayAdsAvailabilityResolver, PlatformLimitsSource, DATABASE],
    },
    {
      provide: DisplayAdsService,
      useFactory: (repo: DisplayAdsRepository, a: DisplayAdsAvailabilityResolver, l: PlatformLimitsSource, s: MediaStorage, n: DisplayAdsNotifier, p: DisplayAdsPlaylistService) => new DisplayAdsService(repo, a, l, s, n, p),
      inject: [DisplayAdsRepository, DisplayAdsAvailabilityResolver, PlatformLimitsSource, DISPLAY_AD_MEDIA_STORAGE, DisplayAdsNotifier, DisplayAdsPlaylistService],
    },
  ],
  exports: [DisplayAdsPlaylistService],
})
export class DisplayAdvertisingModule {}
