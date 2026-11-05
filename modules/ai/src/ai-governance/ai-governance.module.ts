import { AuditModule, AuditService } from '@aipowersalon/audit';
import { Module } from '@nestjs/common';
import { AiGovernanceController } from './ai-governance.controller';
import { AiGovernanceService } from './ai-governance.service';
import { InMemoryAiGovernanceRepo, type AiGovernanceRepo } from './ai-governance.repository';
import { KyselyAiGovernanceRepo } from './ai-governance.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AI_PACKAGES } from '../ai/ai-catalog';

export const AI_GOVERNANCE_REPO = Symbol('AI_GOVERNANCE_REPO');
const assistantKeys = () => AI_PACKAGES.map((p: any) => p.code);

@Module({
  imports: [AuditModule],
  controllers: [AiGovernanceController],
  providers: [
    { provide: AI_GOVERNANCE_REPO, useFactory: (db: AppDatabase): AiGovernanceRepo => (db ? new KyselyAiGovernanceRepo(db) : new InMemoryAiGovernanceRepo()), inject: [DATABASE] },
    { provide: AiGovernanceService, useFactory: (repo: AiGovernanceRepo, audit: AuditService) => new AiGovernanceService(repo, assistantKeys, audit), inject: [AI_GOVERNANCE_REPO, AuditService] },
  ],
  exports: [AiGovernanceService],
})
export class AiGovernanceModule {}
