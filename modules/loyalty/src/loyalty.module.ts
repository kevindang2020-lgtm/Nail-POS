// loyalty.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { InMemoryLoyaltyRepository, type LoyaltyRepositoryPort } from './loyalty.repository';
import { KyselyLoyaltyRepository } from './loyalty.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { GlobalRewardsController, SuperAdminGlobalRewardsController, GLOBAL_REWARDS_SERVICE } from './global-rewards/global-rewards.controller';
import { GlobalRewardsService } from './global-rewards/global-rewards.service';
import { GlobalRewardsRepository } from './global-rewards/global-rewards.repository';
import { TOKEN_FUNDING_PROVIDER, fundingProviderFromEnv, type TokenFundingProvider } from './global-rewards/token-funding-provider';
import { CustomerRewardsController, OwnerRewardsController } from './global-rewards/rewards-apps.controller';

@Module({
  controllers: [LoyaltyController, GlobalRewardsController, SuperAdminGlobalRewardsController, CustomerRewardsController, OwnerRewardsController],
  providers: [
    { provide: 'LoyaltyRepositoryPort', useFactory: (db: AppDatabase): LoyaltyRepositoryPort => (db ? new KyselyLoyaltyRepository(db) : new InMemoryLoyaltyRepository()), inject: [DATABASE] },   // writes now (rewards catalog), so the primary, not the read replica
    { provide: LoyaltyService, useFactory: (repo: LoyaltyRepositoryPort) => new LoyaltyService(repo), inject: ['LoyaltyRepositoryPort'] },
    // Global Loyalty & Rewards Network (LoyaltyTokens.pdf v1.0 + LoyaltyRules.pdf v2.0). No live funding provider exists:
    // the sandbox one only outside production with GLOBAL_REWARDS_SANDBOX_PROVIDER=on (token-funding-provider.ts).
    { provide: TOKEN_FUNDING_PROVIDER, useFactory: (): TokenFundingProvider | null => fundingProviderFromEnv() },
    { provide: GLOBAL_REWARDS_SERVICE, inject: [DATABASE, TOKEN_FUNDING_PROVIDER, { token: REALTIME, optional: true }],
      useFactory: (db: AppDatabase, provider: TokenFundingProvider | null, rt?: RealtimeEmitter) => (db ? new GlobalRewardsService(new GlobalRewardsRepository(db), provider, rt ?? null) : null) },
  ],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
