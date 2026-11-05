// call-intelligence.module.ts — Kysely repo when a Postgres handle exists, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { CallIntelligenceController } from './call-intelligence.controller';
import { CallIntelligenceService } from './call-intelligence.service';
import { InMemoryCallIntelRepo, type CallIntelRepo } from './call-intelligence.repository';
import { KyselyCallIntelRepo } from './call-intelligence.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export const CALL_INTEL_REPO = Symbol('CALL_INTEL_REPO');

@Module({
  controllers: [CallIntelligenceController],
  providers: [
    { provide: CALL_INTEL_REPO, useFactory: (db: AppDatabase): CallIntelRepo => (db ? new KyselyCallIntelRepo(db) : new InMemoryCallIntelRepo()), inject: [DATABASE] },
    { provide: CallIntelligenceService, useFactory: (repo: CallIntelRepo) => new CallIntelligenceService(repo), inject: [CALL_INTEL_REPO] },
  ],
  exports: [CallIntelligenceService],
})
export class CallIntelligenceModule {}
