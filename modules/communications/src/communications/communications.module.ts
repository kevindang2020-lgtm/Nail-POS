// communications.module.ts — unified inbox. Kysely-backed when Postgres is present, else in-memory (dev/offline/tests).
// AuditService is global (durable audit of mutations). Exports the service for cross-module reuse.
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { CommunicationsController, SuperAdminCommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { InMemoryCommunicationsRepository, type CommunicationsRepositoryPort } from './communications.repository';
import { KyselyCommunicationsRepository } from './communications.kysely.repository';
import { CommunicationsOverviewService } from './communications-overview.service';
import { CommunicationsOverviewRepository } from './communications-overview.kysely.repository';
import { CommunicationsAnnouncementsService } from './communications-announcements.service';
import { CommunicationsActivityService } from './communications-activity.service';
import { CommunicationsAnnouncementsRepository } from './communications-announcements.kysely.repository';
import { CommunicationsLimitsService } from './communications-limits.service';
import { CommunicationsLimitsRepository } from './communications-limits.kysely.repository';
import { CommunicationsTemplatesService } from './communications-templates.service';
import { CommunicationsTemplatesRepository } from './communications-templates.kysely.repository';
import { CommunicationsProvidersService } from './communications-providers.service';
import { CommunicationsProvidersRepository } from './communications-providers.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantMessagingModule } from '../tenant-messaging/tenant-messaging.module';
import { TenantMessagingReadinessService } from '../tenant-messaging/tenant-messaging-readiness.service';
import { InboxController, INBOX_SERVICE } from '../inbox/inbox.controller';
import { InboxService } from '../inbox/inbox.service';
import { InboxRepository } from '../inbox/inbox.repository';

@Module({
  // Communications / SMS Inbox guide (Oct 30 2026): the inbox sends through the ONE SMS path (TENANT_MESSENGER) and asks the
  // messaging readiness service before any provider call; REALTIME is the global bus (ids-only conversation_updated).
  imports: [NotificationsModule, TenantMessagingModule],
  controllers: [CommunicationsController, SuperAdminCommunicationsController, InboxController],
  providers: [
    { provide: INBOX_SERVICE, useFactory: (db: AppDatabase, messenger: TenantMessenger, readiness: TenantMessagingReadinessService, rt: RealtimeEmitter): InboxService | null =>
        (db ? new InboxService(new InboxRepository(db), messenger, readiness, rt) : null), inject: [DATABASE, TENANT_MESSENGER, TenantMessagingReadinessService, REALTIME] },
    { provide: 'CommunicationsRepositoryPort', useFactory: (db: AppDatabase): CommunicationsRepositoryPort => (db ? new KyselyCommunicationsRepository(db) : new InMemoryCommunicationsRepository()), inject: [DATABASE] },
    { provide: CommunicationsService, useFactory: (repo: CommunicationsRepositoryPort, audit: AuditService) => new CommunicationsService(repo, audit), inject: ['CommunicationsRepositoryPort', AuditService] },
    { provide: CommunicationsActivityService, useFactory: (db: AppDatabase) => new CommunicationsActivityService(db), inject: [DATABASE] },
    { provide: CommunicationsOverviewService, useFactory: (db: AppDatabase) => new CommunicationsOverviewService(new CommunicationsOverviewRepository(db)), inject: [DATABASE] },
    { provide: CommunicationsAnnouncementsService, useFactory: (db: AppDatabase) => new CommunicationsAnnouncementsService(new CommunicationsAnnouncementsRepository(db)), inject: [DATABASE] },
    { provide: CommunicationsLimitsService, useFactory: (db: AppDatabase) => new CommunicationsLimitsService(new CommunicationsLimitsRepository(db)), inject: [DATABASE] },
    { provide: CommunicationsTemplatesService, useFactory: (db: AppDatabase) => new CommunicationsTemplatesService(new CommunicationsTemplatesRepository(db)), inject: [DATABASE] },
    { provide: CommunicationsProvidersService, useFactory: (db: AppDatabase, secrets: ProviderSecrets) => new CommunicationsProvidersService(new CommunicationsProvidersRepository(db), secrets), inject: [DATABASE, PROVIDER_SECRETS] },
  ],
  exports: [CommunicationsService, CommunicationsLimitsService, INBOX_SERVICE],
})
export class CommunicationsModule {}
