// system-checks.module.ts — the shared read-only "Check … System" (extras arc, Nov 9 2026).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SystemChecksController } from './system-checks.controller';
import { SystemChecksService } from './system-checks.service';

@Module({
  controllers: [SystemChecksController],
  providers: [{ provide: SystemChecksService, useFactory: (db: AppDatabase) => new SystemChecksService(db), inject: [DATABASE] }],
})
export class SystemChecksModule {}
