// loyalty.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { InMemoryLoyaltyRepository, type LoyaltyRepositoryPort } from './loyalty.repository';
import { KyselyLoyaltyRepository } from './loyalty.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [LoyaltyController],
  providers: [
    { provide: 'LoyaltyRepositoryPort', useFactory: (db: AppDatabase): LoyaltyRepositoryPort => (db ? new KyselyLoyaltyRepository(db) : new InMemoryLoyaltyRepository()), inject: [DATABASE] },   // writes now (rewards catalog), so the primary, not the read replica
    { provide: LoyaltyService, useFactory: (repo: LoyaltyRepositoryPort) => new LoyaltyService(repo), inject: ['LoyaltyRepositoryPort'] },
  ],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
