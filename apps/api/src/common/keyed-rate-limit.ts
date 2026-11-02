// keyed-rate-limit.ts — the API's WIRING of the keyed rate limiter: which store (RATE_LIMIT_STORE) and which URL. The
// limiter itself is @aipowersalon/security; the guard is @aipowersalon/security/nest (Constitution 13 §81/§113).
import { mfaAttemptLimiter, voiceKeyLimiter, InMemoryAnonRateLimitStore, RedisAnonRateLimitStore, type KeyedRateLimiter, type KeyedRateLimitRedis, type AnonRateLimitStore, type AnonRateLimitRedis } from '@aipowersalon/security';

/** Same Redis wiring as makeTenantRateLimiter: RATE_LIMIT_STORE=redis + a URL, else no-op. One shared connection role. */
export function resolvedKeyedRedis(): KeyedRateLimitRedis | null {
  const url = process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
  if ((process.env.RATE_LIMIT_STORE || '').toLowerCase() !== 'redis' || !url) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
  return makeIoredis(url, 'ratelimit') as unknown as KeyedRateLimitRedis;
}
export function makeMfaAttemptLimiter(): KeyedRateLimiter { return mfaAttemptLimiter(resolvedKeyedRedis()); }
export function makeVoiceKeyLimiter(): KeyedRateLimiter { return voiceKeyLimiter(resolvedKeyedRedis()); }

/** Security Deep Scan §28/§43/§44: the store behind @AnonRateLimit. Redis (shared across replicas) whenever a Redis URL is
 *  configured and RATE_LIMIT_STORE is not "memory" (the tenant limiter's selection); else the in-process sliding log. */
export function makeAnonRateLimitStore(env: NodeJS.ProcessEnv = process.env): AnonRateLimitStore {
  const url = env.RATE_LIMIT_REDIS_URL || env.REDIS_URL;
  if (url && (env.RATE_LIMIT_STORE || '').toLowerCase() !== 'memory') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
    return new RedisAnonRateLimitStore(makeIoredis(url, 'ratelimit') as unknown as AnonRateLimitRedis);
  }
  return new InMemoryAnonRateLimitStore();
}
