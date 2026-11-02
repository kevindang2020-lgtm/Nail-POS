# NEXT_STEPS.md — what the next developer does, in order (Oct 26 2026; updated after the Oct 27 final pass and the Oct 28 session)

## Oct 28 2026 — Pilot scan + package (add to the top)

- Start from `DEVELOPER_HANDOFF_FINAL_2026-10-28.md` — it orders everything below (K-12 first, then FST-1, hosting, Fiserv, Twilio).
- FST-1 now also covers the 104 harness-limited specs in `docs/pilot-runs/2026-10-28/unit-sweep-remaining.tsv` (expected green under real vitest).
- New standing rule: after any `index.html` inline script / style change run `node apps/api/scripts/generate-app-headers.mjs` and commit the `_headers` files (CI `app-headers.vitest.spec`).
- Re-run `node tooling/full-system-test/dead-routes.mjs <repo>` after adding or renaming a frontend route (0 dead targets today).

## Oct 28 2026 — Check-In + Live Operations One-Screen (add to the top)

- **internal (by severity):**
  1. run the updated jsdom tests (`POSCheckInScreen.test.tsx`, `.vi.test.tsx`, `QuickCheckInPanel.test.tsx`, `POSDashboardScreen.test.tsx`), pos-web `tsc` and eslint with real `node_modules`;
  2. run the check-in pgtests (duplicate / concurrency) and `/pos/check-in/customers/search` against a production-sized customer table;
  3. two-station pilot: check-in on one station → Live Check-In Queue / Waiting Lounge / Available Technicians / Live Operations update on the other without layout shift;
  4. Edge, branded Chrome, the physical 27-inch touchscreen (Windows scaling 100 % / 125 %).
- **external (Kevin):** phone masking on the Check-In queue (§76 — kept as today); shell header 48–52 px and sidebar 175–195 px for every page (labels truncate); review VI strings A34; Avg. Check-In Time needs check-in duration tracking.

## Oct 28 2026 — Overview 27-Inch One-Screen (add to the top)

- **internal:**
  - run `POSOverviewScreen.test.tsx` / `.vi.test.tsx` (updated: error alert, server insight wording, "+N more"), pos-web `tsc` and eslint with real `node_modules`;
  - run `/pos/overview/state` + `/board` against a built API on a busy tenant (200 technicians, 1,000+ appointments): latency, payload, slowest query;
  - a two-station realtime check (check-in on one station → the Overview on the other updates with no layout shift);
  - Edge, branded Chrome, the physical 27-inch touchscreen.
- **external (Kevin):**
  - whether the shell header may go to 48–52 px for every POS page (§7 target; kept at 60);
  - whether the sidebar group labels may be shortened so the sidebar can be 175–195 px (§23);
  - missed-call tracking (nothing records caller numbers yet; the tab says "not connected");
  - review the A33 Vietnamese strings.

## Oct 28 2026 — Customer Queue One-Screen (add to the top)

- **internal:**
  - run `POSQueueScreen*.test.tsx` (updated for the Manage overlay), the queue pgtests, pos-web `tsc` and eslint with real `node_modules`;
  - run the Kysely queue adapter end-to-end: the durable move keys, the `create()` unique-violation path and the `techSignals` cost on `/pos/queue/state`;
  - pilot with two POS stations + the Technician App:
    - concurrent assign / start / Tech Queue;
    - Add to Queue double tap;
    - a VIP raise with a reason;
    - wait alert to a guest with the Customer App;
    - tenant and branch isolation;
  - time `/pos/queue/state` at 50 / 100 / 250 records and 200 technicians (latency, payload, slowest query, browser memory).
- **external (Kevin):**
  - SMS wait alerts (template + consent);
  - whether a priority raise should also need a manager;
  - whether Auto Balance may ever apply without a person;
  - the physical 27-inch touchscreen in Edge and Chrome.

## Oct 28 2026 — Serving One-Screen (add to the top)

- **internal:**
  - run `POSServingScreen*.test.tsx` and the serving pgtests with real `node_modules` (the jsdom tests' Manage drawer now lives in an overlay — same labels, same `tr` wrapper);
  - run the Kysely Serving adapter end-to-end (its statements were verified on PostgreSQL 16 one by one);
  - pilot with two POS stations + the Technician App: concurrent start / stage / add-on / Mark Ready, multi-technician (A manicure + B pedicure), delayed service, tenant and branch isolation;
  - §94: warn when an add-on's added minutes collide with the add-on technician's next appointment (not checked today);
  - time the 200-technician floor (snapshot latency, payload, slowest query, browser memory).
- **external (Kevin):** SMS for Send Update (template + consent); partial handoff (one technician done, another serving); whether Auto Balance may ever execute automatically; the physical 27-inch touchscreen in Edge and Chrome.


## Oct 28 2026 — Service Done One-Screen (add to the top)

- **internal:**
  - apply migration **707** (`service_done_checklist`);
  - run `POSServiceDoneScreen*.test.tsx` and the queue pgtests with real `node_modules`;
  - run the live Serving → Service Done → Checkout pilot on a built API, including the multi-technician, quality-issue and late add-on paths;
  - time the 200-technician board (snapshot latency, payload, query time).
- **external (Kevin):**
  - decide whether **Send Update** should text the guest (communications template + consent);
  - decide whether a **partial handoff** is ever allowed;
  - run the physical 27-inch touchscreen pass in Edge and Chrome.


## Oct 28 2026 — Checkout One-Screen (add to the top of the list)

- **internal:** Run these with real `node_modules`:
  - `apps/pos-web` tests `POSCheckoutScreen*.test.tsx`; the insight test was updated, and the note test id was kept on the note text;
  - the checkout pgtests;
  - `vite build`;
  - `tsc`.

  Then re-run `node tooling/checkout-one-screen/measure.mjs` and `interact.mjs` against the real fonts (Hanken Grotesk and Playfair Display).
- **external (Kevin):** Decide on **Split Ticket**. Today one ticket per visit is assumed platform-wide, and the Quick Action is Split Payment. Then:
  - a physical 27-inch touchscreen pilot (Chrome + Edge);
  - CARD / Tap to Pay against a real MID.


Re-ordered on Oct 26 2026, after the Oct 26 build. The sources are the INTERNAL / EXTERNAL lists at the end of each
`docs/mandates/status/*.md` report and the older P / M / S items below.

Each item has an owner:
- **internal**: a developer can do it in this repository.
- **external**: it needs an account, device, approval or decision that only Kevin (or his developer, for K-12) can give.

Nothing open here is a broken path a salon would hit today. Each item has a safe behaviour now: a refusal with a clear
message, a "not configured" answer, or a person in the loop.

## 0. Full System Test (Oct 28 2026, FullSystemTest.pdf) — the ordered list, P0 → P3

Verdicts: **CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO** (`PRODUCTION_READINESS.md`). Evidence:
`docs/full-system-test/2026-10-28/`. Each row: path · action · owner · done when.

| # | Sev | Path | Action | Owner | Done when |
|---|---|---|---|---|---|
| FST-1 (= V-28) | P0 | repo root | `npm ci` → `npm run typecheck` → `npm run ci:gates` → `npm run ci:test:{packages,modules,apps,api}` → `npm run ci:test:race` → pilot day on a fresh DB through 706 (`TEST_RESULTS.md` §7) | developer | all green; pilot every line PASS; record in `TEST_RESULTS.md` |
| FST-2 (= P0-1) | P0 | — | K-12 sequence, `SECURITY_REMAINING_ACTIONS.md` A1–A7 | Kevin's developer | each step confirmed; gitleaks full-history green |
| FST-3 (= P0-2) | P0 | Super Admin → Payment Gateways; `apps/api/scripts/uat/cardpointe-uat.mjs` | one salon's MID; `cd apps/api && npm run uat:cardpointe`; confirm the refund-inquiry shape; then `PAYMENTS_REFUND_INQUIRY_VERIFIED=1` | Kevin + Fiserv | approve + void on UAT; a timeout refund settles once |
| FST-4 | P1 | hosting variables | `DB_TENANT_RLS=1`, `DB_TENANT_RLS_STRICT=1` (tested locally: `DATABASE_AUDIT.md` §3) | Kevin's developer | staging: tenant-less request reads 0 rows |
| FST-5 | P1 | hosting | production restore + PITR into an isolated instance (checks of `tooling/full-system-test/backup-drill.sh`); RPO / RTO recorded | Kevin | restore boots at 706; checksums match; other tenants untouched |
| FST-6 | P1 | — | S-B2 … S-B7, then the penetration test (S-B12) | Kevin | report with no open high |
| FST-7 | P2 | `docs/pilot-runs/<date>/` | 27-inch EN / VI POS run + busy-state report (I-18) on this commit — the last run predates POS-only Vietnamese `05ac57cd` | developer | one-screen primary 54 / 54; responsive ≥ 85 / 90 or explained |
| FST-8 | P2 | `EXTERNAL_SETUP_CHECKLIST.md` X-9 … X-16 | Tap to Pay, Twilio, SendGrid, push, OCR, AI, native builds | Kevin | each acceptance test there |
| FST-9 | P3 | `apps/api/src/common/tenant-rate-limit.vitest.spec.ts` and other specs that read files relative to the package | none for vitest (it runs per package); only if the stand-in harness is reused, run each spec with its package as cwd | developer (optional) | — |

Fixed in the test run: owner PIN from the CSPRNG + `error-text` baseline (`2ca43279`); four duplicate-import spec files
(`42f77325`); WebAuthn verifier fails closed on anything but `verified === true` (`07e599ea`). Verified now (were "V-28 must run"): `check:openapi` (3,123 routes match the hand-edited manifest), `check:error-text`,
`check:async-exports`, `check:permission-docs`, `check:pos-i18n`, and the six database gates on real PostgreSQL.

## 1. Internal — in this order

**Oct 28 2026, afternoon — Kevin's decisions + POSLanguage.pdf** (all BUILT, verify under V-28; details in
`NEW_CHAT_HANDOFF.md` §8 and `docs/mandates/status/POS_LANGUAGE_SCOPE_STATUS.md`): Tap to Pay per-location MID (`e574752d`,
migration 704) and refunds / voids in the POS (`33034f61`); paycheck push / paid-week revert / itemised bonuses
(`78a07f6b`); membership reminder SMS (`cf4af25b`); Twilio offboarding of cancelled salons (`f9ff96c4`, migration 705);
manager PIN scoped to the manager's location(s) (`039e3725`); POS-only Vietnamese — English enforced at bootstrap in every
other app, new gate `check:english-only-apps` (`05ac57cd`). Decision 7 (refuse boot without a shared login throttle) = NO.
**V-28 must add:** the rewritten jsdom tests (customer-display, the four apps' `catalog.test.ts`), the new pgtests (paycheck
revert + push, pay-stub language, PIN location, offboarding), the CommerceHub sandbox VERIFY markers, and the POS 27-inch
EN / VI layout runs.

**Oct 28 2026 session** (`75c45d6d` … see `NEW_CHAT_HANDOFF.md` §8). The session had NO npm registry access, so no
`node_modules`: `typecheck`, the vitest suites, the race lane and the pilot could not run. Built — and checked as far as that
allowed, so each is BUILT, not DONE, until V-28 runs (44 dependency-free gates; changed specs run through a stand-in harness with negative controls; the `as any`
batch proven runtime-identical file by file):
- **SD-23 / N-4** (`7d23399e`): "Turn off all AI in this salon" is a real setting, and the tenant's saved AI settings now
  reach real AI calls (AiPlatform + the OCR gateway read them per call — before, nothing passed them). `POST
  /ai/dashboard/settings` is strict (1,246 / 1,268). **Behaviour change:** saved caps / disabled tasks are now enforced.
- **I-15** (`c2292a19`): `as any` 4,954 → 3,251 (the Oct 27 WIP patch; one hidden whole-row read fixed).
- **N-19** (`f0ee9ef0`): 5 Super Admin xlsx / pdf exports answered `{"type":"Buffer",…}`; fixed in AsyncExportInterceptor
  (+ field minimisation no longer rebuilds file bodies).
- **B-93 + R-5** (`7eae34fe`): OCR store writes fail loudly; OCR audit rows carry correlationId / jobId.
- **Lint gate false PASS** (`75c45d6d`): `check:lint` passed when eslint never ran.
- **Mandate re-audit (8 PDFs + the Vietnamese POS PDF), fixes** — all BUILT, verify under V-28:
  F1 corrected receipt amounts reach the posting (`c9a72331`); F2–F6 receipt branch scope, CSV-import duplicates, loud dedup,
  splits (`0c6d0a0f`); Tap to Pay recovery lookup + fail-closed kill switch (`7cad2089`); unpaid gift-card mint retired, card +
  ledger in one transaction (`8a6f5ce2`); paycheck branch scope / cash cap / paid re-handoff / drawer lock (`b8ca06da`);
  Tap to Pay refund / void refused here (`TAP_TO_PAY_REFUND_AT_PROCESSOR`) and the refund sweep never auto-releases unless
  `PAYMENTS_REFUND_INQUIRY_VERIFIED=1` (`d8f2967e`); AI plan lines per-service eligibility (`c47fbac9`); Vietnamese POS re-audit
  — server English on Vietnamese screens, glossary in every app, customer notices in the customer's language, Owner / Tech
  default language, four accent-folded searches (`bafe612c`); eligibility authority required at boot (`ba73e2ef`); revoke
  releases the phone's claims, attempt routes location-scoped (`041a8ff6`). Every status report in `docs/mandates/status/`
  carries a "Re-audit — Oct 28 2026" block and per-row notes; false DONE rows were downgraded.
- **Later on Oct 28 (second request: the same 8 PDFs + the Security Deep Scan PDF)** — BUILT, verify under V-28:
  payroll legacy period reads branch-scoped, expense version races + matchPayment audit, OCR retention order, e2e-giftcard
  rewritten on the paid flow (`c46c5fc2`); realtime clients drop late older frames by aggregate resourceVersion (`28062a34`);
  phone-change / AI-proposal / review-request SMS in the customer's language (`a3460b50`); Security Deep Scan re-audit — Support
  Mode unmask bypass closed, step-up on lockdown lift / cancel, salon Twilio credentials, partner payouts, branch-access grants,
  queue support requests, sort-key prototype fix, migration 703 refuses TRUNCATE on the audit tables, manager-PIN budget in
  Postgres (`74208ced`); receipt export disclaimer §162 and same-vendor-same-day flag §96 (`8505efa1`).
  **V-28 also:** regenerate `apps/api/openapi/manifest.txt` (10 lines were edited by hand to add `step-up`) and run
  `check:openapi`; run the new pgtests (support mode, TRUNCATE, manager-PIN budget, payroll legacy reads, retention order,
  same vendor same day, expense search, owner ticket search, tech customer search, customer notices).
- **Kevin's ruling (Oct 28 2026): every CUSTOMER message is English** (customers are English-speaking Americans) —
  `customerMessageLanguage()` always answers `en` and `customer/me/locale` answers `en`; Vietnamese stays for staff screens.
- **Manager PIN (BUILT Oct 28, verify V-28):** works only at a location the manager may enter, only in her own salon
  (`STAFF_BRANCH_ACCESS` wiring). **Security items still open (internal):** extend `scripts/idor-routes.mjs` to write routes and the customer
  realm; per-processor webhook schemas (§110); computed `<style>` → CSS variables so `'unsafe-inline'` can leave
  `style-src-elem` (§89); a process-wide egress allowlist (§93); per-realm credentialed-origin lists (an XSS in one app can
  call another realm with its cookie). Kevin decided (Oct 28): do NOT fail boot when `LOGIN_THROTTLE_STORE` is not
  `redis` — set it to `redis` on any multi-replica deploy (S-B3).
- **New from the re-audit, still open (internal):** ~~e2e-giftcard script, legacy payroll reads, client `resourceVersion`,
  OCR version checks, customer SMS templates~~ (all built later on Oct 28, above); the Tech app has no language switch;
  §32 version-conflict race tests; native Secure Enclave key store / App Attest verifier / app-switcher cover (code now,
  proof on a device). **Decisions for Kevin:** see `NEW_CHAT_HANDOFF.md` §8.

**First thing to do (V-28):** with dependencies installed, run `npm run typecheck` and `npm run ci:gates`. If
`check:strict-bodies-types` reports a stale proof, run `node apps/api/scripts/strict-bodies-typeproof.mjs`, and the strict-bodies
report: `STRICT_BODIES_REPORT=1 npx vitest run src/common/strict-bodies.vitest.spec.ts` in `apps/api`; both JSON files were
hand-edited for `POST /ai/dashboard/settings`. Then run `ci:test:{packages,modules,apps,api}`. A removed `as any` can still be a
compile error — type what typecheck names. Then N-2 (full regression) per `NEW_CHAT_HANDOFF.md`.

**Oct 27 final pass** (`TEST_REPORT.md` "Oct 27 2026 — final pass"): full regression on the final-pass code — 19,281 unit /
PGlite passed, race 336, 24 / 24 live proofs, pilot 235 / 235, announcement proof 58 / 58. Closed: I-1, I-11, I-17, the
5xx / SD-21 parts of I-8, part of V-5, and Kevin's §24 decision (category fallback for unconfigured technicians). New items
I-18 … I-20 below. (Its "first thing to do", I-20, is superseded by V-28 above.)


| # | Item | Where | Done when |
|---|---|---|---|
| ~~I-1~~ | **DONE Oct 27 (final pass)** — every lane logged in `TEST_REPORT.md` "Oct 27 2026 — final pass"; whole pilot day without `PILOT_SKIP` 235 / 235 (phase-11 blocked-time lines PASS); Final Acceptance Matrix refreshed. | — | — |
| ~~I-2~~ | ~~Recovery flows in the pilot day~~ — **DONE Oct 27** (`44988993`): pilot phase 14 (`lib/pilot-recovery.mjs`, `PILOT_SKIP=14`), 4/4 PASS; it found and fixed a lost commission reversal on a sweep-settled refund. | `docs/pilot-runs/2026-10-27-final/pilot.txt` lines 292–296 (the `2026-10-27-recovery/` folder named here before does not exist — corrected Oct 28) | — |
| ~~I-3~~ | ~~Wallet webhook leg~~ — **DONE Oct 27** (`2dbeb916`): a top-up order's charge event settles the intent through the same conditional settle + `topup:<id>` key; race spec with a webhook participant. UAT confirms only the real event shape. | `payment-webhook.service.ts`, `customer-payments.service.ts` | — |
| ~~I-4~~ | ~~Split-tender race~~ — **DONE Oct 27** (`2a7cd107`): `split-tender-lost-card.postgres-race.vitest.spec.ts` (mutation-checked) + pilot 14c. | race lane | — |
| I-5 | **~~Realtime-first outbox lane~~ built (`aad5863f`); the client half is open:** (200-tech §90 / §1, old M5-1). Publish the SSE projection before the heavy consumers per aggregate, then re-measure with `m4-outbox-burst-bench.mjs`. Also: no client reads `resourceVersion` yet, although the M4 lane commit said clients drop stale frames. Either implement the client check or correct the claim. | `apps/api/src/events/outbox-publisher.ts`, `event-transport.ts`, realtime clients | lag p95 measured lower on the bench; per-aggregate order tests still green (`outbox-aggregate-order.pgtest`, `outbox-lanes.postgres-race`) |
| ~~I-6~~ | **Done (`247172f3`, Oct 27):** **Owner App at 200 in the pilot** (200-tech §62 / §69; remaining §45). Open Team, Performance, Payroll and Reports (week / month / YTD by technician, branch, service, payout method) against the 200-technician salon and compare the numbers to the DB. Record timings in `PERFORMANCE_REPORT.md`. | `lib/pilot-large-salon-m5.mjs` | pilot lines PASS; performance rows added |
| ~~I-7~~ | ~~Cost-allocation matrix~~ — **DONE Oct 27** (`ffc1b9d6`): 110 %, negative, removed branch (named for review, keeps splitting), edit after allocation (bug fixed: re-scales), history (decision: read-time re-split; own splits fixed). | `modules/finance` | — |
| I-8 | **Security internal remainder** (after Oct 27 2026). From `SECURITY_DEEP_SCAN_STATUS.md` → INTERNAL: computed `<style>` blocks in admin-web / customer-web / pos-web moved to CSS so their CSP drops `'unsafe-inline'` for elements (§89); per-route `@ResourceScope` metadata into the manifest (§38); process-wide egress allowlist (§93); mobile transitive SBOM (§14); remove the per-process limiters in deals / salons / techs only with a lockout-equivalent anon limiter (they add a 5-minute lock and are the only limiter on the customer DM routes). Done Oct 27: §40 / S-A14 strict bodies (1,245 / 1,268; 23 reviewed exceptions — Oct 28: `POST /ai/dashboard/settings` strict too, 1,246 / 22, because the server now implements `settings.killSwitch` (SD-23)); the 13 routes that answered 5xx to malformed input (`eca99938`; injection run 3: 22,250 requests, 0 failing) and SD-21 (`df8bf3b0`). Also: strict webhook payload schemas (§110). | see the status report rows | each row moves to DONE with its test |
| ~~I-9~~ | **S-A13 DONE Oct 27 2026** (`d598d8d3`): trusted device for platform sign-in. | `platform-device-trust.pgtest` | — |
| ~~I-10~~ | ~~Secure Tap §51 remainder~~ — **DONE Oct 27** (`278c5bad`): unusual-registration rule + owner / platform payment-phone panels; also §35/§36/§73 software halves proven (`d90c1bfe`). Secure Tap has no internal work left. | `docs/mandates/status/SECURE_TAP_STATUS.md` |
| ~~I-11~~ | **DONE Oct 27 (final pass)** — announcement browser proof 58 / 58 on the final-pass code (1366×768: 209 px; 1280×800: 163 px); §108 / §165 → DONE. | — | — |
| ~~I-12~~ | **Done (`9ded9435`, Oct 27 — Hold and Appointment Soon from the server):** **200-tech §33**: Appointment Soon / Hold as real lane states in the Tech Queue (today the POS filter offers Ready / Serving / Break / Off shift only — nothing invented on screen). | `modules/queue`, `POSTechQueueScreen.tsx` | lane states from the server; filter test |
| ~~I-13~~ | ~~Remaining-production smaller items~~ — **DONE Oct 27**: §31 perceptual hash + §30 OCR through the central AI gateway (`aee55104`), §24 one skill rule (`3fa531bc`; Kevin's Oct 27 decision `ded4729d`: technicians with no services set up are bookable through the category fallback, configured ones strictly exact), §66 technician cross-tenant probe in the pilot (`fdbcaf69`), §59 reconnect test (`93d84d84`). Only §43 (drive the Capacitor Tech App shell in the pilot, nice-to-have) is left. | `docs/mandates/status/REMAINING_PRODUCTION_STATUS.md` | — |
| I-14 | **Dead-code batch 2**: exports, dead client methods and manager-pay i18n keys deferred from batch 1. | `docs/DEAD_CODE_REPORT.md`, `docs/dead-code-plan.json` | gates + typecheck green; report updated |
| I-15 | **Ratchets** (P3-1 / remaining §39) — started Oct 27: exhaustive-deps 81 → 76 (`41d0c3c3`) → 0 (`af5036f6`); `as any` 5,772 → 4,994 (Oct 27) → **3,251 (Oct 28, `c2292a19`; typecheck still to run)**. Next: `checkout.service.ts`, `payment-gateway.resolver.ts`, `payment-reconciliation.service.ts`, payroll / permissions / tenant-context / booking (`node apps/api/scripts/check-as-any.mjs` lists the per-file counts). | `tooling/ci/lint-ratchet.mjs`, `apps/api/scripts/as-any.baseline.json` | baselines lower, gates green |
| I-16 | **M4-1 read-back**: re-run `apps/api/scripts/m4-clock-burst-bench.mjs --pin-hash pin` on the pilot host and record the 100-tap clock-in p95. Expected about 1.7–2.2 s there; sub-second needs more cores. | `PERFORMANCE_REPORT.md` | p95 recorded |
| ~~I-17~~ | **DONE Oct 27** (`b2783117`) — a wrong handoff code answers 401 `HANDOFF_TOKEN_INVALID` (EN / VI text); 10e2 reads `payload_json`; pilot 235 / 235 on a fresh DB. | — | — |
| I-18 | **Busy-state one-screen responsive report 55 / 90** (pilot phase 13, 200 technicians; it was 85 / 90 in the earlier Oct 27 Vietnamese run; primary viewport 18 / 18). Not investigated in the final pass — compare the two reports' failing items by module / viewport and fix or explain. | `tooling/e2e/pos-vi-one-screen.mjs`, `docs/pilot-runs/2026-10-27-final/` | responsive report back at ≥ 85 / 90, or each item explained |
| I-19 | **Harness first-pass failure** — `verify-terminal-capture` 12 / 17 on the first harness pass of the final run; 17 / 17 alone and 9 / 0 / 1 on the lane re-run. Not reproduced, not explained. | `apps/api/scripts/verify-terminal-capture.mjs` | cause found, or 5 clean lane runs in a row |
| ~~I-20~~ | **Closed by the Oct 27 later commits (all gates green at `84e4de76` per the handoff); re-check under V-28.** Was: `ci:gates` red on the branch HEAD (7 FAIL) — work after the final pass. `6a1a76e8` (payments `as any` removal) turned `.catch(() => [] as any[])` into `.catch(() => [])`: `check:silent-catch` (5 payments files over baseline) and `check:tenant-builder` (2 `payment-gateway.resolver.ts` reads) now fail. The uncommitted pay-stub PDF routes fail `check:unreached`, `check:openapi`, `check:api-contract`, `check:list-queries`, `check:attack-surface`. Both pass at the final-pass commit `fe1080e6` (clean worktree). | the owners of that work | `npm run ci:gates` rc 0 |

### Receipt, Expense, Invoice, OCR & Accounting — what is left (Oct 27 2026, after the close-out build)

Built Oct 27 (`9a0a1dd1` → `2eefe1de`, migration 700; status 192 / 18 / 1 / 1 in `docs/mandates/status/RECEIPT_EXPENSE_OCR_STATUS.md`).
Decision recorded: **§181 purchase orders are not built** — the mandate allows but does not require them ("do not create a full
procurement system unless already required"); the inventory module keeps its purchase orders and an approved document can already
post to `inventory_receipt` against one. Internal remainder:

| # | Item | Where | Done when |
|---|---|---|---|
| R-1 | **Filter chips** on the POS and Owner expense lists — category, vendor, payment method (the API already takes `category`, `vendorId`, `paymentMethod`, `minCents` / `maxCents`; §87). | `POSExpensesScreen.tsx`, `ExpensesScreen.tsx` | chips send the filters; a screen test each |
| R-2 | **Expense ÷ revenue KPI** with its methodology label on the Owner report (§94) and a **PDF summary export** (reuse the statement PDF generator), optionally with receipt images (§98). | `modules/finance` `report` / `exportFile`, Owner report screen | the KPI names what it excludes; `format=pdf` answers a file; test |
| R-3 | **Permission keys** (§73): `owner.expenses.read_own`, `bills.*` aliases, an upload-only key for the front desk / technicians — the service-side switches (§74 / §75) already refuse until the owner turns them on. Security agent's lane (`packages/permissions`). | `packages/permissions/src/rbac.ts`, role matrix | the keys exist; the front desk reaches `POST /pos/ai-ocr-receipt/upload` with the switch on and nothing else |
| R-4 | **Parallel version-conflict race** (§201): two `update` calls on one expense row on real Postgres (pattern: `payroll-paycheck.postgres-race`). | `modules/finance` race lane | exactly one wins, the other `EXPENSE_VERSION_CONFLICT` |
| ~~R-5~~ | **BUILT Oct 28, verify under V-28** (`7eae34fe`): `KyselyOcrAuditSink` writes the context's correlationId / requestId, and the jobId inside the extraction job, into `metadata_json` (after the caller's keys). | `ai-ocr-receipt.store-writes.vitest.spec.ts` | real vitest still to run |
| R-6 | ~~Run the pilot's new 10d checks~~ DONE Oct 27 — both PASS on a fresh DB (`docs/pilot-runs/2026-10-27-receipt-ocr/pilot.txt:116-117`); re-run with the next full pilot day (phases 11–14 were skipped in that run). | `apps/api/scripts/live-pilot-day.mjs` | both PASS in the log |

External (Kevin): the evidence bucket + ClamAV + Textract (then §197 / §203 on real photos), a push / SMS / e-mail provider for the
new alerts and summaries, an AI key for the category suggestion — unchanged from the status report's EXTERNAL list.

### Weekly Technician Paycheck — what is left (Oct 27 2026, after the close-out build)

Status: 160 DONE / 1 PARTIAL / 0 NOT DONE / 0 BLOCKED_EXTERNAL (`docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md`). The 13
INTERNAL items were built in `15a79fef`; every new path has a unit / PGlite / real-Postgres race / screen test.

| # | Item | Owner | Where | Done when |
|---|---|---|---|---|
| W-1 | **Run the pilot day with phase 10e2** (preparation report, manager "ready for review" push, `BRANCH_MANAGER` refusal, CANCELED period, the three cash confirmations in 10e). The phase was added and syntax-checked, not executed on the shared host. | internal | `apps/api/scripts/live-pilot-day.mjs` 10e / 10e2 | the four 10e2 checks + the 10e CHECK + CASH check PASS in `docs/pilot-runs/<date>/pilot.log` |
| W-2 | **Kevin reviews the 71 + 19 + 24 Vietnamese strings** of the close-out (POS rows "Paycheck close-out" in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`; Owner / Tech catalogs). | external (Kevin) | `apps/pos-web/src/i18n/ns/people.vi.ts`, `apps/owner-web/src/i18n/catalog.ts`, `apps/tech-web/src/i18n/catalog.ts` | rows OK or corrected |
| W-3 | ~~**17.5 pay-stub PDF**~~ — DONE Oct 27 2026: the approved, locked statement rendered server-side as a PDF (EN / VI, Work Sans OFL), downloaded from the Tech App, the POS statement drawer and the Owner panel; audited, rate-limited, never cached; no worker needed (200 stubs measured). | internal | `modules/workforce/src/payroll/payroll-paystub*.ts`, `svc.payStub` / `myPayStub`, the three `…/pay-stub.pdf` routes | DONE — `payroll-paystub.pgtest` 7 / 7, `payroll-paystub.vitest` 9 / 9, screen tests, pilot 10e PAY STUB step |
| W-4 | **A payout provider / bank clearance feed** (17.5 / 10.4): ACH, direct deposit or ADP / Gusto, and a clearance feed for checks — recorded methods exist; `payroll-provider.port.ts` answers `PAYROLL_PROVIDER_NOT_CONFIGURED` honestly today. | external (Kevin: provider + credentials) | `payroll-provider.port.ts` | a provider is connected in staging and the "other methods" lines settle through it |
| W-5 | **Tech App QR scan on the native shells**: the web Tech App scans with the browser `BarcodeDetector` when present and otherwise takes the typed 8-character code; the Capacitor shells can add a camera plugin. | internal (after the native shells, external devices) | `apps/tech-web/src/screens/TechPayStatementsPanel.tsx` `scanHandoffCode` | a scan on a physical Android phone confirms a payout |

### English + Vietnamese POS — what is left (Oct 27 2026, after the open-items pass)

Status: 116 DONE / 8 PARTIAL / 3 NOT DONE (was 113 / 11 / 3). Details: `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md` → §M and "Remaining gaps".

| # | Item | Owner | Where | Done when |
|---|---|---|---|---|
| V-1 | **Kevin reviews 3,640 Vietnamese strings** (232 changed approved values + 3,408 new; summary table at the top; V-OPEN adds 57). A developer then applies his corrections. | external (Kevin) + internal | `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` → the named files | every row OK or corrected; `check-i18n` + `check-vi-glossary` green |
| ~~V-2~~ | **DONE Oct 27** (`5b75796a`, `a56e4026`): Overview / queue rows fit at 1600 / 1366 / 1280, top-bar switch collapses below 1440, 2560 in the harness; matrix primary 54 / 54, other viewports fit 270 / 270. | — | `tooling/e2e/pos-vi-one-screen.mjs` | — |
| ~~V-3~~ | **DONE Oct 27** (`5b75796a`): 44 × 44 px hit areas without changing the look (`shell/hitSlop.ts`), measured on the 9 modules — 0 short at the primary viewport. Left as report items: 6 light-state controls at 2560 / 1920×1080 / 1280 (report §M). | internal (small) | `POSBookingScreen` grid decorations, Live Ops report links, Tech Queue VI 1280 | `measureHitAreas` 0 short at every viewport |
| ~~V-4~~ | **DONE Oct 27** (`46e7bcd5`): AI prose in the reader's POS language; cache key + stored explanation carry it; label only when it differs. | — | `modules/ai/src/ai/ai-response-language.ts` | — |
| ~~V-5~~ | **Done (Oct 27, V-5 all modules)** — every POS / Owner / Tech server refusal is a registry code: `withCode(…)` on 1,476 throw sites, 681 new codes with EN + VI (`ns/errors`, Owner / Tech generated catalogues), gate `check:error-text` (0 pending; reviewed English-only list in `tooling/ci/error-text.baseline.json`). Left for Kevin: review rows V5M-1…681 in `VI_NEW_STRINGS_FOR_REVIEW.md`. | — | `packages/api-contracts/src/coded-error.ts`, `ns/errors` | — |
| ~~V-6~~ | **Already built** in WP-C2 (`183f1cb2`): the customer edit form's English / Tiếng Việt picker. | — | `POSCustomersScreen` | — |

### Older internal items still open

| # | Item | Done when |
|---|---|---|
| S-A2 | Nest 10 → 11.1.18+ and kysely ≥ 0.28.17 (empties `tooling/security/npm-audit-allowlist.json` before 2027-01-31). | `npm run security:deps` passes with an empty allowlist; suites + pilot green |
| S-A3 | Dev tooling majors: vitest 4+, vite 6.4.4+. | `npm audit` incl. dev: 0 critical / 0 high |
| S-A4 | Settings PATCH routes declare `settings.view`; the edit rule is service-only. Add an any-of permission to `RolePermissionGuard`. | a view-only role gets 403 from the guard (test) |
| S-A5 | Display / kiosk tokens still accepted in the query string (legacy builds). | after the displays update: query forms refused (test) |
| S-A7 | Webhook timestamp tolerance once the processor's signing header is known (blocked on the processor spec). | an old, correctly signed delivery is refused (test) |
| S-A8 | Exact pin of `capacitor-secure-storage-plugin`. | exact pin + update procedure |
| S-A11 | admin-web: cancelling the step-up prompt still shows the original error. | cancel → no error toast (test) |
| S-A16 | Before the first production deploy with migration 698: the trusted-device policy is `enforce` under `NODE_ENV=production`. Existing Super Admin devices were backfilled as approved; a NEW admin device needs the emailed link (SendGrid must be configured) or approval from an approved device. Break-glass: `SUPER_ADMIN_DEVICE_POLICY=report`. | `docs/security/SUPER_ADMIN_NETWORK_POLICY.md` → Trusted device |
| S-A15 | Before the first deploy with the network policy, check the DB allowlist (see `DEVELOPER_HANDOFF.md` pre-deploy checklist). | allowlist holds the operators' addresses, or is empty |
| ~~B-93~~ | **BUILT Oct 28, verify under V-28** (`7eae34fe`): OCR store writes throw; reads still degrade; the audit / posting-attempt history rows are logged best effort. | `ai-ocr-receipt.store-writes.vitest.spec.ts` (real vitest still to run) |
| M5-4 | Reschedules / assigns of an on-screen appointment reload the whole grid (by design: unknown → full reload). | — (watch) |

## 2. External — Kevin (or his developer)

| # | Owner | Item | Done when |
|---|---|---|---|
| P0-1 / S-B1 | **Kevin's developer** | **K-12 security sequence, in this order:** (1) rebuild the machine; (2) rotate every credential; (3) revoke the Firebase key; (4) new Play upload keys; (5) change the DB password and close port 5432; (6) only then push the rewritten history (`docs/COMMIT_MAP_K12_REWRITE.md`). | each step confirmed; gitleaks full-history job passes, then its `continue-on-error` is removed |
| P0-2 | Kevin | Each salon's real CardPointe MID + credentials in Super Admin → Payment Gateways, then a $1 sale / void on UAT (`npm run uat:cardpointe`). Also confirm the `inquireByOrderid` refund listing shape (B-23 / P2-1). | `INTEGRATION_STATUS.md` CardPointe → WORKING; a timeout refund settles automatically on UAT |
| E-TTP | Kevin | Tap to Pay: Apple entitlement; Fiserv CommerceHub SDK + sandbox credentials + webhook secret; **per-location CommerceHub merchant onboarding** (today one `COMMERCEHUB_TTP_MERCHANT_ID` serves every location; the per-location merchant account is recorded on the intent / payment); sandbox access to implement `inquireByOrderId` so `/reconcile`, Verify and the recovery worker reach final states; a Mac + Xcode; three iPhones (native key store, App Attest verifier, Face ID, app-switcher cover, the physical 3-phone pilot). | pilot S8 reconciles on the sandbox; physical pilot run |
| E-OCR / P1-5 / S-B5 | Kevin | Private S3 bucket + IAM (`EVIDENCE_S3_BUCKET`, `MEDIA_STORE=s3`), ClamAV (`CLAMAV_HOST`, `CLAMAV_REQUIRED=1`), AWS Textract. | upload → scanned → extracted → posted on staging; EICAR refused |
| E-MSG | Kevin | Twilio platform account + A2P brand / campaign + number or Messaging Service per salon + Verify; SendGrid key + verified domain; Firebase (new service account) + APNs; AI provider keys. | first live sends on staging |
| S-B2 | Kevin | Edge: Cloudflare (or equal) — WAF, bot / rate rules on `/auth/*`, DDoS. | blocked test request shows the WAF page |
| S-B3 | Kevin | Railway variables (names in `DEVELOPER_HANDOFF.md` → Pre-deploy checklist): `NODE_ENV`, `RATE_LIMIT_STORE` + `REDIS_URL`, `LOGIN_THROTTLE_STORE`, `WEB_CORS_ORIGINS`, `CLOCK_PIN_LOOKUP_KEY`, `PG_WORKER_POOL_MAX`, `SUPER_ADMIN_NETWORK_POLICY` / `SUPER_ADMIN_IP_ALLOWLIST`, `MOBILE_PAY_DEVICE_KEYS`, `TTP_ATTESTATION_POLICY`, `TWILIO_ACCOUNT_SID`, `PAYMENTS_WEBHOOK_RAW_BODY`. | `/health` security posture shows no warning |
| S-B4 | Kevin | DB roles (`apps/api/scripts/db-provision-roles.mjs`), private networking, at-rest encryption. | no `DB_ROLE_POSTURE` error; 5432 unreachable from the internet |
| S-B6 | Kevin | GitHub: branch protection with required checks, code scanning, secret-scanning push protection, dependency graph, `production-image` reviewers. | a PR without green checks cannot merge |
| S-B7 | Kevin | Static hosting serves `apps/*/public/_headers`. | `curl -I` shows the CSP |
| S-B8 / S-B9 | Kevin | Store rebuilds on Capacitor 8.5.3; base-image digest pins. | builds in TestFlight / Play internal; Dockerfile uses digests |
| S-B10 | Kevin | Ownership of the S3 bucket `power-salon-bucket`. | answer recorded |
| S-B12 | Kevin | Penetration test on staging after S-B2 … S-B7; a real production-backup restore into an isolated DB. | report with no open high; restore booted |
| D-* | Kevin | Decisions: S-B11 (admin password-reset matrix), S-A9 (map tile provider), K-05 / K-07 … K-11 / K-13 (`BUG_REGISTER.md`), whether the deleted `update_tech_login.patch` behaviour (Tech App Face-ID auto-prompt + remembered salon code) is wanted. | decision recorded |

Full external list with defaults: `docs/HOSTING_ACTIONS_FOR_KEVIN.md`, `BUG_REGISTER.md` → "Open — needs Kevin".

## 3. Delivered (kept for the record — do not redo)

| # | Delivered | Evidence |
|---|---|---|
| ~~M4-1~~ | **DONE Oct 26** — Kevin chose "lower the hash cost": the Clock PIN has its own scrypt cost (N=2048, about 4 ms vs 34 ms); old hashes verify and are re-hashed on the next clock-in; lockouts / per-kiosk window / keyed digest unchanged. Only the pilot-host read-back remains (I-16). | `clock-pin-hash.ts`, `clock-pin-hash.vitest`, `PERFORMANCE_REPORT.md` "M4 follow-ups" |
| ~~M5-2 / S-A12~~ | Queue state DONE (1.75 → about 0.26 s); clock-in burst addressed by M4-1 (I-16 read-back). | `PERFORMANCE_REPORT.md` |
| ~~M5-1~~ | Lanes + concurrent consumers (Oct 24); lane review fixes and **per-aggregate order across failures / ticks / instances** (Oct 26, `146a3f55`, `044a1878`). The < 2 s target on production hardware continues as I-5. | `EVENT_ARCHITECTURE_REPORT.md` §7d |
| ~~M5-3~~ | Four stale API inventories after M6 (Oct 24, `246df92c`). | `npm run ci:test:api` |
| ~~M5-5~~ | 200-tech internal gaps built Oct 26 (`02906764` … `d90be7df`). Print Schedule backed out (`b72d7d9c`) — **Kevin re-confirmed the no-print rule Oct 26**, §6 / §54 closed as decided-against. | `200_TECHNICIAN_STATUS.md` |
| ~~Tech-queue accept label~~ | **Decided Oct 26 (Kevin)**: an accepted offer stays `ready_to_start` whatever `technicianMustAcceptTicket` says. | `tech-queue.service.ts`, `tech-queue-accept-status.vitest.spec.ts` |
| ~~P1-1 … P1-3 (B-79 … B-81)~~ | Payment recovery (Oct 23, `ab1ccc58`). | `CHANGELOG_HANDOFF.md` |
| ~~P1-4 (B-82)~~ | Exact-service eligibility everywhere (Oct 23, M2). | — |
| ~~P2-2, P2-3~~ | Default-sender From; salon-wide cost shares (Oct 23, M3, migration 681). | — |
| ~~P3-2~~ | Tech App sign-in at phone size is in the pilot (M5: `pilot-large-salon-m5.mjs`, 390×844, five accounts). | `docs/pilot-runs/2026-10-24-m4/pilot.log` |
| ~~P3-3~~ | Customer Display 3-second clear asserted in the pilot (3,006 ms). | pilot phase 4 |
| ~~S-A6, S-A10~~ | Own-key sort lookups; attack-surface rate column from the decorators (Oct 26, `2881125c`). | `SECURITY_FIX_REGISTER.md` SD-* |
| ~~Security §136/§29, §59, §28/§43/§44, §75/§187, §153, §84, §87~~ | Super Admin network policy (migration 692), step-up gaps, per-IP anonymous limiter, cross-branch suite, security signals, sort own-keys, HTML escaping gate (Oct 26, `2881125c`, `d571dbab`). | `SECURITY_DEEP_SCAN_STATUS.md` |
| ~~Secure Tap §5 (server), §10, §12, §15, §51 (counters), §53, §64, §67, §68, §75, §77 (HTTP)~~ | Oct 26: `0c18a930`, `f8e3c0d3`, `33807ecf`, `b52e05d4`, `97d68d74`; pilot S10–S14 133/133. | `SECURE_TAP_STATUS.md`, `docs/pilot-runs/2026-10-26-secure-tap/` |
| ~~Malware scan~~ | Oct 26 (`eb691b77`): no malware in tree, history or dependencies; bidi escapes + hidden-code rule 5; lockfile integrity. | `docs/security/MALWARE_SCAN_REPORT.md` |
| ~~Dead-code batch 1~~ | Oct 26 (`246be7a7`): 69 files / 27,195 LOC. | `docs/DEAD_CODE_REPORT.md` |
| ~~S-A1~~ | Not a gap (`check:tenant-builder` already gates per statement). | — |

## How to start (first hour)

1. `START-HERE.md` (install, database, seed, run). Commands: `DEVELOPER_HANDOFF.md` → "How to run".
2. Read `DEVELOPER_HANDOFF.md` (top) → `CONTINUE_HERE.md` → this file → `docs/mandates/status/*.md`.
3. Take the first item not marked DONE. The rules are in `ENGINEERING_RULES.md`: integer cents, server-derived tenant, no fake success, a test with every change, no second system next to an existing one, and no print features.
