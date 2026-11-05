// system-health.module.ts — binds the Kysely DB probe when a Postgres handle exists, else the in-memory fallback.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService } from './system-health.service';
import { KyselyHealthDb, InMemoryHealthDb } from './system-health.data';

@Module({
  controllers: [SystemHealthController],
  providers: [
    { provide: SystemHealthService, inject: [DATABASE], useFactory: (db: AppDatabase) => new SystemHealthService(db ? new KyselyHealthDb(db) : new InMemoryHealthDb()) },
  ],
})
export class SystemHealthModule {}
