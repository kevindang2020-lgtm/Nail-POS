// super-admin-settlements.module.ts — wires the read-only platform Settlements & Deposits over the platform DB,
// reusing the existing payment_settlements batch spine (migrations 038 + 175).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SettlementsService } from './settlements.service';
import { SettlementsRepository } from './settlements.repository';
import { SettlementsActionsService } from './settlements-actions.service';
import { SuperAdminSettlementsController } from './super-admin-settlements.controller';
import { SupportTicketsService } from '@aipowersalon/support';

@Module({
  controllers: [SuperAdminSettlementsController],
  providers: [
    {
      provide: SettlementsService,
      useFactory: (db: AppDatabase) => new SettlementsService(new SettlementsRepository(db as never)),
      inject: [DATABASE],
    },
    {
      // Reuses the EXISTING SupportTickets writer for processor-support cases (no parallel ticket store).
      provide: SettlementsActionsService,
      useFactory: (db: AppDatabase, svc: SettlementsService) =>
        new SettlementsActionsService(db as never, new SupportTicketsService(db as never), svc, new SettlementsRepository(db as never)),
      inject: [DATABASE, SettlementsService],
    },
  ],
  exports: [SettlementsService, SettlementsActionsService],
})
export class SuperAdminSettlementsModule {}
