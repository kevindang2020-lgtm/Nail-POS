// ai-provider-health.vitest.spec — Constitution 10 §17, §81–§86.
import { describe, it, expect } from 'vitest';
import { ProviderCircuitBreakers, classifyError, isRetryable, adapt } from './ai-provider-health';
import { MockAiProvider } from './ai-gateway';
import { route } from './ai-model-router';
import { AI_TASKS, type TaskDefinition } from './ai-task-registry';

const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms: number) => { t += ms; } }; };
const mk = (c = clock()) => ({ c, b: new ProviderCircuitBreakers({ failureThreshold: 3, openMs: 10_000, latencySamples: 5, now: c.now }) });

describe('§85/§86 error classification — permanent errors are never retried', () => {
  it('maps adapter error shapes to classes', () => {
    expect(classifyError(new Error('ai_provider_timeout'))).toBe('TIMEOUT');
    expect(classifyError(new Error('api.openai.com 429: rate limit'))).toBe('RATE_LIMITED');
    expect(classifyError(new Error('api.openai.com 401: invalid api key'))).toBe('PERMANENT');
    expect(classifyError(new Error('api.anthropic.com 400: max_tokens too large'))).toBe('PERMANENT');
    expect(classifyError(new Error('api.openai.com 503: overloaded'))).toBe('TRANSIENT');
    expect(classifyError(new Error('socket hang up'))).toBe('TRANSIENT');       // unknown → transient, retried once, never swallowed
    expect(classifyError(Object.assign(new Error('x'), { status: 403 }))).toBe('PERMANENT');
  });
  it('only PERMANENT is non-retryable', () => {
    expect(isRetryable('PERMANENT')).toBe(false);
    for (const c of ['TIMEOUT', 'RATE_LIMITED', 'TRANSIENT'] as const) expect(isRetryable(c)).toBe(true);
  });
});

describe('§83 circuit breaker', () => {
  it('opens after the failure threshold and the router routes around it', () => {
    const { b } = mk();
    expect(b.isOpen('openai')).toBe(true);
    b.recordFailure('openai', 'TRANSIENT'); b.recordFailure('openai', 'TIMEOUT');
    expect(b.isOpen('openai')).toBe(true); expect(b.health('openai').status).toBe('DEGRADED');
    b.recordFailure('openai', 'TRANSIENT');
    expect(b.isOpen('openai')).toBe(false); expect(b.health('openai').status).toBe('UNAVAILABLE');
    const d = route(AI_TASKS['review.sentiment_analyze'] as TaskDefinition, { env: { NODE_ENV: 'production' } as never, health: b });
    expect(d.provider).toBe('anthropic'); expect(d.fallback?.fromProvider).toBe('openai');
  });
  it('half-opens after openMs: one probe is allowed; success closes, failure re-opens', () => {
    const { b, c } = mk();
    for (let i = 0; i < 3; i++) b.recordFailure('openai', 'TRANSIENT');
    expect(b.isOpen('openai')).toBe(false);
    c.tick(10_001);
    expect(b.isOpen('openai')).toBe(true);                    // probe allowed
    b.recordFailure('openai', 'TRANSIENT');                    // probe failed → re-open
    expect(b.isOpen('openai')).toBe(false);
    c.tick(10_001); b.recordSuccess('openai', 120);            // probe succeeded → closed
    expect(b.isOpen('openai')).toBe(true); expect(b.health('openai').status).toBe('HEALTHY');
    expect(b.health('openai').consecutiveFailures).toBe(0);
  });
  it('§86 a PERMANENT error is the request\'s fault and does NOT count toward opening — one bad request cannot take a provider down for everyone', () => {
    const { b } = mk();
    for (let i = 0; i < 50; i++) b.recordFailure('openai', 'PERMANENT');
    expect(b.isOpen('openai')).toBe(true);
    expect(b.health('openai').failureCount).toBe(0);
  });
  it('§82 keeps counters and a latency p50', () => {
    const { b } = mk();
    for (const ms of [300, 100, 200, 900, 150]) b.recordSuccess('anthropic', ms);
    const h = b.health('anthropic');
    expect(h.successCount).toBe(5); expect(h.latencyMsP50).toBe(200);
    b.recordFailure('anthropic', 'TIMEOUT');
    expect(b.health('anthropic').timeoutCount).toBe(1);
    expect(Object.keys(b.snapshot())).toEqual(['anthropic']);
  });
  it('breakers are per PROVIDER: openai open does not affect anthropic', () => {
    const { b } = mk();
    for (let i = 0; i < 3; i++) b.recordFailure('openai', 'TRANSIENT');
    expect(b.isOpen('anthropic')).toBe(true);
  });
});

describe('§17 adapter contract over the existing port', () => {
  it('adapt() lifts an AiProvider: supports() comes from the model registry, health() from the breakers', () => {
    const { b } = mk();
    const a = adapt(new MockAiProvider(), b);
    expect(a.provider).toBe('mock');
    expect(a.supports('text.generate')).toBe(true);
    expect(a.supports('audio.transcribe')).toBe(true);        // mock-1 declares every capability
    expect(a.health().status).toBe('HEALTHY');
    expect(a.port).toBeInstanceOf(MockAiProvider);
  });
});
