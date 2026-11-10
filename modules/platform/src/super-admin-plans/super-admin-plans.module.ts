// super-admin-plans.module.ts — wires the Plans controller/service + the tenant Entitlements controller/service. Kysely
// adapters when a DB handle exists, else empty in-memory adapters (honest zeros for reads; writes refuse without a DB).
import { Module } from '@nestjs/common';
import { SuperAdminPlansController } from './plans.controller';
import { SuperAdminPlansService } from './plans.service';
import { InMemoryPlansRepository, type PlansDataPort } from './plans.repository';
import { KyselyPlansRepository } from './plans.kysely.repository';
import { EntitlementsController } from './entitlements.controller';
import { EntitlementsService } from './entitlements.service';
import { InMemoryEntitlementsRepo, type EntitlementsRepo } from './entitlements.repository';
import { KyselyEntitlementsRepo } from './entitlements.kysely.repository';
import { OverageController } from './overage.controller';
import { OverageService } from './overage.service';
import { InMemoryOverageRepo, type OverageRepo } from './overage.repository';
import { KyselyOverageRepo } from './overage.kysely.repository';
import { SubscriptionChangeController } from './subscription-change.controller';
import { SubscriptionChangeService } from './subscription-change.service';
import { InMemorySubscriptionChangeRepo, type SubscriptionChangeRepo } from './subscription-change.repository';
import { KyselySubscriptionChangeRepo } from './subscription-change.kysely.repository';
import { TenantOffersController } from './tenant-offers.controller';
import { TenantOffersService } from './tenant-offers.service';
import { InMemoryTenantOffersRepo, type TenantOffersRepo } from './tenant-offers.repository';
import { KyselyTenantOffersRepo } from './tenant-offers.kysely.repository';
import { GrandfatherController } from './grandfather.controller';
import { GrandfatherService } from './grandfather.service';
import { InMemoryGrandfatherRepo, type GrandfatherRepo } from './grandfather.repository';
import { KyselyGrandfatherRepo } from './grandfather.kysely.repository';
import { UtilizationController } from './utilization.controller';
import { ScheduledChangesController } from './scheduled-changes.controller';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';
import { UsageAlertSweep, UsageAlertsController } from './usage-alerts';
import { PlatformApprovals, PlatformApprovalsController } from '../platform-approvals/platform-approvals';
import { FeatureRegistry, FeatureRegistryController } from './feature-registry';
import { ENTITLEMENT_SERVICE, type EntitlementService as FeatureGate } from '@aipowersalon/permissions';
import { invalidateOnWrite } from './plan-feature-source';
import { PlanLinksController } from './plan-links';

@Module({
  controllers: [PlanLinksController, FeatureRegistryController, PlatformApprovalsController, UsageAlertsController, SuperAdminPlansController, EntitlementsController, OverageController, SubscriptionChangeController, TenantOffersController, GrandfatherController, UtilizationController, ScheduledChangesController],
  providers: [
    // Constitution 7 §119 — maker/checker; 'plan.limit_override' is the first registered action
    { provide: PlatformApprovals, useFactory: (db: AppDatabase, ent: EntitlementsService) => {
        const a = new PlatformApprovals(db);
        a.register({ key: 'plan.limit_override', label: 'Tenant plan-limit override', requiredPermission: 'super_admin.plans.manage',
          execute: (p: any, actor) => ent.setLimitOverride(String(p?.tenantId), p?.input ?? {}, { userId: actor.userId ?? undefined, role: 'SUPER_ADMIN', permissions: [...actor.permissions] } as any) });
        return a;
      }, inject: [DATABASE, EntitlementsService] },
    // Batch C decision 1 (Nov 6 2026): the same instance by token, so loyalty registers its approvable actions without importing platform
    { provide: 'PLATFORM_APPROVALS', useExisting: PlatformApprovals },
    // Constitution 7 §30–§33: feature registry + resolver (platform layers over entitlements)
    { provide: FeatureRegistry, useFactory: (db: AppDatabase, ent: EntitlementsService) => new FeatureRegistry(db, ent), inject: [DATABASE, EntitlementsService] },
    UsageAlertSweep,   // Constitution 7 §41 — hourly, gated, once per tenant/metric/threshold/month
    { provide: 'PlansDataPort', useFactory: (db: AppDatabase): PlansDataPort => (db ? new KyselyPlansRepository(db) : new InMemoryPlansRepository()), inject: [DATABASE] },
    { provide: SuperAdminPlansService, useFactory: (repo: PlansDataPort) => new SuperAdminPlansService(repo), inject: ['PlansDataPort'] },
    { provide: 'EntitlementsRepo', useFactory: (db: AppDatabase): EntitlementsRepo => (db ? new KyselyEntitlementsRepo(db) : new InMemoryEntitlementsRepo()), inject: [DATABASE] },
    // BUILD_PLAN Phase 12 (#13): an override / plan / add-on write drops the salon's cached feature-gate answers at once
    { provide: EntitlementsService, useFactory: (repo: EntitlementsRepo, cache: TenantCache, gate?: FeatureGate) => invalidateOnWrite(new EntitlementsService(repo, cache), gate, { setFeatureOverride: 0 }), inject: ['EntitlementsRepo', TENANT_CACHE, { token: ENTITLEMENT_SERVICE, optional: true }] },
    { provide: 'OverageRepo', useFactory: (db: AppDatabase): OverageRepo => (db ? new KyselyOverageRepo(db) : new InMemoryOverageRepo()), inject: [DATABASE] },
    { provide: OverageService, useFactory: (repo: OverageRepo, ent: EntitlementsService) => new OverageService(repo, ent), inject: ['OverageRepo', EntitlementsService] },
    { provide: 'SubscriptionChangeRepo', useFactory: (db: AppDatabase): SubscriptionChangeRepo => (db ? new KyselySubscriptionChangeRepo(db) : new InMemorySubscriptionChangeRepo()), inject: [DATABASE] },
    { provide: SubscriptionChangeService, useFactory: (repo: SubscriptionChangeRepo, gate?: FeatureGate) => invalidateOnWrite(new SubscriptionChangeService(repo), gate, { commit: 1, processScheduled: -1 }), inject: ['SubscriptionChangeRepo', { token: ENTITLEMENT_SERVICE, optional: true }] },
    { provide: 'TenantOffersRepo', useFactory: (db: AppDatabase): TenantOffersRepo => (db ? new KyselyTenantOffersRepo(db) : new InMemoryTenantOffersRepo()), inject: [DATABASE] },
    { provide: TenantOffersService, useFactory: (repo: TenantOffersRepo, gate?: FeatureGate) => invalidateOnWrite(new TenantOffersService(repo), gate, { assignAddOn: 1, cancelAddOn: 1, startTrial: 1 }), inject: ['TenantOffersRepo', { token: ENTITLEMENT_SERVICE, optional: true }] },
    { provide: 'GrandfatherRepo', useFactory: (db: AppDatabase): GrandfatherRepo => (db ? new KyselyGrandfatherRepo(db) : new InMemoryGrandfatherRepo()), inject: [DATABASE] },
    { provide: GrandfatherService, useFactory: (repo: GrandfatherRepo) => new GrandfatherService(repo), inject: ['GrandfatherRepo'] },
  ],
  exports: [SuperAdminPlansService, EntitlementsService, OverageService, SubscriptionChangeService, TenantOffersService, GrandfatherService],
})
export class SuperAdminPlansModule {}
