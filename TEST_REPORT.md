# TEST_REPORT.md

## Oct 28 2026 — Whole-repository pilot scan (`docs/pilot-runs/2026-10-28/PILOT_SCAN_REPORT.md`)

| Check | Result |
|---|---|
| Module / controller wiring (27 modules, every `@Controller`) | **PASS** |
| crosswire / unreached / dead-client gates | **PASS** (unchanged) |
| Dead navigation targets (7 apps, new `dead-routes.mjs`) | 12 found → fixed → **0** |
| Enabled buttons without a handler (new `dead-buttons.mjs`) | **0** |
| Frontend bundles (esbuild, new `bundle-all.mjs`) | **7 / 7 clean** |
| Environment variables read vs documented | **170 / 170** |
| Unit sweep of the 738 unreached spec files (stand-in) | **587 PASS + 47 self-running PASS**; 104 harness-limited (need real vitest / Nest — FST-1); **2 real defects fixed** (`_headers` CSP hashes 22/22, push-producer inventory 4/4) |
| Frontend `tsc`, Vite, ESLint, 12 env-bound gates, jsdom, Edge, physical touchscreen, live processors | NOT_RUN (FST-1 / FST-7) |

## Oct 28 2026 — Check-In + Live Operations One-Screen

| Command | Result |
|---|---|
| `PAGE=checkin SD_SERVER=old node measure.mjs checkin-before …` (HEAD worktree) | 7 / 18; 1920×945 scrolled 174 (normal / busy / very busy / 200 techs), 334 (long); 1600×765 44–711 |
| `PAGE=checkin node measure.mjs checkin-after` (6 states × 7 viewports) | **36 / 36** one-screen; 1366×633 131 px by design |
| `PAGE=liveops SD_SERVER=old node measure.mjs liveops-before …` (HEAD worktree) | 3 / 18; 1920×945 128 / 359 / 634 / 2,112 / 359 / 432 px |
| `PAGE=liveops node measure.mjs liveops-after` | **36 / 36**; 1366×633 91 px by design |
| `node tooling/checkout-one-screen/interact-checkin.mjs` | **26 / 26** (fit, card stability, +N more, drawer, appointment check-in, triple tap = 1 visit, New Customer body, Quick Actions, touch, announcements, long names) |
| `node tooling/checkout-one-screen/interact-liveops.mjs` | **20 / 20** |
| `check-in-floor.vitest.spec.ts` · `live-ops-branch-scope.vitest.spec.ts` | **12 / 12** · **2 / 2**; dashboard cache / metrics / t02 13 / 13; check-in + queue sweep = HEAD + 12 new |
| PostgreSQL 16 proof (`scratchpad/ci/queries.sql`) | see the status docs (search 0.06 ms / 50,000 customers, isolation 0, walk-ins 14 vs 5, upcoming 4 vs 0, multi-location 2 vs 3) |
| Shimmed backend typecheck | 5,351 lines, a subset of the baseline (no new error) |
| Regression (shared kit / CSS) | Checkout / Service Done / Serving / Queue / Overview measure 30 / 30; E2E 26 / 29 / 36 / 34 / 22 |
| NOT_RUN | jsdom tests, eslint, pos-web `tsc`, Vite build, check-in pgtests, Edge, branded Chrome, physical touchscreen, two-station realtime |

## Oct 28 2026 — Overview 27-Inch One-Screen (AI_PowerSalon_Overview_27in_One_Screen_Module_Wiring_UX_Completion_Mandate.pdf)

| Command | Result |
|---|---|
| `PAGE=overview SD_SERVER=old node tooling/checkout-one-screen/measure.mjs ov-before …` (pre-change screen) | 7 / 18 cells fit (empty at 1920×945 + the 2560×1305 cells). 1920×945 scrolled 183 (normal) / 287 (busy, very busy) / 282 (long) px; 1600×765 117–541 px |
| `PAGE=overview node tooling/checkout-one-screen/measure.mjs ov-after` (6 states × 7 viewports) | **36 / 36 PASS** one-screen; 1366×633 scrolls 125 px by design |
| `node tooling/checkout-one-screen/interact-overview.mjs` | **22 / 22 PASS** (incl. every shown row fully visible at 1920×945 and 1600×765) |
| `node tooling/checkout-one-screen/overview-announce-perf.mjs` | announcement none / short / long / expanded / urgent **5 / 5** no scroll; 2 Overview calls, largest payload 31.7 / 40.5 KB |
| `overview-floor.vitest.spec.ts` (new) | **11 / 11** |
| Overview core / cache / schedule specs (stand-in) | 32 / 32, 3 / 3, 2 / 2; analytics sweep 327 passed / 5 pre-existing failures (also fail on HEAD) |
| Overview SQL on PostgreSQL 16 (`scratchpad/ov/queries.sql`, `explain.sql`) | KPI old vs new (F of the status doc); tenant leak 0, branch leak 0; EXPLAIN 0.64 / 0.16 / 0.085 ms |
| Shimmed backend typecheck | 5,354 lines, identical set to the Customer Queue baseline |
| Regression (shared `styles.css`, `format.ts`) | Checkout / Service Done / Serving / Queue `measure.mjs` 24 / 24; `interact.mjs` 26 / 26, `interact-sd.mjs` 29 / 29, `interact-serving.mjs` 36 / 36, `interact-queue.mjs` 34 / 34 |
| `run-all-gates.sh` | the same 12 FAILs as the baseline (`node_modules`-bound); `check:sql:select` failed on a checker bug (BIGSERIAL) → fixed, 0 findings; pos-i18n, vi-glossary, as-any, silent-catch, raw-sql-inputs, openapi OK |
| NOT_RUN | pos-web jsdom tests, eslint, pos-web `tsc`, `vite build`, Edge, branded Chrome, physical touchscreen, two-station realtime |

## Oct 28 2026 — Customer Queue One-Screen (AI_PowerSalon_Customer_Queue_Claude.pdf)

| Command | Result |
|---|---|
| `PAGE=queue SD_SERVER=old node tooling/checkout-one-screen/measure.mjs queue-before …` (pre-change screen) | 7 / 18 cells fit (the empty and 2560×1305 cells). At 1920×945 the page scrolled 436 px (normal), 433 (busy), 1,042 (long names). |
| `PAGE=queue node tooling/checkout-one-screen/measure.mjs queue-after` (6 states × 1920×945, 1920×1080, 1600×900, 2560×1440, 1600×765, 2560×1305) | **36 / 36 PASS**; 1366×633 scrolls 145 px by design |
| `node tooling/checkout-one-screen/interact-queue.mjs queue-interact` | **34 / 34 PASS** |
| `queue-floor.vitest.spec.ts` (new) | **23 / 23** |
| Queue SQL on PostgreSQL 16 (`scratchpad/cq/proof.sh`) | second active walk-in entry → 23505; concurrent start: A 1 row, B blocked → UPDATE 0; the durable key is set once and never overwritten; another tenant → 0 rows; EXPLAIN 0.16 ms (seq, 250 rows) / 0.38 ms (index) |
| Queue module stand-in sweep (89 files) | **1034 passed / 94 failed** = previous 1011 / 94 + the 23 new (queue-core and queue-transitions updated to pass a reason for a priority raise) |
| Shimmed backend typecheck | identical to the baseline (no new error code in any file) |
| Regression (shared CSS + overlay fix) | Checkout / Service Done / Serving `measure.mjs` 12 / 12 each; `interact.mjs` 26 / 26; `interact-sd.mjs` 29 / 29 and `interact-serving.mjs` 36 / 36, now typing key by key |
| Overlay focus bug (Serving, before / after) | typed "Please come to station 4" into the staff alert → before kept "P", after kept the whole text |
| `run-all-gates.sh` | same FAIL / BLOCKED set as the baseline once the attack-surface doc was regenerated (controller line numbers moved); openapi 3,126 routes unchanged; pos-i18n, vi-glossary, error-text, as-any, silent-catch OK |
| NOT_RUN | pos-web jsdom tests, pgtests, eslint, pos-web `tsc` (npm registry unreachable for `@types/react`), `vite build`, Edge, branded Chrome, physical touchscreen, two-station pilot, Technician App update |

## Oct 28 2026 — Serving One-Screen (AI_PowerSalon_Serving_Claude.pdf)

| Command | Result |
|---|---|
| `PAGE=serving SD_SERVER=old node tooling/checkout-one-screen/measure.mjs serving-before …` (pre-change screen) | 3 / 15 PASS — 1920×945 page scroll 8 (empty) · 505 (normal) · 607 px (busy) |
| `PAGE=serving node tooling/checkout-one-screen/measure.mjs serving-after` (6 states × 1920×945, 1920×1080, 1600×900, 2560×1440, 1600×765, 2560×1305) | **36 / 36 PASS**; 1366×633 scrolls 145 px by design |
| `node tooling/checkout-one-screen/interact-serving.mjs serving-interact` | **36 / 36 PASS** |
| `serving-floor.vitest.spec.ts` (new) | **25 / 25** |
| Serving SQL on PostgreSQL 16 | concurrent start: A 1 row, B blocked → 0 rows; duplicate add-on id → 23505; reassignment closes / opens sessions; one-active-per-tech index refuses; isolation 0 rows; EXPLAIN 0.027 ms |
| Queue module stand-in sweep (non-PG spec files, 88) | **1011 passed / 94 failed** = previous 986 / 94 + the 25 new (same files, same counts) |
| Shimmed backend typecheck | vs baseline: +1 TS7006 shim effect only |
| Checkout / Service Done regression (shared CSS) | `measure.mjs` 21 / 21 and 18 / 18 (excl. the by-design 1366×633 cells); `interact.mjs` 26 / 26; `interact-sd.mjs` 29 / 29 |
| Gates | silent-catch, as-any, mass-assignment, state-transitions, error-text, raw-sql-inputs, pos-i18n, vi-glossary, openapi, attack-surface, event-producers, realtime-catalog OK; DB gates 0; BLOCKED_DEPENDENCY set unchanged |
| NOT_RUN | pos-web jsdom tests, pgtests, eslint, pos-web `tsc`, `vite build`, Edge, branded Chrome, physical touchscreen, two-station live pilot, Technician App update |


## Oct 28 2026 — Service Done One-Screen (ServiceDone.pdf)

| Command | Result |
|---|---|
| `PAGE=service-done SD_SERVER=old node tooling/checkout-one-screen/measure.mjs sd-before …` (pre-change screen) | 3 / 36 PASS — 1920×945 page scroll 90 (empty) … 2,826 px (busy) |
| `PAGE=service-done node tooling/checkout-one-screen/measure.mjs sd-after` | **30 / 30 PASS** (6 states × 1920×945, 1920×1080, 1600×900, 2560×1440, 1366×768) |
| `… sd-after-chrome … 1600x765,2560x1305,1366x633` | 12 / 12 PASS at 1600×765 / 2560×1305; 1366×633 scrolls 145 px by design (§117) |
| `node tooling/checkout-one-screen/interact-sd.mjs sd-interact` | **29 / 29 PASS** |
| `service-done-handoff.vitest.spec.ts` | 16 / 16 (mutation: dropping the "already sent" rule fails 3) |
| Handoff SQL on PostgreSQL 16 (two sessions) | A moves the row; B blocks, re-checks and matches 0 rows. Unapproved / paid / reopened / other tenant each match 0 rows. EXPLAIN 0.12 ms |
| Migration 707 applied twice on PostgreSQL 16 | idempotent (second run: NOTICE, skipping) |
| Queue module stand-in sweep (non-PG spec files) | 87 files: **986 passed / 94 failed** = baseline 970 / 94 (86 files) + the 16 new handoff tests; the 94 are the same 5 files with the same counts (stand-in limits: request-schemas 89, eligibility 1, multitech controller 1, module inventory 1, tech-mobile idempotent 2) |
| Checkout regression after the shared CSS change | `measure.mjs` 35 / 35, `interact.mjs` 26 / 26 |
| `bash tooling/full-system-test/run-all-gates.sh` | state-transitions 0 findings, as-any OK, mass-assignment OK, vi-glossary OK, error-text 0, DB gates 0 on real Postgres; the remaining failures are the BLOCKED_DEPENDENCY set |
| NOT_RUN | pos-web jsdom tests, pgtests, eslint, pos-web `tsc`, `vite build`, Edge, branded Chrome, physical touchscreen, live pilot |


## Oct 28 2026 — Checkout One-Screen (checkout.pdf)

Every line below was run here (sandbox, Node 22.23.4, PostgreSQL 16.15, no `node_modules`, TypeScript 6.0.2, Chromium via Playwright).

| Command | Result |
|---|---|
| `node tooling/checkout-one-screen/build.mjs` | built: 650 inputs, app.js 9.4 MB, app.css 135 KB |
| `node tooling/checkout-one-screen/measure.mjs before` (pre-change tree) | 4 / 35 PASS — 1920×945 page scroll 288–5,888 px, analytics + Quick Actions hidden |
| `node tooling/checkout-one-screen/measure.mjs after` | **35 / 35 PASS** (7 states × 1920×945, 1920×1080, 1600×900, 2560×1440, 1366×768) |
| `measure.mjs after-chrome … 1600x765,1366x633,2560x1305` | **14 / 14 PASS** at 1600×765 / 2560×1305. 1366×633 scrolls 145 px **by design** (fallback rule added with the Service Done mandate §117 — usable panels instead of a forced fit). |
| `node tooling/checkout-one-screen/interact.mjs interact` | **26 / 26 PASS** |
| `checkout-totals-locked.vitest.spec.ts` | 8 / 8 (guard removed from applyDiscount → 4 fail: mutation check) |
| `checkout-paid-read-fails-closed.vitest.spec.ts` | 5 / 5 |
| `checkout-board-signals.vitest.spec.ts` | 14 / 14 |
| Checkout module stand-in sweep (123 non-PG files) | 880 passed / 75 failed = baseline 853 / 75 + 27 new; the 75 are the same pre-existing stand-in limits |
| `bash tooling/full-system-test/run-all-gates.sh` | 12 FAILED in run-gates.mjs = 6 BLOCKED_DEPENDENCY + 6 DB gates that pass on real Postgres (all `RESULT … 0`); error-text 0, as-any OK |
| Shimmed backend typecheck | 0 errors in the changed backend files |
| NOT_RUN | pos-web jsdom tests, pgtests, eslint, pos-web `tsc`, `vite build`, Edge, branded Chrome, physical touchscreen |


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

## Oct 20, 2026 — the mandate's one logged run (`tooling/ci/final-run.sh` → `final-run/summary.txt`)

Commit `79df7020` for the first pass (the nine fix commits on `6ffc9c78`); reruns at `98a052dd`–`8590d46e` after the fix for each failure was committed. **Every figure is copied from `final-run/summary.txt` and the lane logs next to it; the first-pass FAIL lines remain in the summary beside their rerun.** Box: Node 22.22, PostgreSQL 16 local, four lanes at a time.

| # | Lane | Command | First pass | Rerun (after fix) |
|---|---|---|---|---|
| 1 | install | `npm ci --no-audit --no-fund` | rc=0 | — |
| 2 | migrations-fresh | `MIGRATE_DATABASE_URL=…/fr_migrate node apps/api/scripts/migrate.mjs` | **605 applied, 0 already present** | — |
| 3 | build-packages / build-modules (26) / build-api / build-frontends | `npm run build:*` | rc=0 · rc=0 · rc=0 · rc=0 | — |
| 4 | typecheck-api | `npm run typecheck` | rc=0 | — |
| 5 | lint | `node tooling/ci/lint-ratchet.mjs` | **rc=1** — `no-unused-vars` 121 vs baseline 120 (three vars destructured and unused in `production-config.vitest.spec.ts`, changed Oct 20) | **rc=0** — 0 errors, 200 warnings; baseline ratcheted (`exhaustive-deps` 83→82) |
| 6 | gates | `npm run ci:gates` | **rc=1** — 59/60: `check:lint` (same cause) | **rc=0** — **all 47 gates + 13 audits** (incl. supply-chain R7, secrets, boot, types-drift, api-contract, crosswire, unreached, perms, tenant, money, event-producers, audit wiring, frontend builds) |
| 7 | tests-packages | `npm run ci:test:packages` | **20/20 packages, 1,103 passed, 0 failed** | — |
| 8 | tests-modules | `npm run ci:test:modules` | **26/26 modules, 10,102 passed, 217 skipped, 0 failed** (ai 1,989 · workforce 919 · checkout 754 · booking 672 · analytics 276 · …) | — |
| 9 | tests-apps | `npm run ci:test:apps` | **rc=1** — 7/8: admin-web 1 failed / 1,034 passed (`BranchHealthScreen` timed out at vitest's 5 s default under load; passes alone in 272 ms) | **rc=0** — **8/8 apps, 3,495 passed, 0 failed** (admin 1,035 · pos 1,369 · owner 335 · customer 275 · display 201 · tech 182 · manager-pay 90 · kiosk 8) |
| 10 | tests-api | `npm run ci:test:api` | **345 files passed, 25 skipped; 2,855 tests passed, 134 skipped, 0 failed** | — |
| 11 | harnesses | `apps/api: npm run test:harness` (40 `verify-*` scripts) | **rc=1 — 1/40**: the runner symlinked a non-existent `/tmp/pgtest` PGlite over the workspace one; tsx applied tsconfig `paths` and loaded a `.d.ts` as a guard (`Invalid guard … AiReceptionistVerificationController`); 34 harnesses replayed migrations without `pg_trgm` | **rc=1 — 11/40** after the plumbing fix (`98a052dd`): the 29 still failing assert behaviour that changed since they were written (seeds predating the Oct 8 FK constraints, media routes now authenticated, retention semantics, upload validation). **Open as B-27** — this lane has been reported "124/0" since Oct 8 while it could not run; it is NOT green and is not counted as such |
| 12 | migrations-race + race-lane | fresh `fr_race` · `PG_RACE_URL=… npm run ci:test:race` | **605 applied · 88 files, 307 tests passed, 0 skipped, 0 failed across 14 packages** (checkout 45 incl. `refund-race` 7 and `gift-card-machine` 3 · booking 42 incl. `booking-time-off` 3 · queue 27 incl. walk-in replica retry · workforce 16 · super-admin 9 · …) | — |
| 13 | live-route-sweep | fresh `fr_live` · `live-route-sweep.mjs` (booted API, seeded LUXE/PALACE, every route) | **rc=1 — 13/14**: "every response under 2000 ms" — `/super-admin/database/indexes` 2,668 ms while the harness rerun shared the box | **rc=0 — 14/14** (fresh `fr_live2`, quiet box) |
| 14 | live-event-wiring | `EVENT_PUBLISHER_ENABLED=1 live-event-wiring.mjs` | **rc=1 — 7/17**: run-script bug — the flow proofs need the PILOT01 seed, which the sweep does not create | 1st rerun 16/17 (seed step overrode the owner password the proof signs in with); 2nd 16/17 (owner confined to the seed branch — Phase 9 grants; the proof now grants its own branches); **3rd rc=0 — 17/17**: 10 consumers registered once, 62 background classes single-instance, 21 job handlers, 8 flow proofs green (queue 33/33, booking verification, phone, fair turn 22/22, money chain 25/25, multi-tech 21/21, one-payment checkout, payroll), **280 domain events of 48 types all published and consumed, 0 dead letters, p95 outbox→published 995 ms** |
| 15 | migrations-pilot + live-pilot-day | fresh `fr_pilot` · `live-pilot-day.mjs` (booted API, loopback CardPointe, real Chromium, 9 screenshots in `final-run/pilot-shots/`) | **605 applied · 74/74 checks** (open → check-ins → Fair Turn → serving → service done → checkout incl. gift card / split / refund → payroll → close; API log and Postgres log clean) | — |
| 16 | drill-restore | `drills/drill-restore.mjs` on `fr_pilot` | **rc=1 — 12/13**: the drill ran without the pilot API's `AUTH_SESSION_SECRET`, so derived keys could not decrypt 3 sealed columns (run-script bug) | 1st rerun rc=0 but only 10 checks — the hold proof had been placed inside the "no sealed rows" branch of the drill and was skipped on a database that holds sealed rows (a defect in the Oct 20 drill change, found by comparing the two passes); moved out (`drill-restore.mjs` §6). **2nd rerun rc=0 — 12/12**: dump 0.5 s, restore 2.4 s, 2.3 MB, 605/605 ledger, 750 tables row-identical, payments/tickets checksums identical, 3 sealed columns open with the pilot keys, **POST_RESTORE_HOLD=1 claims nothing; hold cleared → the same job runs exactly once** |
| 17 | e2e-html | `apps/api: npm run e2e:html` (kiosk + public booking link in real Chromium) | **rc=1**: Playwright's pinned headless shell not downloaded on this box | **rc=0** — both single-file apps complete their journeys, 24 API calls verified (uses the installed Chromium like `live-pilot-day.mjs`) |

**Totals (final state):** gates 47 + 13 audits · unit/pgtest **17,555 passed** (1,103 + 10,102 + 3,495 + 2,855), 351 skipped, **0 failed** · race lane 307/307 · route sweep 14/14 · event wiring 17/17 · pilot day 74/74 · restore drill green · e2e:html green · harness lane **11/40 (open, B-27)**.

Static scans used by `FRONTEND_ROUTE_STATUS.md` (same tree): `audit-crosswire.js` 2,527 frontend calls, 2,527 wired, 0 orphaned; `audit-unreached-routes.js` 0 newly dead (157 on the reviewed ledger); `audit-routes.js` 2,991 routes.

## Oct 20, 2026 (afternoon) — second full run after the harness-lane repair (B-27) and the B-29 fix

`tooling/ci/final-run.sh` at commit `81883bf7`, every lane on fresh databases, nothing else on the box. First-pass logs of the
morning run are kept in `final-run-pass1/`. **27 lanes — 26 rc=0 at first pass; 1 rerun.**

| Lane | Result |
|---|---|
| install · migrations-fresh | rc=0 · **605 applied, 0 already present** |
| build-packages · build-modules · build-api · build-frontends · typecheck-api · lint | all rc=0 (lint 0 errors, 200 warnings — baseline) |
| gates | **all 47 gates + 13 audits passed** (first time, no rerun) |
| tests-packages | 20/20, **1,103 passed** |
| tests-modules | 26/26, **10,105 passed**, 217 skipped (incl. the new `portfolio-delete-removes-file.pgtest`) |
| tests-apps | 8/8, **3,495 passed** |
| tests-api | 345 files, **2,855 passed**, 134 skipped |
| migrations-harness · harnesses | 605 applied · **37 passed, 0 failed, 1 skipped-by-design** (`verify-customer-import.mjs` needs a running API — it runs in the lane below) |
| migrations-race · race-lane | 605 applied · **88 files, 307 tests passed, 0 failed** across 14 packages |
| migrations-live · live-route-sweep | 605 applied · **rc=1 — 13/14**: `/super-admin/database/indexes` 3,085 ms on the first request after a fresh database (2 s budget) → **B-30**; rerun (`18b`, per-attempt timing, 0 rate-limited calls) **15/15** |
| live-api-harnesses | **1 passed** — the bulk customer import (5,000 rows: preview, commit, idempotent re-import) against the booted API on the sweep's database |
| seed-pilot01 · live-event-wiring | **17/17** — 10 consumers, 62 background classes single-instance, 21 job handlers, 8 flow proofs (queue 33/33, fair turn 22/22, money chain 25/25, multi-tech 21/21 …), every produced event published and consumed, 0 dead letters |
| live-display-lifecycle (new lane) | **30/30** — Send-to-Display, tip and payment reach the display stream, release, forged token refused |
| migrations-pilot · live-pilot-day | 605 applied · **74/74**, 9 screenshots |
| drill-restore | **12/12** — dump 0.6 s, restore 4.9 s, 750 tables row-identical, sealed columns open, POST_RESTORE_HOLD claims nothing then the job runs once |
| e2e-html | **green** — kiosk + public booking link in real Chromium, 24 API calls verified |

**Totals:** unit/pgtest **17,558 passed, 0 failed** (1,103 + 10,105 + 3,495 + 2,855), 351 skipped · race 307/307 · harnesses 37/37 (+1 in its own lane) · route sweep 15/15 (after B-30 noted) · event wiring 17/17 · display lifecycle 30/30 · pilot day 74/74 · restore drill 12/12 · e2e green · gates 47 + 13.

## Oct 20, 2026 (night) — third full run after the evening P2 / P3 fixes (B-12 … B-30)

`tooling/ci/final-run.sh` at commit `16f3fa89` (the seven evening commits on top of `dac964a3`), every lane on fresh databases.
Second-run logs kept in `final-run-pass2/`. **28 lanes — 26 rc=0 at first pass; 2 failed and were fixed, then rerun** (`final-run-rerun.sh`
at `4428ea3c`, appended to the same `summary.txt` with `-rerun`; the first-pass lines stay).

| Lane | Result |
|---|---|
| install · migrations-fresh | rc=0 · **607 applied, 0 already present** (666 tenant-consistency triggers, 667 sold-unit stamps) |
| build-packages · build-modules · build-api · build-frontends · typecheck-api · lint | all rc=0 |
| gates | **all 48 gates + 13 audits passed** first pass (48th: `check:migration-safety`, B-15); rerun at `4428ea3c` — 48 + 13 again |
| tests-packages | **1,103 passed**, 0 failed |
| tests-modules | **10,133 passed**, 217 skipped, 0 failed |
| tests-apps | **3,499 passed**, 0 failed |
| tests-api | **2,870 passed**, 134 skipped, 0 failed |
| migrations-harness · harnesses | 607 · **rc=1 — 35 passed, 2 failed, 1 skipped**. The run crossed midnight UTC (8 pm Eastern): `verify-owner-staff` → a **real defect, B-31** (owner attendance counted "scheduled today" on New York's day for every salon; fixed `a5bdce20`, test first with the clock pinned); `verify-checkin` → its fixture (a UTC-dated appointment on a New Jersey branch; the product correctly refused) — fixture fixed. **Rerun: 37 passed, 0 failed, 1 skipped-by-design** |
| migrations-race · race-lane | 607 · **88 files, 307 passed, 0 failed** across 14 packages |
| migrations-live · live-route-sweep | 607 · **rc=1 — `/super-admin/database/indexes` 3,114 ms** (2 s budget): the B-30 cache of the evening (`16f3fa89`) had not fixed the cold FIRST request. Measured ~220 ms alone / ~1.1 s for 8 concurrent cold requests; fixed in round 2 (`4428ea3c`: warm-up at start-up, single-flight, set-based query). **Rerun: 15/15, every response under 2 s** |
| live-api-harnesses | **1 passed** (bulk customer import) — and again on the rerun |
| seed-pilot01 · live-event-wiring | **17/17** — flow proofs queue 33/33, fair turn 22/22, money chain 25/25, multi-tech 21/21; no dead letters; p95 outbox → published 1,013 ms |
| live-display-lifecycle | **30/30** |
| migrations-pilot · live-pilot-day | 607 · **74/74** |
| drill-restore | **12/12** — dump 0.7 s, restore 7.3 s |
| e2e-html | **green** — kiosk + public booking link in real Chromium, 24 API calls verified |

**Totals (first pass, `16f3fa89`):** unit / pgtest **17,605 passed, 0 failed** (1,103 + 10,133 + 3,499 + 2,870), 351 skipped · race
307/307 · event wiring 17/17 · display 30/30 · pilot day 74/74 · drill 12/12 · e2e green. **After the two fixes (rerun at `4428ea3c`):**
48 gates + 13 audits · harnesses 37/0 (+1 live) · route sweep 15/15 · live API 1/1. The two packages the fixes touched were run in full
at the final head: analytics **278/0**, super-admin **1,939/0** (13 skipped); the other 24 module batteries are unchanged since the first pass.

## Oct 21, 2026 (early) — fourth full run after B-14 (rest) and B-16

`tooling/ci/final-run.sh` at commit `8d41bd7a` (B-14 rest `331b5b67`, B-16 `f7880f1a`, reports), every lane on fresh databases.
Third-run logs kept in `final-run-pass3/`. **28 lanes — 27 rc=0 at first pass; 1 failed (the race lane), a real defect, fixed test-first
(B-32 `28ce4850`), then rerun** (`final-run-rerun.sh race gates` at the B-32 head, appended to the same `summary.txt` with `-rerun`).

| Lane | Result |
|---|---|
| install · migrations-fresh | rc=0 · **608 applied, 0 already present** (668: platform-managed messaging provisioning) |
| build-packages · build-modules · build-api · build-frontends · typecheck-api · lint | all rc=0 |
| gates | **all 48 gates + 13 audits passed** first pass; rerun at the B-32 head — 48 + 13 again |
| tests-packages | **1,103 passed**, 0 failed |
| tests-modules | **10,161 passed**, 217 skipped, 0 failed |
| tests-apps | **3,502 passed**, 0 failed (pos-web 1,372 · tech-web 182 · …) |
| tests-api | **2,878 passed**, 134 skipped, 0 failed |
| migrations-harness · harnesses | 608 · **37 passed, 0 failed, 1 skipped-by-design** — first pass |
| migrations-race · race-lane | 608 · **rc=1 — 306 passed, 1 failed**: two guests grabbing the same slot at the same instant, one got a raw `deadlock detected` instead of "held for another booking" — **B-32**, a real (intermittent) defect: inserts racing on the `booking_holds` exclusion constraint can deadlock. Fixed: the victim's insert is retried once; test first (`booking-hold-deadlock.pgtest`, 3 red → 3 green); booking battery 676/0. **Rerun: 88 files, 307 passed, 0 failed** |
| migrations-live · live-route-sweep | 608 · **15/15** first pass (B-30 round 2 holds: no cold-request miss) |
| live-api-harnesses | **1 passed** (bulk customer import) |
| seed-pilot01 · live-event-wiring | **17/17** — no dead letters; p95 outbox → published 1,110 ms |
| live-display-lifecycle | **30/30** |
| migrations-pilot · live-pilot-day | 608 · **74/74** |
| drill-restore | **12/12** — dump 0.5 s, restore 5.4 s |
| e2e-html | **green** — kiosk + public booking link in real Chromium, 24 API calls verified |

**Totals (first pass, `8d41bd7a`):** unit / pgtest **17,644 passed, 0 failed** (1,103 + 10,161 + 3,502 + 2,878), 351 skipped ·
harnesses 37/0 · route sweep 15/15 · event wiring 17/17 · display 30/30 · pilot day 74/74 · drill 12/12 · e2e green · race 306/1 →
**after B-32: race 307/307**. The one package B-32 touched (booking) was run in full at the final head: **676/0** (43 skipped).

## Oct 21, 2026 (midday) — fifth full run after the Oct 14–19 rebuild (M1–M4: B-33 … B-48)

`tooling/ci/final-run.sh` at commit `444f3852` (the M2–M4 head), every lane on fresh databases; fourth-run logs kept in
`final-run-pass4/`. The session runner stopped the script at its 2-hour limit inside the harness lane (first pass had
finished 14 lanes); the remaining lanes ran through `final-run-rerun.sh` (which gained `tests-api` and `pilot` lanes,
`e3c231f6`) and are appended to the same `summary.txt` with `-rerun` suffixes and dated NOTE lines.

| Lane | Result |
|---|---|
| install · migrations-fresh | rc=0 · **611 applied, 0 already present** (669 booking deposits, 670 reminder ladder, 671 rollout flags) |
| build-packages · build-modules · build-api · build-frontends · typecheck-api · lint | all rc=0, first pass |
| gates | **all 51 gates + 15 audits passed**, first pass (new: one-tax-calculation, silent-catch, as-any; audits zoom, i18n) |
| tests-packages | **1,105 passed**, 0 failed |
| tests-modules | **10,197 passed**, 282 skipped, 0 failed (26 modules) |
| tests-apps | **3,515 passed**, 0 failed (pos-web 1,376 · admin-web 1,041 · owner-web 336 · customer-web 280 · customer-display 201 · tech-web 183 · manager-pay 90 · kiosk 8) |
| tests-api | first pass **rc=1 — 14 failed / 2,881 passed**: two generated `_headers` files stale after the EN/VI dictionaries moved the inline script's CSP hash, and seven projection specs comparing exact payloads against the new §43 resource envelope (`resourceType / resourceId / resourceVersion`) → fixed `766c0b2a` + `1e05abda` → rerun at the head (below) |
| migrations-harness · harnesses | 611 · two reruns: (1) `verify-reschedule-rewards` timed out — a stale `browser-e2e` boot from the viewport audit still held its PGlite port 5459 (process killed; harness alone 12/12); (2) `verify-tech-profile-http` got a socket error right after boot (alone: 30/30). Across the reruns **every one of the 37 harnesses passed** (1 skipped by design) |
| migrations-race · race-lane | 611 · **88 files, 307 passed, 0 failed** |
| migrations-live · live-route-sweep | 611 · **15/15** |
| live-api-harnesses | **1 passed** (bulk customer import, 9 checks) |
| seed-pilot01 · live-event-wiring | **19/19** (was 17/17: + `live-payroll-plans` 23/23 and `live-multibranch` 12/12 as flow proofs) — no dead letters; p95 outbox → published 996 ms |
| live-display-lifecycle | **30/30** |
| migrations-pilot · live-pilot-day | 611 · first pass **73/74** — the loyalty check read the earnings table while the payment consumer's last write was still in flight (all five rows were in the database seconds later); the proof now waits for every approved payment's earning (`4befec49`) → rerun **74/74** |
| drill-restore | **12/12** — dump 0.7 s, restore 5.3 s |
| e2e-html | **green** — kiosk + public booking link in real Chromium, 24 API calls verified |
| POS viewport / touch audit (`pos-viewport-audit.mjs`, outside the lanes) | **60/60** route × viewport checks on the real logged-in app — after the audit itself was repaired (it had measured the login page, then one screen ten times: `bf9903a3`) and the shell's controls raised to 40 px (`e8990543`); what remains under 40 px is per-screen content (filter selects 31–36 px, inline text links) — `final-run/viewport-audit.log` |

**Totals:** unit / pgtest **17,712 passed, 0 failed** at the final head (1,105 + 10,197 + 3,515 + 2,895), 416 skipped ·
harnesses 37/0 · route sweep 15/15 · event wiring 19/19 · display 30/30 · pilot day 74/74 · drill 12/12 · race 307/307 · e2e green.
No product defect surfaced in this run: the api-lane failures were test artefacts of the §43 envelope and a generated file; the
pilot-day miss was the proof's timing; the harness misses were environmental.

## Oct 22, 2026 — sixth full run (`tooling/ci/final-run.sh`) after the merge verdict and Kevin's decisions (D1–D5, D7, B-18, B-19, B-22)

First pass on `0f94cf7b`; reruns (`tooling/ci/final-run-rerun.sh`) after each failure's fix was committed — both are in
`final-run/summary.txt`, first-pass lines kept. TZ=UTC, node v22.22.0, PostgreSQL 16.15 (password auth for host connections),
fresh databases per lane.

| Lane | First pass | After the fix |
|---|---|---|
| install · fresh-DB migrations | rc=0 · **617 applied, 0 already present** | — |
| builds: packages · modules · API · frontends | rc=0 · rc=0 · rc=0 · rc=0 | — |
| typecheck (API) · lint ratchet | rc=0 · rc=0 | — |
| gates + audits | **all 51 gates + 16 audits passed** | rerun after the drafts-controller fix: **51 + 16 passed** |
| packages · modules · apps | **1,107 · 10,346 · 3,562 passed, 0 failed** | — |
| api | 1 failed / 2,919 passed — `idor-route-coverage`: the new `{draftId}` param had no fixture | **2,920 passed, 0 failed** (`54e598b9`) |
| harnesses | 34 passed, **3 failed** (the compiled API refused to boot: drafts controller DI), 1 skipped | **37 passed, 0 failed**, 1 skipped by design (`efd7795e`) |
| race lane (real PostgreSQL) | 5 failed in `db-worker-pool` (passwordless throwaway role under scram) | rerun 1: `refund-race` flake (two files' platform-wide sweeps on one database) → files take turns (`fe561ef5`) → **89 files, 310 tests, 0 failed, 0 skipped** |
| live route sweep | 14/15 — `/tech/payroll/statements/{statementId}` fixture belonged to no technician | **15/15** (`efd7795e`, then one shared pinned fixture `5349c92d`) |
| live API harnesses (customer import) | **9/9** | — |
| live event wiring | **19/19** (every consumer incl. the new recipe consumer; nothing dead-lettered; p95 975 ms) | — |
| live display lifecycle | **30/30** | — |
| **pilot day** | **74/74** — incl. D4 (polish 6 → 4 at Service Done, nothing recorded by hand) and D3 (partial tender earns; Jenny's $50 gift card excluded) | — |
| restore drill | **12/12** (POST_RESTORE_HOLD proven) | — |
| e2e:html (kiosk + public booking in Chromium) | **green** (24 API calls) | — |
| live IDOR (not a final-run lane; run beside it) | 6/8 — statement fixture constraint; cleanup blocked by the immutable-statement trigger | **8/8 — 178 cases, 0 LEAK, 0 ERROR** (`5349c92d`) |

Totals at the final head (`5349c92d`): unit / pgtest **17,935 passed, 0 failed** (packages 1,107 · modules 10,346 · apps 3,562 ·
api 2,920); race **310**; live checks: pilot 74 · sweep 15 · wiring 19 · display 30 · drill 12 · IDOR 8 · harnesses 37 + 1.

## Oct 22 2026 — handoff run (seventh full run, `tooling/ci/final-run.sh` + `tooling/ci/live-proofs.sh`)

**First pass on `b30dce6c`** (every product fix of the hand-back committed; the 14 uncommitted files at its start were the
hand-back documents and `tooling/ci/gen-env-inventory.mjs` — no product code). **Reruns** of the two failed lanes on
`a42dd40f` with `tooling/ci/final-run-rerun.sh tests-api pilot`, after each fix was committed; both passes are in
`final-run/summary.txt` (first-pass lines kept). **The 24 live proofs** (`final-run-live/summary.txt`) ran on `a42dd40f`'s
fresh build. TZ=UTC, node v22.22.0, npm 10.9.4, PostgreSQL 16.15 (password auth for host connections), a fresh database
per lane.

Exact commands (what final-run.sh runs, in order — each lane's log is `final-run/NN-*.log`):

```bash
npm ci --ignore-scripts
MIGRATE_DATABASE_URL=$PG_URL/fr_migrate node apps/api/scripts/migrate.mjs           # fresh database
npm run build:packages && npm run build:modules && npm run build:api && npm run build:frontends
npm run typecheck && node tooling/ci/lint-ratchet.mjs && npm run ci:gates
npm run ci:test:packages && npm run ci:test:modules && npm run ci:test:apps && npm run ci:test:api
cd apps/api && HARNESS_DATABASE_URL=$PG_URL/fr_harness npm run test:harness
PG_RACE_URL=$PG_URL/fr_race npm run ci:test:race
# live lanes on the built API: live-route-sweep, live-api-harnesses, seed PILOT01, live-event-wiring, live-display-lifecycle,
# live-pilot-day (fresh fr_pilot), drill-restore, e2e-html
PG_URL=… bash tooling/ci/live-proofs.sh     # the 24 proofs final-run does not run, each on its own seeded database
```

| Lane | First pass (`b30dce6c`) | After the fix |
|---|---|---|
| install · fresh-DB migrations | rc=0 · **618 applied, 0 already present** | — |
| builds: packages · modules · API · frontends | rc=0 · rc=0 · rc=0 · rc=0 | — |
| typecheck · lint ratchet | rc=0 · rc=0 | — |
| gates + audits | **all 51 gates + 16 audits passed** | — |
| packages · modules · apps | **1,107 · 10,375 · 3,572 passed, 0 failed** (modules: 221 env-gated skips — the race files, run in the race lane) | — |
| api | **2 failed**: `tenant-isolation` (static) read the advisory-lock key `'payroll_periods:<tenant>'` as an unscoped raw-SQL query; `validate-not-valid-547` refused migration 678's `NOT VALID` CHECK | **2,920 passed, 0 failed** (134 env-gated skips) — `3ae547a7` (key renamed in both writers; CHECK validated) |
| harnesses | **37 passed, 0 failed**, 1 skipped by design | — |
| race lane (real PostgreSQL) | **90 files, 311 tests passed, 0 skipped** (incl. the new pay-period overlap race) | — |
| live route sweep | **15/15** | — |
| live API harnesses (customer import) | **1/1** (9 checks) | — |
| live event wiring | **19/19** (p95 outbox → published 969 ms) | — |
| live display lifecycle | **30/30** | — |
| **pilot day** (`live-pilot-day.mjs`, now with phase 10) | **95/96** — the one red was the proof's own check (the receipt scan answers 201, the check demanded 200); the product side was green | **96/96** (`a42dd40f`) |
| restore drill | **12/12** | — |
| e2e:html | **green** (24 API calls) | — |
| **24 live proofs** (`live-proofs.sh`, on `a42dd40f`) | see the table below | — |

Live proofs (`final-run-live/summary.txt`, each on its own migrated + seeded database):

| Proof | Checks | Proof | Checks |
|---|---|---|---|
| live-checkout-one-payment | 30/30 | live-phase12-v1 | 19/19 |
| live-display-ads | 42/42 | live-phase13-app-version | 17/17 |
| live-display-23in-browser | 37/37 | live-phase13-native-realtime | 17/17 |
| live-display-ads-browser | 14/14 | live-phase13-offline | 13/13 |
| live-display-checkin-browser | 39/39 | live-phase14-telemetry | 22/22 |
| live-display-devices-browser | 29/29 | live-phase2-foundations | 22/22 |
| live-display-journeys-browser | 43/43 | live-phase5-deals | 39/39 |
| live-local-day | 13/13 | live-phase7-scheduling | 31/31 |
| live-phase10-database | 31/31 | live-phase8-community-browser | 25/25 |
| live-phase12-async | 21/21 | live-phase9-permissions | 28/28 |
| live-pos-autolock | 25/25 | live-refresh-authorization | 10/10 |
| live-rls-trial (strict RLS, app role) | 20/20 | live-tracing (OTLP) | 16/16 |

**Totals at the final head (`a42dd40f`):** unit / pgtest **17,974 passed, 0 failed** (packages 1,107 · modules 10,375 · apps 3,572 ·
api 2,920); race **311**; live: pilot **96** · sweep 15 · wiring 19 · display 30 · drill 12 · harnesses 37 + 1 · the 24 live proofs
**603 checks**. Static scans on this tree: TODO / FIXME / HACK / `@ts-ignore` / `@ts-nocheck` in product code **0**; true test
skips (`it.skip` / `describe.skip`) **0** (116 `skipIf` = env-gated race / PG specs, run by the race lane); frontend → backend
calls **2,637 / 2,637 wired**, **0 orphaned**; backend routes **3,085**; **0 new** unreached routes.

**Development runs on Oct 22 before the logged run** (fresh database each): the extended pilot went 80/96 → 90/96 → 95/96; the
live-proof runner first showed 6 red proofs (fixed `475f3e48`). Every red is accounted for in `BUG_REGISTER.md` (B-66 … B-78).

**Not run here (external):** a real CardPointe MID, real Twilio delivery / A2P, Textract / S3 / ClamAV, Tap to Pay on an iPhone,
native store builds, a hosted restore — `NEXT_STEPS.md`, `INTEGRATION_STATUS.md`.

## Oct 26 2026 — M7 full regression on HEAD

Run on branch `merge-github-main`, starting at `634ba8e1` (clean tree), TZ=UTC, on a 2-core / 7 GB host (suites one at a
time). Two other sessions committed docs-only changes during the run (`ab1c628b`, `9b03aded` — the Vietnamese POS mandate
text and its status); no product code changed except the fix below. Code under test for the pilot and proofs: `1c03e996`.
Scratch logs: `/tmp/…/scratchpad/regression/` (progress.log, one log per lane); the evidence that matters is committed under
`docs/pilot-runs/2026-10-26-final/`.

**Build + static**

| Lane | Command | Result |
|---|---|---|
| Build | `npm run -s build:packages && npm run -s build:modules && npm run -s build:api` | rc 0 |
| Frontend builds for the pilot | `npx vite build` in pos-web, tech-web, owner-web, customer-display | rc 0 each |
| Gates | `npm run ci:gates` | **all 54 gates + 17 audits passed** (71 PASS lines, 0 FAIL) at `634ba8e1`, and again at `9d232442` after every fix in this run |
| Typecheck | `npm run -s typecheck` | rc 0 |
| Lint ratchet | `node tooling/ci/lint-ratchet.mjs` | rc 0 — 0 errors, 196 warnings (baseline 198: no-unused-vars 116, exhaustive-deps 80) |
| npm audit | `node tooling/security/check-npm-audit.mjs` | critical 0, high 1 (reviewed allowlist), moderate 10 |

**Unit / PGlite lanes** (`tooling/ci/run-tests.mjs` logic — `npx vitest run` per workspace, fail on any FAIL file line)

| Lane | Suites | Test files | Tests passed | Failed | Skipped |
|---|---|---|---|---|---|
| packages (`ci:test:packages`) | 20 | 126 | **1,195** | 0 | 0 |
| modules (`ci:test:modules`) | 27 | 1,296 (+72 skipped) | **10,746** | 0 | 236 |
| apps — 8 frontends (`ci:test:apps`) | 8 | 704 | **3,688** | 0 (1 on the first run, fixed) | 0 |
| api (`ci:test:api`) | 1 | 372 (+26 skipped) | **3,042** | 0 | 136 |
| **total** | 56 | 2,498 | **18,671** | **0** | 372 |

Skipped files / tests are the env-gated `*.postgres-race` and PG-only specs (`skipIf(!PG_RACE_URL)`); they run in the race lane.

Per suite: modules — ai 2,012 · analytics 288 · appointments 32 · audit 35 · booking 719 · catalog 45 · checkout 865 ·
communications 467 · customers 225 · deals 232 · finance 58 · gift-cards 35 · identity 585 · inventory 29 · loyalty 10 ·
marketing 102 · memberships 139 · payments 260 · platform 114 · queue 687 · reports 15 · safety 538 · security-center 14 ·
super-admin 1,997 · support 34 · tenants 150 · workforce 1,059. Apps — admin-web 1,049 · customer-display 203 ·
customer-web 282 · go-check-in-kiosk 8 · manager-pay-web 120 · owner-web 357 · pos-web 1,470 · tech-web 199. Packages —
api-client 38 · api-contracts 101 · auth 20 · cache 3 · config 22 · database 98 · date-time 19 · events 15 · media 56 ·
mobile-sdk 197 · money 35 · notifications 14 · observability 300 · permissions 120 · realtime-client 28 ·
realtime-contracts 4 · security 33 · tenant-context 4 · ui 78 · web-push 10.

What was re-run and why:
- **modules:** `npm run ci:test:modules` was stopped by the session tool's 30-minute background limit after 23 of 27 suites
  (all 23 PASS); the last four (super-admin, support, tenants, workforce) were run with the same per-suite logic — all PASS.
  Not a test failure.
- **apps — admin-web, 1 failure (real flake, fixed):** `BranchHealthScreen.test.tsx` "reads worst first … pages append" —
  "Load more" not found. Alone it failed 1 run in 3. Cause: the screen derived its paging cursor from the page in a second
  effect, so the first DOM commit of a page had the rows but no "Load more" button (and Refresh briefly kept the old
  cursor). Fixed in `092ceac3` (cursor set in the same update as the page) with a MutationObserver test that records every
  commit and fails on a frame with rows but no button (fails on the old component, passes now) plus a Refresh paging test.
  admin-web re-run alone: 176 / 176 files, 1,049 / 1,049 tests.

**Race lane (real PostgreSQL)** — `DATABASE_URL=…/race_final node apps/api/scripts/migrate.mjs` (632 migrations, latest
`692_security_event_network_policy.sql`), then `PG_RACE_URL=…/race_final TZ=UTC npm run ci:test:race`: **96 files, 328
tests passed, 0 skipped** across 15 packages (api 131, ai 14, booking 47, checkout 49, customers 5, deals 8, gift-cards 2,
identity 2, inventory 5, marketing 4, payments 2, queue 27, safety 3, super-admin 9, workforce 20).

**Pilot day** — fresh database `pilot_final` migrated through 692, all phases (no `PILOT_SKIP`), screens on:
**190 / 190** in 524 s (`docs/pilot-runs/2026-10-26-final/`, section at the top of `docs/PILOT_DAY_REPORT.md`). Attempts on the
way: 160 / 190 (phase 11's blocked-time bulk import exhausted its session's 2,000 / min limiter budget — harness, fixed
`4572c401`), one run killed by a container restart, 188 / 190 (S14's annex name collided with the M5 annex — harness, fixed
`1c03e996`). Then `scripts/drills/drill-restore.mjs` on the pilot database: **12 / 12**.

**Live proofs** — `PG_URL=… bash tooling/ci/live-proofs.sh` (24 proofs, each on a fresh migrated + PILOT01-seeded database):

| Proof | Checks | Proof | Checks |
|---|---|---|---|
| live-checkout-one-payment | 32/32 (first pass 26/30) | live-phase12-v1 | 19/19 |
| live-display-ads | 42/42 | live-phase13-app-version | 17/17 |
| live-display-23in-browser | 37/37 | live-phase13-native-realtime | 17/17 |
| live-display-ads-browser | 14/14 | live-phase13-offline | 13/13 |
| live-display-checkin-browser | 39/39 (`PROOF_TZ=Asia/Tokyo`) | live-phase14-telemetry | 22/22 |
| live-display-devices-browser | 29/29 (first pass aborted) | live-phase2-foundations | 22/22 (restored) |
| live-display-journeys-browser | 43/43 (`PROOF_TZ=Asia/Tokyo`) | live-phase5-deals | 40/40 (first pass 34/39) |
| live-local-day | 13/13 | live-phase7-scheduling | 31/31 |
| live-phase10-database | 31/31 (restored) | live-phase8-community-browser | 25/25 |
| live-phase12-async | 21/21 | live-phase9-permissions | 28/28 |
| live-pos-autolock | 25/25 | live-refresh-authorization | 10/10 |
| live-rls-trial (strict RLS, app role) | 20/20 | live-tracing (OTLP) | 16/16 |

**24 / 24 proofs, 606 checks** after the fixes. First pass on HEAD: 19 green; the rest, all harness (no product change),
fixed in `9e987247` and re-run alone:
- `live-phase10-database`, `live-phase2-foundations` — **deleted by dead-code batch 1 (`246be7a7`)** although this runner
  lists them; restored unchanged, both green; `DEAD_CODE_REPORT.md` corrected.
- `live-checkout-one-payment` (4 red) and `live-phase5-deals` (5 red) — the proofs predate the Oct 23 step-up on terminal →
  register and on refunds (403). They now step up (and checkout-one-payment asserts the 403 STEP_UP_REQUIRED first).
- `live-display-devices-browser` — an anchored `/^Paired\./` no longer matched the note (it now starts with "✓"), and the
  popup's URL was read before the new window navigated.
- `live-display-checkin-browser` / `live-display-journeys-browser` refused to start at 9:30 pm New York (they need a working
  day ahead, exit 2 — not a pass); run with their own `PROOF_TZ=Asia/Tokyo` branch (mid-morning there): green.

**Announcement browser proof** — `CHROMIUM_PATH=/opt/pw-browsers/chromium DATABASE_URL=… node
tooling/e2e/pos-announcement-layout.mjs`: **51 / 51** (1920×1080, 1600×900, 1366×768, 1280×800). (Without `CHROMIUM_PATH`
the script looks for a chromium-1194 path that this host does not have.)

**The other `final-run.sh` lanes** (same commands as `tooling/ci/final-run.sh`, fresh databases `fr_harness`, `fr_live`):

| Lane | Result |
|---|---|
| migrations on a fresh database (×4: harness, live, race, pilot) | 632 applied each, latest 692 |
| harnesses (`npm run -s test:harness`, `HARNESS_DATABASE_URL`) | **9 passed, 0 failed, 1 skipped** (customer import needs a running API — run in live-api-harnesses). First pass 8 / 1 failed: `verify-terminal-capture` 10 / 17 — see below |
| live-route-sweep | 15 / 15 |
| live-api-harnesses (customer import) | 1 / 1 (9 checks) |
| seed PILOT01 + live-event-wiring | 19 / 19 (outbox → published p95 974 ms) |
| live-display-lifecycle | 30 / 30 |
| e2e:html (kiosk + public booking in Chromium) | OK — 24 API calls verified |

`verify-terminal-capture` (harness bug, fixed with this report): it stored its fake Bolt terminal as `http://127.0.0.1:5611`;
since the processor-URL policy (`1b115fb8`, Oct 23) a Bolt address must be https on a CardPointe host, so the charge was
refused `PROCESSOR_URL_NOT_ALLOWED` before any call (7 checks red — the policy behaved as specified). The harness now
stores `https://bolt-harness.cardpointe.com` and its injected transport sends that host to the local fake: 17 / 17.

**Bugs found by this regression:** one product bug (admin-web Branch health paging cursor, `092ceac3`, with tests); harness
/ tooling: the pilot blocks phase pacing (`4572c401`), the S14 branch name (`1c03e996`), two live proofs wrongly deleted
and three out of date (`9e987247`), the terminal-capture harness URL (this commit). Acceptance per mandate: `docs/FINAL_ACCEPTANCE_MATRIX.md`.

**Not run here (external):** a real CardPointe MID / UAT, Twilio / SendGrid delivery, S3 / ClamAV / Textract, Tap to Pay on
an iPhone, native store builds, a hosted backup restore, a penetration test.

## Oct 27 2026 — English + Vietnamese POS mandate: final verification (WP-J)

The product code under test is `dd92f860` on `merge-github-main`, plus the WP-J documentation commit. Everything ran on one
2-core host, one suite at a time, with `TZ=UTC`.

| Lane | Command | Result |
|---|---|---|
| Build | `npm run -s build:packages && npm run -s build:modules && npm run -s build:api`; `npx vite build` in pos-web, admin-web, owner-web, tech-web, customer-display | rc 0 |
| Gates | `npm run ci:gates` | **all 54 gates + 19 audits passed** (incl. `i18n` 12,754 keys / 11 dictionaries, `pos-i18n` tier-4 ratchet 11, `vi-glossary`, `admin-english-only`) |
| Typecheck | `npm run typecheck`; `tsc --noEmit` apps/pos-web | rc 0 / rc 0 |
| pos-web | `npx vitest run` | **345 files, 1,611 passed**, 0 failed |
| owner-web | `npx vitest run` | **67 files, 358 passed** |
| admin-web | `npx vitest run` | **176 files, 1,055 passed** |
| API | `npm run ci:test:api` | **375 files (+27 skipped), 3,070 passed**, 0 failed, 137 skipped (env-gated race / PG) |
| Modules touched by the final pass | `npx vitest run` in queue / booking / communications / deals / audit / customers / ai | 703 / 722 / 480 / 232 / 35 / 62 / 2,028 passed, 0 failed |
| Vietnamese Unicode | `modules/customers/.../vietnamese-unicode.pgtest.vitest.spec.ts` (migrated PGlite) | 4 / 4 |
| Pilot day (all phases, fresh DB migrated through 697, screens on, **no PILOT_SKIP**) | `DATABASE_URL=…/vi_final5 PORT_PROOF=3201 CHROMIUM_PATH=/opt/pw-browsers/chromium PILOT_SHOTS=… PILOT_OUT=… node apps/api/scripts/live-pilot-day.mjs` | **224 / 224** in 833 s (phase 13 Vietnamese: 14 / 14) — `docs/pilot-runs/2026-10-27-vietnamese/` |
| One-screen certification | `tooling/e2e/pos-vi-one-screen.mjs` (`STATE=empty` on `vi_empty`, `STATE=light` on `vi_onescreen`; busy inside pilot 13e) | primary viewport (a 1920×1080 screen with browser chrome + taskbar = a 1920×945 page): **18 / 18 per state, 54 / 54 total**; full-screen 1920×1080 54 / 54. All 5 viewports: empty 90 / 90, light 90 / 90, busy 85 / 90 (5 responsive report items, below) |

Earlier development runs that led to fixes:

- **Pilot run 1, phases 1–11 and 13:** 180 / 187. The failures were harness selectors, a duplicate test phone, a missing
  step-up, and one real bug: the booking technician search was not accent-insensitive (fixed in `84ec29d5`).
- **Final run 1:** 221 / 223. Two harness reads.
- **Final run 2:** 223 / 224. One real bug: the Customer Queue server search was not accent-insensitive. Fixed in `0cbd0ef5`
  together with Service Done, the Booking list, Live Schedule columns, the inbox, campaigns, bundles and audit.
- **Final run 3:** 224 / 224, but the one-screen primary viewport was a full 1920×1080 page. The harness then moved to the
  mandate's screen with browser chrome and taskbar (a 1920×945 page). Its leftover-English list exposed the English payout
  roles and the Tech Queue source mix; both now carry codes (`beafefe1`).
- **Final run 4:** 223 / 224. One real bug, unrelated to language: the AI receptionist sent times without an offset when the
  salon zone has a zero offset (`Etc/GMT`). Intl prints plain "GMT" there. Fixed in `dd92f860`.

- **Final run 5:** **224 / 224** on a fresh database at `dd92f860`. This is the run recorded above and in
  `docs/pilot-runs/2026-10-27-vietnamese/`.

**Bugs found by this pass and fixed:**

- accent-insensitive search was missing in nine server list searches and in Checkout's client filter;
- Customers could not be searched by their whole name;
- report titles and columns, success notes, example placeholders and 39 date formats were English in Vietnamese mode;
- the unused-key report did not know run-time code prefixes;
- the Checkout payout roles and the Tech Queue source mix were English in Vietnamese;
- the AI receptionist gave offset-less times for zero-offset salon zones.

**Not passing (reported, internal):** the responsive report items below. Both languages are affected unless marked; full detail
is in report §G.

- At 1366 / 1280 the Overview's Notify button overlaps View All.
- At 1280 the Checkout row buttons overlap (VI only).
- Compact buttons are 15–25 px tall at the one-screen density (§78).

## Oct 27 2026 — Platform Announcements + Secure Tap to Pay: INTERNAL PARTIAL items closed

Commits `4dd41f0e` (announcements §72 §116 §106 §60 §34 §84), `d6631f8e` (§98, migration 699), `278c5bad` (Secure Tap §51),
`d90c1bfe` (Secure Tap §35 / §36 / §73 software half), and the status / matrix commit. All suites `TZ=UTC`, one at a time.

| Suite | Result |
|---|---|
| `apps/pos-web/src/shell/PlatformAnnouncementBar.test.tsx` | **17 / 17** (+7: §72 ×3, §116, §106 ×2, §34) |
| `apps/admin-web/src/screens/PlatformAnnouncementsScreen.test.tsx` | **15 / 15** (+4: §60, §34, §84 ×2) |
| `modules/communications/…/platform-notice.pgtest.vitest.spec.ts` (PGlite, every migration incl. 699) | **29 / 29** (+2: §60 creator, §98 search rewrite) |
| `apps/api/src/observability/client-events.vitest.spec.ts` | **7 / 7** (+1: the three POS announcement failure events) |
| `packages/api-contracts/src/client-telemetry.test.ts` | pass |
| `apps/api/scripts/platform-announcements-explain.mjs` (3,000 salons / 20,000 notices / 1.88M targets) | recorded in `PERFORMANCE_REPORT.md` "Platform Announcements (§98)" |
| `modules/checkout/…/device-security-signals.vitest.spec.ts` | **8 / 8** (+4: unusual-registration rule, limits, service event + dedupe, claim-conflict audit) |
| `modules/checkout/…/payment-device-oversight.pgtest.vitest.spec.ts` (PGlite) | **4 / 4** (new) |
| `modules/checkout/…/mobile-recovery-convergence.vitest.spec.ts` | **5 / 5** (new) |
| `apps/owner-web/src/screens/PaymentDevicesScreen.test.tsx` | **6 / 6** (+2) |
| `apps/admin-web/src/screens/SystemOpsPaymentDevices.test.tsx` + `SystemOperationsScreen.test.tsx` | **2 / 2** + **16 / 16** |
| typecheck: pos-web, admin-web, owner-web, communications, checkout, api build | 0 errors |

**Platform Announcements browser proof — Oct 27, this HEAD** — `vite build` of pos-web + `tsc` of the API, database
`e2e_announce` (PILOT01) migrated to 701, `CHROMIUM_PATH=/opt/pw-browsers/chromium DATABASE_URL=… node
tooling/e2e/pos-announcement-layout.mjs`: **56 / 58** (was 51 checks; +7 new: §106 dialog / focus trap / return focus /
computed contrast — text 7.92:1, icon 4.97:1 — §34 library icon, §116 the failed snapshot counted on /metrics, §164 no
announcement text in ≈797 KB of API log). **FAIL ×2:** "the message keeps readable room" at 1366×768 (163 px, needs 200) and
1280×800 (117 px, needs 150). Cause: the header now also carries the English / Tiếng Việt language switch (~95 px, Vietnamese
POS mandate), so the announcement slot is 303 / 257 px wide; every other layout check (no scroll, Search ≥ 180 px, bar
between Search and clock, controls not overlapped, ≤ 2 lines) passes at all four widths. Open as Platform Announcement §108
(owner: the POS header layout work).

## Oct 27 2026 — final pass: full regression on HEAD (the last internal items, Kevin's §24 decision, every lane)

Branch `merge-github-main`, TZ=UTC, a 2-core / 7 GB host, one suite at a time. Product code under test: `3c5ae402`
(build / static / unit lanes) and `94ba69e9` = `b01f8d71` (the API lane, the pilot day, the live proofs — the difference is
two renames and test / harness / allowlist lines, listed below). The container restarted once mid-run (final run #2 was
killed in its modules lane): only the lanes not yet recorded green were re-run, on the same code. Lane logs:
`docs/pilot-runs/2026-10-27-final/` (summaries + the per-lane logs that matter).

**Fixes made in this pass** (each with a test; commits on the branch, nothing pushed): OCR body routes strict + reviewed
pages caller (`7f86355f`); SD-21 attempt-by-key scoped to the caller's location (`df8bf3b0`, `35863220`); the 13 routes that
answered 5xx on malformed input (`eca99938`) — injection pass run 3: **22,250 requests, 0 failing** (`8c651a19`); wrong QR
handoff code → 401 `HANDOFF_TOKEN_INVALID` + POS EN/VI (`b2783117`); `check:unreached` (Owner App suggested-expense link),
lint `@ts-ignore`, silent catches in the AI gateway, pos-i18n (`73acd523`); V-5 server refusals as registry codes, deal
reasons worded by the POS (`2fa57469`); as-any / response-exposure / attack-surface (`034585ea`, `35863220`); Kevin's §24
decision — category fallback for technicians with no services set up (`ded4729d`); API-lane drift (`3f299d0a`), role-checks
allowlist (`b01f8d71`), route-sweep / pilot / ads-proof harness fixes (`a4c635ed`, `94ba69e9`, `7d7787dd`).

**Build + static** (final run #2 at `3c5ae402`)

| Lane | Command | Result |
|---|---|---|
| Install | `npm ci` | rc 0 |
| Migrations, fresh database | `migrate.mjs` on `fr_migrate` | **642 applied** (001 … 702) |
| Builds | `build:packages`, `build:modules`, `build:api`, `build:frontends` | rc 0 each |
| Typecheck | `npm run -s typecheck` | rc 0 |
| Lint ratchet | `lint-ratchet.mjs` | rc 0 — 0 errors, 192 warnings (baseline locked: exhaustive-deps 75) |
| Gates | `npm run ci:gates` | **all 54 gates + 21 audits passed** at `35863220` and `3c5ae402`; at `94ba69e9` 1 FAIL (`check:role-checks`: the reviewed invitation line moved with the `requestedInviteeRole` rename) → fixed `b01f8d71` (re-checked: pass); final full run on the shared tree: see "Final `ci:gates` on HEAD" below |

**Unit / PGlite lanes** (`tooling/ci/run-tests.mjs` logic — `npx vitest run` per workspace, fail on any FAIL file line)

| Lane | Suites | Test files | Tests passed | Failed | Skipped |
|---|---|---|---|---|---|
| packages (`ci:test:packages`) | 20 | 129 | **1,247** | 0 | 0 |
| modules (`ci:test:modules`) | 27 | 1,345 (+74 skipped) | **11,027** | 0 | 243 |
| apps — 8 frontends (`ci:test:apps`) | 8 | 745 | **3,897** | 0 | 0 |
| api (`ci:test:api`) | 1 | 380 (+27 skipped) | **3,110** | 0 (5 on the first run, fixed) | 137 |
| **total** | 56 | 2,599 | **19,281** | **0** | 380 |

Per suite — modules: ai 2,055 · analytics 290 · appointments 36 · audit 35 · booking 724 · catalog 47 · checkout 898 ·
communications 483 · customers 241 · deals 232 · finance 77 · gift-cards 35 · identity 595 · inventory 29 · loyalty 10 ·
marketing 102 · memberships 140 · payments 269 · platform 114 · queue 711 · reports 15 · safety 588 · security-center 14 ·
super-admin 2,010 · support 34 · tenants 152 · workforce 1,091. Apps: admin-web 1,066 · customer-display 203 · customer-web 282
· go-check-in-kiosk 8 · manager-pay-web 120 · owner-web 368 · pos-web 1,649 · tech-web 201. Packages: api-client 38 ·
api-contracts 131 · auth 20 · cache 3 · config 22 · database 100 · date-time 19 · events 15 · media 59 · mobile-sdk 206 · money 35 ·
notifications 14 · observability 304 · permissions 123 · realtime-client 29 · realtime-contracts 4 · security 33 · tenant-context 4
· ui 78 · web-push 10.

What was re-run and why:
- **modules:** 19 of 27 suites passed in final run #2 before the container restart killed it; the other 8 (queue, reports,
  safety, security-center, super-admin, support, tenants, workforce) were run with the same per-suite logic — all PASS; workforce
  and super-admin again after `3f299d0a` / `94ba69e9` touched them (1,091 / 2,010, 0 failed).
- **api, 5 failures on the first run (test drift from the Oct 27 builds + two names):** §69 CSRF rule — two payroll GET
  handlers named `pay…` (renamed `preparationReport` / `technicianEvidence`, routes unchanged); §323 role-from-body rule — the
  platform invitation read `b?.role` (the role REQUESTED for the invitee; named `requestedInviteeRole`); the schema guard read
  `IS DISTINCT FROM EXCLUDED` as a table; the payroll period machine gained `draft → canceled`; the validated-body field error
  gained `rule` (V-5). Fixed in `3f299d0a`; the full API lane re-run: 3,110 / 3,110.

**Race lane (real PostgreSQL)** — `race_final` migrated to 702 (`migrate.mjs`: 702 had been applied earlier from a pre-commit
copy — the same column and the same CHECK under another constraint name; the runner warns and does not re-apply), then
`PG_RACE_URL=…/race_final npm run ci:test:race`: **99 files, 336 tests passed, 0 skipped** across 15 packages.

**Harnesses** — `npm run test:harness` on a fresh migrated database: first pass 8 passed / 1 failed (`verify-terminal-capture`
12 / 17); alone on a fresh database 17 / 17, and the whole lane again on another fresh database **9 passed, 0 failed, 1 skipped**
(`verify-customer-import` needs a running API — it ran in `live-api-harnesses`: 9 / 9). The first-pass failure did not reproduce
(recorded, not explained).

**Live lanes of `final-run.sh`** (fresh `fr_live` / `fr_live2`, `fr_pilot` / `fr_pilot2`)

| Lane | Result |
|---|---|
| live-route-sweep | first pass 14 / 15 — `GET …/paychecks/periods/{id}/preparation` 409 for the seeded (unapproved) period, `PAYROLL_PERIOD_NOT_READY` by contract → listed in the sweep's by-design answers (`a4c635ed`); re-run **15 / 15** |
| live-api-harnesses | 1 / 1 (customer import 9 / 9) |
| live-event-wiring | **19 / 19** — publisher p95 922 ms |
| live-display-lifecycle | **30 / 30** |
| live-pilot-day | first pass **230 / 235** (harness: phase 14 kept the receptionist session phase 13 had signed out; the cancel-week check required a statement in a week without earnings) → fixed `94ba69e9` → **235 / 235** on a new database (`docs/PILOT_DAY_REPORT.md`) |
| drill-restore | **12 / 12** (both pilot databases) |
| e2e-html | both single-file HTML apps (kiosk, public booking link) complete their journeys in Chromium |

**Live proofs** — `PG_URL=postgres://postgres:…@localhost:5432 PROOF_TZ=Asia/Tokyo CHROMIUM_PATH=/opt/pw-browsers/chromium bash
tooling/ci/live-proofs.sh` (24 proofs, each on its own migrated + PILOT01-seeded database): **24 / 24, 606 checks**.
checkout-one-payment 32 · display-ads 42 · display-23in-browser 37 · display-ads-browser 14 (first pass 13 / 14: the badge
reads "Active" since the status labels went through `statusLabel` — harness, `7d7787dd`) · display-checkin-browser 39 ·
display-devices-browser 29 · display-journeys-browser 43 · local-day 13 · phase10-database 31 · phase12-async 21 · phase12-v1 19
· phase13-app-version 17 · phase13-native-realtime 17 · phase14-telemetry 22 · phase2-foundations 22 · phase5-deals 40 ·
phase7-scheduling 31 · phase8-community-browser 25 · phase9-permissions 28 · pos-autolock 25 · refresh-authorization 10 ·
tracing 16 · rls-trial 20 · phase13-offline 13.

**Announcement browser proof** — `e2e_announce` migrated to 702, `CHROMIUM_PATH=… node tooling/e2e/pos-announcement-layout.mjs`:
**58 / 58** — the two §108 "readable room" checks that failed at `dd92f860` now pass (1366×768: 209 px ≥ 200; 1280×800:
163 px ≥ 150).

**Vietnamese one-screen matrix** — `tooling/e2e/pos-vi-one-screen.mjs` (9 primary modules × EN / VI, Hanken Grotesk):
`STATE=empty` on `vi_empty` **18 / 18 primary, 108 / 108 incl. responsive**; `STATE=light` on `vi_onescreen` **18 / 18 primary,
107 / 108** (report item: Tech Queue VI at 1280×800 — two compact controls 230×35, short of a 44 px hit area); busy (200
technicians) inside pilot phase 13: **18 / 18 primary**, responsive report 55 / 90 (report-only; it was 85 / 90 in the Oct 27
Vietnamese run — not investigated in this pass, listed in NEXT_STEPS).

**§163 injection pass, run 3** — 2,422 routes, 22,250 requests, **0 failing responses** (`docs/security/SECURITY_TEST_REPORT.md` §4).

**Final `ci:gates` on HEAD — NOT green, and not from this pass's commits.** While the last records were being written,
other agents committed to the branch (`6a1a76e8`, payments `as any` removal) and were editing ~280 files in the working tree
(pay-stub PDF routes and others, uncommitted). The full `npm run ci:gates` on that shared tree: **7 FAIL** — `check:tenant-builder`,
`check:silent-catch` (both caused by `6a1a76e8`: `.catch(() => [] as any[])` became `.catch(() => [])`, which the scanners now
count — 5 payments files above their silent-catch baselines, 2 `payment-gateway.resolver.ts` reads flagged without `tenant_id`),
and `check:unreached`, `check:openapi`, `check:api-contract`, `check:list-queries`, `check:attack-surface` (all from the three
uncommitted `…/pay-stub.pdf` routes). Isolation, in a clean `git worktree` of the commits (static gates): at `fe1080e6` (this
pass's last commit) tenant-builder and silent-catch **pass**; at `6a1a76e8` they **fail**; unreached, list-queries,
attack-surface, role-checks, as-any **pass** at `6a1a76e8` (no pay-stub routes committed). So the gates were green at this
pass's code (`3c5ae402` full run; `b01f8d71` after the one role-checks fix) and are red on the branch HEAD because of work
landed / in progress after it — for that work's owner to close (silent-catch baseline review or re-throw, tenant-builder
review, and `openapi --manifest` / list-query / api-contract types / attack-surface regeneration for the pay-stub routes).

