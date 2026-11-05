// circuit-breaker.ts — THE circuit breaker (BUILD_PLAN Phase 2; Constitution 4 §117, Constitution 10 §83, Constitution 11 §298).
//
// Before Oct 2026 there were three: the AI providers' breaker (blocked AI calls), the integration connections' breaker
// (durable, per connection, blocked sync calls) and the provider-telemetry breaker in front of Twilio, SendGrid, FCM,
// CardPointe, Clover and Fiserv — which only RECORDED "open" and let every call through, so a dead SMS provider still
// took 15 s per text and a dead gateway 60 s per card. All three now take their decisions from this one state machine:
//
//   closed    — calls pass; `failureThreshold` consecutive PROVIDER failures (timeout, network, 5xx) open it.
//               Our own mistakes (4xx, bad credentials) never count: one salon's wrong password must not take the
//               provider offline for every salon (Constitution 11 §299).
//   open      — calls are refused at once, without touching the network, until `openMs` has passed.
//   half_open — exactly ONE probe call goes through; the rest are still refused. The probe's success closes the
//               circuit, its failure opens it again for another `openMs`, a neutral outcome (our 4xx) frees the probe slot.
//
// The pure functions are what the durable integration breaker uses too; `CircuitBreakers` is the in-memory registry
// (per process) the provider chokepoint and the AI router share.

export type CircuitState = 'closed' | 'open' | 'half_open';
export interface BreakerPolicy { failureThreshold: number; openMs: number }
export const DEFAULT_BREAKER_POLICY: Readonly<BreakerPolicy> = Object.freeze({ failureThreshold: 5, openMs: 30_000 });

export interface CircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  /** half_open only: a probe has been let through and has not reported back yet. */
  probeInFlight: boolean;
}
export const CLOSED: Readonly<CircuitSnapshot> = Object.freeze({ state: 'closed', consecutiveFailures: 0, openedAt: null, probeInFlight: false });

export interface Admission { allowed: boolean; next: CircuitSnapshot; probe: boolean; retryAfterMs: number }

/** May a call go through now? An open circuit whose time is up becomes half_open and admits one probe. */
export function admit(s: CircuitSnapshot, now: number, policy: BreakerPolicy = DEFAULT_BREAKER_POLICY): Admission {
  if (s.state === 'closed') return { allowed: true, next: s, probe: false, retryAfterMs: 0 };
  if (s.state === 'open') {
    const until = (s.openedAt ?? now) + policy.openMs;
    if (now < until) return { allowed: false, next: s, probe: false, retryAfterMs: until - now };
    return { allowed: true, next: { ...s, state: 'half_open', probeInFlight: true }, probe: true, retryAfterMs: 0 };
  }
  // half_open
  if (s.probeInFlight) return { allowed: false, next: s, probe: false, retryAfterMs: Math.min(1_000, policy.openMs) };
  return { allowed: true, next: { ...s, probeInFlight: true }, probe: true, retryAfterMs: 0 };
}

export function onSuccess(_s: CircuitSnapshot): CircuitSnapshot { return { ...CLOSED }; }

/** A provider failure. In half_open the probe failed → open again; otherwise count, and open at the threshold. */
export function onFailure(s: CircuitSnapshot, now: number, policy: BreakerPolicy = DEFAULT_BREAKER_POLICY): CircuitSnapshot {
  const consecutiveFailures = s.consecutiveFailures + 1;
  if (s.state === 'half_open' || consecutiveFailures >= policy.failureThreshold) return { state: 'open', consecutiveFailures, openedAt: now, probeInFlight: false };
  return { ...s, consecutiveFailures };
}

/** Neither the provider's success nor its failure (our 4xx). Frees a half_open probe slot; changes nothing else. */
export function onNeutral(s: CircuitSnapshot): CircuitSnapshot { return s.state === 'half_open' ? { ...s, probeInFlight: false } : s; }

export function isOpenAt(s: CircuitSnapshot, now: number, policy: BreakerPolicy = DEFAULT_BREAKER_POLICY): boolean {
  return s.state === 'open' && now < (s.openedAt ?? now) + policy.openMs;
}

export class CircuitOpenError extends Error {
  readonly code = 'PROVIDER_CIRCUIT_OPEN';
  constructor(readonly key: string, readonly retryAfterMs: number) {
    super(`${key}: circuit open — the provider failed repeatedly; not called (retry in ${Math.ceil(retryAfterMs / 1000)} s)`);
    this.name = 'CircuitOpenError';
  }
}

/** In-memory registry, one circuit per key. The clock is injectable for tests. */
export class CircuitBreakers {
  private readonly circuits = new Map<string, CircuitSnapshot>();
  constructor(readonly policy: BreakerPolicy = DEFAULT_BREAKER_POLICY, private readonly clock: () => number = Date.now) {}

  get(key: string): CircuitSnapshot { return this.circuits.get(key) ?? CLOSED; }
  now(): number { return this.clock(); }

  /** Claims admission (and the half_open probe slot). Every allowed call MUST report success/failure/neutral. */
  tryAcquire(key: string, now = this.clock()): Admission {
    const a = admit(this.get(key), now, this.policy);
    if (a.next !== this.get(key)) this.circuits.set(key, a.next);
    return a;
  }
  /** Read-only view for routers: would a call be admitted now (without claiming a probe)? */
  wouldAdmit(key: string, now = this.clock()): boolean { return admit(this.get(key), now, this.policy).allowed; }

  success(key: string): void { if (this.circuits.has(key)) this.circuits.set(key, onSuccess(this.get(key))); }
  failure(key: string, now = this.clock()): CircuitSnapshot { const n = onFailure(this.get(key), now, this.policy); this.circuits.set(key, n); return n; }
  neutral(key: string): void { if (this.circuits.has(key)) this.circuits.set(key, onNeutral(this.get(key))); }

  isOpen(key: string, now = this.clock()): boolean { return isOpenAt(this.get(key), now, this.policy); }
  openUntil(key: string, now = this.clock()): number | null { const s = this.get(key); return isOpenAt(s, now, this.policy) ? (s.openedAt ?? now) + this.policy.openMs : null; }
  keys(): string[] { return [...this.circuits.keys()]; }
  clear(): void { this.circuits.clear(); }
}
