// cache.module.ts — global module exposing the tenant-scoped read-through cache under TENANT_CACHE.
// Resolves to a Redis-backed cache when CACHE_STORE=redis + a URL is configured, else a transparent passthrough
// (Scaling Roadmap Phase 2). Injecting it is always safe: with caching off, getOrSet simply runs the loader.
import { Global, Module } from '@nestjs/common';
import { NoopTenantCache, RedisTenantCache, TENANT_CACHE, type TenantCache, type CacheRedis } from '@aipowersalon/cache';

export { TENANT_CACHE };   // re-exported: the token lives with the port (Constitution 13 §94)

// Env selector, mirroring makeLoginThrottle / realtime bus: Redis when opted in + configured, else the passthrough.
export function makeTenantCache(): TenantCache {
  const url = process.env.CACHE_REDIS_URL || process.env.REDIS_URL;
  if ((process.env.CACHE_STORE || '').toLowerCase() === 'redis' && url) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
    return new RedisTenantCache(makeIoredis(url, 'cache') as unknown as CacheRedis);
  }
  return new NoopTenantCache();
}


@Global()
@Module({
  providers: [{ provide: TENANT_CACHE, useFactory: makeTenantCache }],
  exports: [TENANT_CACHE],
})
export class CacheModule {}
