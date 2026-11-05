// help.module.ts — Help Center knowledge base (read foundation). DB-injected service, controller mounted at
// /tenant/help/* and covered by the global TenantContextMiddleware.
import { NotificationsService, NotificationsModule } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { HelpController } from './help.controller';
import { LocalDiskMediaStorage, makeSupportAttachmentStorage, STORAGE_QUOTA, type StorageQuotaPort } from '@aipowersalon/media';
import { SUPPORT_ATTACHMENT_STORAGE, SupportAttachmentsService } from './support-attachments.service';
import { SlaSweepController } from './sla-sweep.controller';
import { HelpService } from './help.service';
import { HelpAssistantService } from './help-assistant.service';
import { HelpConversationsService } from './help-conversations.service';
import { SupportTicketsService } from './support-tickets.service';
import { StatusService } from './status.service';
import { SupportSessionsService } from './support-sessions.service';
import { SlaBreachSweepJob } from './sla-breach-sweep';
import { SlaBreachSweepScheduler } from './sla-breach-sweep.scheduler';
import { SlaBreachNotifier } from './sla-breach-notifier';
import { AiGatewayService, resolveAiProvider } from '@aipowersalon/ai';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [NotificationsModule],
  controllers: [HelpController, SlaSweepController],
  providers: [
    { provide: HelpService, useFactory: (db: AppDatabase) => new HelpService(db), inject: [DATABASE] },
    { provide: HelpConversationsService, useFactory: (db: AppDatabase) => new HelpConversationsService(db), inject: [DATABASE] },
    // Support assistant: reuses the shared AI gateway (Mock provider when no API key) and the KB as its only
    // grounding source. Deliberately NOT behind the paid AI access-gate — product support is free to all users.
    // Persists each turn via the conversation store (§14), but never blocks an answer on storage.
    { provide: HelpAssistantService, useFactory: (help: HelpService, conv: HelpConversationsService) => new HelpAssistantService(help, new AiGatewayService(resolveAiProvider()), conv), inject: [HelpService, HelpConversationsService] },
    { provide: SupportTicketsService, useFactory: (db: AppDatabase) => new SupportTicketsService(db), inject: [DATABASE] },
    // Ticket attachments reuse the established MediaStorage port with a SEPARATE PRIVATE root: keys under this root
    // are unreachable from the public /media/* controller, so bytes flow only through the authorized help endpoints.
    { provide: SUPPORT_ATTACHMENT_STORAGE, useFactory: () => makeSupportAttachmentStorage() },   // BUILD_PLAN Phase 14 B: instrumented (store 'support_attachments')
    { provide: SupportAttachmentsService, useFactory: (db: AppDatabase, st: LocalDiskMediaStorage, quota?: StorageQuotaPort) => new SupportAttachmentsService(db, st, quota ?? null), inject: [DATABASE, SUPPORT_ATTACHMENT_STORAGE, { token: STORAGE_QUOTA, optional: true }] },
    { provide: StatusService, useFactory: (db: AppDatabase) => new StatusService(db), inject: [DATABASE] },
    { provide: SupportSessionsService, useFactory: (db: AppDatabase) => new SupportSessionsService(db), inject: [DATABASE] },
    // SLA first-response breach sweep: env-gated cron (off in dev/test). Flags overdue tickets idempotently.
    // Breach notifications are a second opt-in (SLA_BREACH_NOTIFY, default off) to owners/managers via the metered path.
    { provide: SlaBreachNotifier, useFactory: (db: AppDatabase, notif: NotificationsService) => new SlaBreachNotifier(db, notif), inject: [DATABASE, NotificationsService] },
    { provide: SlaBreachSweepJob, useFactory: (db: AppDatabase, notifier: SlaBreachNotifier) => new SlaBreachSweepJob(db, notifier), inject: [DATABASE, SlaBreachNotifier] },
    SlaBreachSweepScheduler,
  ],
})
export class HelpModule {}
