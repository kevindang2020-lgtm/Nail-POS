// ai-marketing.module.ts — AI Marketing Assistant (read layer). Kysely-backed when Postgres present, else
// in-memory (dev/offline/tests). DISTINCT from CampaignsModule / PromotionsModule / SalonPromotionsModule —
// this module only READS existing data and composes recommendations; it owns no new tables in slice 1.
import { AiModule } from '../ai/ai.module';
import { AiPlatform } from '../ai/ai-platform';
import { marketingDraftAdapter } from '../ai/ai-platform.adapters';
import { KyselyAiAccessRepo, KyselyAiUsageLogger } from '../ai/ai-access.kysely.repository';
import { CampaignsModule, CampaignsService } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { AiMarketingController } from './ai-marketing.controller';
import { AiMarketingService } from './ai-marketing.service';
import { AiMarketingContentService, type AiMarketingDraftPort } from './ai-marketing-content.service';
import { AiMarketingCampaignService } from './ai-marketing-campaign.service';
import { InMemoryAiMarketingRepository, type AiMarketingRepositoryPort } from './ai-marketing.repository';
import { KyselyAiMarketingRepository } from './ai-marketing.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { KyselyPlanStore, InMemoryPlanStore, type PlanStorePort } from './ai-marketing-send.adapters';
import { KyselyCampaignConversions, InMemoryCampaignConversions, type CampaignConversionsPort } from './ai-marketing-conversions';

@Module({
  imports: [AiModule, CampaignsModule], // reuse the existing campaign lifecycle (create/transition/audit), no duplication
  controllers: [AiMarketingController],
  providers: [
    {
      provide: 'AiMarketingRepositoryPort',
      useFactory: (db: AppDatabase): AiMarketingRepositoryPort =>
        db ? new KyselyAiMarketingRepository(db) : new InMemoryAiMarketingRepository(),
      inject: [DATABASE_READ],
    },
    {
      provide: AiMarketingService,
      useFactory: (repo: AiMarketingRepositoryPort) => new AiMarketingService(repo),
      inject: ['AiMarketingRepositoryPort'],
    },
    // Content generation REUSES the existing provider layer (Mock/OpenAI/Anthropic/Gemini) — no second client.
    {
      // Constitution 10 §6/§92. History: this once held a raw AiGatewayService (no subscription check, no usage
      // row — a cancelled tenant kept generating drafts for free, on no AI Usage screen), then GatedAiCompletion.
      // Phase 23 completes the move to AiPlatform.execute('marketing.content_draft'), which adds prompt
      // versioning, routing and schema validation on top of the entitlement and usage GatedAiCompletion gave it.
      //
      // The no-database branch used to return the RAW gateway while its comment claimed it was "left unbound
      // rather than silently allowing a paid call". It was not — it was the last ungated provider path in the
      // tree. The platform now decides: with no database its access repo default-denies, which is what the
      // comment always meant.
      provide: 'AiMarketingCompletionPort',
      useFactory: (platform: AiPlatform) => marketingDraftAdapter(platform),
      inject: [AiPlatform],
    },
    {
      provide: AiMarketingContentService,
      useFactory: (port: AiMarketingDraftPort) => new AiMarketingContentService(port),
      inject: ['AiMarketingCompletionPort'],
    },
    // Send plan store (message body + approved audience) over migration 321; in-memory when no DB.
    {
      provide: 'AiMarketingPlanStore',
      useFactory: (db: AppDatabase): PlanStorePort => (db ? new KyselyPlanStore(db) : new InMemoryPlanStore()),
      inject: [DATABASE_READ],
    },
    // Per-campaign booking attribution from conversion events (migration 322); in-memory when no DB.
    {
      provide: 'AiMarketingConversions',
      useFactory: (db: AppDatabase): CampaignConversionsPort => (db ? new KyselyCampaignConversions(db) : new InMemoryCampaignConversions()),
      inject: [DATABASE_READ],
    },
    // Approval spine drives the existing CampaignsService (permission + state machine + audit reused).
    {
      provide: AiMarketingCampaignService,
      useFactory: (campaigns: CampaignsService, planStore: PlanStorePort, conversions: CampaignConversionsPort) =>
        new AiMarketingCampaignService(campaigns, planStore, conversions),
      inject: [CampaignsService, 'AiMarketingPlanStore', 'AiMarketingConversions'],
    },
  ],
  exports: [AiMarketingService, AiMarketingContentService, AiMarketingCampaignService],
})
export class AiMarketingModule {}
