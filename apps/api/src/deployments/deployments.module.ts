import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { InMemoryDeploymentsRepository, type DeploymentsRepositoryPort } from './deployments.repository';
import { KyselyDeploymentsRepository } from './deployments.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { LogsModule } from '../logs/logs.module';
import { LogsService } from '../logs/logs.service';
import { ApiWebhooksModule } from '../api-webhooks/api-webhooks.module';
import { WebhookDispatchService } from '../api-webhooks/webhook-dispatch.service';

@Module({
  imports: [LogsModule, ApiWebhooksModule],
  controllers: [DeploymentsController],
  providers: [
    { provide: 'DeploymentsRepositoryPort', useFactory: (db: AppDatabase): DeploymentsRepositoryPort => (db ? new KyselyDeploymentsRepository(db as any) : new InMemoryDeploymentsRepository()), inject: [DATABASE] },
    { provide: DeploymentsService, useFactory: (repo: DeploymentsRepositoryPort, logs: LogsService, events: WebhookDispatchService) => new DeploymentsService(repo, undefined, logs, events), inject: ['DeploymentsRepositoryPort', LogsService, WebhookDispatchService] },
  ],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
