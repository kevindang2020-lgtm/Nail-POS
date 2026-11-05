// ai-provider-health.ts — Constitution 10 §17, §81–§86: the adapter contract, provider health, circuit breakers,
// and the retry/permanent-error split.
//
// The existing adapters in ai-providers.ts stay as they are — they already confine provider HTTP to one file.
// This module wraps them with what §17 requires (health, supports) and what §83 requires (a breaker per
// provider), and gives the router its ProviderHealthView. One breaker per PROVIDER, shared by every task:
// a provider that is timing out for reviews is timing out for reconciliation too.
import { CircuitBreakers } from '@aipowersalon/observability';
import type { AiProvider } from './ai-gateway';
import type { Capability } from './ai-task-registry';
import type { ProviderHealthView } from './ai-model-router';
import { AI_MODELS } from './ai-model-registry';

/** §81. */
export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
/** §82 the metrics the breaker keeps per provider. */
export interface ProviderHealth {
  status: ProviderHealthStatus;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  /** §83: while set and in the future, the circuit is OPEN and the router routes around this provider. */
  openUntil: number | null;
  /** p50 latency over the recent window, ms. */
  latencyMsP50: number | null;
}

/** §17 the adapter contract. Existing AiProvider instances are lifted into it by `adapt()`. */
export interface AIProviderAdapter {
  readonly provider: string;
  supports(capability: Capability): boolean;
  health(): ProviderHealth;
  /** The underlying port — the ONLY thing that touches provider HTTP. */
  readonly port: AiProvider;
}

/** §86: errors that must not be retried, because the same request will fail the same way. */
export type ErrorClass = 'PERMANENT' | 'RATE_LIMITED' | 'TRANSIENT' | 'TIMEOUT';

/**
 * §85/§86: classify a provider failure. Reads the message the adapter attached ("<host> <status>: …") and the
 * timeout sentinel. Unknown shapes are TRANSIENT — retried once, then surfaced; never silently swallowed.
 */
export function classifyError(e: unknown): ErrorClass {
  const msg = String((e as any)?.message ?? e ?? '');
  if (msg === 'ai_provider_timeout') return 'TIMEOUT';
  const m = /\b(\d{3})\b/.exec(msg.slice(0, 40));
  const status = m ? Number(m[1]) : Number((e as any)?.status) || 0;
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422) return 'PERMANENT';
  if (status >= 500) return 'TRANSIENT';
  if (/invalid|unauthorized|forbidden|not found|too large|unsupported|malformed/i.test(msg)) return 'PERMANENT';
  return 'TRANSIENT';
}
export const isRetryable = (c: ErrorClass) => c !== 'PERMANENT';

export interface BreakerOptions {
  /** Consecutive failures that open the circuit (§83). */
  failureThreshold: number;
  /** How long the circuit stays open before one probe is allowed through. */
  openMs: number;
  /** Rolling window for latency p50. */
  latencySamples: number;
  now?: () => number;
}
export const DEFAULT_BREAKER: BreakerOptions = { failureThreshold: 5, openMs: 30_000, latencySamples: 50 };

/**
 * §83 circuit breaker registry. `isOpen(provider)` is the router's health view: true = safe to route.
 * Half-open is implicit: once the open window passes, calls are routable again (a probe); its outcome resets or re-opens.
 *
 * BUILD_PLAN Phase 2 (Oct 2026): the open/closed decisions are THE platform breaker's (`CircuitBreakers` in
 * @aipowersalon/observability — the same state machine the provider chokepoint and the integration connections use).
 * This class keeps only the AI view on top: counts, latency p50, HEALTHY/DEGRADED/UNAVAILABLE.
 */
export class ProviderCircuitBreakers implements ProviderHealthView {
  private readonly state = new Map<string, ProviderHealth & { latencies: number[] }>();
  private readonly now: () => number;
  private readonly circuits: CircuitBreakers;
  constructor(private readonly opts: BreakerOptions = DEFAULT_BREAKER) {
    this.now = opts.now ?? Date.now;
    this.circuits = new CircuitBreakers({ failureThreshold: opts.failureThreshold, openMs: opts.openMs }, () => this.now());
  }

  private entry(provider: string) {
    let e = this.state.get(provider);
    if (!e) { e = { status: 'HEALTHY', consecutiveFailures: 0, successCount: 0, failureCount: 0, timeoutCount: 0, lastFailureAt: null, lastSuccessAt: null, openUntil: null, latencyMsP50: null, latencies: [] }; this.state.set(provider, e); }
    return e;
  }

  /** Router contract (§12 "provider health"). Open circuit = NOT routable. */
  isOpen(provider: string): boolean {
    return this.circuits.wouldAdmit(provider);   // open window elapsed → half-open → allow the probe
  }

  recordSuccess(provider: string, latencyMs: number) {
    const e = this.entry(provider);
    this.circuits.success(provider);
    e.successCount++; e.consecutiveFailures = 0; e.openUntil = null; e.lastSuccessAt = this.now();
    e.latencies.push(latencyMs); if (e.latencies.length > this.opts.latencySamples) e.latencies.shift();
    const s = [...e.latencies].sort((a, b) => a - b); e.latencyMsP50 = s[Math.floor(s.length / 2)];
    e.status = 'HEALTHY';
  }

  recordFailure(provider: string, cls: ErrorClass) {
    const e = this.entry(provider);
    // §86: a PERMANENT error is the REQUEST's fault, not the provider's. It must not trip the breaker, or one
    // malformed request could take a healthy provider offline for everyone.
    if (cls === 'PERMANENT') return;
    e.failureCount++; e.lastFailureAt = this.now();
    if (cls === 'TIMEOUT') e.timeoutCount++;
    const c = this.circuits.failure(provider);
    e.consecutiveFailures = c.consecutiveFailures;
    if (c.state === 'open') { e.openUntil = (c.openedAt ?? this.now()) + this.opts.openMs; e.status = 'UNAVAILABLE'; }
    else if (e.consecutiveFailures >= Math.ceil(this.opts.failureThreshold / 2)) e.status = 'DEGRADED';
  }

  health(provider: string): ProviderHealth {
    const { latencies: _l, ...h } = this.entry(provider);
    return { ...h };
  }
  /** §173 provider dashboard. */
  snapshot(): Record<string, ProviderHealth> {
    const out: Record<string, ProviderHealth> = {};
    for (const p of this.state.keys()) out[p] = this.health(p);
    return out;
  }
}

/** §17: lift an existing AiProvider into the adapter contract, with health from the shared breakers. */
export function adapt(port: AiProvider, breakers: ProviderCircuitBreakers): AIProviderAdapter {
  const caps = new Set<Capability>();
  for (const m of Object.values(AI_MODELS)) if (m.provider === port.name) for (const c of m.capabilities) caps.add(c);
  return {
    provider: port.name, port,
    supports: (c) => caps.has(c),
    health: () => breakers.health(port.name),
  };
}
