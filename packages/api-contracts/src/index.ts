// @aipowersalon/api-contracts — the realm-independent runtime contracts (Constitution 13 §13: "pagination",
// "error codes", "enums" live here beside the request/response types). The realm types stay under ./tenant,
// ./customer and ./platform (§14) and are imported by subpath, never from here (§361: a customer app must not see
// the tenant or platform realm).
//
// This package is browser-safe and dependency-free (§111): nothing in it may import from outside the package.
// apps/api consumes it COMPILED (dist), like every backend package, so runtime code here cannot move the API's rootDir.
export * from './date-range';   // moved from apps/api/src/common/date-range.ts (Constitution 13 §219)
export * from './list-query';   // BUILD_PLAN Phase 12 (Constitution 5 §48–§52): the one filter / sort / search / range wire syntax
export * from './pagination';   // moved from apps/api/src/common/pagination.ts (Constitution 13 §219)
export * from './payment-status';   // moved from apps/api/src/payments/payment-status.ts (Constitution 13 §219)
export * from './appointment-status';   // Functional Decision 38 — one list of appointment statuses and groups
export * from './errors';   // Constitution 5 §28–31 / §221: the error-code registry and envelope (server filter + apps)
export * from './coded-error';   // V-5 (Oct 27 2026): withCode(err, CODE, params) — a refusal's registry code beside its English
export * from './cursor';   // Constitution 5 §46 / G10: the one cursor codec — keyset (v2) and offset (v3) — for the API and the apps
export * from './display-ads-rules';   // 23-inch dual-screen spec §51–§72, §110: customer-display advertising limits (server, POS, Super Admin)
export * from './display-device-rules';   // 23-inch dual-screen spec §8–§12, §85–§88, §97: display pairing codes, heartbeat, device state, receipt masking
export * from './display-mode';   // Dual-Screen mandate §11–§12: the ONE customer-display state model + its priority
export * from './check-in-rules';   // 23-inch dual-screen spec §20–§27: add-on category, the wait band
export * from './customer-phone';   // Phase 3: the customer phone status wire shape (API, POS, customer app)
export * from './tenant-twilio';   // Phase 4: a salon's own Twilio (masked; Verify Service; validation)
export * from './booking-verification';   // Phase 4: booking phone verification wire shapes
export * from './operations';   // Phase 12 (Constitution 5 §32–33): the one async operation contract (202 + statusUrl, status, download)
export * from './app-version';   // BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §150, §219–220): app version rules, /app-config + UPDATE_REQUIRED wire shapes
export * from './mobile-push';   // BUILD_PLAN Phase 13 D (Constitution 6 §58–63): typed push categories, per-app targeting, safe routes
export * from './mobile-biometric';   // BUILD_PLAN Phase 13 D (Constitution 6 §37–39): the biometric device credential wire shapes
export * from './client-telemetry';   // BUILD_PLAN Phase 13 E (Constitution 6 §116–119): analytics + perf allowlists, the one privacy sanitizer (apps + API)
export * from './payment-device-security';   // Secure Tap to Pay §51 (Oct 27 2026): owner + platform payment-phone security panels
export * from './mobile-links';   // BUILD_PLAN Phase 13 D (Constitution 6 §64–65): universal links / App Links, the AASA + assetlinks builders, bundle ids
export * from './realtime-ticket';   // BUILD_PLAN Phase 13 A (Constitution 6 §28–32): the native realtime stream ticket
export * from './language';   // BUILD_PLAN Phase 13 E (Constitution 6 §97–98): EN / VI and the per-user language preference
export * from './customer-notification-text';   // VietnamesePOS §54 / §119: a customer's appointment / bill notices in HER language
export * from './text/vi-fold';   // Vietnamese POS mandate §41 (WP-B stub, WP-E owns): accent-insensitive search key
export * from './text/coded-text';   // Vietnamese POS mandate §21/§120 (Oct 27 2026): server text as code + vars
export * from './telemetry-search';   // BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292): request / correlation / trace / log search wire shapes
export * from './pos-auto-lock';   // Oct 12 2026 (Kevin): POS auto-lock on by default at 60 minutes, server-enforced, full sign-in after 8 h locked (Decision 35)
export * from './payment-terminals';   // Oct 13 2026 (wave 3 PAYI §12/§50): the ONE normalized payment-terminal status + its derivation
export * from './sms-segments';   // Oct 13 2026 (wave 3 PAYI §77/§81): SMS segment estimate + the campaign cost preview shape
export * from './booking-drafts';   // B-22 (Oct 22 2026): POS booking drafts wire shapes
