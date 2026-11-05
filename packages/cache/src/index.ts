// @aipowersalon/cache — the tenant cache PORT (Constitution 13 §94). Domains depend on TenantCache + TENANT_CACHE;
// the API decides the store (passthrough, or Redis when CACHE_STORE=redis) in its global CacheModule.
export * from './tenant-cache';   // moved from apps/api/src/common/tenant-cache.ts (Constitution 13 §219)
export * from './redis';   // moved from apps/api/src/common/redis.ts (Constitution 13 §219)
