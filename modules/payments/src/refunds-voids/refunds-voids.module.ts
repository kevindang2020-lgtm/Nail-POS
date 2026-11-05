// refunds-voids.module.ts — Kysely-backed when Postgres present, else in-memory.
import { Module } from '@nestjs/common';
import { RefundsVoidsController } from './refunds-voids.controller';
import { RefundsVoidsService } from './refunds-voids.service';
import { InMemoryRefundsVoidsRepository, type RefundsVoidsRepositoryPort } from './refunds-voids.repository';
import { KyselyRefundsVoidsRepository } from './refunds-voids.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [RefundsVoidsController],
  providers: [
    { provide: 'RefundsVoidsRepositoryPort', useFactory: (db: AppDatabase): RefundsVoidsRepositoryPort => (db ? new KyselyRefundsVoidsRepository(db) : new InMemoryRefundsVoidsRepository()), inject: [DATABASE_READ] },
    { provide: RefundsVoidsService, useFactory: (repo: RefundsVoidsRepositoryPort) => new RefundsVoidsService(repo), inject: ['RefundsVoidsRepositoryPort'] },
  ],
  exports: [RefundsVoidsService],
})
export class RefundsVoidsModule {}
