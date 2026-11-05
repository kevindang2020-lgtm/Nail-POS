/**
 * nail-showcase.module.ts — wires NailShowcase. Binds the Postgres (Kysely) port when a DB handle is present; otherwise
 * a stub that errors (the feature requires persistence). Exposes the customer feed/post/reaction/comment surface and the
 * POS moderation surface.
 */
import { PushModule, PushService } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { NailShowcaseCustomerController } from './nail-showcase.controller';
import { NailShowcasePosController } from './nail-showcase.pos.controller';
import { NailShowcaseSuperAdminController } from './nail-showcase.super-admin.controller';
import { NailShowcaseSocialController } from './nail-showcase-social.controller';
import { NailShowcaseService } from './nail-showcase.service';
import { NailShowcaseRankingService } from './nail-showcase-ranking.service';
import { NailShowcaseSocialService } from './nail-showcase-social.service';
import { StubNailShowcaseRepository, type NailShowcasePort } from './nail-showcase.repository';
import { KyselyNailShowcaseRepository } from './nail-showcase.kysely.repository';
import { StubNailShowcaseSocialRepository, type NailShowcaseSocialPort } from './nail-showcase-social.repository';
import { KyselyNailShowcaseSocialRepository } from './nail-showcase-social.kysely.repository';
import { NailPhotoConsentController } from './nail-photo-consent.controller';
import { NailPhotoConsentService, type NailPhotoConsentPort } from './nail-photo-consent.service';
import { KyselyNailPhotoConsentRepository, StubNailPhotoConsentRepository } from './nail-photo-consent.kysely.repository';
import { MEDIA_STORAGE } from '../tech-profile/tech-profile.service';
import { makeMediaStorage } from '@aipowersalon/media';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [PushModule],
  controllers: [NailShowcaseCustomerController, NailShowcasePosController, NailShowcaseSuperAdminController, NailShowcaseSocialController, NailPhotoConsentController],
  providers: [
    { provide: 'NailShowcasePort', useFactory: (db: AppDatabase): NailShowcasePort => (db ? new KyselyNailShowcaseRepository(db) : new StubNailShowcaseRepository()), inject: [DATABASE] },
    { provide: 'NailShowcaseSocialPort', useFactory: (db: AppDatabase): NailShowcaseSocialPort => (db ? new KyselyNailShowcaseSocialRepository(db) : new StubNailShowcaseSocialRepository()), inject: [DATABASE] },
    { provide: 'NailPhotoConsentPort', useFactory: (db: AppDatabase): NailPhotoConsentPort => (db ? new KyselyNailPhotoConsentRepository(db) : new StubNailPhotoConsentRepository()), inject: [DATABASE] },
    { provide: NailPhotoConsentService, useFactory: (repo: NailPhotoConsentPort) => new NailPhotoConsentService(repo), inject: ['NailPhotoConsentPort'] },
    { provide: NailShowcaseRankingService, useFactory: (repo: NailShowcaseSocialPort, push: PushService) => new NailShowcaseRankingService(repo, push), inject: ['NailShowcaseSocialPort', PushService] },
    { provide: NailShowcaseSocialService, useFactory: (repo: NailShowcaseSocialPort, ranking: NailShowcaseRankingService, push: PushService) => new NailShowcaseSocialService(repo, ranking, push), inject: ['NailShowcaseSocialPort', NailShowcaseRankingService, PushService] },
    { provide: NailShowcaseService, useFactory: (repo: NailShowcasePort, ranking: NailShowcaseRankingService, push: PushService) => new NailShowcaseService(repo, undefined, ranking, push), inject: ['NailShowcasePort', NailShowcaseRankingService, PushService] },
    { provide: MEDIA_STORAGE, useFactory: () => makeMediaStorage() },
  ],
  exports: [NailShowcaseService, NailShowcaseRankingService, NailShowcaseSocialService],
})
export class NailShowcaseModule {}
