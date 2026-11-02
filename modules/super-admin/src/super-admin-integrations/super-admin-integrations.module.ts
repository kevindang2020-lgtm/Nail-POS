// super-admin-integrations.module.ts — Integrations read endpoints + connection lifecycle (Add/OAuth/Refresh/
// Credentials/Test/Disable) + synchronization engine (enqueue/run/retry/drain). Optional DATABASE → repos.

import { SECRET_SEALERS, type SecretSealers } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminIntegrationsController } from './super-admin-integrations.controller';
import { SuperAdminIntegrationsService } from './super-admin-integrations.service';
import { KyselyIntegrationsRepo } from './super-admin-integrations.kysely.repository';
import { IntegrationLifecycleController } from './integration-lifecycle.controller';
import { IntegrationLifecycleService } from './integration-lifecycle.service';
import { IntegrationConnectionsRepo } from './integration-connections.kysely.repository';
import { IntegrationSyncController } from './integration-sync.controller';
import { SyncEngineService } from './sync-engine.service';
import { IntegrationSyncRepo } from './integration-sync.kysely.repository';
import { IntegrationWebhookInboundController, IntegrationWebhookAdminController } from './integration-webhook.controller';
import { WebhookIngestService } from './webhook-ingest.service';
import { IntegrationWebhookRepo } from './integration-webhook.kysely.repository';
import { ProviderReliabilityController } from './provider-reliability.controller';
import { ProviderReliabilityService } from './provider-reliability.service';
import { ProviderReliabilityRepo } from './provider-reliability.kysely.repository';
import { IntegrationSchedulerController } from './integration-scheduler.controller';
import { IntegrationSchedulerService } from './integration-scheduler.service';

@Module({
  controllers: [SuperAdminIntegrationsController, IntegrationLifecycleController, IntegrationSyncController, IntegrationWebhookInboundController, IntegrationWebhookAdminController, ProviderReliabilityController, IntegrationSchedulerController],
  providers: [
    {
      provide: SuperAdminIntegrationsService,
      useFactory: (db: AppDatabase) => new SuperAdminIntegrationsService(db ? new KyselyIntegrationsRepo(db) : undefined, db),
      inject: [DATABASE],
    },
    {
      provide: IntegrationLifecycleService,
      useFactory: (db: AppDatabase, sealers: SecretSealers) => new IntegrationLifecycleService(db ? new IntegrationConnectionsRepo(db, sealers.forPurpose('webhook')) : undefined, db),
      inject: [DATABASE, SECRET_SEALERS],
    },
    {
      provide: ProviderReliabilityService,
      useFactory: (db: AppDatabase) => new ProviderReliabilityService(db ? new ProviderReliabilityRepo(db) : undefined, db),
      inject: [DATABASE],
    },
    {
      provide: SyncEngineService,
      useFactory: (db: AppDatabase, reliability: ProviderReliabilityService, sealers: SecretSealers) => new SyncEngineService(db ? new IntegrationSyncRepo(db) : undefined, db ? new IntegrationConnectionsRepo(db, sealers.forPurpose('webhook')) : undefined, db, undefined, {}, reliability),
      inject: [DATABASE, ProviderReliabilityService, SECRET_SEALERS],
    },
    {
      provide: WebhookIngestService,
      useFactory: (db: AppDatabase, sealers: SecretSealers) => new WebhookIngestService(db ? new IntegrationWebhookRepo(db) : undefined, db ? new IntegrationConnectionsRepo(db, sealers.forPurpose('webhook')) : undefined, db),
      inject: [DATABASE, SECRET_SEALERS],
    },
    {
      provide: IntegrationSchedulerService,
      useFactory: (db: AppDatabase, sync: SyncEngineService, webhooks: WebhookIngestService, lifecycle: IntegrationLifecycleService) => new IntegrationSchedulerService(db, sync, webhooks, lifecycle),
      inject: [DATABASE, SyncEngineService, WebhookIngestService, IntegrationLifecycleService],
    },
  ],
  exports: [SuperAdminIntegrationsService, IntegrationLifecycleService, SyncEngineService, WebhookIngestService, ProviderReliabilityService, IntegrationSchedulerService],
})
export class SuperAdminIntegrationsModule {}
