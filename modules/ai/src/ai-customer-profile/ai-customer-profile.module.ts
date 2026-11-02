// ai-customer-profile.module.ts — wires the read-only AI Customer Profile Assistant. It REUSES CustomersService and
// ServicesService (via their modules) rather than touching the DB directly, so tenant/branch scoping and audit are
// inherited from the authoritative modules. The tenant-scoped summary cache is Redis-backed when REDIS_URL is set
// (cross-instance correctness) and in-memory otherwise — the same seam AiCenter uses for the Copilot cache.
// Exported so AI Center / Reception Copilot share one customer-intelligence layer (spec §25).
import { RedisCache, makeCacheRedis } from '../cache/cache-redis';
import { type CachePort } from '../cache/cache-port';
import { CustomersModule, CustomersService } from '@aipowersalon/customers';
import { ServicesModule, ServicesService } from '@aipowersalon/catalog';
import { Module } from '@nestjs/common';
import { AiCustomerProfileController } from './ai-customer-profile.controller';
import { CustomerIntelligenceCenter } from './customer-intelligence-center';
import { CustomerIntelligenceCenterController, CUSTOMER_INTELLIGENCE_CENTER } from './customer-intelligence-center.controller';
import { ChurnWatchCenter } from './churn-watch-center';
import { ChurnWatchCenterController, CHURN_WATCH_CENTER } from './churn-watch-center.controller';
import { RebookingCenter } from './rebooking-center';
import { RebookingCenterController, REBOOKING_CENTER } from './rebooking-center.controller';
import { AiCustomerProfileService, DefaultProfileSettings, DefaultCallSummary, type ProfileSettingsPort, type CallSummaryPort } from './ai-customer-profile.service';
import { KyselyCallSummary } from './ai-customer-profile.call-summary.kysely';
import { AiCustomerProfileScanScheduler } from './ai-customer-profile-scan.scheduler';
import { KyselyProfileSettings } from './ai-customer-profile.settings.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { ProfileCache } from './ai-customer-profile.cache';
import { InMemoryProfileMetrics, RedisProfileMetrics, makeMetricsRedis, type ProfileMetrics } from './ai-customer-profile.metrics';
import { AuditService } from '@aipowersalon/audit';
import { makeIoredis } from '@aipowersalon/cache';

// Cross-instance summary cache: Redis when REDIS_URL is set, else null → the service falls back to a per-process
// in-memory cache. Short TTL bounds staleness; invalidateTenant() bumps the tenant namespace version.
function makeProfileCache(): CachePort | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try { return new RedisCache(makeCacheRedis(makeIoredis(url, 'ai') as any), { prefix: process.env.CACHE_PREFIX || 'aps:cache:' }); } catch { return null; }
}

@Module({
  imports: [CustomersModule, ServicesModule],
  controllers: [AiCustomerProfileController, CustomerIntelligenceCenterController, ChurnWatchCenterController, RebookingCenterController],   // + Customer Intelligence guide (Nov 1 2026)
  providers: [
    { provide: 'PROFILE_CACHE', useFactory: makeProfileCache },
    // DB-backed settings (persistent overrides + emergency kill switches) when Postgres is present; else read-only defaults.
    { provide: 'PROFILE_SETTINGS', useFactory: (db: AppDatabase): ProfileSettingsPort => (db ? new KyselyProfileSettings(db) : new DefaultProfileSettings()), inject: [DATABASE] },
    { provide: 'PROFILE_METRICS', useFactory: (): ProfileMetrics => {
      const url = process.env.REDIS_URL;
      if (url) { try { return new RedisProfileMetrics(makeMetricsRedis(makeIoredis(url, 'ai') as any), { prefix: process.env.CACHE_PREFIX || 'aps:cache:' }); } catch { /* fall through */ } }
      return new InMemoryProfileMetrics();
    } },
    { provide: 'PROFILE_CALLS', useFactory: (db: AppDatabase): CallSummaryPort => (db ? new KyselyCallSummary(db) : new DefaultCallSummary()), inject: [DATABASE] },
    {
      provide: AiCustomerProfileService,
      useFactory: (customers: CustomersService, audit: AuditService, services: ServicesService, cache: CachePort | null, settings: ProfileSettingsPort, metrics: ProfileMetrics, calls: CallSummaryPort) =>
        new AiCustomerProfileService(customers, audit, services, cache ? new ProfileCache(cache) : new ProfileCache(), settings, metrics, calls),
      inject: [CustomersService, AuditService, ServicesService, 'PROFILE_CACHE', 'PROFILE_SETTINGS', 'PROFILE_METRICS', 'PROFILE_CALLS'],
    },
    AiCustomerProfileScanScheduler, // periodic tenant aggregate refresh (opt-in via env)
    // Customer Intelligence (Nov 1 2026): the six cards from a set-based scan with the assistant's own rules + tunables
    { provide: CUSTOMER_INTELLIGENCE_CENTER, useFactory: (db: AppDatabase, svc: AiCustomerProfileService) =>
        (db ? new CustomerIntelligenceCenter(db, async (ctx) => { const s = await svc.getEffectiveSettings({ ...ctx, branchId: ctx.branchId ?? '' }); return { enabled: s.enabled, tunables: s.tunables }; }) : null),
      inject: [DATABASE, AiCustomerProfileService] },
    // Churn Watch (Nov 1 2026): the review queue over the same scan's churn rule
    { provide: CHURN_WATCH_CENTER, useFactory: (db: AppDatabase, svc: AiCustomerProfileService) =>
        (db ? new ChurnWatchCenter(db, async (ctx) => (await svc.getEffectiveSettings({ ...ctx, branchId: ctx.branchId ?? '' })).enabled) : null),
      inject: [DATABASE, AiCustomerProfileService] },
    // Rebooking Opportunities (Nov 1 2026): the review queue + Booking Assistant handoff over the same scan's rebooking rule
    { provide: REBOOKING_CENTER, useFactory: (db: AppDatabase, svc: AiCustomerProfileService) =>
        (db ? new RebookingCenter(db, async (ctx) => { const s = await svc.getEffectiveSettings({ ...ctx, branchId: ctx.branchId ?? '' }); return { enabled: s.enabled, tunables: s.tunables }; }) : null),
      inject: [DATABASE, AiCustomerProfileService] },
  ],
  exports: [AiCustomerProfileService],
})
export class AiCustomerProfileModule {}
