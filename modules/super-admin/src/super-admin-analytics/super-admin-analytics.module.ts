// super-admin-analytics.module.ts — wires the consolidated Analytics endpoint + audited export. It owns
// no new repositories: it composes the already-exported platform + memberships services, plus the shared
// DATABASE handle (optional) so exports can be audited. No duplicated aggregation / cross-tenant SQL.

import { SuperAdminMembershipsModule } from '../super-admin-memberships/super-admin-memberships.module';
import { SuperAdminMembershipsService } from '../super-admin-memberships/super-admin-memberships.service';
import { SuperAdminPlatformModule } from '../super-admin-platform/super-admin-platform.module';
import { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminAnalyticsController } from './super-admin-analytics.controller';
import { SuperAdminAnalyticsService } from './super-admin-analytics.service';
import { KyselyAnalyticsGapRepo } from './super-admin-analytics.kysely.repository';

@Module({
  imports: [SuperAdminPlatformModule, SuperAdminMembershipsModule],
  controllers: [SuperAdminAnalyticsController],
  providers: [
    {
      provide: SuperAdminAnalyticsService,
      useFactory: (platform: SuperAdminPlatformService, memberships: SuperAdminMembershipsService, db: AppDatabase) =>
        new SuperAdminAnalyticsService(platform, memberships, db || undefined, db ? new KyselyAnalyticsGapRepo(db) : undefined),
      inject: [SuperAdminPlatformService, SuperAdminMembershipsService, DATABASE],
    },
  ],
  exports: [SuperAdminAnalyticsService],
})
export class SuperAdminAnalyticsModule {}
