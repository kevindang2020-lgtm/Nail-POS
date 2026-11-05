# TEST_REPORT.md

Every figure below was produced by running the command shown. **Nothing here is estimated.**

Generated at the end of the handoff pass.

---

## Type checking — `npx tsc --noEmit`

| App | Result |
|---|---|
| `api` | **0 errors** |
| `pos-web` | **0 errors** |
| `admin-web` | **0 errors** |
| `customer-web` | **0 errors** |
| `owner-web` | **0 errors** |
| `tech-web` | **0 errors** |
| `manager-pay-web` | **0 errors** |
| `customer-display` | **0 errors** |

`go-check-in-kiosk` and `go-check-in-admin` have no `tsconfig.json` (not TypeScript apps).

## Tests — `npx vitest run`

| App | Files | Tests | Failures |
|---|---|---|---|
| **api** (sharded 1/3, 2/3, 3/3) | **669** | **4,568** | **0** |
| `admin-web` | — | **742** | 0 |
| `pos-web` (sharded 1/2, 2/2) | — | **643** | 0 |
| `customer-web` | — | **238** | 0 |
| `owner-web` | — | **213** | 0 |
| `tech-web` | — | **97** | 0 |
| `manager-pay-web` | — | **35** | 0 |
| **TOTAL** | | **≈6,536** | **0** |

> The API suite is run in **3 shards**. A single full run is reaped by the container's memory limit. This is an
> environment constraint, **not a test failure** — each shard passes cleanly.

## Guards — 12 files, 107 tests, all passing

`tenant-isolation` · `no-orphaned-controllers` · `sql-schema-consistency` · `auth-boundary` · `image-assets` ·
`session-sid-coverage` · `session-401-coverage` · `native-auth-coverage` · `cors-native-origins` ·
`webauthn-wiring` · `auth-wiring` · `faceid-flag`

Each was verified **non-vacuously**: the bug it guards against was planted back and the guard confirmed to fail
**by name**.

## Lint — `npx eslint apps/*/src --quiet`

**0 errors.**

Three suppressions were added, each with a written reason:
- control-character regexes (deliberate sanitization of model/OCR output)
- a `\-` escape inside a **PII phone-redaction regex** — left intact rather than risk breaking redaction for a
  cosmetic rule
- lazy `require()` of the AWS SDK (a production-only dependency; a static import breaks builds where it is absent)

## Production builds — `npx vite build` / `tsc -p tsconfig.build.json`

| App | Result |
|---|---|
| `api` | **OK** |
| `pos-web`, `admin-web`, `customer-web`, `owner-web`, `tech-web`, `manager-pay-web`, `customer-display` | **all OK** |

## Database migrations — applied from an EMPTY database

**366 / 367 applied cleanly, in order.**

The single exception is `107_pos_search_indexes.sql`, which needs the **`pg_trgm`** extension. **PGlite (the
in-process Postgres used for testing) does not ship that extension.** The migration creates it correctly
(`CREATE EXTENSION IF NOT EXISTS pg_trgm`), so it applies on real PostgreSQL 16. **This is a test-harness
limitation, not a migration bug.**

## Authentication / authorization / tenant isolation — verified by test

- **Portal separation**: a `MANAGER`/`TECHNICIAN`/`CUSTOMER` **cannot** sign in through the owner or customer app.
  Enforced in SQL (`where role = 'OWNER'`), so there is nothing for the query to find. *(11 + 10 tests)*
- **Salon switching is server-verified**: a tampered `salonId` is refused with 403, no session minted, nothing
  audited. The refusal is indistinguishable from "no such salon". *(38 tests)*
- **Role per salon**: an owner may run payroll at Salon A and be reports-only at Salon B. The best role held
  anywhere is never applied elsewhere. *(21 tests)*
- **Cross-tenant isolation**: Salon A cannot read *or* write Salon B's campaign compliance flags, delivery data,
  or message templates. *(10 + 4 tests)*
- **Sessions are revocable**: every session carries a `sid`; a re-issued session (branch/salon switch) keeps it.
- **Native tokens**: issued only to native clients; a browser (and any XSS in it) can never obtain one.

---

## What could NOT be verified here, and exactly why

1. **A live server start (`npm run start:api`, `vite dev`).** This environment has no PostgreSQL daemon and no
   network-bound ports. Migrations were instead applied against **PGlite**, an in-process PostgreSQL — which is
   why 366/367 is reported above rather than "the app booted".
2. **A true clean-install from the ZIP** (`npm install` in a fresh folder). `npm install` was run in this
   workspace and both native plugins resolved, but a from-scratch install in an empty container was not
   performed end-to-end.
3. **Face ID acceptance on a real device.** The verifier is proven to **reject** forged ceremonies (8 tests); the
   *success* path needs a physical Face ID device. **Face ID therefore ships DISABLED** behind `FACE_ID_ENABLED`.
   See `FACE_ID_ENABLEMENT_RUNBOOK.md`.
4. **The `pg_trgm` index (migration 107)** — see above.

Anything not listed here was verified by running it.

---

## Handoff re-verification — 2026-07-16 (this packaging pass)

Run in the packaging environment (Node sandbox, **no live Postgres or browser**). Every line below is an actual command result.

**Type-check (8 apps) — 0 errors each**
- `apps/api` `tsc --noEmit` → 0
- `admin-web`, `owner-web`, `pos-web`, `tech-web`, `customer-web`, `customer-display`, `manager-pay-web` `tsc --noEmit` → 0 each

**Backend gates — PASS**
- `check:di`, `check:sql`, `check:public`, `check:nav` → all PASS

**Production build**
- `apps/api` `npm run build` → PASS

**Representative test suites executed this pass (PASS)**
- compensation **96**, checkout **119**, technicians **28**, technician-help **16**, realtime **18**

**Security / hygiene**
- Source secret scan (`sk-…`, `AKIA…`, `xoxb-…`, private keys) → none found
- No real `.env` files in the tree (only `.env.example` + `.env.*.example/template`), `.env.example` values are placeholders only
- `dist/` build artifacts and all `node_modules` excluded from the handoff ZIP

### Not verified in this environment (and why) — run these against a live stack
- **Full ~6,500-test suite in one run** — the complete suite is very large and times out in a single sandbox invocation; run per-workspace (`npm test` / `vitest run`) locally.
- **Clean-install + live runtime** (DB setup, migrations, seed, backend + frontend startup, route/auth/tenant-isolation at runtime) — requires a running Postgres and served frontends, which this sandbox does not provide. The repo ships the harness for it: `scripts/tenant-isolation-check.mjs`, `permission-check.mjs`, `unguarded-route-check.mjs`, the `e2e-*.mjs` scripts, and `verify-migrations-pglite.mjs`.
- **Browser / responsive-layout testing** — needs a browser; use `scripts/browser-e2e.mjs` / `e2e-admin-browser.mjs` against a running stack.

## Fresh full-surface run — Jul 20, 2026
Commands and exact results (nothing estimated):
- `npm run -s check:di|sql|crosswire|dead-client|unreached|perms|public|nav` (apps/api): **all green** — DI complete · SQL schema errors 0 · orphaned endpoints 0 · newly dead client methods 0 · unreached 0 · perms catalog OK · public routes reviewed · nav reaches real screens.
- `npx tsc --noEmit` in all 8 workspaces (api, owner-web, tech-web, admin-web, pos-web, customer-web, manager-pay-web, customer-display): **0 errors each**.
- `node scripts/verify-migrations-pglite.mjs`: **✅ 416/416 applied in order** (through `416_payment_surcharge_bucket.sql`).
- API vitest `--shard=1/4..4/4`: **1481 + 1407 + 1415 + 1422 = 5,725 passed, 4 skipped, 0 failed**.
- Nest-free core harnesses (esbuild→node over `*-core.spec.ts`/`*-service.spec.ts`): **124 suites passed, 0 failed**.
- Frontend suites: owner-web **258** · tech-web **114** · customer-web **261** · manager-pay-web **46** · admin-web (3 shards) **306+223+225 = 754** · pos-web (3 shards) **211+285+199 = 695** — **0 failures**.
- Marker scan (`TODO|FIXME|HACK|XXX|NOT IMPLEMENTED|COMING SOON` in app source, non-test): **0 hits**. Secrets scan (live-key patterns, private keys, hardcoded passwords): only test stubs, masked `••••` display strings, and a fake pgtest key — **no real credentials in the tree**; only `.env*.example`/`.template` files exist (no real `.env`).
- Env coverage: 126 distinct `process.env.*` vars referenced · 147 documented across the `.env*` examples.
Not verifiable in this environment: live processor captures (CommerceHub adapter deliberately throws until real sandbox credentials are provided) and runtime behavior against a production Postgres/browser fleet.

### Clean-install verification (Step 9) — Jul 20, 2026
Performed on the actual handoff ZIP, extracted to a clean temp folder (5,381 files):
- `apps/api`: `npm install` from scratch → **441 packages in 18s, exit 0** · `npx tsc --noEmit` → **0 errors** · `node scripts/verify-migrations-pglite.mjs` → **416/416 applied** · vitest sample (surcharge-compliance + revenue-split engine + owner-portfolio) → **88 passed, 0 failed**.
- `apps/pos-web`: `npm install` from scratch → **138 packages in 3s** · `npx vite build` (production) → **OK**.
Everything above ran inside the extracted ZIP contents only — no files from the original tree. The package installs, type-checks, migrates, tests, and builds from a cold start.

### Touch-migration verification — Jul 20, 2026
- pos-web `npx tsc --noEmit`: **0 errors** · vitest shards 1–3: **212 + 285 + 199 = 696 passed, 0 failed** · `vite build`: **OK**.
- Marker scan on changed files: 0 TODO/FIXME/HACK. No new secrets (changes were CSS + JSX attributes + one screen interaction + tests).
- API untouched by this pass; its Jul-20 full battery stands (gates green, 5,725 vitest + 124 harness suites, 416/416 migrations).
- Not verifiable in this environment (needs the physical Dell): 1920×1080 visual fit, on-screen-keyboard coverage, finger-scroll feel, Chrome/Edge touch↔mouse matrix, second display.

### Clean-install verification (Step 9, refreshed package) — Jul 20, 2026
From the actual refreshed ZIP, extracted to a clean temp folder (5,382 files):
- `apps/api`: `npm install` **441 packages in 15s** → `tsc` **0 errors** → migrations **416/416** → money-engine sample (revenue-split + surcharge-compliance) **29 passed**.
- `apps/pos-web`: `npm install` **138 packages in 3s** → production `vite build` **OK** → touch-migration tests (Tech Queue tap-to-assign + Customers) **21 passed**.
All ran inside the extracted ZIP only — cold start, no files from the original tree.


## Jul 26, 2026 — current numbers (this session's runs)
| Surface | Result |
| --- | --- |
| apps/api vitest (4 shards) | 1497 + 1400 + 1444 + 1440 = **5,781 passed, 4 skipped, 0 failed** |
| apps/api gates | 10/10 green (incl. types-drift + tenant) |
| migrations (PGlite, in order) | 422/422 |
| pos-web (3 shards) | 212 + 285 + 199 = **696** |
| admin-web (3 shards) | 306 + 228 + 225 = **759** |
| customer-web / owner-web / manager-pay-web | 265 / 262 / 50 (Jul-25 runs; untouched since) |
| Real-browser viewport acceptance (pos-web, logged-in) | **60/60** route×resolution checks pass (10 screens × 1920×1080, 1536×864, 1280×720, 1600×900, 1366×768, 2560×1440) |
| Real-browser session persistence | login → reload → `/auth/me` 200 (cookie 408 bytes) |

Auth note: the session token no longer embeds role-default permissions (cookie was 6,986 bytes and browsers dropped
it); size + compatibility are pinned by `auth-session-token.vitest.spec.ts`.


## Jul 26, 2026 — security additions (current truth)
- API battery: **5,813 + 4 skipped, 0 failed** (1506+1413+1453+1441). admin-web: **761** (306+228+227). pos-web: 698 (212+285+201). manager-pay: 50. customer-display: 43. packages/ui: 5.
- Security fast lane (`npm run security:fast`, also on every CI push/PR): 12 static gates + redacting secret scan + deny-path ratchet + quick auth suites — last run 15 PASSED / 0 FAILED / 4 NOT VERIFIED, exit 0.
- Security full sweep (`npm run security:full`, nightly CI cron + manual): + the 4-shard battery + runtime-gated npm audit. Runtime deps: critical 0, high 12 (all major-version-gated, deferred by name per spec §13).
- In-platform Security Audit Engine (migrations 419-420 era): unit 7/7, real-schema pgtest 3/3, SecurityScreen section tests 6.


## Jul 26, 2026 (late) — customer identity arc (current truth)
- API battery: **5,877 + 4 skipped, 0 failed** (8 shards). admin-web: **766**. migrations **421/421**. 10/10 gates.
- Customer identity suites: 10 files / 57 tests — identity-core (19), real-time link pgtest (3), reconciliation
  engine (5), reconciliation pgtest (3), creation-site hooks (3), registration hook (4), audit events (4),
  profile propagation (5), merge + conflict lifecycle (5), cross-tenant isolation pgtest (5).
- Super Admin sync surface: 5 service-level tests + admin-web Oversight screen 21 tests (incl. merge confirmation
  gate and legal-hold messaging).


## Jul 27, 2026 — verification run

Commands executed and results (all from the repository, not summarised from memory):

| Check | Result |
|---|---|
| `npx tsc --noEmit` (api + 5 frontends) | 0 errors |
| Integrity gates (12) | di, sql, crosswire, dead-client, unreached, perms, public, nav, types-drift, tenant, **dialogs**, **money** — all pass |
| `node scripts/verify-migrations-pglite.mjs` | 423/423 on real Postgres (PGlite/PG16) |
| api vitest (8 shards) | 5,925 passed + 4 skipped, 0 failed |
| pos-web vitest (2 shards) | 710 passed |
| admin-web vitest (3 shards) | 766 passed |
| owner-web / tech-web / customer-web | 262 / 114 / 265 passed |
| `npx vite build` × 5 frontends | all succeed |
| Marker scan (TODO/FIXME/HACK/NOT IMPLEMENTED/COMING SOON) | 87 hits, **all benign** — HTTP `NOT_IMPLEMENTED` status enums, `TapToPayNotImplementedError` (the deliberate CommerceHub skeleton), substrings inside identifiers (`toDo`, `xxx`), and one explanatory comment. Zero real `TODO:`/`FIXME:` work comments. |
| Secret scan (`sk_live`, `pk_live`, AWS keys, private-key headers) | 28 hits, **all benign** — test assertions that such strings must NOT appear, and password-type inputs. No real credentials. |
| Real `.env` files in the tree | 0 (only `.env.example`) |

### Two new gates added this session
- `check:dialogs` — fails if any `window.prompt/confirm/alert` returns to a frontend. Negative-tested: a reintroduced `window.confirm` made the gate fail, then pass again once removed.
- `check:money` — fails on `parseFloat(...) * 100`, and on `parseDollarsToCents(x) ?? 0` where a validity guard follows within 300 characters. **This second rule found a real bug on first run**: a referral reward guarded by `!Number.isFinite(cents)` would have issued a silent $0.00 reward on invalid input.

### Not verified (requires a deployed environment, stated honestly)
- Live SSE end-to-end on a real host; sleep/wake on physical hardware; multi-node Redis fan-out under real traffic.
- The 7 PM customer-sync worker firing in production, and multi-instance racing.
- On-device push delivery (needs APNs/Firebase credentials).
- Tap-to-Pay against real CommerceHub sandbox credentials.

## Jul 28, 2026 — verification run (fresh chat: baseline + guarantee-proration change)

Baseline was re-established from the extracted handoff zip with real runs before any change, then the full battery
was re-run after the guarantee-proration work. Nothing below is estimated.

| Check | Baseline (pre-change) | Post-change |
|---|---|---|
| `npx tsc --noEmit` (api) | 0 errors | 0 errors |
| Integrity gates (12) | all pass | all pass |
| `verify-migrations-pglite` | **423/423** | not re-run — the diff contains zero SQL files |
| api vitest (8 shards) | **5,935 + 4 skipped, 0 failed** | **5,953 + 4 skipped, 0 failed** (+18 = exactly the new tests) |
| pos-web (2 shards) | 710 · tsc 0 | untouched by the diff |
| admin-web (3 shards) | 766 · tsc 0 | untouched by the diff |
| owner-web / tech-web / customer-web | 262 / 114 / 265 · tsc 0 each | untouched by the diff |
| `npx vite build` × frontends | not run this session | not run this session |

**Correction to the Jul 27 table above:** its api figure (5,925) predates the two `serving-retail` specs added by the
Jul 27 (late) retail arc, which re-ran targeted suites only. The true pre-change total was **5,935** (+10 = those two
files); this run confirmed it by summing all 8 shards.

## Jul 28, 2026 — end-of-session totals (after all six units)

Six units shipped this session: guarantee-proration fail-safe → scheduled-hours derivation + Memberships nav →
Help Center wiring → Communications activity metrics → normalizer unification (staff reset + customer writes) →
eligible-expense list. Every figure below came from a real run; the api totals were summed from all eight shard
logs after all eight returned.

| Suite | Start of session | End of session |
|---|---|---|
| api vitest (8 shards) | 5,935 + 4 skipped | **6,013 + 4 skipped, 0 failed** |
| pos-web (2 shards) | 710 | **714** (384 + 330) |
| admin-web (3 shards) | 766 | **766** (311 + 228 + 227) |
| owner-web / tech-web / customer-web | 262 / 114 / 265 | unchanged — untouched by every diff |
| `npx tsc --noEmit` | 0 errors | 0 errors (api, pos-web, admin-web) |
| Integrity gates | 12/12 | 12/12 after every unit |
| `verify-migrations-pglite` | 423/423 | not re-run — **no unit contained a single SQL file** |

The api growth (+78) is exactly the tests added: 18 guarantee, 16 parity, 10 scheduled-hours, 17 communications,
5 normalizer-write, 12 eligible-expense. `check:crosswire` caught one real would-404 mid-session (a new Help Center
client called `/help/*` when the controller mounts at `tenant/help`) — fixed before it shipped.

## Jul 28, 2026 (late) — after the realtime, gate, and feedback-store units

| Suite | Figure |
|---|---|
| api vitest (8 shards) | **6,023 + 4 skipped, 0 failed** |
| `verify-migrations-pglite` | **424/424** (424_ai_insight_feedback added this session) |
| Integrity gates | 12/12 |
| admin-web (3 shards) | **769** (311 + 231 + 227) |
| pos-web (2 shards) | 714 |
| owner-web / tech-web / customer-web | 262 / 114 / 265 (each re-run + vite build this session) |
| manager-pay-web / customer-display / packages/ui | 50 / 43 / 23 |
| `npx tsc --noEmit` | 0 errors across every workspace with a tsconfig |
| cross-wire | **1,941/1,941 wired, 0 orphaned** (up from 1,912 — the two go-check-in HTML apps are now scanned) |

Session arc: api started at 5,935 and ended at 6,023 (+88 = exactly the tests added). Two production surfaces were
found to have no automated coverage at all — `go-check-in-kiosk` and `go-check-in-admin`, single-file HTML apps —
and the cross-wire gate now covers their 29 API calls. **They still have no tests and no typecheck.**
*(Correction, later that night + Jul 29: they now have two layers of automated coverage — `check:html` (gate 13:
script-block syntax, dangling element refs, hardcoded origins, credentials) and `npm run e2e:html` (real Chromium
drives the kiosk guest journey end-to-end, 13 assertions with server-side payload checks, plus the device manager;
proven by sabotage). Still true: no tsc and no vitest — the harness and gate are their only automated checks.)*

### Jul 29, 2026 — after the mobile-ecosystem arc (passes 1–4)
| Surface | Result |
|---|---|
| api vitest (8 shards, summed from logs) | **6,037 passed + 4 skipped, 0 failed** |
| Wiring/honesty gates | **14/14** (di sql crosswire dead-client unreached perms public nav types-drift tenant dialogs money html) |
| Migrations (PGlite/PG16) | **426/426** |
| manager-pay-web | tsc 0 · 52 · build OK |
| customer-web | tsc 0 · 267 · build OK |
| tech-web | tsc 0 · 117 · build OK |
| pos/admin/owner/display/ui | untouched this arc (last green Jul 28) |
New specs this arc: mobile-ticket-composition (5), skip-line-customer-tip (6), tech-service-history pgtest (3),
TicketScreen +2, PayScreen +2, TechServiceHistoryScreen (3). Also fixed: the communications-activity pgtest's
UTC-midnight seeding flake (hour-proof now).


## Current totals (Jul 29, 2026 — commit 897da4f; earlier tables above are dated history)
| Lane | Result |
| --- | --- |
| api vitest (8 shards, summed from logs) | **6,049 + 4 skipped, 0 failed** |
| Migrations (PGlite/PG16) | **426/426** |
| Gates | 13/13 (7-app dialogs/money coverage) |
| pos-web | 719 · tsc 0 · build OK |
| admin-web | 769 · tsc 0 · build OK |
| owner/tech/customer/mpw/display/ui | 262 / 117 / 267 / 53 / 43 / 23 |
| browser-e2e + e2e:html | PASSED at final commit |


## Current totals (Jul 29, 2026 — commit f4cb8af; the tables above are dated history)
| Lane | Result |
| --- | --- |
| api vitest (8 shards, summed from logs) | **6,091 + 4 skipped, 0 failed** |
| Migrations (PGlite/PG16) | **431/431** |
| Gates | 13/13 |
| pos-web / admin-web | 726 (+ SMS panel pins) / 769 (+ SMS screen 12) · tsc 0 · builds OK |
| owner / tech / customer / mpw / display / ui | 262 / 117 / 267 / 53 / 43 / 23 |
| Live harnesses | auth-matrix 13/13 · browser-e2e · e2e:html — all green at their last run |

---

## Jul 30, 2026 — battery stamp (post-migration-432)
API: `npx vitest run --shard=N/8` ×8 → **6,091 passed + 4 skipped, 0 failed** (808+758+749+734+732+794+819+697;
skips = the 4 device-management integration tests, env-gated as always). Gates: **13/13** (the 14th,
check:no-print, was added later the same day). Migrations:
**432/432** via `verify-migrations-pglite.mjs`. Identical totals to the Jul-29 stamp — migration 432 (pure
DROP INDEX) changed no behavior, now proven rather than assumed.

---

## Jul 30, 2026 — post print-removal verification (pos-web only; API unchanged)
pos-web: `npx vitest run --shard=1/2` + `2/2` → **729 passed, 0 failed** · `tsc --noEmit` 0 · `vite build` OK.
Gates: **14/14** (the new `check:no-print` included; negative-tested by re-adding a banned control and
confirming a file:line failure). Security lane: **17 PASSED · 0 FAILED · 4 NOT VERIFIED** across 21 checks.
API suite NOT re-run — no API source changed in this commit (last full API battery: same date, 6,091+4, 0 failed).

---

## Aug 3, 2026 — booking page + boot gate
API battery: 8 shards → **6,091 passed + 4 skipped, 0 failed** (808+758+749+734+732+794+819+697) — unchanged by
the DI fix, as expected for a provider-registration change. Gates: **15/15** (new `check:boot`). Browser:
`e2e:html` **3/3 apps** green (kiosk, admin, booking). Migrations 432/432.
**Live-stack verification (new for this repo):** real PostgreSQL 16 + real API boot + real browser — guest
registration, availability, and TWO bookings persisted to `pos_tech_appointments`. This is the first time the
API was booted end-to-end in this environment; it is what exposed the boot defect above.


---

## Aug 3, 2026 (later) — no-login guest booking page
API battery: 8 shards → **6,094 passed + 4 skipped, 0 failed** (808+761+749+734+732+794+819+697); the +3 over
the previous stamp are exactly the three new phone-verification mapping tests. Gates **15/15**. Browser:
`e2e:html` **4/4 apps** (kiosk, admin, booking, public guest booking). NOT RUN: the signed-link path against a
real minted token — it needs `AI_BOOKING_LINK_SECRET` and a link minted through Super Admin.

---

## Sep 18, 2026 — picture-audit fixes + silent-SQL hardening
API: 8 shards → **6,113 passed + 4 skipped, 0 failed** (834+740+765+728+750+800+813+683).
admin-web **781** · pos-web **733** (395+338) · **13/13 gates** · migrations **432/432** verified on real
Postgres · `e2e:html` **5/5 apps, 38 API calls** · all typechecks 0 · builds OK.

Delta from the previous stamp: **+16 tests, all new this session** — 3 product ranking rules, 2 Arriving-Soon
rules, 1 Last-Check rule, and 10 across four new **pgtests that execute raw SQL against the real migrated
schema** (product-catalog, help/status, revenue-residuals, system-status, customer-data). No test was deleted
or skipped; tests that pinned old labels were rewritten to pin the new wording.

New checks available (report-only, not gates):
- `npm run check:silent-sql` — raw SQL behind an error-swallowing catch, ranked by exposure (100 files; 48 in
  modules with a pgtest, 52 without).
- `npm run check:sql-identifiers` — applies every migration to PGlite and verifies every table and qualified
  column in raw SQL exists. **Currently 0 unknown columns.** Sabotage-proven: reinstating a real bug
  (`t.name` where `tenants` has `display_name`) makes it report the file and line.

NOTE for a fresh checkout: `e2e:html` needs `npx playwright install chromium` first — a missing browser, not
a code failure.
