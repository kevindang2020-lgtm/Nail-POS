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

@Module({
  controllers: [CommunicationsController, SuperAdminCommunicationsController],
  providers: [
    { provide: 'CommunicationsRepositoryPort', useFactory: (db: AppDatabase): CommunicationsRepositoryPort => (db ? new KyselyCommunicationsRepository(db) : new InMemoryCommunicationsRepository()), inject: [DATABASE] },
    { provide: CommunicationsService, useFactory: (repo: CommunicationsRepositoryPort, audit: AuditService) => new CommunicationsService(repo, audit), inject: ['CommunicationsRepositoryPort', AuditService] },
    { provide: CommunicationsActivityService, useFactory: (db: AppDatabase) => new CommunicationsActivityService(db as any), inject: [DATABASE] },
    { provide: CommunicationsOverviewService, useFactory: (db: AppDatabase) => new CommunicationsOverviewService(new CommunicationsOverviewRepository(db as any)), inject: [DATABASE] },
    { provide: CommunicationsAnnouncementsService, useFactory: (db: AppDatabase) => new CommunicationsAnnouncementsService(new CommunicationsAnnouncementsRepository(db as any)), inject: [DATABASE] },
    { provide: CommunicationsLimitsService, useFactory: (db: AppDatabase) => new CommunicationsLimitsService(new CommunicationsLimitsRepository(db as any)), inject: [DATABASE] },
    { provide: CommunicationsTemplatesService, useFactory: (db: AppDatabase) => new CommunicationsTemplatesService(new CommunicationsTemplatesRepository(db as any)), inject: [DATABASE] },
    { provide: CommunicationsProvidersService, useFactory: (db: AppDatabase, secrets: ProviderSecrets) => new CommunicationsProvidersService(new CommunicationsProvidersRepository(db as any), secrets), inject: [DATABASE, PROVIDER_SECRETS] },
  ],
  exports: [CommunicationsService, CommunicationsLimitsService],
})
export class CommunicationsModule {}
