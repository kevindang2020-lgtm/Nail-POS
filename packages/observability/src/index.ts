// @aipowersalon/observability — Constitution 13 §80: structured logging, metrics, request/correlation ids, redaction,
// and the telemetry adapters every domain module reports through (jobs, providers, database, Redis, realtime, HTTP).
// Health aggregation, SLOs, alert routing and System Operations stay in apps/api: they are the platform operations
// domain built ON this kernel, not part of it.
export * from './build-info';   // moved from apps/api/src/observability/build-info.ts (Constitution 13 §219)
// db-telemetry and request-telemetry each export a `fingerprint` (a SQL-shape fingerprint vs an error fingerprint) —
// different things with one name, so the public entry names them apart instead of `export *` (§97: the public API
// is explicit where the internals are ambiguous).
export { attachDbTelemetry, classify, record as recordDbQuery, recentSlowQueries, resetSlowQueries, fingerprint as sqlFingerprint, dbQueries, dbQueryDuration, dbQueryErrors, dbSlowQueries, dbQueriesPerRequest, dbPoolTotal, dbPoolUtilisation, SLOW_QUERY_MS, DB_BUCKETS, type SlowQueryRecord } from './db-telemetry';   // moved from apps/api/src/observability/db-telemetry.ts (Constitution 13 §219)
export * from './job-telemetry';   // moved from apps/api/src/observability/job-telemetry.ts (Constitution 13 §219)
export * from './scheduler-coordination';   // Phase 2 (Oct 2026): one owner per scheduled tick across processes
export * from './logger';   // moved from apps/api/src/observability/logger.ts (Constitution 13 §219)
export * from './invalid-id';   // w4 SW-21: a missing / malformed client id is a 400 INVALID_ID, checked before any query
export * from './metrics';   // moved from apps/api/src/observability/metrics.ts (Constitution 13 §219)
export * from './provider-telemetry';   // moved from apps/api/src/observability/provider-telemetry.ts (Constitution 13 §219)
export * from './circuit-breaker';   // Phase 2 (Oct 2026): THE circuit breaker — provider chokepoint, AI router and integration connections
export * from './realtime-telemetry';   // moved from apps/api/src/observability/realtime-telemetry.ts (Constitution 13 §219)
export * from './redaction';   // moved from apps/api/src/observability/redaction.ts (Constitution 13 §219)
export * from './redis-telemetry';   // moved from apps/api/src/observability/redis-telemetry.ts (Constitution 13 §219)
export * from './request-context';   // moved from apps/api/src/observability/request-context.ts (Constitution 13 §219)
// request-telemetry (middleware, exception filter, headers) and pino-logger are NestJS-bound: behind './nest' (§113).
export { MS_BUCKETS } from './http-buckets';   // shared by the HTTP metrics writer and the Super Admin latency reader
export * from './concurrency-telemetry';   // Smooth Refresh spec §100: conflict rates
export * from './customer-display-telemetry';   // Dual-Screen mandate §107–§108: display events, state latency, operation log line
export { toErrorEnvelope, leaksInternals } from './error-envelope';   // Constitution 5 §28–31
export * from './tracing';   // BUILD_PLAN Phase 11: W3C trace context, spans, OTLP/HTTP JSON export (Constitution 4 §101, Constitution 11 §16–19)
export * from './integration-business-metrics';   // wave 3 PAYI §104/§105: payment + messaging business counters (bounded event names)
export * from './webhook-counters';   // BUILD_PLAN Phase 11: per-provider webhook received / verified / rejected / duplicate / processed (Constitution 4 §173–175)
export * from './process-metrics';   // BUILD_PLAN Phase 14 B: RSS / heap / CPU / handles / uptime in the registry (Constitution 11 §49)
export * from './storage-telemetry';   // BUILD_PLAN Phase 14 B: media / private store ops, bytes, errors, latency, lifecycle runs (Constitution 11 §49, §152)
export * from './telemetry-store';   // BUILD_PLAN Phase 14 A: the bounded, batched, fail-open sink into the platform's own log + trace store (Constitution 11 §291–292)
