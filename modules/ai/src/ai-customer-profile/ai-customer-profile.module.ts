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
  controllers: [AiCustomerProfileController],
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
  ],
  exports: [AiCustomerProfileService],
})
export class AiCustomerProfileModule {}
