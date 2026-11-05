// @aipowersalon/config — Constitution 13 §83–84: application configuration derived from the environment in ONE place.
// Every function takes the env as a parameter (default process.env): testable, and nothing reads process.env ad hoc.
// Secrets are NOT here — keys are resolved by the API's key ring (Constitution 12 §40–47), which stays in the API.
export * from './platform-urls';   // moved from apps/api/src/common/platform-urls.ts (Constitution 13 §219)
export * from './trust-proxy';   // moved from apps/api/src/common/trust-proxy.ts (Constitution 13 §219)
export * from './process-role';   // which background jobs this process runs (Constitution 13 Phase 8)
export * from './events-flags';   // the event publisher switch and the realtime delivery path (Constitution 8 / 13 §343)
export * from './instance-id';   // Phase 2: the holder name for scheduler leases
export * from './flag-rollout';   // Constitution 4 §76: percentage / selected-tenant rollout + per-flag kill (Phase 11)
