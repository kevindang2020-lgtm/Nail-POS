// pos-social.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { SocialController } from './pos-social.controller';
import { SocialService } from './pos-social.service';
import { InMemorySocialRepository, type SocialRepositoryPort } from './pos-social.repository';
import { KyselySocialRepository } from './pos-social.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SocialController],
  providers: [
    { provide: 'SocialRepositoryPort', useFactory: (db: AppDatabase): SocialRepositoryPort => (db ? new KyselySocialRepository(db) : new InMemorySocialRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: SocialService, useFactory: (repo: SocialRepositoryPort) => new SocialService(repo), inject: ['SocialRepositoryPort'] },
  ],
  exports: [SocialService],
})
export class SocialModule {}
