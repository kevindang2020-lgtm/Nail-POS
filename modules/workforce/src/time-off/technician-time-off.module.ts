// technician-time-off.module.ts — time-off request workflow (merge Oct 12 2026). Kysely-only: without a database the
// service answers 503 `unavailable` (no in-memory fake of an approval workflow).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { AuditService } from '@aipowersalon/audit';
import { TechnicianTimeOffService } from './technician-time-off.service';
import { TechTimeOffController, TechnicianTimeOffController } from './technician-time-off.controller';

@Module({
  imports: [EventsCoreModule],
  controllers: [TechTimeOffController, TechnicianTimeOffController],
  providers: [
    { provide: TechnicianTimeOffService, useFactory: (db: AppDatabase, outbox: OutboxWriter, audit?: AuditService) => new TechnicianTimeOffService(db as any, outbox, audit ?? null), inject: [DATABASE, OutboxWriter, { token: AuditService, optional: true }] },
  ],
  exports: [TechnicianTimeOffService],
})
export class TechnicianTimeOffModule {}
