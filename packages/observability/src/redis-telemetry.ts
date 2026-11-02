// redis-telemetry.ts — Constitution 11 §44, §196, §368: Redis observability at the ONE place every client is made.
//
// HOW. makeIoredis() is the single constructor for every ioredis client in the codebase (realtime bus, tenant
// cache, login throttle, rate limit, AI caches). attachRedisTelemetry() wraps the client it returns:
//   • every command passes through `sendCommand` — wrapping it times each command and labels it by COMMAND NAME
//     only (get/set/incr/publish…, ~20 values; §365: never by key, which would be one series per tenant);
//   • the client's own lifecycle events (ready / error / close / reconnecting) feed the connection gauges;
//   • memory, evictions and keyspace hit ratio come from INFO (§44), collected on demand with a throttle so a
//     scrape never issues more than one INFO per client per 15 s — and NEVER from inside a request.
//
// A wrapped client that is used by several features is instrumented once, and each client is labelled by the
// ROLE it was made for (realtime / cache / throttle / ratelimit), which is how the dashboard tells "the realtime
// backbone is failing" from "the AI cache is slow" (§145).
//
// Nothing here logs a command (§368) or a value. A telemetry failure never fails a command (§286).
import { registry } from './metrics';

// §364: cache round-trips are sub-millisecond locally and a few ms across an AZ; 100 ms is already wrong.
export const REDIS_BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1] as const;

export const redisCommands = registry.counter('aipowersalon_redis_commands_total', 'Commands sent', ['role', 'command']);
export const redisCommandErrors = registry.counter('aipowersalon_redis_command_errors_total', 'Commands that failed', ['role', 'command']);
export const redisCommandDuration = registry.histogram('aipowersalon_redis_command_duration_seconds', 'Command round-trip', ['role', 'command'], REDIS_BUCKETS);
export const redisConnectionState = registry.gauge('aipowersalon_redis_connection_up', '1 when the client is ready, else 0', ['role']);
export const redisReconnects = registry.counter('aipowersalon_redis_reconnects_total', 'Reconnect attempts', ['role']);
export const redisMemoryBytes = registry.gauge('aipowersalon_redis_memory_used_bytes', 'used_memory from INFO', ['role']);
export const redisMemoryRatio = registry.gauge('aipowersalon_redis_memory_utilisation_ratio', 'used_memory / maxmemory (0–1); 0 when unbounded', ['role']);
export const redisEvictions = registry.gauge('aipowersalon_redis_evicted_keys_total', 'evicted_keys from INFO (monotonic on the server)', ['role']);
export const redisHitRatio = registry.gauge('aipowersalon_redis_keyspace_hit_ratio', 'hits / (hits + misses) from INFO (0–1)', ['role']);
export const redisBlockedClients = registry.gauge('aipowersalon_redis_blocked_clients', 'blocked_clients from INFO', ['role']);

export type RedisRole = 'realtime' | 'cache' | 'throttle' | 'ratelimit' | 'ai' | 'other';

/** INFO fields are `name:value` lines. Exported for the health aggregator and for tests. */
export function parseInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** The derived numbers the gauges and the health aggregator want. Pure. */
export function summarizeInfo(info: Record<string, string>): { memoryBytes: number; memoryRatio: number; evicted: number; hitRatio: number | null; blocked: number } {
  const n = (k: string) => Number(info[k] ?? 0) || 0;
  const hits = n('keyspace_hits'), misses = n('keyspace_misses');
  const max = n('maxmemory');
  return {
    memoryBytes: n('used_memory'),
    memoryRatio: max > 0 ? n('used_memory') / max : 0,
    evicted: n('evicted_keys'),
    hitRatio: hits + misses > 0 ? hits / (hits + misses) : null,   // null, not 100%: an idle cache has no ratio
    blocked: n('blocked_clients'),
  };
}

const INFO_THROTTLE_MS = 15_000;

// The wrapper needs only these members. Typed loosely on purpose: ioredis's own overloads (info(), sendCommand())
// are wider than any interface here could restate without copying the vendor's types.
interface MinimalRedis {
  sendCommand?: (...args: any[]) => any;
  on?: (...args: any[]) => any;
  info?: (...args: any[]) => any;
  status?: string;
}

/** Wraps one ioredis client. Idempotent. Returns the same object, unchanged in type. */
export function attachRedisTelemetry<R extends object>(client: R, role: RedisRole, now: () => number = () => performance.now()): R {
  const redis = client as R & MinimalRedis & { __aipowersalonInstrumented?: boolean };
  if (redis.__aipowersalonInstrumented) return client;
  redis.__aipowersalonInstrumented = true;

  // Commands. ioredis routes EVERY command (including pipelines' members) through sendCommand.
  if (typeof redis.sendCommand === 'function') {
    const original = redis.sendCommand.bind(redis);
    redis.sendCommand = (cmd: any, ...rest: any[]) => {
      const command = String(cmd?.name ?? 'unknown').toLowerCase();
      const startedAt = now();
      let result: any;
      try { result = original(cmd, ...rest); }
      catch (e) { redisCommandErrors.inc({ role, command }); throw e; }
      // The command's own promise carries the outcome; observe it WITHOUT altering what the caller gets.
      const p: Promise<unknown> | undefined = cmd?.promise;
      if (p && typeof p.then === 'function') {
        p.then(
          () => { redisCommands.inc({ role, command }); redisCommandDuration.observe((now() - startedAt) / 1000, { role, command }); },
          () => { redisCommandErrors.inc({ role, command }); },
        ).catch(() => undefined);
      } else {
        redisCommands.inc({ role, command });
      }
      return result;
    };
  }

  // Lifecycle. §44 redis_up / failover / reconnects come from the client, not from polling.
  if (typeof redis.on === 'function') {
    redis.on('ready', () => redisConnectionState.set(1, { role }));
    redis.on('close', () => redisConnectionState.set(0, { role }));
    redis.on('end', () => redisConnectionState.set(0, { role }));
    redis.on('reconnecting', () => redisReconnects.inc({ role }));
    redis.on('error', () => { /* counted per command; an unhandled 'error' would crash the process without this listener */ });
  }
  redisConnectionState.set(redis.status === 'ready' ? 1 : 0, { role });

  // INFO on demand, throttled. Never inside a request; only when something reads the registry.
  let lastInfoAt = 0; let inflight: Promise<void> | null = null;
  registry.onCollect(() => {
    if (typeof redis.info !== 'function' || redis.status !== 'ready') return;
    if (now() - lastInfoAt < INFO_THROTTLE_MS || inflight) return;
    lastInfoAt = now();
    inflight = Promise.resolve(redis.info()).then((text: string) => {
      const s = summarizeInfo(parseInfo(text));
      redisMemoryBytes.set(s.memoryBytes, { role }); redisMemoryRatio.set(s.memoryRatio, { role });
      redisEvictions.set(s.evicted, { role }); redisBlockedClients.set(s.blocked, { role });
      if (s.hitRatio !== null) redisHitRatio.set(s.hitRatio, { role });
    }).catch(() => undefined).finally(() => { inflight = null; });
  });
  return client;
}
