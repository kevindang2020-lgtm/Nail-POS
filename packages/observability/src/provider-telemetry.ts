// provider-telemetry.ts — Constitution 11 §52–58, §110, §194, §298, §312: every external provider call, instrumented.
//
// THE SEAM. Every provider client in this codebase — CardPointe, Fiserv CommerceHub, Twilio (SMS, numbers,
// TrustHub), FCM/APNs push, email — takes an injected `fetch`-like function. Wrapping THAT function gives §194's
// full list (call count, latency, status, error category, retry, circuit state) without touching a single request
// path inside any client. `instrumentedFetch('twilio', fetch)` is the whole integration.
//
// ERROR CATEGORY (§58, §194). A provider call fails in five different ways and they mean different things:
//   timeout          — the provider did not answer (AbortError / ETIMEDOUT)
//   network          — could not reach it (ECONNREFUSED, DNS, TLS)
//   provider_error   — it answered 5xx: THEIR outage
//   rate_limited     — 429
//   client_error     — 4xx other than 429: OUR request or OUR configuration (bad credentials are 401/403)
//   ok               — 2xx/3xx
// A card DECLINE is a 2xx with a decline body, and is deliberately NOT a failure here (§58: "do not trigger outage
// alert because normal card declines increased"). Declines are a business SLI, recorded by the payment domain.
//
// CIRCUIT STATE (§194, §298; Constitution 4 §117). ONE breaker (circuit-breaker.ts) — the same state machine the AI
// router and the integration connections use: 5 consecutive provider failures open the circuit for 30 s, then one
// probe. Since BUILD_PLAN Phase 2 (Oct 2026) the circuit BLOCKS here: an open circuit refuses the call without touching
// the network (CircuitOpenError) — before, it was only recorded and every call still waited out its timeout. Only
// timeout / network / provider_error count toward opening — a 401 from OUR bad credentials is not the provider's
// outage (§299: provider health ≠ tenant configuration health). The circuit is per provider AND host: a salon whose
// gateway site name is wrong (DNS failure) opens only its own host's circuit, never the provider's for every salon.
//
// LABELS: provider + operation only (§365). The operation is the path with ids removed; never the tenant.
import { registry } from './metrics';
import { CircuitBreakers, CircuitOpenError, DEFAULT_BREAKER_POLICY } from './circuit-breaker';
import { startSpan } from './tracing/span';

export type ProviderName = 'cardpointe' | 'fiserv' | 'twilio' | 'fcm' | 'apns' | 'email' | (string & {});
export type ErrorCategory = 'ok' | 'timeout' | 'network' | 'provider_error' | 'rate_limited' | 'client_error';
export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN';

// §364: provider calls are tens to hundreds of ms; a 10 s bucket catches the timeouts.
export const PROVIDER_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30] as const;

export const providerCalls = registry.counter('aipowersalon_provider_calls_total', 'Outbound provider calls', ['provider', 'operation', 'category']);
export const providerDuration = registry.histogram('aipowersalon_provider_call_duration_seconds', 'Provider round-trip (§312: separate from request duration)', ['provider', 'operation'], PROVIDER_BUCKETS);
export const providerCircuitOpen = registry.gauge('aipowersalon_provider_circuit_open', '1 while the circuit for this provider is open', ['provider']);

/** §298 — the standard shape every provider exposes to the health aggregator. */
export interface ProviderHealth {
  provider: string;
  status: ProviderStatus;
  latencyMs: number | null;        // p50 over the recent window
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  errorRate: number | null;        // failures / calls over the recent window; null when no calls
  consecutiveFailures: number;
  openUntil: number | null;
}

interface State { calls: number; failures: number; lastSuccessAt: number | null; lastFailureAt: number | null; latencies: number[] }
const states = new Map<string, State>();
const WINDOW = 100;
export const BREAKER = DEFAULT_BREAKER_POLICY;   // the one policy (circuit-breaker.ts) — identical to the AI breakers

let breakerClock: () => number = Date.now;
let breakers = new CircuitBreakers(DEFAULT_BREAKER_POLICY, () => breakerClock());
/** The process's provider circuits (key `provider|host`). */
export function providerBreakers(): CircuitBreakers { return breakers; }
/** Tests only: drive the breaker's wall clock. */
export function setProviderBreakerClock(clock: () => number): void { breakerClock = clock; }
/** The circuit key: provider + host. Calls recorded without a URL share `provider|*`. */
export function breakerKey(provider: string, url?: string): string {
  if (!url) return `${provider}|*`;
  try { return `${provider}|${new URL(url).host || '*'}`; } catch { return `${provider}|*`; }
}
const keysOf = (provider: string) => breakers.keys().filter((k) => k.startsWith(provider + '|'));

function state(p: string): State {
  let s = states.get(p);
  if (!s) { s = { calls: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null, latencies: [] }; states.set(p, s); }
  return s;
}

export function classifyResponse(status: number): ErrorCategory {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  if (status >= 400) return 'client_error';
  return 'ok';
}

export function classifyError(e: unknown): ErrorCategory {
  const name = String((e as { name?: string })?.name ?? '');
  const code = String((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code ?? '');
  const msg = String((e as { message?: string })?.message ?? '');
  if (name === 'AbortError' || name === 'TimeoutError' || /ETIMEDOUT|timeout/i.test(code + msg)) return 'timeout';
  return 'network';
}

/** Whether a category is the PROVIDER's failure (opens the circuit) or ours (does not). */
export const OPENS_CIRCUIT: ReadonlySet<ErrorCategory> = new Set(['timeout', 'network', 'provider_error']);

/** The operation label: the URL path with ids/tokens removed. Never a raw URL (§37). */
export function operationOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    return p
      .replace(/\/[A-Z]{2}[0-9a-f]{32}(?=\/|$)/g, '/:sid')                      // Twilio SIDs first — they are hex under /i
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
      .replace(/\/[0-9a-f]{20,}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:n')                                           // whole-segment integers only; 2010-04-01 survives
      .slice(0, 80) || '/';
  } catch { return '/'; }
}

/** Record one call. Exported so non-fetch providers (SDK-based, if any appear) can report through the same path.
 *  `key` is the circuit the call was admitted on (breakerKey); null records telemetry only (an opted-out transport). */
export function recordProviderCall(provider: string, operation: string, category: ErrorCategory, durationMs: number, now = breakerClock(), key: string | null = breakerKey(provider)): void {
  const s = state(provider);
  providerCalls.inc({ provider, operation, category });
  providerDuration.observe(durationMs / 1000, { provider, operation });
  s.calls++;
  s.latencies.push(durationMs); if (s.latencies.length > WINDOW) s.latencies.shift();
  if (category === 'ok') { s.lastSuccessAt = now; if (key) breakers.success(key); }
  else {
    s.failures++; s.lastFailureAt = now;
    // A client_error (and a 429) is not the provider's outage: it neither opens the circuit nor closes it — it only
    // frees a half-open probe slot.
    if (key) { if (OPENS_CIRCUIT.has(category)) breakers.failure(key, now); else breakers.neutral(key); }
  }
  if (s.calls > WINDOW) { s.calls = WINDOW; s.failures = Math.min(s.failures, WINDOW); }   // keep the rate a window, not all-time
  providerCircuitOpen.set(keysOf(provider).some((k) => breakers.isOpen(k, now)) ? 1 : 0, { provider });
}

export function providerHealth(provider: string, now = breakerClock()): ProviderHealth {
  const s = states.get(provider);
  if (!s || s.calls === 0) return { provider, status: 'UNKNOWN', latencyMs: null, lastSuccessAt: null, lastFailureAt: null, errorRate: null, consecutiveFailures: 0, openUntil: null };
  const sorted = [...s.latencies].sort((a, b) => a - b);
  const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const errorRate = s.failures / s.calls;
  // The provider's view over its circuits (one per host): open while any is open; the worst failure streak.
  const keys = keysOf(provider);
  const opens = keys.map((k) => breakers.openUntil(k, now)).filter((u): u is number => u !== null);
  const openUntil = opens.length ? Math.max(...opens) : null;
  const consecutiveFailures = keys.reduce((m, k) => Math.max(m, breakers.get(k).consecutiveFailures), 0);
  const status: ProviderStatus = openUntil !== null ? 'OUTAGE' : errorRate >= 0.25 ? 'DEGRADED' : 'HEALTHY';
  return { provider, status, latencyMs: p50, lastSuccessAt: s.lastSuccessAt, lastFailureAt: s.lastFailureAt, errorRate, consecutiveFailures, openUntil };
}

export function allProviderHealth(now = breakerClock()): ProviderHealth[] { return [...states.keys()].sort().map((p) => providerHealth(p, now)); }
export function resetProviderHealth(): void { states.clear(); breakers.clear(); breakerClock = Date.now; }

type FetchLike = (input: any, init?: any) => Promise<any>;

/**
 * Wraps an injected fetch. The returned function has the same contract; the caller's response, rejection and
 * timing behaviour are unchanged — telemetry is recorded from the outside. A telemetry failure never fails a call.
 */
/** How long a provider may take before the call is abandoned (Constitution 4 §118, Oct 6 2026). Before this the SMS,
 *  email, CardPointe and Clover clients used a bare fetch with no timeout: a provider that accepted the connection and
 *  never answered held the checkout or the send for undici's ~5-minute default. Payment gateways get a full minute (an
 *  authorization can be slow); messaging is seconds. A caller that passes its own `signal` keeps it; the card TERMINAL
 *  (which blocks while the customer taps) passes a longer `timeoutMs`. */
export const PROVIDER_TIMEOUT_MS: Readonly<Record<string, number>> = {
  cardpointe: 60_000, clover: 60_000, fiserv: 60_000,
  twilio: 15_000, email: 15_000, fcm: 10_000, apns: 10_000,
};
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
export function providerTimeoutMs(provider: string): number { return PROVIDER_TIMEOUT_MS[provider] ?? DEFAULT_PROVIDER_TIMEOUT_MS; }

export interface InstrumentedFetchOptions {
  timeoutMs?: number;
  /** false: do not send `traceparent` to this provider (BUILD_PLAN Phase 11). Default true. */
  propagate?: boolean;
  /** false: never refuse a call on an open circuit (the card terminal: a call that waits on the CUSTOMER says nothing
   *  about the provider's health). The call is still timed and counted. Default true. */
  breaker?: boolean;
}

export function instrumentedFetch(provider: ProviderName, fetchImpl: FetchLike, now: () => number = () => performance.now(), opts: InstrumentedFetchOptions = {}): FetchLike {
  const timeoutMs = opts.timeoutMs ?? providerTimeoutMs(provider);
  const guarded = opts.breaker !== false;
  return async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input ?? '');
    const operation = operationOf(url);
    const key = guarded ? breakerKey(provider, url) : null;
    if (key) {
      // Constitution 4 §117: an open circuit refuses the call HERE — no network, no timeout to wait out.
      const a = breakers.tryAcquire(key);
      if (!a.allowed) {
        try { providerCalls.inc({ provider, operation, category: 'circuit_open' }); } catch { /* never fail on telemetry */ }
        throw new CircuitOpenError(key, a.retryAfterMs);
      }
    }
    // BUILD_PLAN Phase 11: a CLIENT span per provider call (child of the request/job span), and the trace continues to
    // the provider in a W3C `traceparent` header. Attributes: provider, method, host, the id-free path — never the URL.
    const span = startSpan(`${provider} ${operation}`, { kind: 'client', attributes: {
      'aipowersalon.provider': provider, 'http.request.method': String(init?.method ?? 'GET').toUpperCase(), 'server.address': hostOf(url), 'url.template': operation,
    } });
    const startedAt = now();
    const bounded = init?.signal || timeoutMs <= 0 ? init : { ...(init ?? {}), signal: AbortSignal.timeout(timeoutMs) };
    const sent = opts.propagate === false ? bounded : withTraceparent(input, bounded, span.traceparent());
    try {
      const res = await fetchImpl(input, sent);
      const category = classifyResponse(Number(res?.status ?? 0));
      try { recordProviderCall(provider, operation, category, now() - startedAt, breakerClock(), key); } catch { /* never fail a call */ }
      span.setAttributes({ 'http.response.status_code': Number(res?.status ?? 0), 'aipowersalon.provider.category': category });
      if (category === 'provider_error') span.setStatus('error', 'provider_error');
      span.end();
      return res;
    } catch (e) {
      const category = classifyError(e);
      try { recordProviderCall(provider, operation, category, now() - startedAt, breakerClock(), key); } catch { /* never fail a call */ }
      span.setAttribute('aipowersalon.provider.category', category).setStatus('error', category).end();
      throw e;
    }
  };
}

function hostOf(url: string): string { try { return new URL(url).host; } catch { return ''; } }

/**
 * Add `traceparent` to the outgoing headers without disturbing the caller's: a plain object stays a plain object, a
 * Headers stays a Headers, an array of pairs stays an array. A caller that set its own traceparent keeps it. A Request
 * object as `input` (its headers live on it) is left alone — no provider client here passes one.
 */
export function withTraceparent(input: unknown, init: any, traceparent: string): any {
  if (!(typeof input === 'string' || input instanceof URL)) return init;
  try {
    const h = init?.headers;
    if (h && typeof h.has === 'function' && typeof h.set === 'function') {
      if (h.has('traceparent')) return init;
      const copy = new Headers(h); copy.set('traceparent', traceparent);
      return { ...init, headers: copy };
    }
    if (Array.isArray(h)) {
      if (h.some((p: any) => String(p?.[0]).toLowerCase() === 'traceparent')) return init;
      return { ...init, headers: [...h, ['traceparent', traceparent]] };
    }
    if (h && typeof h === 'object') {
      if (Object.keys(h).some((k) => k.toLowerCase() === 'traceparent')) return init;
      return { ...init, headers: { ...h, traceparent } };
    }
    return { ...(init ?? {}), headers: { traceparent } };
  } catch { return init; }
}
