// super-admin-ai.module.ts — wires the Super-Admin AI subscription manager. Kysely repo + audit when a DB exists,
// in-memory otherwise.
import { Module } from '@nestjs/common';
import { AiAdminController } from './ai-admin.controller';
import { AiAdminService } from './ai-admin.service';
import { AiPlansAdminController } from './ai-plans-admin.controller';
import { AiPlansAdminService } from './ai-plans-admin.service';
import { InMemoryAiAdminRepo, KyselyAiAdminRepo, type AiAdminRepo } from './ai-admin.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [AiAdminController, AiPlansAdminController],
  providers: [
    { provide: 'AiAdminRepo', useFactory: (db: AppDatabase): AiAdminRepo => (db ? new KyselyAiAdminRepo(db) : new InMemoryAiAdminRepo()), inject: [DATABASE] },
    { provide: AiAdminService, useFactory: (repo: AiAdminRepo, db: AppDatabase) => new AiAdminService(repo, db ?? null), inject: ['AiAdminRepo', DATABASE] },
    { provide: AiPlansAdminService, useFactory: (db: AppDatabase, repo: AiAdminRepo) => new AiPlansAdminService(db ?? null, repo ?? null), inject: [DATABASE, 'AiAdminRepo'] },
  ],
  exports: [AiAdminService, AiPlansAdminService],
})
export class SuperAdminAiModule {}
