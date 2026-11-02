// @aipowersalon/api-client — the transport core every frontend API client is built on (Constitution 13 §108, §245).
// Browser- and mobile-safe (§111–112): no server import, no Node API. Public API only (§97–99).
export { buildUrl, assertNoClientTenant, normalizeError, isEmptyState, newIdempotencyKey, createIntentKeys, type NormalizedError } from './http-core';
export { installAuthRefresh, refreshableUrl, type NativeTokenStore, type AuthRefreshOptions } from './auth-refresh';   // Constitution 3 Step 2b
export { API_V1_PREFIX, apiV1Path, buildApiUrl, isUnversionedPath } from './api-version';   // BUILD_PLAN Phase 12: every app calls /api/v1
export { runAsyncExport, type AsyncTransport, type AsyncExportAs, type RawResponse, type RunAsyncExportOptions } from './async-operation';   // BUILD_PLAN Phase 12: the one async export flow (202 → poll → download)
