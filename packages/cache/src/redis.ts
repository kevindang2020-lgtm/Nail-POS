// redis.ts — one place that constructs an ioredis client, with sane production defaults.
// ioredis is required LAZILY (inside the function) so a single-instance deployment that never opts into Redis never
// loads the library at startup. Callers (the realtime bus + login throttle factories) only invoke this when the
// relevant *_REDIS_URL / REDIS_URL is set and the feature is switched to 'redis'.
import type { Redis as IORedis, RedisOptions } from 'ioredis';
import { attachRedisTelemetry, type RedisRole } from '@aipowersalon/observability';

/**
 * `role` labels every command, connection and INFO gauge for this client (Constitution 11 §44/§196), so the
 * dashboard can tell the realtime backbone from the AI cache. It is the ONLY label — never a key, never a tenant.
 */
/** Commands that legitimately wait on the server — never given the request/response timeout. */
export const BLOCKING_COMMANDS: ReadonlySet<string> = new Set(['subscribe', 'psubscribe', 'ssubscribe', 'unsubscribe', 'punsubscribe', 'sunsubscribe', 'blpop', 'brpop', 'brpoplpush', 'blmove', 'blmpop', 'bzpopmin', 'bzpopmax', 'bzmpop', 'xread', 'xreadgroup', 'wait', 'monitor', 'quit', 'client', 'info']);

/** BUILD_PLAN Phase 11 (Constitution 4 §47/§112, found by the redis-loss drill): while Redis is unreachable ioredis queues
 *  each command and retries it for 2–6 s, so a cache MISS cost more than 10 s and a limiter check held every request.
 *  Every request/response command now gives up after `ms` (the same `Command.setTimeout` ioredis' own `commandTimeout`
 *  uses) so the caller's fallback runs at once; blocking / pub-sub commands keep waiting. Applied by makeIoredis. */
export function withCommandTimeout<R extends { sendCommand?: (...a: any[]) => any }>(client: R, ms: number): R {
  if (!(ms > 0) || typeof client.sendCommand !== 'function') return client;
  const original = client.sendCommand.bind(client);
  client.sendCommand = (cmd: any, ...rest: any[]) => {
    const name = String(cmd?.name ?? '').toLowerCase();
    if (cmd && typeof cmd.setTimeout === 'function' && !BLOCKING_COMMANDS.has(name)) cmd.setTimeout(ms);
    return original(cmd, ...rest);
  };
  return client;
}

export function redisCommandTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.REDIS_COMMAND_TIMEOUT_MS ?? 500);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

export function makeIoredis(url: string, role: RedisRole = 'other', opts: RedisOptions = {}): IORedis {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('ioredis');
  const Ctor = (mod && (mod.default || mod)) as new (url: string, opts?: RedisOptions) => IORedis;
  return attachRedisTelemetry(withCommandTimeout(new Ctor(url, {
    // Don't let a transient Redis outage hang request handlers forever; fail fast and let the feature's
    // try/catch fall back (realtime → deliver locally; throttle → treated as no recent failures).
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
    ...opts,
  }), redisCommandTimeoutMs()), role);
}
