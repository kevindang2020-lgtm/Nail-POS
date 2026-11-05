// pos-referrals.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { ReferralsController } from './pos-referrals.controller';
import { ReferralsService } from './pos-referrals.service';
import { InMemoryReferralsRepository, type ReferralsRepositoryPort } from './pos-referrals.repository';
import { KyselyReferralsRepository } from './pos-referrals.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ReferralsController],
  providers: [
    { provide: 'ReferralsRepositoryPort', useFactory: (db: AppDatabase): ReferralsRepositoryPort => (db ? new KyselyReferralsRepository(db) : new InMemoryReferralsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: ReferralsService, useFactory: (repo: ReferralsRepositoryPort) => new ReferralsService(repo), inject: ['ReferralsRepositoryPort'] },
  ],
  exports: [ReferralsService],
})
export class ReferralsModule {}
