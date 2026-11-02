// marketing-growth.module.ts — Marketing & Growth (Oct 30 2026). Reuses RetentionRepository (salon-local periods +
// authorized branch scope) and a READ-ONLY CampaignCenter (overview / list — its launch path is never reachable from here:
// the limits preflight it would need refuses).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { RetentionRepository } from '@aipowersalon/customers';
import { CampaignCenter } from '@aipowersalon/communications';
import { MarketingGrowthController, MARKETING_GROWTH_REPOSITORY } from './marketing-growth.controller';
import { MarketingGrowthRepository } from './marketing-growth.repository';

const readOnly = async () => { throw new Error('Marketing & Growth is read-only: it never launches a campaign.'); };

@Module({
  controllers: [MarketingGrowthController],
  providers: [
    { provide: MARKETING_GROWTH_REPOSITORY, inject: [DATABASE],
      useFactory: (db: AppDatabase) => (db ? new MarketingGrowthRepository(db, new RetentionRepository(db), new CampaignCenter(db, readOnly)) : null) },
  ],
})
export class MarketingGrowthModule {}
