# Mobile Architecture Audit — Constitution 6 (Mobile), §301 Phases 1–2

BUILD_PLAN Phase 13 (Oct 9 2026). Written from the code as it stands at the END of Phase 13 (agents A–E), not from the
Oct 6 audit (`docs/audit-2026-10-06/constitution-06-mobile.md`, which this supersedes for the mobile apps). Every count
below was measured on the tree with the commands in §9.

## 1. Scope

Four Capacitor store apps — the constitution names three; the fourth (Manager Tap to Pay) stays a separate app by
decision (§5):

| App | Dir | Bundle id (native = truth) | Version (package.json = iOS MARKETING_VERSION = Android versionName) | Screens | Non-test src files | Test files | Distinct API paths |
|---|---|---|---|---|---|---|---|
| Customer | `apps/customer-web` | `com.powersalon.customer` | 1.6.0 (Android versionCode 8) | 68 | 96 | 64 | 93 |
| Technician | `apps/tech-web` | `com.powersalon.technician` | 1.4.0 (6) | 27 | 56 | 33 | 82 |
| Owner | `apps/owner-web` | `com.powersalon.owner` | 1.4.0 (5) | 50 | 76 | 63 | 97 |
| Manager Tap to Pay | `apps/manager-pay-web` | `com.aipowersalon.pay` | 1.0.0 (2) | 8 | 22 | 14 | 17 |

The customer display and the Go Check-In kiosk are Capacitor shells too; they are DEVICE principals (paired-device
tokens, proven in earlier phases) and are out of this audit's app-by-app scope.

## 2. Phase 1 — Discovery

| Area | What exists (end of Phase 13) |
|---|---|
| Framework | React 18.3 + Vite 5 + TypeScript 5.4, wrapped by Capacitor 8 (`@capacitor/core/ios/android/cli`). Same stack for all four; vitest + Testing Library for unit/render tests. |
| Navigation | Tech + Owner: typed in-memory tab/push stacks (`shell/nav.tsx`, no URL). Customer: react-router v6 (`BrowserRouter`). Manager-pay: in-memory `PayNavProvider`. Deep links / push taps enter through ONE closed route list + route gate (`mobile-sdk/links`, D). |
| State | Session: each app's `AuthContext` (manager-pay: `App.tsx`). Server state: `@tanstack/react-query` 5.103.2 via `mobile-sdk/query` (C) — scoped keys `[realm, tenant, branch, …]`, persisted read cache (IndexedDB web / device store native, secrets stripped, wiped on logout + tenant switch), realtime → invalidation, pending-mutation journal. Adopted on 11 main read screens (customer Home/Appointments/Wallet; tech Dashboard/Queue/Earnings/TicketDetail; owner Home/Approvals/Alerts; manager-pay Checkout queue); the rest still `useState` + effect. |
| API | ONE transport `mobile-sdk/network/transport.ts` (A): base read per call, `/api/v1` (`buildApiUrl`), bearer on native incl. uploads / cookie on web, `X-Client-Type/Version/Platform`, `X-Device-ID`, `X-Request-ID`, FAST 8 s / NORMAL 20 s / UPLOAD 120 s / LONG 60 s, GET-only jittered retry, `Idempotency-Key`, `normalizeError`, `NetworkState`, `onTiming` → telemetry. Each app's `api/client.ts` is a thin wrapper keeping its exported names. Gate `check:mobile-transport`. Wire types in `packages/api-contracts`. |
| Auth | Realms wired (customer / employee); single-flight refresh (`api-client/auth-refresh.ts`); native token pair in Keychain / EncryptedSharedPreferences (`mobile-sdk/native-auth`, `capacitor-adapters`). Face ID = biometric-protected long-lived DEVICE credential (migration 559 `device_biometric_credentials`, `/auth/biometric/enroll|login`, revoked on logout / password change / device revoke) (D). |
| Storage | Secrets: Keychain / Keystore only. localStorage holds only conveniences: customer `aps_customer_target_route`, `aps_signin_note`, `customer_faceid_enabled`; tech `aps_last_tech_salon`, `aps_tech_target_tab/pushed`, `tech_faceid_enabled`; owner `aps.owner.favoriteSalons/recentSalons`, `aps_owner_target_tab/pushed`, `owner_faceid_enabled`; all apps `aps.language` (E), the push token (D, not a secret), the query cache (C, secret-stripped). |
| Realtime | `packages/realtime-client` (backoff, dedupe, sequence resync, fallback poll). Native: short-lived single-use stream ticket (migration 557, `POST /realtime/stream-ticket`, `?ticket=` on SSE) — fixes bug 1 (A). Logout disconnects (`signalSignedOut`). |
| Push | ONE client `mobile-sdk/push` (D): permission after first meaningful action, register/rotate/unregister, typed categories, per-app targeting, tap → route gate. Server strips customer names from every push payload. |
| Device services | Biometrics (`@capgo/capacitor-native-biometric`), secure storage (`capacitor-secure-storage-plugin`), `@capacitor/app` (links, lifecycle), `@capacitor/push-notifications`, splash screen; manager-pay Tap to Pay native bridge (`native/tapToPay.ts`, plugin not yet in the Xcode project). Privacy screen + auto-lock (`mobile-sdk/security`, D). |
| Remote config / version | `GET /app-config` + 426 `UPDATE_REQUIRED` middleware, migration 558 `mobile_app_versions`, Super Admin "Mobile app versions" screen; client `AppConfigGate`, `useRemoteFlag`, `useModuleNotice` (B). One version source per app (`tooling/mobile/sync-versions.mjs --check`). |
| Observability (E) | Errors: `@aipowersalon/ui` reporter → `POST /client-telemetry/errors` with app + `VITE_APP_VERSION` + **platform** + route (tech/owner report the in-memory screen via `setCurrentScreen`). Analytics + perf: `mobile-sdk/telemetry` → `POST /client-telemetry/events` (batched, allowlisted). Super Admin: System Operations → "Mobile apps" count view (`GET /super-admin/system/mobile-telemetry`). |
| i18n (E) | `mobile-sdk/i18n`: `t()` / `useT()` over EN + VI catalogues, EN default + fallback; user's language saved server-side (migration 560 `users.preferred_language`; `GET {customer|owner|tech|pos}/me/locale` on every sign-in returns language + branch zone; `PUT owner/me/language` from the Owner Settings selector, now real — bug 11). The other three apps have no language UI yet: they follow the saved choice / device language; their selector + PUT route is a follow-up (a PUT no screen calls fails `check:unreached`). Business dates in the BRANCH time zone. |
| Build | `vite build` per app (gate `frontend builds`), `tsc --noEmit` per app (gate `app types`), app + package vitest lanes (`ci:test:apps`, `ci:test:packages`), native config gate, version gate, stale-mock gate. Native: `.github/workflows/mobile.yml` (Android `cap sync` + `assembleDebug`, iOS `cap sync`) — runs on GitHub's runners, not in this sandbox (no Android SDK here). |
| Release | `ANDROID_SUBMISSION_RUNBOOK.md`, `apple-readiness/*`, `docs/mobile/MOBILE_RELEASE_SETUP.md` (D: build variants, signing, entitlements, Firebase — Kevin's steps). Signing / TestFlight / Play upload are manual (Kevin). |

## 3. Phase 2 — Inventory classification

| Code | Class | Why / where it went |
|---|---|---|
| `packages/mobile-sdk` (auth, secure store, device id, biometrics, WebAuthn) | **KEEP** | The shared mobile core. Extended in place (no third package): `network/` (A), `config/` (B), `query/` (C), `push/` `links/` `security/` (D), `telemetry/` `i18n/` (E). |
| `packages/api-client` (`http-core`, `auth-refresh`, `api-version`, `runAsyncExport`) | **KEEP** | Under the transport (buildApiUrl, normalizeError, single-flight refresh). |
| `packages/realtime-client` | **KEEP** | Native path via stream tickets (A). |
| `packages/ui` (design system, error boundary/reporter) | **KEEP** | Reporter gained platform + current screen (E). |
| `packages/money`, `packages/date-time` | **KEEP → ADOPTED** | Were imported by 0 app files; now the display rules every mobile screen uses (E, §8). |
| `apps/*/src/api/client.ts` ×4 (drifted) + `authApi.ts http()` ×3 | **MERGE → REFACTOR** | Thin wrappers over the one transport (A); names kept so screens did not change. |
| `apps/*/src/lib/push.ts` ×4 + `pushApi.ts` ×3 | **MERGE** | Into `mobile-sdk/push` (D). |
| `Principal` ×4 re-declared | **MERGE** | Wire types from `api-contracts` (A/D). |
| Face ID "enabled" ×3 localStorage keys, `aps_bio_login_success` | **REFACTOR / REMOVE** | Device credential redesign (D): the credential lives in the Keychain / Keystore; the `*_faceid_enabled` keys remain only as a per-device UI preference. Bug 14's never-set key removed (0 references). |
| ~82 local `money()` / `fmtDate()` / `fmtTime()` one-liners | **MERGE** | Into `@aipowersalon/money` (+5 display rules) and `@aipowersalon/date-time` (+7 zone-aware display helpers) via `mobile-sdk` branch-zone wrappers (E). |
| Owner language `<select>` (local state, 5 languages, 3 untranslatable) | **REFACTOR** | Real EN / VI selector saved to the user (E, bug 11). |
| Stale test mocks (`vi.mock` of removed modules) | **REMOVE** | Two removed + gate `stale mocks` (E, bug 12). |
| `AuthContext.tsx` ×3 | **KEEP** (deliberately not merged) | Same shape, different realms / side effects; merging buys little and touches every screen. |
| Feature folders (`screens/ components/ api/ lib/` → per-feature) | **DEPRECATE (deferred)** | §7/§251 restructure is Kevin's call (Build order step 15); no code moved. |
| Three committed Android keystores + `key.properties` | **REMOVE (Kevin)** | Allow-listed in `check-native-config.mjs` until rotated; see §7. |

## 4. Decisions taken as defaults (Kevin may override)

1. **Bundle ids** — the native projects are the truth: `com.powersalon.customer`, `com.powersalon.technician`,
   `com.powersalon.owner`, `com.aipowersalon.pay`. `capacitor.config.ts` aligned (bug 8); gate `mobile native config`.
2. **Server-state layer** — `@tanstack/react-query` 5.103.2, one version across the four apps.
3. **Crash vendor** — none. The platform's own redacted `/client-telemetry/errors` (+ `/events` for analytics/perf),
   labelled app + version + platform. No third party receives telemetry. A native crash SDK (Crashlytics/Sentry) would
   add native-crash coverage (a JS reporter cannot see a native crash) — Kevin's call.
4. **manager-pay stays a fourth app.**
5. **i18n** — English + Vietnamese for the four mobile apps, English default and fallback; the language is the USER's
   (server), the time zone is the BRANCH's (§98–99); money stays USD in en-US format (currency is business context).
6. **Telemetry storage** — counters only (Prometheus metrics, aggregated across instances by the scrape; the Super Admin
   view shows this instance's counters). Nothing is stored per event; Phase 14 builds the persisted mobile dashboard.
7. **Language column** — `users.preferred_language` (migration 560), not `user_ui_prefs`, because that table is
   tenant-scoped and a customer has no tenant row there.

## 5. Observability (§116–119) — what lands, and the privacy proof

- **Errors (§118)**: app, `VITE_APP_VERSION` (B's single version source), platform (`ios|android|web`, allow-listed label),
  route path / current screen (ids stripped server-side), the last failed request id. Never a query string, body, token.
- **Analytics (§116–117)**: `track(event, props)` → `sanitizeAnalyticsEvent` (shared, `api-contracts/client-telemetry.ts`):
  13 listed events; each prop's VALUE is a closed set / route template / boolean / small count — never free text, so a
  name, phone, email, card, uuid, OTP or note cannot ride under an allowed key. Applied on the device AND again on the
  server. Proofs: `api-contracts/src/client-telemetry.test.ts` (9), `mobile-sdk/src/telemetry/telemetry.test.ts` (6),
  `apps/api/src/observability/client-events.vitest.spec.ts` (6 — the registry snapshot, logs and count view contain none of
  the PII strings posted). `booking_completed_ui` is a UI fact, never business truth.
- **Performance (§119)**: launch → first screen (once per launch), screen render, API latency by timeout class + outcome
  (the transport's `onTiming`, no URL), realtime reconnect reason. Histograms `aipowersalon_client_perf_ms`.
- **Not measured** (needs native SDKs): native crash rate, ANR rate, memory usage.

## 6. i18n, money and dates — coverage (honest numbers)

| Measure | Count |
|---|---|
| Catalogue keys (EN = today's English text) | 71 — shared 32 (sign-in, tabs, greetings, language) + customer 11, tech 5, owner 15, manager-pay 8 |
| Keys with a Vietnamese translation | 71 / 71 (a test per app fails on a missing VI key) |
| Call sites migrated to `t()` | 98 `tr(...)` sites + 3 greetings + the owner Language label: all four sign-in screens, all four tab bars, tech home greeting, owner Settings language row |
| User-facing literals in the four apps (JSX text + placeholder / aria-label / title, rough count) | ≈ 2,287 (customer 738, tech 514, owner 920, manager-pay 115) → **≈ 4–5 % of visible strings migrated**. The rest show English in VI mode (fallback by design); migrating them is mechanical (`useT()` + key + VI string) and is the main follow-up. |
| Named local money / date formatters replaced by `@aipowersalon/money` / `@aipowersalon/date-time` | **82** (in 66 files) — each new rule byte-identical to the one-liner it replaced (`money/src/display-rules.test.ts`, `date-time/src/display.test.ts` run under UTC, New York and Tokyo) |
| Inline formatting left in JSX | 63 sites: 26 inline date `toLocale*` calls (device zone), 37 number / money-in-input prefill / points counts |
| Branch time zone | owner: the selected branch (else the salon's first) — `OwnerBranchContext`; tech / customer / manager-pay: `GET {realm}/me/locale` → session branch, else the salon's first branch; signed out → device zone (= today's output) |

## 7. Only Kevin can do (exact actions)

1. **Apple** (Apple Developer account + a Mac with Xcode): set the Team and signing for the four targets; add entitlements
   `aps-environment` (push), Associated Domains `applinks:<your domain>` (universal links), keychain sharing if wanted;
   create an APNs `.p8` auth key and set the server env `APNS_KEY_ID`, `APNS_TEAM_ID`, the key (`APNS_KEY_P8*`), `APNS_ENV`, and the per-app `APNS_TOPIC_*` (= the bundle ids); add the Tap to Pay plugin to
   the manager-pay Xcode project and request the Tap to Pay entitlement; archive + TestFlight; App Store privacy labels.
2. **Google / Firebase**: create the four Firebase Android apps, download `google-services.json` ×4 into each
   `android/app/` (kept out of git; the native-config gate refuses committed ones), create the FCM v1 service account and set
   `FCM_SERVICE_ACCOUNT_JSON` (or `_B64`) as server env; Play Console listings + Play App Signing.
3. **Rotate the three committed Android upload keystores** (`apps/{customer,tech,owner}-web/android/*.jks` + `key.properties`
   with their password): create new upload keys, register them in Play Console (upload-key reset), delete the old files
   from the repo AND its history, store the new ones outside git (`docs/mobile/MOBILE_RELEASE_SETUP.md`).
4. **App / universal links**: serve the domain; set the API env `APPLE_TEAM_ID` (AASA) and
   `ANDROID_CERT_SHA256_<APP>` (assetlinks.json, the release cert SHA-256 per app), plus `APP_LINK_WEB_<APP>` fallbacks — the API returns 404 until set.
5. **Real-device checks**: Face ID enrol / login / revoke on an iPhone, Android biometric, push delivery + tap on both,
   offline queue on a device, privacy screen in the app switcher.
6. **Run the native CI lane once**: the `mobile` workflow (`.github/workflows/mobile.yml`) needs a push to GitHub; confirm
   the four `assembleDebug` jobs and `cap sync` checks pass (cannot run here: no Android SDK).
7. **Decisions**: a native crash SDK (yes / no, which); `com.aipowersalon.pay` adopted for the fourth app; the feature-folder restructure (§7/§251); more languages beyond EN / VI.

## 8. CI lanes (§213, bug 13)

| Lane | Where | Status |
|---|---|---|
| install, lint, `vite build` all apps | `security.yml` fast → `ci:gates` (`frontend builds`) | existing |
| typecheck all SPAs | `ci:gates` → `app types` | existing (Phase 11) |
| app unit/render tests | `security.yml` tests matrix `apps` | existing |
| package tests incl. mobile-sdk, api-client, realtime-client | `security.yml` tests matrix `packages` (`run-tests.mjs packages`) | existing since Oct 6 — bug 13's package half was already closed; verified all three have a vitest config and run |
| stale test mocks | `ci:gates` → `stale mocks` (`tooling/ci/check-stale-mocks.mjs`) | **new (E, bug 12)** |
| native config / versions | `ci:gates` → `mobile native config`, `mobile versions` | new (D, B) |
| Android `cap sync` drift + `assembleDebug` ×4, iOS `cap sync` ×4 | `.github/workflows/mobile.yml` | **new (E)** — GitHub runners only |
| §301 phase 20 tests in CI | offline (C: `customer-offline.test.tsx`, journal/cache tests — apps + packages lanes; browser check `live-phase13-offline.mjs` manual), realtime native (A: ticket tests in api lane; `live-phase13-native-realtime.mjs` manual), push (D: mobile-sdk push tests + `apps/api/src/common/push-producers.vitest.spec.ts`, `push-targeting.vitest.spec.ts`), upgrade gate (B: `mobile-config.pgtest` + config gate tests; `live-phase13-app-version.mjs` manual), security config (D: `apps/api/src/common/mobile-native-config.vitest.spec.ts` + gate) | all in CI except the three `live-phase13-*` scripts, which boot a server + browser and stay manual |

## 8b. The Oct 6 audit's bugs — status at the end of Phase 13

| # | Bug | Status | By |
|---|---|---|---|
| 1 | Native realtime dead | Fixed — stream tickets, absolute base | A |
| 2 | Face ID has no working case | Fixed — biometric device credential | D |
| 3–7 | manager-pay guard, native base URL, captured BASE, upload bearer, latent version block | Closed Phase 1; 5–7 re-verified by the one transport (A) and `/app-config` (B) | A, B |
| 8 | appId drift | Fixed + gate | D |
| 9 | Push only in tech-web, customer names in payloads | Fixed (all four apps; names stripped, producer spec) | D |
| 10 | ATS / cleartext / allowBackup | Fixed for release builds + gate | D |
| 11 | Fake owner language selector | Fixed — real EN / VI, saved to the user | E |
| 12 | Stale test mocks | Fixed (2 found) + gate `stale mocks` | E |
| 13 | Packages / app tsc not in CI | Already closed in Phase 11–12 (verified); native lane added | E |
| 14 | `aps_bio_login_success` never set | Removed | D |

## 9. How the numbers were measured

Screens: `ls apps/<app>/src/screens/*.tsx | grep -v test`. API paths: distinct string literals passed to
`api|transport.(get|post|put|patch|del|upload|request)`. Strings: JSX text nodes and `placeholder|aria-label|title`
literals with ≥ 2 letters in non-test `.tsx`. Formatters: named `money|fmt*|format*|usd|money0|money2|timeOf|dt|day|ago|
clock|longDate|apptWhen` definitions whose body now calls the shared packages; inline: remaining
`toLocale*|Intl.*|toFixed(2)` calls.

## 10. Not done (follow-ups)

- ~95 % of visible strings still English-only (fallback); 26 inline date sites still device-zone.
- A language selector in the customer / tech / manager-pay apps (+ their `PUT {realm}/me/language`).
- Query layer on 11 of ~153 screens (main read screens only).
- Native crash / ANR / memory metrics (need a native SDK, decision 3).
- Persisted, fleet-wide mobile telemetry dashboard (Phase 14).
- Feature-folder restructure (Kevin's call).
