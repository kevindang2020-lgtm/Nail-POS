// request-context.ts — Constitution 11 §6–15, §375–377: ONE ambient context for the whole request/job/event.
//
// Everything that logs, errors, publishes an event or calls a provider reads its identifiers from here instead
// of being handed them by hand (§376). The store is AsyncLocalStorage, so concurrent requests cannot see each
// other's context — §277/§377 test exactly that.
//
// Three identifiers, three meanings (§7–10):
//   requestId      one inbound HTTP request. Minted here, returned to the client, quoted to support.
//   correlationId  one business workflow: booking → event → worker → Twilio all share it (§8). A client may
//                  continue a chain by sending x-correlation-id; otherwise it starts here and equals requestId.
//   traceId        W3C trace id (32 hex). Since BUILD_PLAN Phase 11 it is ADOPTED from an inbound `traceparent` (or
//                  minted), and `spanId` is the span this context IS — a request's server span, a job span, a consumer
//                  span (tracing/span.ts). Spans are exported over OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set.
//
// Jobs and event consumers do NOT inherit the HTTP context — there is none. They call `runWithContext()` with a
// context built from the job/event metadata (§13–14, §376), which is why `correlationId` is carried on those.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export type ActorType = 'user' | 'customer' | 'technician' | 'super_admin' | 'device' | 'system' | 'anonymous';

export interface TelemetryContext {
  requestId: string;
  correlationId: string;
  traceId: string;
  /** The span this context is (server / job / consumer span). Absent on a context built by hand. */
  spanId?: string;
  /** The remote/enqueuing parent span, when the context continued one. */
  parentSpanId?: string;
  /** W3C sampled flag of this trace. */
  traceSampled?: boolean;
  /** Present once the session middleware has resolved the tenant. Absent on public routes. */
  tenantId?: string;
  branchId?: string | null;
  actorId?: string;
  actorType?: ActorType;
  /** The signed-in session's id (staff / customer), set by the API's tenant-context middleware. Stored on audit rows
   *  (Phase 10) — never logged: contextFields() does not include it. */
  sessionId?: string;
  /** `service.operation`, e.g. `api.POST /appointments`, `job.ai-trial-sweep`, `consumer.realtime.projection`. */
  operation?: string;
  service: 'api' | 'job' | 'consumer' | 'realtime';
  /** §43: queries issued while this context was active — the N+1 detector reads it at request end. */
  dbQueries?: number;
  /** Phase 11 (Constitution 4 §35 noisy neighbour): total DB statement time (ms) while this context was active. */
  dbMs?: number;
  /** BUILD_PLAN Phase 13 (Constitution 6 §12, §149): which client app / version / platform made the request, from the
   *  mobile transport's X-Client-Type / X-Client-Version / X-Client-Platform headers — strictly shaped (clientInfoFrom),
   *  absent when the caller sent none. Names only: never the device id. Client input: labels, never authorization. */
  clientApp?: string;
  clientVersion?: string;
  clientPlatform?: string;
}

const CLIENT_APP = /^[a-z][a-z0-9-]{1,31}$/;
const CLIENT_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}([-+][0-9A-Za-z.-]{1,32})?$/;
const CLIENT_PLATFORM = /^(ios|android|web)$/;
/** The client labels a request may carry (Constitution 6 §12). A malformed value is dropped, never logged. */
export function clientInfoFrom(headers: Record<string, unknown> | undefined): Pick<TelemetryContext, 'clientApp' | 'clientVersion' | 'clientPlatform'> {
  const h = headers ?? {};
  const pick = (name: string, re: RegExp) => { const v = h[name]; return typeof v === 'string' && re.test(v) ? v : undefined; };
  const out: Pick<TelemetryContext, 'clientApp' | 'clientVersion' | 'clientPlatform'> = {};
  const app = pick('x-client-type', CLIENT_APP); if (app) out.clientApp = app;
  const ver = pick('x-client-version', CLIENT_VERSION); if (ver) out.clientVersion = ver;
  const plat = pick('x-client-platform', CLIENT_PLATFORM); if (plat) out.clientPlatform = plat;
  return out;
}

const store = new AsyncLocalStorage<TelemetryContext>();

// Crockford base32, the ULID alphabet: time-sortable ids that read well in a support ticket (§7 "req_01J…").
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function timeBase32(ms: number): string {
  let out = '';
  for (let i = 9; i >= 0; i--) out += B32[Math.floor(ms / 32 ** i) % 32];
  return out;
}
function randBase32(n: number): string {
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += B32[bytes[i] % 32];
  return out;
}

/** `req_` + 10 time chars + 16 random chars. Sortable by creation time; 80 bits of randomness. */
export function newRequestId(now = Date.now()): string { return `req_${timeBase32(now)}${randBase32(16)}`; }
/** W3C trace-context shape: 32 lowercase hex, never all zeros. */
export function newTraceId(): string { return randomUUID().replace(/-/g, ''); }

const SAFE_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
/** An inbound correlation id is accepted only if it looks like an id — never free text into logs. */
export function sanitizeInboundId(v: unknown): string | undefined {
  return typeof v === 'string' && SAFE_ID.test(v) ? v : undefined;
}

export function runWithContext<T>(ctx: TelemetryContext, fn: () => T): T { return store.run(ctx, fn); }

/** Run `fn` with NO ambient context (BUILD_PLAN Phase 14 A): the telemetry sink's own database writes must never be
 *  counted as, or become spans of, the request whose log line happened to schedule the flush. */
export function runOutsideContext<T>(fn: () => T): T { return store.exit(fn); }

/** The current context, or undefined outside any request/job. Callers must tolerate undefined (§6). */
export function getContext(): TelemetryContext | undefined { return store.getStore(); }

/** Mutate the CURRENT context in place — the session middleware fills in tenant/actor once it knows them. */
export function enrichContext(patch: Partial<TelemetryContext>): void {
  const c = store.getStore();
  if (c) Object.assign(c, patch);
}

// Job and event metadata come from OUR database, not from a client. They are trusted: any non-empty id continues
// the chain. Running them through sanitizeInboundId() (a first draft did) would silently START A NEW CHAIN for any
// id shorter than 8 characters — the worst failure here, because nothing would look broken.
const trustedId = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** The span a job/event context runs as (tracing/span.ts makes it; Phase 11). Without it a fresh trace id is minted. */
export interface ContextTrace { traceId: string; spanId: string; parentSpanId?: string; sampled: boolean }
const traceFields = (t?: ContextTrace) => (t ? { traceId: t.traceId, spanId: t.spanId, parentSpanId: t.parentSpanId, traceSampled: t.sampled } : { traceId: newTraceId() });

/** Start a fresh context for a job or consumer, continuing a correlation chain when the metadata carries one. */
export function contextForJob(input: { jobType: string; correlationId?: string | null; tenantId?: string | null; branchId?: string | null; jobId?: string | null; trace?: ContextTrace }): TelemetryContext {
  const requestId = input.jobId ? `job_${input.jobId}` : newRequestId();
  return {
    requestId, correlationId: trustedId(input.correlationId) ?? requestId, ...traceFields(input.trace),
    tenantId: input.tenantId ?? undefined, branchId: input.branchId ?? null,
    actorType: 'system', operation: `job.${input.jobType}`, service: 'job',
  };
}

export function contextForEvent(input: { consumerName: string; eventId: string; eventType: string; correlationId?: string | null; tenantId?: string | null; branchId?: string | null; trace?: ContextTrace }): TelemetryContext {
  const requestId = `evt_${input.eventId}`;
  return {
    requestId, correlationId: trustedId(input.correlationId) ?? requestId, ...traceFields(input.trace),
    tenantId: input.tenantId ?? undefined, branchId: input.branchId ?? null,
    actorType: 'system', operation: `consumer.${input.consumerName}:${input.eventType}`, service: 'consumer',
  };
}

/** The fields safe to spread into any log line or span (§134). Never actor names, never payloads. */
export function contextFields(c: TelemetryContext | undefined = getContext()): Record<string, string | null | undefined> {
  if (!c) return {};
  return { requestId: c.requestId, correlationId: c.correlationId, traceId: c.traceId, spanId: c.spanId, tenantId: c.tenantId, branchId: c.branchId ?? undefined, actorType: c.actorType, operation: c.operation, service: c.service };
}
