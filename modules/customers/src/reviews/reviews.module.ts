// reviews.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { InMemoryReviewsRepository, type ReviewsRepositoryPort } from './reviews.repository';
import { KyselyReviewsRepository } from './reviews.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ReviewsController],
  providers: [
    { provide: 'ReviewsRepositoryPort', useFactory: (db: AppDatabase): ReviewsRepositoryPort => (db ? new KyselyReviewsRepository(db) : new InMemoryReviewsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: ReviewsService, useFactory: (repo: ReviewsRepositoryPort) => new ReviewsService(repo), inject: ['ReviewsRepositoryPort'] },
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
