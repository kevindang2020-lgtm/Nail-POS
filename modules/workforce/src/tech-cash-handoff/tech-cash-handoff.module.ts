// tech-cash-handoff.module.ts — End-of-day tech cash hand-off & reconciliation.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { TechCashHandoffRepository } from './tech-cash-handoff.repository';
import { TechCashHandoffService } from './tech-cash-handoff.service';
import { TechCashHandoffTechController } from './tech-cash-handoff.tech.controller';
import { TechCashHandoffPosController } from './tech-cash-handoff.pos.controller';

@Module({
  imports: [EventsCoreModule],   // the outbox writer the hand-off records its facts through (§343)
  controllers: [TechCashHandoffTechController, TechCashHandoffPosController],
  providers: [
    { provide: TechCashHandoffRepository, useFactory: (db: AppDatabase, outbox: OutboxWriter) => new TechCashHandoffRepository(db as any, outbox), inject: [DATABASE, OutboxWriter] },
    { provide: TechCashHandoffService, useFactory: (repo: TechCashHandoffRepository, rt: RealtimeEmitter) => new TechCashHandoffService(repo, rt), inject: [TechCashHandoffRepository, REALTIME] },
  ],
  exports: [TechCashHandoffService],
})
export class TechCashHandoffModule {}
