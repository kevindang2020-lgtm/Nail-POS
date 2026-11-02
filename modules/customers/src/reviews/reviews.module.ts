// reviews.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { InMemoryReviewsRepository, type ReviewsRepositoryPort } from './reviews.repository';
import { KyselyReviewsRepository } from './reviews.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { ReviewsCenter } from './reviews-center';
import { ReviewsCenterController, REVIEWS_CENTER } from './reviews-center.controller';

@Module({
  controllers: [ReviewsCenterController],   // the legacy pos/reviews/state + :id/visibility routes are retired (no caller since the Oct 31 rebuild; every Hide goes through the audited moderate path)
  providers: [
    { provide: 'ReviewsRepositoryPort', useFactory: (db: AppDatabase): ReviewsRepositoryPort => (db ? new KyselyReviewsRepository(db) : new InMemoryReviewsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: REVIEWS_CENTER, useFactory: (db: AppDatabase) => (db ? new ReviewsCenter(db) : null), inject: [DATABASE] },
    { provide: ReviewsService, useFactory: (repo: ReviewsRepositoryPort) => new ReviewsService(repo), inject: ['ReviewsRepositoryPort'] },
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
