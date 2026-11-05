// ticket-history.module.ts — wires the read-only TicketHistoryService over the tenant DB to /pos/tickets/:id/history.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TicketHistoryService } from './ticket-history.service';
import { TicketHistoryKyselyRepository } from './ticket-history.kysely.repository';
import { TicketHistoryController } from './ticket-history.controller';

@Module({
  controllers: [TicketHistoryController],
  providers: [
    {
      provide: TicketHistoryService,
      useFactory: (db: AppDatabase) => new TicketHistoryService(new TicketHistoryKyselyRepository(db as any)),
      inject: [DATABASE],
    },
  ],
  exports: [TicketHistoryService],
})
export class TicketHistoryModule {}
