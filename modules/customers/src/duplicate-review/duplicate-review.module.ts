// duplicate-review.module.ts — Duplicate Review guides (Nov 1 2026): the human-review workspace over possible duplicate
// customer profiles. Postgres only — without a database the controller answers 503 SERVICE_UNAVAILABLE (never "no duplicates").
// The confirmed merge runs the canonical customer merge (customers/customer-merge.ts) with the same outbox writer, so a
// merge from here emits exactly one customer.merged event, committed with the merge.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { DuplicateReviewCenter } from './duplicate-review-center';
import { DuplicateReviewCenterController, DUPLICATE_REVIEW_CENTER } from './duplicate-review-center.controller';

@Module({
  imports: [EventsCoreModule],
  controllers: [DuplicateReviewCenterController],
  providers: [{ provide: DUPLICATE_REVIEW_CENTER, useFactory: (db: AppDatabase, outbox: OutboxWriter) => (db ? new DuplicateReviewCenter(db, outbox ?? null) : null), inject: [DATABASE, OutboxWriter] }],
})
export class DuplicateReviewModule {}
