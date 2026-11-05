// marketing-report.module.ts — composes the three marketing domains by importing their modules and
// injecting their services (reuse, not duplication).
import { ReviewsModule, ReviewsService } from '@aipowersalon/customers';
import { CampaignsModule, CampaignsService } from '@aipowersalon/communications';
import { SalonPromotionsModule, SalonPromotionsService } from '@aipowersalon/deals';
import { Module } from '@nestjs/common';
import { MarketingReportController } from './marketing-report.controller';
import { MarketingReportService } from './marketing-report.service';

@Module({
  imports: [CampaignsModule, SalonPromotionsModule, ReviewsModule],
  controllers: [MarketingReportController],
  providers: [
    { provide: MarketingReportService, useFactory: (c: CampaignsService, p: SalonPromotionsService, r: ReviewsService) => new MarketingReportService(c, p, r), inject: [CampaignsService, SalonPromotionsService, ReviewsService] },
  ],
  exports: [MarketingReportService],
})
export class MarketingReportModule {}
