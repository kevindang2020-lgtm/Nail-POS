// customer-timeline.module.ts — Customer Timeline guide (Nov 1 2026): the read-only, source-linked customer history.
// Postgres only — without a database the controller answers 503 SERVICE_UNAVAILABLE (never an empty "no history").
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CustomerTimelineCenter } from './customer-timeline-center';
import { CustomerTimelineCenterController, CUSTOMER_TIMELINE_CENTER } from './customer-timeline-center.controller';

@Module({
  controllers: [CustomerTimelineCenterController],
  providers: [{ provide: CUSTOMER_TIMELINE_CENTER, useFactory: (db: AppDatabase) => (db ? new CustomerTimelineCenter(db) : null), inject: [DATABASE] }],
})
export class CustomerTimelineModule {}
