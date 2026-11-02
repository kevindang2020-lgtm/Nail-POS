// tenant-ai.module.ts — wires the tenant-owner AI surface. Kysely repo when a DB handle exists, in-memory otherwise.
import { Module } from '@nestjs/common';
import { TenantAiController } from './tenant-ai.controller';
import { TenantAiService } from './tenant-ai.service';
import { InMemoryTenantAiRepo, KyselyTenantAiRepo, type TenantAiRepo } from './tenant-ai.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AiUsageScreenController, AI_USAGE_SCREEN_REPOSITORY } from './ai-usage-screen.controller';
import { AiUsageScreenRepository } from './ai-usage-screen.repository';
import { SetupHealthController, ReleaseEvidenceController, SetupHealthNightlyScheduler, SETUP_HEALTH_REPOSITORY } from '../setup-health/setup-health.controller';
import { SetupHealthRepository } from '../setup-health/setup-health.repository';

@Module({
  controllers: [TenantAiController, AiUsageScreenController, SetupHealthController, ReleaseEvidenceController],   // + Setup Health (Four-Module Completion Guide)   // + AI Usage & Limits Complete Build Guide (Oct 30 2026)
  providers: [
    { provide: SETUP_HEALTH_REPOSITORY, useFactory: (db: AppDatabase) => (db ? new SetupHealthRepository(db) : null), inject: [DATABASE] },
    SetupHealthNightlyScheduler,
    { provide: AI_USAGE_SCREEN_REPOSITORY, useFactory: (db: AppDatabase) => (db ? new AiUsageScreenRepository(db) : null), inject: [DATABASE] },
    { provide: 'TenantAiRepo', useFactory: (db: AppDatabase): TenantAiRepo => (db ? new KyselyTenantAiRepo(db) : new InMemoryTenantAiRepo()), inject: [DATABASE] },
    { provide: TenantAiService, useFactory: (repo: TenantAiRepo, db: AppDatabase) => new TenantAiService(repo, db ?? null), inject: ['TenantAiRepo', DATABASE] },
  ],
  exports: [TenantAiService],
})
export class TenantAiModule {}
