# REPOSITORY_ARCHITECTURE_AUDIT.md — Constitution 13, Phases 1–4 (Discovery, Dependency Graph, Classification, Duplicates)

**Measured on `d969655` (Sep 22, 2026), by scripts — not from memory.** The graph and duplicate figures below are
reproduced by `tooling/architecture-tests/` (Phase 11 enforcement starts from this baseline so nothing gets worse
while domains migrate). Spec: `AI_PowerSalon_Repository__amp__Monorepo_Architecture_Constitution_13.md` (389 sections).

## 1. Repository map (§204)

| Area | What exists today | Size |
|---|---|---|
| **Apps (TS)** | `apps/api` (NestJS 10, Kysely, **200 `src/` directories**), `apps/pos-web`, `apps/admin-web` (Super Admin), `apps/owner-web`, `apps/tech-web`, `apps/customer-web`, `apps/manager-pay-web`, `apps/customer-display` — all Vite/React 18; the four mobile apps are Capacitor 8 wrappers of the web apps | api 193,623 lines · admin 41,879 · pos 37,642 · customer 8,932 · owner 7,654 · tech 5,427 · manager-pay 2,508 · display 1,271 |
| **Apps (static)** | `apps/booking-html`, `apps/booking-public`, `apps/booking-schedule-html`, `apps/go-check-in-admin` — an `index.html` + `public/` each, no source; `apps/go-check-in-kiosk` — Capacitor shell over a prebuilt `www/` — **Phase 15 (Oct 10 2026): `booking-html`, `booking-schedule-html`, `go-check-in-admin` removed (§9)** | 0 lines |
| **Packages** | `packages/ui` (497 lines, error boundary + primitives), `packages/realtime-client` (519 lines) | 2 packages |
| **Modules** | none as workspace packages — **the domains live as NestJS module directories inside `apps/api/src/`** (customers, booking, queue, checkout, payments, deals, memberships, loyalty via events/consumers, communications, ai-*, audit, security via `common/` + `super-admin-security/`, …) | 200 dirs |
| **Workers** | in-process: the outbox publisher, 21 schedulers, fraud/integrity/secret-rotation jobs — all inside `apps/api` (`runJob` telemetry, Constitution 11) | no `apps/workers` |
| **Realtime** | in-process SSE gateway `apps/api/src/realtime/` (Constitution 9); client in `packages/realtime-client` | no `apps/realtime` |
| **Database** | `apps/api/src/database/` (Kysely provider, generated types 7,210 lines) + `apps/api/db/migrations/` (457 files, `NNN_name.sql`) | one authoritative location ✓ |
| **Auth / permissions / tenant context** | `apps/api/src/auth/` (sessions, MFA, passkeys, throttles), `apps/api/src/common/security-core.ts` + `auth/rbac.ts` (RBAC + scopes), `apps/api/src/common/tenant-context.middleware.ts` (request-scoped `req.ctx`, C11 `enrichContext` async context) | all inside the API app |
| **API contracts** | none shared: each web app hand-writes its own `src/api/*.ts` clients and types | see §4 |
| **Provider clients** | all HTTP `fetch` through C11's `instrumentedFetch` — **no provider SDK is imported anywhere** (no `openai`, `twilio`, `stripe`); AWS S3 SDK in `common/` (evidence) + `tech-profile/` (media) | 41 call sites in 25 dirs |
| **Infrastructure** | `railway.json`, `Dockerfile`, `docker-compose.yml`, `deploy/terraform/` (3 files) | spec wants `infrastructure/` (§192) |
| **Tooling** | root `eslint.config.mjs`, root `tsconfig.json` + 11 app/package tsconfigs, `scripts/` (brand sync, verify), 17 `check:*` gates in `apps/api/scripts/` | spec wants `tooling/` (§199) |
| **Docs** | `docs/` (77 files, 11 subfolders — feature/history reports), root `*_AUDIT.md` / `*_REPORT.md` from Constitutions 4–12, `HANDOFF/`, `_MERGE_ARTIFACTS/` (42 files) — **both removed Phase 15 (§9)**, `apple-readiness/` (19) | no `docs/architecture`, no `docs/adr` |
| **Tests** | 1,129 API spec files (148 real-schema PGlite), 512 app tests, `browser-tests/` (3 e2e), one embedded-real-PostgreSQL lane | close to code ✓ |
| **Workspace** | npm workspaces (`apps/*`, `packages/*`), no `packageManager` field, **three lockfiles** (root + `apps/api` + `apps/pos-web`) — **Phase 15: one (root); the nested two deleted (§9)** | §125 violated → met |
| **CI** | `.github/workflows/security.yml` only (security gates every push; nightly full battery) — no build matrix, no lint, no typecheck step | §224 gap |

## 2. Dependency graph (§205)

**API-internal, directory level:** 198 directories with imports, **918 edges**.
- **One cycle, 53 directories strongly connected.** It is caused by only **15 platform→domain back-edges**:
  `common` → ai, api-webhooks, checkout, super-admin-merchant-accounts, super-admin-ticket-removal, tenant-safety-community ·
  `events` → push, queue, super-admin-system-status · `observability` → ai, super-admin-platform ·
  `payments` → settings, super-admin-platform · `auth` → technicians · `notifications` → branding.
  Six of the fifteen are **Constitution 12's own additions** (`common/fraud-detector → checkout` for refund thresholds;
  `common/restore-verify` → three domains for their decrypt functions; `common/evidence-scanner`; `common/guards/ai-entitlement`).
  Remove these 15 edges (interfaces/ports, or moving the shared concept down) and the cycle dissolves — §102.
- **Most depended-on:** `database` (181 dirs), `common` (175), `observability` (34), `realtime` (30), `auth` (28), `audit` (25), `ai` (15), `events` (13), `payments` (13). These are the platform packages the spec names — they already behave as such.
- **Highest fan-out domains:** checkout (14), ai-center (13), customer-booking (12), queue (11), owner (11), tech-profile (10). Checkout at 14 is the §256 signal: it is an orchestrator (§257), and should be structured as one.
- **Frontend → backend imports: 0** (a first scan reported three; they were each app's own `src/api/` folder — a pattern false-positive, recorded here so it is not re-found).
- **Provider SDKs:** none. Every provider is an HTTP adapter over `instrumentedFetch`; the boundary to enforce is *which directories may contain provider URLs* (41 sites in 25 directories today — payments 8, super-admin-tenants 5, hardware-payment 5, mobile-checkout 4, checkout 4 …). `checkout` and `mobile-checkout` containing processor URLs is the §341 "checkout → Fiserv directly" shape to fix.
- **Raw Kysely:** 439 files import Kysely — 266 are repository/store/query files (correct), **173 are services/controllers** issuing queries directly (§24).

## 3. Classification (§206)

| Directory | Class | Notes |
|---|---|---|
| `apps/api` | APP (composition root) — but hosts 21 DOMAIN MODULES + PLATFORM code | the whole migration is unbundling this |
| `apps/pos-web`, `apps/admin-web`, `apps/owner-web`, `apps/tech-web`, `apps/customer-web`, `apps/manager-pay-web`, `apps/customer-display` | APP | names preserved (§3): admin-web = super-admin, tech-web = technician-app, customer-web = customer-app, owner-web = owner-app |
| `apps/booking-html`, `apps/booking-public`, `apps/booking-schedule-html`, `apps/go-check-in-admin` | **LEGACY** | static shells with no source; owner: platform; replacement: `apps/pos-web` / customer-web routes; removal condition: no Railway service or link references them. **Phase 15:** three removed (§9); `booking-public` re-classified **APP** — it is the live no-login signed-link page of the AI-booking public channel (`ai-booking-public.controller.ts`), with no replacement, and is kept |
| `apps/go-check-in-kiosk` | APP (thin Capacitor shell) | keep |
| `apps/api/src/database`, `common`, `observability`, `auth`, `events`, `realtime`, `notifications`, `cache`, `health`, `config` | PLATFORM PACKAGE (in the wrong place) | candidates for `packages/*` |
| `apps/api/src/<domain>` (customers, booking, customer-booking, queue, checkout, payments, deals, memberships, communications, audit, support*, ai-*, reports, …) | DOMAIN MODULE (in the wrong place) | 21 target domains map onto ~150 of these dirs; the `super-admin-*` dirs are the *platform control plane* (§270) |
| `packages/ui`, `packages/realtime-client` | PLATFORM PACKAGE | keep; extend |
| `deploy/`, `railway.json`, `Dockerfile`, `docker-compose.yml` | INFRASTRUCTURE | move under `infrastructure/` (§192) |
| `scripts/`, `apps/api/scripts/`, `eslint.config.mjs`, `tsconfig.json` | TOOLING | `tooling/` (§199) |
| `docs/`, root audits/reports | DOCUMENTATION | add `docs/architecture`, `docs/adr` |
| `HANDOFF/`, `_MERGE_ARTIFACTS/`, `apple-readiness/`, `marketing/`, `brand/`, `browser-tests/`, `ops/` | LEGACY / DOCUMENTATION / TOOLING | `_MERGE_ARTIFACTS` and `HANDOFF` are historical reports (move to `docs/history`) — **Phase 15: removed instead (superseded; git history keeps them, §9)**; `brand/` is the source of the six identical brand copies (§4) |
| `UNKNOWN` | none | every directory classified |

## 4. Duplicate inventory (§207)

- **14 groups of byte-identical files across apps, ~2,770 duplicated lines:** brand (`PlatformLogo.tsx`, `branding-client.ts`, `platform-brand.ts`) ×6 · `InlineConfirm.tsx` ×5 · `api/http-core.ts` ×5 · `lib/money-input.ts` ×4 · `auth/native-auth.ts`, `auth/faceid.ts`, `auth/native-faceid.ts`, `api/webauthn.ts` ×4 · `auth/native-bootstrap.ts`, `auth/capacitor-secure-store.ts` ×3 · `InlineAsk.tsx`, `useEscapeKey.ts` ×2. These ARE `packages/mobile-sdk` (§89), `packages/ui` (§88) and the API-client core (§108) that the spec asks for.
- **20 same-path files that have drifted** (`LoginScreen.tsx` ×6, `api/authApi.ts` ×6, `api/client.ts` ×6, `AuthContext.tsx` ×5, `AcceptInviteScreen.tsx` ×4, …): the duplicate-authentication-system shape (§387).
- **346 exported type names defined in two or more apps** (`Principal` ×6, `LoginResultBody` ×6, `NormalizedError` ×6, `FollowUpStatus` in api+3 apps, …): §15 "apps should not recreate API types". The fix is `packages/api-contracts` (§13), realm-split (§14).
  **Correction (Phase 5, api-contracts slice 1):** that 346 counted `apps/api` as an "app". Split properly: **332 are frontend types re-declaring an API type** (324 of them inside the apps' `src/api/*` client files) and only 10 are frontend↔frontend. Of the frontend copies, 225 are identical to the API's definition and **114 have drifted** (a first measurement said 163 — a normalizer that treated a trailing separator and a leading `|` as differences; fixed before any figure was used). Tracked by the architecture gate as `mirroredApiTypes` (ratchet: 264 after slice 1).
- **API clients per app:** admin 49 files, pos 96, customer 16, tech 9, owner 8, manager-pay 6 — each hand-written against the same API.
- **Seven near-identical AES-GCM modules in the API** (`mfa-enc`, `provider-crypto`, `funding-crypto`, `webhook-crypto`, `ticket-deletion-crypto`, …): Constitution 12 unified their *keys* (`key-ring.ts`) but not the cipher code. One `packages/security` `encrypt(purpose, …)` removes the duplication **and** three of the fifteen cycle edges.
  **Done (Phase 5, `packages/security`):** one `seal`/`open` over both wire formats at rest; the seven modules are adapters with unchanged exports; `restore-verify` decrypts through the package — **back-edges 15 → 12, largest cycle 53 → 49**. Backend packages are consumed *compiled* (`dist/*.d.ts`, because `apps/api` pins `rootDir`), so the build order is `build:packages` → API, in the Dockerfile and CI; tests resolve packages to source.
- **Three `maskEmail` implementations** (`customer-identity/identity-core.ts`, `super-admin-platform/payments-core.ts`, `observability/redaction.ts`) with three different outputs — `packages/security`'s data-classification helpers (§81) absorb them; until then mobile-checkout reuses identity's (one new domain→domain edge, 919).
- **Ticket status on the mobile detail:** `CheckoutTicketDetail` never carried `status` (only the queue row does); the Tap-to-Pay ticket badge that read it always rendered empty and was removed — the checkout module migration should carry status on the detail projection.
- **`Money = number` is declared separately in at least four API files** (checkout-display, overview, booking, tech-appointments): the §86/§259 shared-kernel type in alias form. The checkout slice resolved it to checkout's; `packages/money` gives it one home.
- **Super Admin APIs that return unnamed or implementation-derived shapes** (found while moving the platform-realm contracts): analytics returns inline objects the app guesses at (`TopTenant` with every field optional; app-side `Kpi`/`TrendPoint`/`StateRow`/`Recommendation`); settlements declares `SettlementsOverview` as `ReturnType<typeof rollupKpis>`. Neither can be a contract until the API names its responses — Phase 6 work for those domains.
- **Three `FollowUpStatus` enums with different meanings** — end-of-day follow-ups (ten workflow states, now the tenant contract), voice-booking's ticket states, and the customer app's three visible states (renamed `CustomerFollowUpStatus`). The API does not name its customer projection (`/customer/follow-ups`); it should (§268), in the customer realm. Likewise `FollowUpTemplate` carries a `render()` function — the API's internal template, not the response view the tech app declares.
- **Money — corrected:** the "19 money/cents files" was a name match on the AI *money-protection* domain (fraud rules), not money utilities. The real duplication was `Money = number` in **nine** API files, seven byte-identical `centsToUsd`, and three distinct display rules under similar names. **Done (Phase 5, `packages/money`):** one integer-cents `Money`, the exact parser, the three display rules under distinct names, and the compensation engine's largest-remainder allocation; every prior site is a re-export.
- **Dates (§87) — `packages/date-time` done:** one `zonedParts` decomposition replaces four hand-rolled ones (owner `zparts`, reminders `tzOffsetMs`, queue `todayInTimeZone`, campaigns `localHour`); `businessDate(tz)` is the salon's day. **Open, ratcheted:** 107 inline `toISOString().slice(0, 10)` (the UTC day) across 83 API files — each needs a judgment (UTC key vs salon day) during its domain's Phase 6 migration; the gate forbids new ones.
- **Two pre-existing test breaks surfaced by the first FULL API run** (7,903 tests; earlier commits ran targeted suites only): an API-side guard asserted each mobile app owns `src/auth/native-auth.ts` (moved to `packages/mobile-sdk` in the first Phase 5 commit — the guard now checks that each app wires the SDK); and `customer-security.pgtest` claimed "the REAL schema" but hand-built a `sessions` table that fell behind Constitution 12's device columns — it now uses the migrated schema. **Method change:** the whole API suite runs before every commit.
- **Workspace packages were never registered in the lockfile** — `realtime-client` (Constitution 9), `mobile-sdk`, `api-contracts`, `security`, `money` had no `package-lock.json` entry and no `node_modules` link, so `npm ci` in the Dockerfile would have refused the tree and the compiled API's `require('@aipowersalon/security')` failed at runtime; tests passed because they resolve to source. Fixed by `npm install` (workspace links only — no third-party version moved) and a permanent gate rule.
- **Dependency versions (§126):** React 18.3.1, Vite 5.4.8, Capacitor 8.4 aligned ✓; `vitest` ^2.1.9 ×3 vs ^1.6.0 ×1; `typescript` `~5.4.5` ×7 vs `5.4.5` ×1.
- **Workspace names (§114):** `@aipowersalon/api`, `@aipowersalon/ui`, `@aipowersalon/realtime-client` vs `aipowersalon-pos-web` etc. — two conventions.

## 5. Decisions

- **D1 — npm workspaces stay** (§123: preserve a healthy package manager). Nested lockfiles in `apps/api` and `apps/pos-web` are deleted; root lockfile is authoritative (§125). `packageManager` is pinned.
  **Correction (Phase 15, Oct 10 2026):** the nested lockfiles were only *baselined* until Phase 15, which deleted them; `packageManager` was never pinned (root `package.json` has no such field) — recorded as an open decision in §9, not silently claimed.
- **D2 — No build orchestrator is added** (§124). npm workspace scripts + `--workspace` filtering cover §132; §133's affected builds are recorded as a later option, not installed now.
- **D3 — Domain modules stay NestJS modules and move to `modules/<domain>` as workspace packages one at a time (§209)**, each with `src/index.ts` as its only public API (§97) and `exports` in `package.json` (§99). `apps/api` becomes the composition root that imports them (§148). Existing route paths, event names and table names do not change (§200–202).
- **D4 — The in-process workers and SSE gateway stay in-process for now.** Railway runs one replica; `apps/workers` and `apps/realtime` as separate deployables (§60, §63) are made *possible* — worker entrypoints and the gateway take their business logic only from modules — and extracted when scaling needs it (§286, §288–289). The Definition of Done's "Workers thin / Realtime thin" is met by structure, not by a second process.
- **D5 — Existing app names are kept** (§3): `admin-web` is the Super Admin app, `tech-web`/`customer-web`/`owner-web` the mobile apps. Workspace names are normalised to `@aipowersalon/*`.
- **D6 — Order of foundation packages (§208), chosen by duplication measured above:** `mobile-sdk` and `ui`/brand first (pure byte-identical moves: lowest risk, largest immediate deletion), then `api-contracts` (346 duplicate types), then `security` (seven ciphers → one; three cycle edges), `money`, `date-time`, then `database`/`auth`/`permissions`/`tenant-context`/`events`/`observability` (which already behave as packages inside the API).
- **D7 — The 15 back-edges are removed by ports, not lazy imports** (§102). Each is listed in the baseline; the architecture test fails on any new one.
- **D8 — Nothing is deleted until the architecture test shows zero importers** (§215). Static legacy apps are the first removal candidates, after confirming nothing deploys or links them.

## 6. Target mapping (existing → spec)

| Spec | Existing owner today | Migration |
|---|---|---|
| `apps/super-admin` | `apps/admin-web` | keep name |
| `apps/customer-app` / `technician-app` / `owner-app` | `customer-web` / `tech-web` / `owner-web` (Capacitor) | keep names |
| `apps/workers`, `apps/realtime` | in-process in `apps/api` | D4 |
| `modules/loyalty` | **done** — the first module out (six files, only `database` + `permissions`); `modules/*` is a workspace root; build order packages → modules → API | Phase 6 ✓ |
| `modules/gift-cards`, `modules/inventory` | **done** via `tooling/modules/extract-module.py` — public entry derived from actual inbound imports (checkout's use of card-number/claim/clearing = the §36 stable interface) | Phase 6 ✓ |
| `modules/customers` … `modules/support` (remaining 18) | `apps/api/src/<dirs>` — ~50 directories now import nothing else from the API (measured after the database + permissions packages) | Phase 6, one at a time |
| `packages/database` | **done** (`DB`, handles, `DatabaseModule.forRoot({ poolHook })` — telemetry injected); `db/migrations` still under `apps/api` (runner, PGlite harness and Dockerfile reference it — a later move) | Phase 5 ✓ |
| `packages/permissions` | **done** — `security-core` (kernel), `rbac` (catalog), the four clean guards; the AI-entitlement guard stays in the API (domain-specific) | Phase 5 ✓ |
| `packages/auth`, `tenant-context` | `src/auth` (sessions, MFA, passkeys), `common/tenant-context.middleware.ts` | Phase 5 |
| `packages/api-contracts` | none (346 duplicate types) | Phase 5 |
| `packages/events`, `realtime-contracts` | `src/events`, `src/realtime` + `packages/realtime-client` | Phase 5/9 |
| `packages/notifications`, `payments` (providers), `ai-platform` | `src/notifications` + `src/auth/sms.service`, `src/payments/processor.factory`, `src/ai` (C10 gateway) | Phase 5/10 |
| `packages/observability`, `security`, `config`, `errors`, `money`, `date-time`, `feature-flags`, `testing` | `src/observability`, `src/common/*` (key-ring, headers, redaction…), scattered `process.env` (secrets-inventory exists), `common/*Error`, 19 money files, none, `src/feature-flags`?, `test-support/` + `security-expectations.ts` | Phase 5 |
| `packages/ui`, `mobile-sdk` | `packages/ui` (exists), the ×4 identical `auth/*` files | Phase 5 first |
| `infrastructure/`, `tooling/`, `docs/architecture`, `docs/adr` | `deploy/` + root files, `scripts/` + gates, none | Phase 5/11 |

## 7. Risks the plan must respect

- 1,129 API test files import by relative path; every module move must carry its tests and keep them green (§222).
- The `super-admin-*` directories (platform control plane) must not become a "platform" import for tenant domains (§270).
- 173 services/controllers run Kysely directly; moving them into modules does not fix §24 by itself — repository extraction is per-domain work in Phase 6.
- The 12 app shells' `_headers` files (Constitution 12) are generated per app; moving apps must keep `generate-app-headers.mjs` in step.

## 8. What the first module extraction established (Phase 6 mechanics)

- **A module depends on packages only** — `database` and `permissions` had to exist first; the AI-entitlement guard (imports the AI domain) stays in the API. A gate rule (§105) fails any module that imports `apps/` or reaches into another module by relative path.
- **Build order is packages → modules → API**, in the Dockerfile and CI (`build:packages`, `build:modules`); the API consumes modules compiled (`dist/index.d.ts` via `paths`), tests resolve them to source via vitest aliases.
- **Every gate walks every root.** Nine gates enumerated controllers/repositories by walking `apps/api/src`; the route table behind `crosswire`/`unreached`/`nav` broke the moment the loyalty controller moved. All now walk `modules/*/src` too, and an uncatalogued permission planted inside the module fails `check:perms`.
- **One route table.** `audit-routes.js` is the single source; it includes module routes, so the client-versus-route check keeps working as domains move.
- **Tests leave the checks' view as easily as code does.** Moving gift cards out: (1) its schema test located migrations by `process.cwd()` and *skipped* all seven tests from the module — the database package now states `MIGRATIONS_DIR`; (2) five Nest-free `*-core.spec.ts` files run through `scripts/run-core-specs.sh`, which searched only `apps/api/src` — it now searches `modules/*/src`. Module vitest configs include only vitest files, so a core spec can never register as "no tests".
- **The codemod is the method now:** `extract-module.py <name> <dir> [--apply]` refuses a directory that still reaches into the API, moves with history, derives the entry point, rewires importers and wiring. Twenty modules should not be twenty hand-done migrations.
- **The API's `app.module.ts` is becoming the composition root** (§148): it imports `LoyaltyModule` from the package like any other dependency.

## 9. Phase 15 — the §388 close-out (Oct 10 2026, BUILD_PLAN_2026-10-06.md line 31)

Method: the zero-importer rule (§215, D8). For each path every reference was found (workspaces, Dockerfile, `railway*.json`,
`.dockerignore`, CI workflows, `scripts/`, the API's gates and e2e harnesses, tests, API static serving — there is none: the
API image ships no frontend and `build-frontends.sh` was the only stager), the live feature it served was matched to a
**wired replacement by endpoint**, references were repointed, and only then was the path deleted. Recover any of them with
`git checkout 62a1875d -- <path>` (the last commit that has them).

| §388 line | Before | Replacement / evidence | Status |
|---|---|---|---|
| Single lockfile (§125) | `apps/api/package-lock.json`, `apps/pos-web/package-lock.json` baselined | every install is `npm ci` at the root (Dockerfile build + runtime stages, `security.yml` ×4, `mobile.yml` ×2 — the `working-directory:` steps run `tsc`/`vitest`/`vite`, never an install); no tool reads a nested lockfile | **DONE** — deleted; `architecture:test` fails on ANY nested lockfile (absolute rule, no baseline) |
| `apps/go-check-in-admin` (static device manager) | staged by `build-frontends.sh`, brand-synced, scanned by `crosswire`/`dead-client`/`html`, e2e journey | **admin-web → Check-In Devices** (`/check-in-devices`, `CheckInDevicesScreen.tsx` + `api/checkInDevicesApi.ts`, nav-gated `super_admin.operations.view`, tested): calls all 6 routes the page called (`GET/POST …/go-check-in`, `PATCH …/settings`, `PATCH …/:id`, `POST …/:id/disable`, `POST …/:id/regenerate-token`, `GET …/logs`) plus branch assignment | **DONE** — removed |
| `apps/booking-html` (signed-in customer booking page) | scanned by `html`, e2e journey, CSP test | **customer-web → Book** (`BookScreen.tsx`, `PhoneVerificationStep.tsx`, `RegisterScreen.tsx`): all 9 paths the page called (`/auth/login`, `/auth/logout`, `/customer/auth/register`, `/customer/booking{,/availability,/options,/verification/send,/check,/captcha}`), on `/api/v1` with an idempotency key — the page itself still called the deprecated unversioned paths | **DONE** — removed |
| `apps/booking-schedule-html` (staff booking schedule page) | scanned by `html`, e2e journey | **pos-web → Booking** (`/tenant/booking`, `POSBookingScreen.tsx` + `posBookingApi.ts`): day grid, KPIs (from `/pos/booking/state`), availability, create | **DONE** — removed |
| `_MERGE_ARTIFACTS/` (42 files: fix-package REPORTs + 7 copies of an old `HANDOFF/`, one superseded `audit-unreached-routes.js`) | `check-no-print` skip-list only | the live audit is `apps/api/scripts/audit-unreached-routes.js` / `check:unreached`; the reports are history | **DONE** — removed |
| `HANDOFF/` (7 snippets, last touched Jul 29 2026: 101 migrations, 373 tables, 821 routes) | linked from `ARCHITECTURE.md`, `HANDOFF_MANIFEST.md`, `docs/handoff/REPOSITORY_MAP.md` | superseded by `START-HERE.md`, `NEW_CHAT_HANDOFF_2026-10-05.md`, `apps/api/openapi/manifest.txt` (routes), `apps/api/db/ownership/registry.generated.json` (tables), root `TESTING_CHECKLIST.md` | **DONE** — removed; the three linking docs repointed |
| `packageManager` pinned (D1) | never done | not changed here: pinning an exact npm version makes Corepack-enabled hosts refuse a different npm; the root lockfile + `npm ci` already fix the tree | **DECISION for Kevin** (default: leave unpinned; Node 22's bundled npm is the toolchain) |

Guards that now FAIL if any of it comes back (mutation-checked): `architecture:test` — `RETIRED_PATHS` (the five paths,
absolute) and nested lockfiles (absolute); `check:v1-clients` **R7** — any `apps/<dir>` with a page or `src/` that the gate
does not scan; `app-headers.vitest.spec.ts` — the three app names never reappear in `appDirs()`; `frontend-calls.js` and
`audit-html-apps.js` throw / fail on a listed app that is missing instead of silently reading nothing.
`booking-public` stays (live signed-link channel, no replacement). The e2e harness (`npm run e2e:html`) now covers the kiosk
and booking-public only — and was repaired in passing: since Phase 12 both journeys timed out (the stub did not strip
`/api/v1`, and booking-public's services moved to `POST /api/ai-booking/v1/public/services` in Phase 4).

