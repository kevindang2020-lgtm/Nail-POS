import { describe, it, expect } from 'vitest';
import { ProviderReliabilityService, computeBackoffMs } from './provider-reliability.service';

// In-memory repo double; the pgtest proves it on real Postgres.
function repoDouble() {
  const br: any = { state: 'closed', failure_count: 0, failure_threshold: 2, cooldown_seconds: 1, opened_at: null };
  let openElapsed = 0;
  const counts = new Map<string, number>();
  return {
    _br: br, setOpenElapsed(s: number) { openElapsed = s; },
    async getBreaker() { return { ...br }; },
    async openElapsedSeconds() { return openElapsed; },
    async transition(_c: string, state: string) { br.state = state; if (state === 'closed') br.failure_count = 0; if (state === 'open') openElapsed = 0; },
    async recordSuccess() { br.failure_count = 0; },
    async recordFailure() { br.failure_count++; return { failureCount: br.failure_count, threshold: br.failure_threshold }; },
    async isLimited(t: string, k: string, cfg: any) { const c = counts.get(`${t}:${k}`) ?? 0; return { limited: c >= cfg.limit, retryAfter: c >= cfg.limit ? 30 : 0 }; },
    async increment(t: string, k: string) { counts.set(`${t}:${k}`, (counts.get(`${t}:${k}`) ?? 0) + 1); },
    async pinRetryAfter() { /* noop */ },
    async getState() { return { breaker: br, rateLimits: [] }; },
    async resetBreaker() { br.state = 'closed'; br.failure_count = 0; },
  };
}
const hi = { limit: 100, windowSeconds: 60 };

describe('ProviderReliabilityService', () => {
  it('passes healthy calls through and opens the breaker at the threshold', async () => {
    const repo = repoDouble();
    const g = new ProviderReliabilityService(repo as any, undefined, { failureThreshold: 2, cooldownSeconds: 1, limits: { provider: hi, tenant: hi, connection: hi } });
    expect((await g.run({ connectionId: 'c1', providerKey: 'p', operation: 'x' }, async () => 'ok')).result).toBe('ok');
    await g.run({ connectionId: 'c1', providerKey: 'p', operation: 'x' }, async () => { throw new Error('e'); });
    const open = await g.run({ connectionId: 'c1', providerKey: 'p', operation: 'x' }, async () => { throw new Error('e'); });
    expect(open.breakerState).toBe('open'); expect(repo._br.state).toBe('open');
  });

  it('fast-fails when the breaker is open, then recovers via a half-open probe', async () => {
    const repo = repoDouble(); repo._br.state = 'open'; repo.setOpenElapsed(0);
    const g = new ProviderReliabilityService(repo as any, undefined, { failureThreshold: 2, cooldownSeconds: 60, limits: { provider: hi, tenant: hi, connection: hi } });
    const blocked = await g.run({ connectionId: 'c1', providerKey: 'p', operation: 'x' }, async () => 'no');
    expect(blocked.blocked).toBe('circuit_open'); expect(blocked.result).toBeUndefined();
    repo.setOpenElapsed(120); // cooldown elapsed
    const ok = await g.run({ connectionId: 'c1', providerKey: 'p', operation: 'x' }, async () => 'ok');
    expect(ok.ok).toBe(true); expect(repo._br.state).toBe('closed');
  });

  it('rate-limits a scope over its window', async () => {
    const repo = repoDouble();
    const g = new ProviderReliabilityService(repo as any, undefined, { failureThreshold: 5, cooldownSeconds: 60, limits: { provider: hi, tenant: hi, connection: { limit: 2, windowSeconds: 60 } } });
    await g.run({ connectionId: 'c2', providerKey: 'p', operation: 'x' }, async () => 'ok');
    await g.run({ connectionId: 'c2', providerKey: 'p', operation: 'x' }, async () => 'ok');
    const limited = await g.run({ connectionId: 'c2', providerKey: 'p', operation: 'x' }, async () => 'ok');
    expect(limited.blocked).toBe('rate_limited'); expect(limited.scope).toBe('connection');
  });

  it('reset requires a reason', async () => {
    const g = new ProviderReliabilityService(repoDouble() as any, undefined);
    expect((await g.resetCircuit({}, 'c1', '')).error).toBe('reason_required');
    expect((await g.resetCircuit({}, 'c1', 'ok')).ok).toBe(true);
  });

  it('computeBackoffMs is exponential, capped, and jittered within bounds', () => {
    expect(computeBackoffMs(0, { jitter: false })).toBe(1000);
    expect(computeBackoffMs(3, { jitter: false })).toBe(8000);
    expect(computeBackoffMs(20, { jitter: false })).toBe(60000);
    expect(computeBackoffMs(3, { jitter: true }, () => 0)).toBe(4000);
    expect(computeBackoffMs(3, { jitter: true }, () => 1)).toBe(8000);
  });
});
