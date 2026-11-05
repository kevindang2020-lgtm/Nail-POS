// super-admin-tickets.module.ts — wires the read-only SuperAdminTicketsService over the platform DB.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminTicketsService } from './super-admin-tickets.service';
import { SuperAdminTicketsKyselyRepository } from './super-admin-tickets.kysely.repository';
import { SuperAdminTicketsController } from './super-admin-tickets.controller';

@Module({
  controllers: [SuperAdminTicketsController],
  providers: [
    {
      provide: SuperAdminTicketsService,
      useFactory: (db: AppDatabase) => new SuperAdminTicketsService(new SuperAdminTicketsKyselyRepository(db as any)),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminTicketsService],
})
export class SuperAdminTicketsModule {}
