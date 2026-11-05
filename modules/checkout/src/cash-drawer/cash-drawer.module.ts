// cash-drawer.module.ts — Front-desk cash drawer (register) reconciliation.
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxWriter } from '@aipowersalon/events';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { CashDrawerRepository } from './cash-drawer.repository';
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerPosController } from './cash-drawer.pos.controller';

@Module({
  imports: [EventsCoreModule],   // the outbox writer the drawer records its facts through (§343)
  controllers: [CashDrawerPosController],
  providers: [
    { provide: CashDrawerRepository, useFactory: (db: AppDatabase, outbox: OutboxWriter) => new CashDrawerRepository(db as any, outbox), inject: [DATABASE, OutboxWriter] },
    { provide: CashDrawerService, useFactory: (repo: CashDrawerRepository, rt: RealtimeEmitter) => new CashDrawerService(repo, rt), inject: [CashDrawerRepository, REALTIME] },
  ],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
