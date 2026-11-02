// gift-cards.module.ts — Kysely-backed when a Postgres handle exists, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { InMemoryGiftCardsRepository, type GiftCardsRepositoryPort } from './gift-cards.repository';
import { KyselyGiftCardsRepository } from './gift-cards.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [GiftCardsController],
  providers: [
    { provide: 'GiftCardsRepositoryPort', useFactory: (db: AppDatabase): GiftCardsRepositoryPort => (db ? new KyselyGiftCardsRepository(db) : new InMemoryGiftCardsRepository()), inject: [DATABASE_READ] },
    { provide: GiftCardsService, useFactory: (repo: GiftCardsRepositoryPort) => new GiftCardsService(repo), inject: ['GiftCardsRepositoryPort'] },
  ],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
