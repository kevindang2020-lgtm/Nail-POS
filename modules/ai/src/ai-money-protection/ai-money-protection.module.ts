// ai-money-protection.module.ts — wires the deterministic detection foundation. Kysely repo when a DB handle is
// present, in-memory otherwise (dev/offline/tests). Reads use the primary handle for read-after-write correctness
// on newly-created alerts.
import { AiModule } from '../ai/ai.module';
import { AiPlatform } from '../ai/ai-platform';
import { moneyExplainAdapter } from '../ai/ai-platform.adapters';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MoneyProtectionController } from './ai-money-protection.controller';
import { MoneyProtectionService } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository, type MoneyProtectionRepositoryPort } from './ai-money-protection.repository';
import { KyselyMoneyProtectionRepository } from './ai-money-protection.kysely.repository';
import { InMemoryInvestigationRepository, type MoneyProtectionInvestigationRepositoryPort } from './ai-money-protection-investigations.repository';
import { KyselyInvestigationRepository } from './ai-money-protection-investigations.kysely.repository';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { MoneyProtectionExplainService } from './ai-money-protection-explain.service';
import { InMemoryEntitlement, KyselyEntitlement, type EntitlementPort } from './ai-money-protection-entitlement';
import { moneyProtectionFlags } from './ai-money-protection-flags';

@Module({
  imports: [AiModule],
  controllers: [MoneyProtectionController],
  providers: [
    {
      provide: 'MoneyProtectionRepositoryPort',
      useFactory: (db: AppDatabase): MoneyProtectionRepositoryPort =>
        db ? new KyselyMoneyProtectionRepository(db) : new InMemoryMoneyProtectionRepository(),
      inject: [DATABASE],
    },
    {
      provide: 'MoneyProtectionInvestigationRepositoryPort',
      useFactory: (db: AppDatabase): MoneyProtectionInvestigationRepositoryPort =>
        db ? new KyselyInvestigationRepository(db) : new InMemoryInvestigationRepository(),
      inject: [DATABASE],
    },
    {
      provide: 'MoneyProtectionEntitlementPort',
      useFactory: (db: AppDatabase): EntitlementPort => db ? new KyselyEntitlement(db) : new InMemoryEntitlement(),
      inject: [DATABASE],
    },
    {
      provide: MoneyProtectionService,
      useFactory: (repo: MoneyProtectionRepositoryPort, ent: EntitlementPort) => new MoneyProtectionService(repo, ent, moneyProtectionFlags()),
      inject: ['MoneyProtectionRepositoryPort', 'MoneyProtectionEntitlementPort'],
    },
    {
      provide: InvestigationService,
      useFactory: (invRepo: MoneyProtectionInvestigationRepositoryPort, alertRepo: MoneyProtectionRepositoryPort) => new InvestigationService(invRepo, alertRepo),
      inject: ['MoneyProtectionInvestigationRepositoryPort', 'MoneyProtectionRepositoryPort'],
    },
    {
      provide: MoneyProtectionExplainService,
      // Constitution 10 §6: through the platform, which enforces entitlement, routing, validation and usage.
      useFactory: (alertRepo: MoneyProtectionRepositoryPort, platform: AiPlatform) => new MoneyProtectionExplainService(alertRepo, moneyExplainAdapter(platform)),
      inject: ['MoneyProtectionRepositoryPort', AiPlatform],
    },
  ],
  exports: [MoneyProtectionService, InvestigationService, MoneyProtectionExplainService],
})
export class MoneyProtectionModule {}
