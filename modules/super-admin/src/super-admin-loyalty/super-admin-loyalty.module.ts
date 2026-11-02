// super-admin-loyalty.module.ts — wires the read-only platform Loyalty Programs overview over the platform DB.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminLoyaltyService } from './super-admin-loyalty.service';
import { SuperAdminLoyaltyKyselyRepository } from './super-admin-loyalty.kysely.repository';
import { LoyaltyDashboardService } from './loyalty-dashboard.service';
import { LoyaltyDashboardRepository } from './loyalty-dashboard.repository';
import { LoyaltyActionsService } from './loyalty-actions.service';
import { LoyaltyConfigService } from './loyalty-config.service';
import { LoyaltySuspiciousService } from './loyalty-suspicious.service';
import { LoyaltyCorrectionsService } from './loyalty-corrections.service';
import { SuperAdminLoyaltyController } from './super-admin-loyalty.controller';

@Module({
  controllers: [SuperAdminLoyaltyController],
  providers: [
    {
      provide: SuperAdminLoyaltyService,
      useFactory: (db: AppDatabase) => new SuperAdminLoyaltyService(new SuperAdminLoyaltyKyselyRepository(db)),
      inject: [DATABASE],
    },
    {
      provide: LoyaltySuspiciousService,
      useFactory: (db: AppDatabase) => new LoyaltySuspiciousService(db as never),
      inject: [DATABASE],
    },
    {
      provide: LoyaltyCorrectionsService,
      useFactory: (db: AppDatabase) => new LoyaltyCorrectionsService(db as never),
      inject: [DATABASE],
    },
    {
      provide: LoyaltyDashboardService,
      useFactory: (db: AppDatabase, susp: LoyaltySuspiciousService) => new LoyaltyDashboardService(new LoyaltyDashboardRepository(db), susp),
      inject: [DATABASE, LoyaltySuspiciousService],
    },
    {
      provide: LoyaltyActionsService,
      useFactory: (db: AppDatabase, dash: LoyaltyDashboardService) => new LoyaltyActionsService(db as never, dash),
      inject: [DATABASE, LoyaltyDashboardService],
    },
    {
      provide: LoyaltyConfigService,
      useFactory: (db: AppDatabase) => new LoyaltyConfigService(db as never),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminLoyaltyService, LoyaltyDashboardService, LoyaltyActionsService, LoyaltyConfigService, LoyaltySuspiciousService, LoyaltyCorrectionsService],
})
export class SuperAdminLoyaltyModule {}
