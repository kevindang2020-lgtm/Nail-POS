// provider-telemetry.vitest.spec — Constitution 11 §52–58, §194, §298–299.
import { describe, it, expect, beforeEach } from 'vitest';
import { instrumentedFetch, providerTimeoutMs, recordProviderCall, providerHealth, allProviderHealth, resetProviderHealth, classifyResponse, classifyError, operationOf, providerCalls, BREAKER } from './provider-telemetry';

const res = (status: number) => ({ status, ok: status < 400, json: async () => ({}) });
const calls = (provider: string, category: string) => providerCalls.snapshot().filter((s) => s.labels.provider === provider && s.labels.category === category).reduce((a, s) => a + (s.value as number), 0);

beforeEach(() => resetProviderHealth());

describe('the wrapper is transparent to the caller', () => {
  it('returns the provider\'s response unchanged', async () => {
    const f = instrumentedFetch('t1', async () => res(200));
    expect((await f('https://x/a')).status).toBe(200);
  });
  it('rethrows the provider\'s rejection unchanged', async () => {
    const f = instrumentedFetch('t2', async () => { throw new Error('ECONNREFUSED'); });
    await expect(f('https://x/a')).rejects.toThrow('ECONNREFUSED');
  });
  it('records the call even when the caller ignores the result', async () => {
    const f = instrumentedFetch('t3', async () => res(200));
    await f('https://x/a'); await f('https://x/a');
    expect(calls('t3', 'ok')).toBe(2);
  });
});

describe('§58 / §194 error categories', () => {
  it('5xx is the PROVIDER\'s error; 4xx is OURS; 429 is rate limiting', () => {
    expect(classifyResponse(503)).toBe('provider_error');
    expect(classifyResponse(401)).toBe('client_error');
    expect(classifyResponse(429)).toBe('rate_limited');
    expect(classifyResponse(200)).toBe('ok');
  });
  it('an abort is a timeout; a refused connection is network', () => {
    expect(classifyError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('timeout');
    expect(classifyError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('timeout');
    expect(classifyError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('network');
  });
  it('§58: a card DECLINE is a 2xx and is NOT a provider failure — declines must never trip an outage alert', async () => {
    const f = instrumentedFetch('cardpointe', async () => res(200));   // CardPointe declines with 200 + respstat "C"
    for (let i = 0; i < 20; i++) await f('https://fts.cardconnect.com/cardconnect/rest/auth');
    expect(providerHealth('cardpointe').status).toBe('HEALTHY');
    expect(providerHealth('cardpointe').errorRate).toBe(0);
  });
});

describe('§298 health and the §194 circuit — same semantics as the AI breakers', () => {
  it('a provider with no calls is UNKNOWN, not HEALTHY (§332: no fake green)', () => {
    expect(providerHealth('never-called').status).toBe('UNKNOWN');
    expect(providerHealth('never-called').errorRate).toBeNull();
  });
  it('the circuit opens after the threshold of PROVIDER failures', () => {
    for (let i = 0; i < BREAKER.failureThreshold; i++) recordProviderCall('twilio', '/msg', 'provider_error', 100, 1_000_000);
    const h = providerHealth('twilio', 1_000_000);
    expect(h.status).toBe('OUTAGE');
    expect(h.openUntil).toBe(1_000_000 + BREAKER.openMs);
  });
  it('§299: OUR bad credentials (401) do NOT open THEIR circuit — provider health is not tenant configuration health', () => {
    for (let i = 0; i < 20; i++) recordProviderCall('twilio', '/msg', 'client_error', 100, 1_000_000);
    const h = providerHealth('twilio', 1_000_000);
    expect(h.openUntil).toBeNull();
    expect(h.consecutiveFailures).toBe(0);
    expect(h.status).not.toBe('OUTAGE');       // DEGRADED by error rate is fine; OUTAGE would page for our own typo
  });
  it('one success closes the circuit', () => {
    for (let i = 0; i < BREAKER.failureThreshold; i++) recordProviderCall('fcm', '/send', 'timeout', 100, 1_000_000);
    expect(providerHealth('fcm', 1_000_000).status).toBe('OUTAGE');
    recordProviderCall('fcm', '/send', 'ok', 50, 1_000_001);
    // The circuit is CLOSED — but 5 of the last 6 calls failed, so the status is rightly DEGRADED, not HEALTHY.
    // My first assertion said HEALTHY; a provider that just came back is not yet healthy, only reachable.
    expect(providerHealth('fcm', 1_000_001).openUntil).toBeNull();
    expect(providerHealth('fcm', 1_000_001).status).toBe('DEGRADED');
    expect(providerHealth('fcm', 1_000_001).consecutiveFailures).toBe(0);
  });
  it('the circuit closes by itself after openMs', () => {
    for (let i = 0; i < BREAKER.failureThreshold; i++) recordProviderCall('apns', '/x', 'network', 100, 1_000_000);
    expect(providerHealth('apns', 1_000_000 + BREAKER.openMs - 1).status).toBe('OUTAGE');
    expect(providerHealth('apns', 1_000_000 + BREAKER.openMs + 1).status).not.toBe('OUTAGE');
  });
  it('a 25% failure rate is DEGRADED without opening the circuit', () => {
    for (let i = 0; i < 3; i++) recordProviderCall('email', '/send', 'ok', 50, 1_000_000);
    recordProviderCall('email', '/send', 'provider_error', 50, 1_000_000);
    expect(providerHealth('email', 1_000_000).status).toBe('DEGRADED');
  });
  it('latencyMs is the p50 over the window, in ms', () => {
    for (const ms of [10, 20, 30, 40, 1000]) recordProviderCall('fiserv', '/x', 'ok', ms, 1_000_000);
    expect(providerHealth('fiserv').latencyMs).toBe(30);
  });
  it('allProviderHealth lists every provider that has been called, sorted', () => {
    recordProviderCall('b', '/', 'ok', 1); recordProviderCall('a', '/', 'ok', 1);
    expect(allProviderHealth().map((h) => h.provider)).toEqual(['a', 'b']);
  });
});

describe('§37 / §365 the operation label is never a raw URL', () => {
  it('strips message SIDs, uuids and numbers from Twilio-style paths', () => {
    expect(operationOf('https://api.twilio.com/2010-04-01/Accounts/AC0123456789abcdef0123456789abcdef/Messages.json')).toBe('/2010-04-01/Accounts/:sid/Messages.json');
    expect(operationOf('https://x/customers/9f1c2e3a-1b2c-4d5e-8f9a-0b1c2d3e4f5a/cards')).toBe('/customers/:id/cards');
    expect(operationOf('https://x/v1/projects/12345/messages')).toBe('/v1/projects/:n/messages');
  });
  it('is bounded and never throws on garbage', () => {
    expect(operationOf('not a url')).toBe('/');
    expect(operationOf('https://x/' + 'a/'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
  it('twenty tenants calling the same endpoint make ONE series', async () => {
    const f = instrumentedFetch('twilio', async () => res(200));
    for (let i = 0; i < 20; i++) await f(`https://api.twilio.com/2010-04-01/Accounts/AC${'0'.repeat(30)}${i.toString().padStart(2, '0')}/Messages.json`);
    expect(providerCalls.snapshot().filter((s) => s.labels.provider === 'twilio' && s.labels.category === 'ok')).toHaveLength(1);
  });
});

describe('Constitution 4 §118 — every provider call is bounded (Phase 1, Oct 6 2026)', () => {
  // A real HTTP server that accepts the request and never answers: what a hung provider looks like on the wire.
  it('a provider that never answers is abandoned at the timeout and recorded as a timeout — not held for minutes', async () => {
    const http = await import('node:http');
    const server = http.createServer(() => { /* never respond */ });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    try {
      const f = instrumentedFetch('slowprovider', fetch, undefined, { timeoutMs: 300 });
      const started = Date.now();
      await expect(f(`http://127.0.0.1:${port}/v1/charge`, { method: 'POST' })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(providerHealth('slowprovider').lastFailureAt).not.toBeNull();
    } finally { server.closeAllConnections?.(); server.close(); }
  });

  it('every payment and messaging provider has a default; a caller-supplied signal is respected as given', async () => {
    expect(providerTimeoutMs('cardpointe')).toBe(60_000);
    expect(providerTimeoutMs('clover')).toBe(60_000);
    expect(providerTimeoutMs('twilio')).toBe(15_000);
    expect(providerTimeoutMs('email')).toBe(15_000);
    expect(providerTimeoutMs('anything-else')).toBe(30_000);
    const seen: any[] = [];
    const spy = async (_u: any, init?: any) => { seen.push(init); return { status: 200 }; };
    await instrumentedFetch('twilio', spy)('https://api.twilio.com/x', { method: 'POST' });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);          // added when the caller had none
    expect(seen[0].method).toBe('POST');                         // the rest of init is untouched
    const own = new AbortController().signal;
    await instrumentedFetch('twilio', spy)('https://api.twilio.com/x', { signal: own });
    expect(seen[1].signal).toBe(own);
  });
});
