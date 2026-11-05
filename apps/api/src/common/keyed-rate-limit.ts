// keyed-rate-limit.ts — the API's WIRING of the keyed rate limiter: which store (RATE_LIMIT_STORE) and which URL. The
// limiter itself is @aipowersalon/security; the guard is @aipowersalon/security/nest (Constitution 13 §81/§113).
import { mfaAttemptLimiter, voiceKeyLimiter, type KeyedRateLimiter, type KeyedRateLimitRedis } from '@aipowersalon/security';

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
