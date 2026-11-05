import { Module } from '@nestjs/common';
import { SplitPaymentsController } from './split-payments.controller';
import { SplitPaymentsService } from './split-payments.service';
import { InMemorySplitPaymentsRepository, type SplitPaymentsRepositoryPort } from './split-payments.repository';
import { KyselySplitPaymentsRepository } from './split-payments.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SplitPaymentsController],
  providers: [
    { provide: 'SplitPaymentsRepositoryPort', useFactory: (db: AppDatabase): SplitPaymentsRepositoryPort => (db ? new KyselySplitPaymentsRepository(db) : new InMemorySplitPaymentsRepository()), inject: [DATABASE_READ] },
    { provide: SplitPaymentsService, useFactory: (repo: SplitPaymentsRepositoryPort) => new SplitPaymentsService(repo), inject: ['SplitPaymentsRepositoryPort'] },
  ],
  exports: [SplitPaymentsService],
})
export class SplitPaymentsModule {}
