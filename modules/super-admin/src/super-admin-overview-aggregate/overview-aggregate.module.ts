// overview-aggregate.module.ts — composes the existing Super Admin overview/platform/module services behind one
// read-only endpoint. Imports each feature module purely to reuse its exported service (no providers re-declared).
import { SuperAdminOverviewModule } from '../super-admin-overview/overview.module';
import { SuperAdminCheckinModule } from '../super-admin-checkin/super-admin-checkin.module';
import { SuperAdminMembershipsModule } from '../super-admin-memberships/super-admin-memberships.module';
import { SuperAdminLoyaltyModule } from '../super-admin-loyalty/super-admin-loyalty.module';
import { SuperAdminPlatformModule } from '../super-admin-platform/super-admin-platform.module';
import { SuperAdminQueueModule } from '../super-admin-queue/super-admin-queue.module';
import { SuperAdminStaffModule } from '../super-admin-staff/super-admin-staff.module';
import { Module } from '@nestjs/common';
import { OverviewAggregateController } from './overview-aggregate.controller';
import { OverviewAggregateService } from './overview-aggregate.service';

@Module({
  imports: [
    SuperAdminOverviewModule, SuperAdminPlatformModule, SuperAdminStaffModule, SuperAdminQueueModule,
    SuperAdminCheckinModule, SuperAdminMembershipsModule, SuperAdminLoyaltyModule,
  ],
  controllers: [OverviewAggregateController],
  providers: [OverviewAggregateService],
})
export class OverviewAggregateModule {}
