import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { InMemoryLogsRepository, type LogsRepositoryPort } from './logs.repository';
import { KyselyLogsRepository } from './logs.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [LogsController],
  providers: [
    { provide: 'LogsRepositoryPort', useFactory: (db: AppDatabase): LogsRepositoryPort => (db ? new KyselyLogsRepository(db as any) : new InMemoryLogsRepository()), inject: [DATABASE] },
    { provide: LogsService, useFactory: (repo: LogsRepositoryPort) => new LogsService(repo), inject: ['LogsRepositoryPort'] },
  ],
  exports: [LogsService],
})
export class LogsModule {}
