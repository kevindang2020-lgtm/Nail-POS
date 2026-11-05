/**
 * end-of-day-followups.module.ts — wires the Daily Follow-Up Queue. Binds the Postgres (Kysely) port when a DB handle
 * is present; otherwise an erroring stub (the feature requires persistence). Exposes the tech, manager/POS, and
 * customer surfaces, and starts the timezone-aware generation scheduler.
 */
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { FollowUpTechController } from './end-of-day-followups.tech.controller';
import { FollowUpPosController } from './end-of-day-followups.pos.controller';
import { FollowUpCustomerController } from './end-of-day-followups.customer.controller';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { DailyFollowUpScheduler } from './end-of-day-followups.scheduler';
import { StubDailyFollowUpRepository, type DailyFollowUpPort } from './end-of-day-followups.repository';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

@Module({
  imports: [EventsCoreModule],
  controllers: [FollowUpTechController, FollowUpPosController, FollowUpCustomerController],
  providers: [
    { provide: 'DailyFollowUpPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): DailyFollowUpPort => (db ? new KyselyDailyFollowUpRepository(db, outbox) : new StubDailyFollowUpRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: DailyFollowUpService, useFactory: (repo: DailyFollowUpPort, rt: RealtimeEmitter) => new DailyFollowUpService(repo, rt), inject: ['DailyFollowUpPort', REALTIME] },
    DailyFollowUpScheduler,
  ],
  exports: [DailyFollowUpService],
})
export class EndOfDayFollowUpModule {}
