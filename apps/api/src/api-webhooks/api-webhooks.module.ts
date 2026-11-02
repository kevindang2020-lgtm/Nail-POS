// api-webhooks.module.ts — API keys + webhooks controllers + service + repository. Kysely adapter when a Postgres
// handle exists, else in-memory (dev/offline/tests default) — same pattern as the other tenant modules.
import { Module } from '@nestjs/common';
import { ApiKeysController, WebhooksController } from './api-webhooks.controller';
import { ApiWebhooksService } from './api-webhooks.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { InMemoryApiWebhooksRepository, type ApiWebhooksRepositoryPort } from './api-webhooks.repository';
import { KyselyApiWebhooksRepository } from './api-webhooks.kysely.repository';
import { InMemoryWebhookDeliveriesRepository, type WebhookDeliveriesRepositoryPort } from './webhook-deliveries.repository';
import { KyselyWebhookDeliveriesRepository } from './webhook-deliveries.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { LogsModule } from '../logs/logs.module';
import { LogsService } from '../logs/logs.service';

@Module({
  imports: [LogsModule],
  controllers: [ApiKeysController, WebhooksController],
  providers: [
    { provide: 'ApiWebhooksRepositoryPort', useFactory: (db: AppDatabase): ApiWebhooksRepositoryPort => (db ? new KyselyApiWebhooksRepository(db as any) : new InMemoryApiWebhooksRepository()), inject: [DATABASE] },
    { provide: 'WebhookDeliveriesRepositoryPort', useFactory: (db: AppDatabase): WebhookDeliveriesRepositoryPort => (db ? new KyselyWebhookDeliveriesRepository(db as any) : new InMemoryWebhookDeliveriesRepository()), inject: [DATABASE] },
    { provide: ApiWebhooksService, useFactory: (repo: ApiWebhooksRepositoryPort, logs: LogsService) => new ApiWebhooksService(repo, undefined, undefined, logs), inject: ['ApiWebhooksRepositoryPort', LogsService] },
    { provide: WebhookDispatchService, useFactory: (repo: ApiWebhooksRepositoryPort, del: WebhookDeliveriesRepositoryPort, logs: LogsService) => new WebhookDispatchService(repo, del, undefined, undefined, logs), inject: ['ApiWebhooksRepositoryPort', 'WebhookDeliveriesRepositoryPort', LogsService] },
  ],
  exports: [ApiWebhooksService, WebhookDispatchService],
})
export class ApiWebhooksModule {}
