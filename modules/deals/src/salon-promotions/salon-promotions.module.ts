// salon-promotions.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
// DISTINCT from the platform PromotionsModule.
import { Module } from '@nestjs/common';
import { SalonPromotionsController } from './salon-promotions.controller';
import { SalonPromotionsService } from './salon-promotions.service';
import { InMemorySalonPromotionsRepository, type SalonPromotionsRepositoryPort } from './salon-promotions.repository';
import { KyselySalonPromotionsRepository } from './salon-promotions.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { DiscountsScreenController, DiscountsScreenRepository, DISCOUNTS_SCREEN } from './discounts-screen';

@Module({
  controllers: [SalonPromotionsController, DiscountsScreenController],
  providers: [
    { provide: 'SalonPromotionsRepositoryPort', useFactory: (db: AppDatabase): SalonPromotionsRepositoryPort => (db ? new KyselySalonPromotionsRepository(db) : new InMemorySalonPromotionsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    // Services → Discounts (Oct 29 2026): the read model over the same coupon ledger (the primary: a coupon edited in Promotions shows at once)
    { provide: DISCOUNTS_SCREEN, useFactory: (db: AppDatabase) => (db ? new DiscountsScreenRepository(db) : null), inject: [DATABASE] },
    { provide: SalonPromotionsService, useFactory: (repo: SalonPromotionsRepositoryPort) => new SalonPromotionsService(repo), inject: ['SalonPromotionsRepositoryPort'] },
  ],
  exports: [SalonPromotionsService],
})
export class SalonPromotionsModule {}
