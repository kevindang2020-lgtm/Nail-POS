// turn-queue.module.ts — the technician turn queue's manager / board / Technician App routes + the day-close job.
// The writer (turn-ledger.ts) is a plain function set called inside other modules' transactions; this module only serves
// reads and the manager's own actions. Kysely only — the turn queue has no in-memory mode (PostgreSQL is the truth, §186).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { TurnQueueController, TechTurnQueueController } from './turn-queue.controller';
import { TurnQueueService } from './turn-queue.service';
import { TurnQueueDayCloseScheduler } from './turn-queue-day-close.scheduler';

@Module({
  imports: [EventsCoreModule],
  controllers: [TurnQueueController, TechTurnQueueController],
  providers: [
    { provide: TurnQueueService, useFactory: (db: AppDatabase, outbox: OutboxWriter, rt?: RealtimeEmitter) => new TurnQueueService(db as any, outbox, rt ?? null),
      inject: [DATABASE, OutboxWriter, { token: REALTIME, optional: true }] },
    TurnQueueDayCloseScheduler,
  ],
  exports: [TurnQueueService],
})
export class TurnQueueModule {}
