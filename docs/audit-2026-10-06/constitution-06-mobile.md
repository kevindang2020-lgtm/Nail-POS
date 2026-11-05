# Constitution 6 — Mobile (304 §) vs the tree (Oct 6 2026, 7301539f)

Verdict: **PARTIAL, about 40%.** Phase average ~41%; §303: 18 of 76 lines done, 15 present-but-not-re-verified-on-device,
27 partial, 14 missing, 2 need Kevin (iOS build on a Mac; signed Android build). The repo has FOUR Capacitor apps
(customer-web, tech-web, owner-web, manager-pay-web — the fourth is not in the spec).

Reconciliation with the Oct 3 conformance note: three of its five "mobile-core absent" items now exist elsewhere —
single-flight refresh (`packages/api-client/src/auth-refresh.ts`), push sign-out revoke (`lib/push.ts` ×4 + logout order),
realtime backoff (`packages/realtime-client/src/core.ts`). Still absent: the networking policy and app version. Realtime is in
all four mobile apps — but only on the web; on native it cannot connect.

## Status by area
| Requirement | Status | Evidence |
|---|---|---|
| Shared mobile core (§8, §250) | PARTIAL / EQUIVALENT | `packages/mobile-sdk` (secure store, native token pair, device id, biometrics, WebAuthn); no network/flags/push/logging/version; `packages/mobile-core` absent |
| API contracts (§9) | PARTIAL | `packages/api-contracts` imported by all four apps; `Principal`/`LoginResultBody` re-declared in all four `src/api/authApi.ts` |
| Realm clients (§10) | DONE | — |
| One networking layer (§11) | PARTIAL | `packages/api-client/src/http-core.ts` (buildUrl, no-tenant guard, normalizeError+action); four drifted `apps/*/src/api/client.ts` + three `http()` in `authApi.ts` |
| Request metadata (§12, §149) | MISSING | no X-Client-Type/Version/Device-ID/Request-ID; server reads `x-device-id` (`booking-verification.controller.ts:69,129`, `realtime-stream.ts:110`) but apps never send it |
| Timeouts (§13) | MISSING | no AbortController in any mobile client |
| Retry / idempotency (§14–15) | PARTIAL | `newIdempotencyKey`/`createIntentKeys` (`http-core.ts:95,105`) used only by manager-pay; booking create, `startService`, clock, approvals send none; `techApi.ts:126` no version/mutation id |
| Network state (§16) | MISSING | — |
| Offline (§17–23, §254–257) | MISSING | no read cache, drafts, queue, journal |
| Server-state layer (§24–27) | MISSING | useState + contexts only |
| Realtime client (§28–32) | DONE (web) / **BROKEN (native)** | `packages/realtime-client` (jittered backoff, dedupe, version guard, sequence resync, fallback poller, safety sync `sync-policy.ts:244`); native cannot connect (bug 1) |
| Secure storage (§33) | DONE | `capacitor-adapters.ts` Keychain/EncryptedSharedPreferences, no localStorage fallback; CI guard `native-auth-coverage.vitest.spec.ts` |
| Cache wipe + logout (§35, §181) | PARTIAL | logout: unregister push → `/auth/logout` → `clearNativeToken`; never disconnects realtime, never clears the biometric item |
| Face ID (§37–39) | PARTIAL | `native-faceid.ts:97-137` revalidates server-side but stores the ACCESS token, not a device key; no app PIN; ships off (`FACE_ID_ENABLED`) |
| Device registration / revocation (§40, §183) | EQUIVALENT / PARTIAL | `auth_devices` (496) bound from the login body (`auth.controller.ts:83-114`); revoke ends sessions/refresh; app learns on next 401 |
| Attestation / jailbreak (§41–42) | MISSING | optional |
| Bootstrap (§43) | PARTIAL | `AuthContext` via `/auth/me`; no tenant/permission/flag stage |
| Single-flight refresh (§44–45) | EQUIVALENT | `auth-refresh.ts:33-80` in all four `main.tsx:11-13`; failure → 401 → `aps:unauthorized` → login |
| Tenant / branch switch (§46–48, §239–240) | PARTIAL | `/owner/context/switch` server-validated with epoch; abort plumbing no-op (bug 6) |
| Permissions (§50–51) | PARTIAL | `principal.permissions` from server; no reload on resume/role change |
| Flags / kill switch / maintenance (§52–54, §219–220) | EQUIVALENT (server only) | `kill-switches.ts`, `tenant_app_flags`, maintenance 503; no client remote config/banner |
| Version enforcement (§55–57, §150) | MISSING | only `MOBILE_PAY_MIN_APP_VERSION` (`mobile-checkout.service.ts:61`) with a latent bug (7) |
| Push server (§58–63, §151) | DONE | `modules/communications/src/push`: APNs HTTP/2 + FCM v1, per-app topics, dead tokens revoked, consumer drops customer names (`push-notification.consumer.ts:32`) |
| Push client | PARTIAL | four copies of `lib/push.ts`; native plugin only in tech-web; no tap/deep-link handler; no typed categories; `dispatchToUser` not filtered by app (`push.service.ts:35-46`) |
| Deep / universal links (§64–65) | MISSING | no `@capacitor/app`, entitlements, AASA, assetlinks |
| Navigation (§67–68) | PARTIAL | typed tab/push-stack in tech + owner, react-router in customer; guards check only a principal |
| Feature folders (§7, §251) | MISSING | `screens/ components/ api/ lib/` |
| Per-app modules (§69–92, §155–157) | PRESENT, not re-verified | screens: customer 66, tech 27, owner 45, manager-pay 8 |
| Design system (§93–94) | DONE | `packages/ui` |
| Money / date (§99–100) | PARTIAL | `@aipowersalon/money` + `date-time` declared, imported in 0 app files; ~65 local formatters; branch `timeZone` never used |
| Error registry (§106, §236–237) | DONE | api-contracts + `normalizeError` action |
| A11y / OTP (§95–96) | PARTIAL | `one-time-code` at 17 sites; no a11y tests |
| i18n (§97) | MISSING | owner language selector is local state (bug 11) |
| Lifecycle (§108, §244) | PARTIAL | `visibilitychange` in realtime client only |
| Privacy screen / auto-lock (§130, §179, §245–246) | MISSING | — |
| Crash / analytics / perf (§116–119) | PARTIAL | `packages/ui/src/error-reporting.tsx` → `/client-telemetry/errors` (redacted) but version always `'unknown'` (123); no native crash, analytics, perf |
| Env / build variants (§133–136) | MISSING | Debug/Release only |
| iOS / Android config (§137–138) | PARTIAL | Face ID usage strings (not manager-pay); ATS off, cleartext on, no entitlements, no google-services.json |
| Separate store apps (§139) | DONE | four bundle ids (drift, bug 8) |
| Release / semver (§142–147) | PARTIAL | Android 1.6/1.4/1.4/1.0; iOS 1.0(1) all; `ANDROID_SUBMISSION_RUNBOOK.md`, `apple-readiness/*` |
| CI (§213) | PARTIAL | `security.yml` app vitest, lint, `vite build` (`check-frontend-builds.mjs`); no package tests, no app `tsc`, no native builds |
| CD / signing (§214–217) | MISSING | — |
| Mobile threat model (§290) | MISSING | `SECURITY_THREAT_MODEL.md` has no mobile content |

## Phases (§301)
1 Discovery PARTIAL · 2 Inventory MISSING · 3 Shared core PARTIAL · 4 Contracts PARTIAL · 5 Auth/realms DONE (C3) · 6 Secure
storage DONE · 7 Networking PARTIAL · 8 Server-state MISSING · 9 Realtime PARTIAL (native broken) · 10 Offline MISSING · 11
Push PARTIAL · 12 Device services PARTIAL · 13 Flags PARTIAL (server only) · 14–16 Customer/Tech/Owner PARTIAL · 17
Observability PARTIAL · 18 CI/CD PARTIAL · 19 Version enforcement MISSING · 20 Testing PARTIAL (~140 unit files; no
offline/push/device/E2E).

## Duplicates
faceid/webauthn/native-auth ARE consolidated into mobile-sdk. Still duplicated: `api/client.ts` ×4 (drifted); `authApi.ts
http()` ×3; `lib/push.ts` ×4 + `push-unregister.test.ts` ×4; `pushApi.ts` ×3 + techApi push methods; `AuthContext.tsx` ×3;
`Principal` ×4; Face ID "enabled" under three localStorage keys; ~65 money/date formatter files.

## Bugs
1. **Native realtime is dead.** Relative stream paths (`tech-web/src/lib/useTechStream.ts:10`,
   `customer-web/src/api/useCustomerStream.ts:9`, `manager-pay-web/src/lib/useCheckoutStream.ts:32`; owner only `APS_API_BASE`,
   `useOwnerStream.ts:12`); EventSource is cookie-only (`realtime-client/src/client.ts:62`), no query/ticket auth server-side →
   native falls back to the 15-s safety-sync poll.
2. **Face ID has no working case after Step 2b**: enrolls the 15-minute access token (`mobile-sdk/src/faceid.ts:41-43`); only
   succeeds while a refresh token is valid, when boot already restored the session; logout/401 call `clearNativeToken`, not
   `clearFaceId` (`tech-web/src/auth/AuthContext.tsx:33,52` and owner/customer), contradicting `native-faceid.ts:139`.
3. Stale guard vs manager-pay: guard asserts manager-pay "has no Face ID" (`native-auth-coverage.vitest.spec.ts:136-142`) but
   `manager-pay-web/src/screens/LoginScreen.tsx:76,102,177` shows a Face ID button with no plugin / usage description.
4. **Native base URL contradiction**: tech/owner `client.ts:7-8,18` default native to `http://localhost:3000`, which
   `native-bootstrap.ts:32` rejects (https only) → the app throws at startup; manager-pay Android `http` + cleartext exist for a dev API the same assert refuses.
5. customer-web / manager-pay `client.ts:10/9` capture `BASE` at load; requests use it (40/29) not `apiBase()` → runtime `APS_API_BASE` ignored for requests, honoured by the refresh wrapper.
6. `tech-web/src/api/client.ts:46` upload sends no bearer → native uploads 401; `OwnerSalonContext.tsx:113-116,172` exposes a `signal` nothing consumes.
7. **Latent Tap-to-Pay block**: `VITE_APP_VERSION` never set → if `MOBILE_PAY_MIN_APP_VERSION` is set every device fails `appVersionOk` (`manager-pay-web/src/App.tsx:56`); client error reports carry version `unknown`.
8. appId drift: `capacitor.config.ts` `com.aipowersalon.technician/.owner` vs Xcode/Gradle `com.powersalon.technician/.owner` (APNs topics must match the latter).
9. Push: only tech-web ships `@capacitor/push-notifications`; no entitlements / google-services.json; `tech-queue.service.ts:106` pushes the customer name unconditionally (`queue.service.ts:228` fallback too).
10. ATS/cleartext: `NSAllowsArbitraryLoads=true` (customer/tech/owner); `usesCleartextTraffic="true"`; `allowBackup="true"` ×4.
11. Fake language selector `owner-web/src/screens/OwnerSettingScreen.tsx:495,896`.
12. Stale test mocks (`tech-web/src/screens/LoginScreen.test.tsx:24-25`, `manager-pay-web/src/screens/LoginScreen.test.tsx:10-11` mock removed modules).
13. Package tests never run in CI (mobile-sdk, api-client incl. the single-flight test, realtime-client are outside `tooling/ci/run-tests.mjs:18-21`); app `tsc` not run.
14. `aps_bio_login_success` read/removed in three screens, never set.

## Build order
Code: (1) `MOBILE_ARCHITECTURE_AUDIT.md` (Phase 1–2 classification); extend `mobile-sdk` with `network/`, `push/`, `config/`
rather than a third package; (2) one mobile transport (single `apiBase`, bearer on all methods incl. upload, X-Client-*/
X-Device-ID/X-Request-ID, FAST/NORMAL/UPLOAD/LONG timeouts, GET-only backoff retry, Idempotency-Key option, AbortSignal);
delete the four `client.ts` and three `authApi.http()`; (3) native realtime (absolute base in all four adapters, native SSE auth
via short-lived stream ticket or fetch-SSE with Authorization — server change; disconnect on logout); (4) app version: one
source per app → `VITE_APP_VERSION` aligned with iOS/Android; server `GET /app-config` (min/recommended/latest per app+platform,
maintenance banner, flags), UPDATE_REQUIRED middleware, client gate screen, Super Admin version dashboard; (5) client remote
config (flags, module maintenance, kill-switch messaging); (6) server-state layer (TanStack Query) with tenant/branch keys +
realtime invalidation; offline read cache, NetworkState, "last updated"; (7) idempotency for booking create, start/complete
service, approvals; pending-mutation journal + crash recovery; (8) push client (one module, plugin in customer/owner/
manager-pay, tap routing re-authorizing, typed categories + app targeting, strip customer names, prompt timing); (9) Face ID
redesign (biometric-protected long-lived credential, launch lock, clear on logout/401; fix manager-pay button + guard); (10)
security config (release builds without ATS-off/cleartext, `allowBackup`, dev/staging/prod variants, appId alignment, privacy
screen, mobile threat model); (11) observability (version-labelled errors, sanitized analytics, perf marks); (12) i18n (EN/VI)
+ branch timezone; adopt money + date-time packages; (13) CI (packages lane, app `tsc`, Android debug assemble, `cap sync`
check); (14) tests (offline, realtime, push, upgrade, security); (15) feature-folder restructure (Kevin's call).
Kevin: Apple Developer account + Mac (entitlements aps-environment / associated domains / keychain groups, signing, TestFlight,
Tap to Pay plugin into the Xcode project); Firebase `google-services.json` ×4, FCM service account, APNs .p8, per-app topics;
domain hosting for AASA/assetlinks (Team ID, cert SHA-256); Play Console + signing keys; privacy labels; real-device Face ID
check; decisions: bundle-id prefix (`com.powersalon` vs `com.aipowersalon`), crash vendor, TanStack adoption, whether
manager-pay stays a fourth app.
