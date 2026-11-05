// overview-aggregate.service.ts — read-only Super Admin Overview aggregation. Composes the existing platform-level
// services into a single payload so the Overview screen makes ONE request instead of eleven. It re-uses (never
// re-implements) the canonical aggregations: the overview state, the platform device/payment/branch/service/appointment
// summaries, and the staff/queue/check-in/membership/loyalty module overviews. Every source is fail-soft — a rejected
// dependency yields null for that section, never a thrown request or a fabricated figure.
import { SuperAdminOverviewService } from '../super-admin-overview/overview.service';
import { SuperAdminCheckinService } from '../super-admin-checkin/super-admin-checkin.service';
import { SuperAdminMembershipsService } from '../super-admin-memberships/super-admin-memberships.service';
import { SuperAdminLoyaltyService } from '../super-admin-loyalty/super-admin-loyalty.service';
import { type Range } from '../super-admin-overview/overview.dto';
import { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import { SuperAdminQueueService } from '../super-admin-queue/super-admin-queue.service';
import { SuperAdminStaffService } from '../super-admin-staff/super-admin-staff.service';
import { Injectable } from '@nestjs/common';
import type { OverviewScope } from '@aipowersalon/database';

export interface AggCtx { userId?: string; email?: string; ip?: string }

// Resolve a promise to its value, or null on rejection — keeps the per-field type (unlike a single allSettled array).
const settle = <T>(p: Promise<T>): Promise<T | null> => p.then((v) => v).catch(() => null);

@Injectable()
export class OverviewAggregateService {
  constructor(
    private readonly overview: SuperAdminOverviewService,
    private readonly platform: SuperAdminPlatformService,
    private readonly staff: SuperAdminStaffService,
    private readonly queue: SuperAdminQueueService,
    private readonly checkin: SuperAdminCheckinService,
    private readonly memberships: SuperAdminMembershipsService,
    private readonly loyalty: SuperAdminLoyaltyService,
  ) {}

  async aggregate(ctx: AggCtx, range: Range, scope?: OverviewScope) {
    // Phase 1: tenant scope applies to the five module overviews, the platform sections' Overview-consumed fields,
    // and the overview state's operational facts. The overview state's governance KPIs (total tenants, pending
    // applications, support tickets) and the alerts derived from them stay platform-wide by design.
    const sid = scope?.tenantId ?? undefined;
    const [state, devices, payments, branches, services, appts, staff, queue, checkin, memberships, loyalty, tenantsLive, revenueHourly] = await Promise.all([
      settle(this.overview.getState(range, 'SUPER_ADMIN', scope)),
      settle(this.platform.platformDevices({ tenantId: sid })),
      settle(this.platform.platformPayments({ tenantId: sid })),
      settle(this.platform.branchesDashboard(scope)),
      settle(this.platform.platformServices({ tenantId: sid })),
      settle(this.platform.platformAppointments({ tenantId: sid })),
      settle(this.staff.getOverview(ctx, { scope })),
      settle(this.queue.getOverview(ctx, { scope })),
      settle(this.checkin.getOverview(ctx, { scope })),
      settle(this.memberships.getOverview(ctx, { scope })),
      settle(this.loyalty.getOverview(ctx, { scope })),
      settle(this.platform.tenantsLiveMonitor(scope)),
      settle(this.platform.revenueHourlyTodayYesterday(scope)),
    ]);
    return {
      ok: true as const,
      range,
      scoped: !!scope?.tenantId,
      state, devices, payments, branches, services, appts, staff, queue, checkin, memberships, loyalty, tenantsLive, revenueHourly,
      generatedAt: new Date().toISOString(),
    };
  }
}
