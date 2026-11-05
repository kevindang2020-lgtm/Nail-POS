// platform-notice.module.ts — Platform Announcements on the POS top bar (Oct 22 2026): the one service, the Super Admin
// authoring controller and the POS read / receipt controller. Database-only (no in-memory double: a POS with no database
// simply shows nothing — the snapshot call fails and the header stays as it is, §114).
import { Module } from '@nestjs/common';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PlatformNoticeService } from './platform-notice.service';
import { SuperAdminPlatformNoticeController, PosPlatformNoticeController } from './platform-notice.controller';

@Module({
  imports: [EventsCoreModule],
  controllers: [SuperAdminPlatformNoticeController, PosPlatformNoticeController],
  providers: [
    { provide: PlatformNoticeService, useFactory: (db: AppDatabase, outbox: OutboxWriter, audit: AuditService) => (db ? new PlatformNoticeService(db, { outbox, audit }) : null), inject: [DATABASE, OutboxWriter, AuditService] },
  ],
  exports: [PlatformNoticeService],
})
export class PlatformNoticeModule {}
