// super-admin-queue.module.ts — wires the read-only platform live Queue Management over the platform DB.
import { SupportTicketsService, SupportSessionsService } from '@aipowersalon/support';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminQueueService } from './super-admin-queue.service';
import { SuperAdminQueueKyselyRepository } from './super-admin-queue.kysely.repository';
import { SuperAdminQueueController } from './super-admin-queue.controller';
import { LiveQueueService } from './live-queue.service';
import { LiveQueueRepository } from './live-queue.repository';
import { LiveQueueActionsService } from './live-queue-actions.service';

@Module({
  controllers: [SuperAdminQueueController],
  providers: [
    {
      provide: SuperAdminQueueService,
      useFactory: (db: AppDatabase) => new SuperAdminQueueService(new SuperAdminQueueKyselyRepository(db)),
      inject: [DATABASE],
    },
    {
      provide: LiveQueueService,
      useFactory: (db: AppDatabase) => new LiveQueueService(new LiveQueueRepository(db as never)),
      inject: [DATABASE],
    },
    {
      // Reuses the EXISTING support-ticket / support-session writers (no parallel ticketing system) + LiveQueueService.
      provide: LiveQueueActionsService,
      useFactory: (db: AppDatabase, live: LiveQueueService) =>
        new LiveQueueActionsService(db as never, new SupportTicketsService(db as never), new SupportSessionsService(db as never), live),
      inject: [DATABASE, LiveQueueService],
    },
  ],
  exports: [SuperAdminQueueService, LiveQueueService, LiveQueueActionsService],
})
export class SuperAdminQueueModule {}
