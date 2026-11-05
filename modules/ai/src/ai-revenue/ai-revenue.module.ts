import { Module } from '@nestjs/common';
import { AiRevenueController } from './ai-revenue.controller';
import { AiRevenueService } from './ai-revenue.service';
import { InMemoryAiRevenueRepo, type AiRevenueRepo } from './ai-revenue.repository';
import { KyselyAiRevenueRepo } from './ai-revenue.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export const AI_REVENUE_REPO = Symbol('AI_REVENUE_REPO');

@Module({
  controllers: [AiRevenueController],
  providers: [
    { provide: AI_REVENUE_REPO, useFactory: (db: AppDatabase): AiRevenueRepo => (db ? new KyselyAiRevenueRepo(db) : new InMemoryAiRevenueRepo()), inject: [DATABASE] },
    { provide: AiRevenueService, useFactory: (repo: AiRevenueRepo) => new AiRevenueService(repo), inject: [AI_REVENUE_REPO] },
  ],
  exports: [AiRevenueService],
})
export class AiRevenueModule {}
