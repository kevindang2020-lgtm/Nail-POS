// salon-promotions.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
// DISTINCT from the platform PromotionsModule.
import { Module } from '@nestjs/common';
import { SalonPromotionsController } from './salon-promotions.controller';
import { SalonPromotionsService } from './salon-promotions.service';
import { InMemorySalonPromotionsRepository, type SalonPromotionsRepositoryPort } from './salon-promotions.repository';
import { KyselySalonPromotionsRepository } from './salon-promotions.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SalonPromotionsController],
  providers: [
    { provide: 'SalonPromotionsRepositoryPort', useFactory: (db: AppDatabase): SalonPromotionsRepositoryPort => (db ? new KyselySalonPromotionsRepository(db) : new InMemorySalonPromotionsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: SalonPromotionsService, useFactory: (repo: SalonPromotionsRepositoryPort) => new SalonPromotionsService(repo), inject: ['SalonPromotionsRepositoryPort'] },
  ],
  exports: [SalonPromotionsService],
})
export class SalonPromotionsModule {}
