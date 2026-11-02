// redis-telemetry.vitest.spec — Constitution 11 §44, §196, §368.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { attachRedisTelemetry, parseInfo, summarizeInfo, redisCommands, redisCommandErrors, redisConnectionState, redisReconnects, redisMemoryRatio, redisHitRatio } from './redis-telemetry';
import { registry } from './metrics';

/** A client that behaves like ioredis where it matters: sendCommand carries the outcome on cmd.promise. */
function fakeRedis(opts: { failing?: boolean; info?: string; status?: string } = {}) {
  const em = new EventEmitter() as EventEmitter & { sendCommand: (cmd: any) => any; info: () => Promise<string>; status: string };
  em.status = opts.status ?? 'ready';
  em.info = async () => opts.info ?? '';
  em.sendCommand = (cmd: any) => { cmd.promise = opts.failing ? Promise.reject(new Error('READONLY')) : Promise.resolve('OK'); return cmd.promise; };
  return em;
}
const cmd = (name: string) => ({ name, promise: undefined as Promise<unknown> | undefined });
const val = (m: { snapshot: () => Array<{ labels: Record<string, string>; value: unknown }> }, role: string, command?: string) =>
  m.snapshot().find((s) => s.labels.role === role && (command === undefined || s.labels.command === command))?.value as number | undefined;

describe('commands are counted by ROLE and COMMAND NAME only — never by key (§365)', () => {
  it('a successful command is counted and timed', async () => {
    const r = attachRedisTelemetry(fakeRedis(), 'cache');
    const c = cmd('GET'); await r.sendCommand(c).catch(() => undefined);
    await new Promise((res) => setTimeout(res, 0));
    expect(val(redisCommands, 'cache', 'get')).toBeGreaterThanOrEqual(1);
  });

  it('a failed command is an error, not a command', async () => {
    const r = attachRedisTelemetry(fakeRedis({ failing: true }), 'throttle');
    const c = cmd('INCR'); await r.sendCommand(c).catch(() => undefined);
    await new Promise((res) => setTimeout(res, 0));
    expect(val(redisCommandErrors, 'throttle', 'incr')).toBe(1);
    expect(val(redisCommands, 'throttle', 'incr')).toBeUndefined();
  });

  it('the caller still receives the rejection — telemetry never swallows it', async () => {
    const r = attachRedisTelemetry(fakeRedis({ failing: true }), 'ai');
    await expect(r.sendCommand(cmd('SET'))).rejects.toThrow('READONLY');
  });

  it('the command NAME is the label; the key is not — one series for every tenant\'s GET', async () => {
    const r = attachRedisTelemetry(fakeRedis(), 'ratelimit');
    for (const k of ['tenant:a', 'tenant:b', 'tenant:c']) { const c: any = cmd('GET'); c.args = [k]; await r.sendCommand(c); }
    await new Promise((res) => setTimeout(res, 0));
    const series = redisCommands.snapshot().filter((s) => s.labels.role === 'ratelimit');
    expect(series).toHaveLength(1);
  });

  it('wrapping twice instruments once — no double counting when a client is shared', async () => {
    const base = fakeRedis();
    const a = attachRedisTelemetry(base, 'realtime'); const b = attachRedisTelemetry(base, 'realtime');
    expect(a).toBe(b);
    await a.sendCommand(cmd('PUBLISH')); await new Promise((res) => setTimeout(res, 0));
    expect(val(redisCommands, 'realtime', 'publish')).toBe(1);
  });
});

describe('connection state from the client\'s own lifecycle (§44 redis_up, reconnects)', () => {
  it('ready → 1, close → 0, reconnecting counted', () => {
    const r = attachRedisTelemetry(fakeRedis({ status: 'connecting' }), 'other');
    expect(val(redisConnectionState, 'other')).toBe(0);
    r.emit('ready'); expect(val(redisConnectionState, 'other')).toBe(1);
    r.emit('close'); expect(val(redisConnectionState, 'other')).toBe(0);
    r.emit('reconnecting'); r.emit('reconnecting');
    expect(val(redisReconnects, 'other')).toBe(2);
  });

  it('an "error" event does not crash the process — a listener is attached', () => {
    const r = attachRedisTelemetry(fakeRedis(), 'cache');
    expect(() => r.emit('error', new Error('ECONNRESET'))).not.toThrow();
  });
});

describe('INFO — memory, evictions, hit ratio (§44)', () => {
  const INFO = '# Memory\r\nused_memory:52428800\r\nmaxmemory:104857600\r\n# Stats\r\nevicted_keys:17\r\nkeyspace_hits:900\r\nkeyspace_misses:100\r\nblocked_clients:2\r\n';

  it('parses name:value lines and ignores section headers', () => {
    expect(parseInfo(INFO).used_memory).toBe('52428800');
    expect(parseInfo(INFO)['# Memory']).toBeUndefined();
  });

  it('derives ratios; an unbounded maxmemory is 0, not a division by zero', () => {
    const s = summarizeInfo(parseInfo(INFO));
    expect(s.memoryRatio).toBeCloseTo(0.5);
    expect(s.hitRatio).toBeCloseTo(0.9);
    expect(summarizeInfo({ used_memory: '10' }).memoryRatio).toBe(0);
  });

  it('an idle cache has NO hit ratio (null) — not 100%, which would read as perfect', () => {
    expect(summarizeInfo({ keyspace_hits: '0', keyspace_misses: '0' }).hitRatio).toBeNull();
  });

  it('INFO is fetched on collect, throttled — two collects within 15 s issue ONE INFO', async () => {
    let calls = 0; let t = 1_000_000;
    const base = fakeRedis({ info: INFO }); base.info = async () => { calls++; return INFO; };
    attachRedisTelemetry(base, 'ai', () => t);
    registry.snapshot(); await new Promise((res) => setTimeout(res, 0));
    registry.snapshot(); await new Promise((res) => setTimeout(res, 0));
    expect(calls).toBe(1);
    t += 16_000; registry.snapshot(); await new Promise((res) => setTimeout(res, 0));
    expect(calls).toBe(2);
    expect(val(redisMemoryRatio, 'ai')).toBeCloseTo(0.5);
    expect(val(redisHitRatio, 'ai')).toBeCloseTo(0.9);
  });

  it('INFO is never sent to a client that is not ready — a reconnecting client is not polled', async () => {
    let calls = 0;
    const base = fakeRedis({ status: 'reconnecting' }); base.info = async () => { calls++; return ''; };
    attachRedisTelemetry(base, 'cache', () => 5_000_000);
    registry.snapshot(); await new Promise((res) => setTimeout(res, 0));
    expect(calls).toBe(0);
  });
});
