# AI POWERSALON — DEVELOPER HANDOFF

**Audience:** the developer taking over this codebase. Read this section top to bottom, then the files it names.

## Oct 28 2026 — FINAL: pilot scan done, code packaged — read `DEVELOPER_HANDOFF_FINAL_2026-10-28.md` first

The whole repository was scanned for unwired modules, dead screens, unhandled buttons, undocumented variables and
unreached unit specs (`docs/pilot-runs/2026-10-28/PILOT_SCAN_REPORT.md`): everything wired, 12 dead links and 2 real
defects fixed (stale CSP hashes for the booking page + kiosk; an unreviewed push). The code is packaged for upload
(tarball + git bundle + checksums). `DEVELOPER_HANDOFF_FINAL_2026-10-28.md` orders the remaining work — the K-12 security
sequence, hosting, Fiserv CardPointe merchant accounts + UAT, Tap to Pay, Twilio / Verify / A2P 10DLC — with variable
names only. **Nothing pushed.**

## Oct 28 2026 — Check-In + Live Operations 27-Inch One-Screen (CheckIn.pdf · AI_PowerSalon_27in_Live_Operations_One_Screen_Touchscreen_Optimization_Mandate.pdf)

Full reports: `docs/mandates/status/CHECK_IN_ONE_SCREEN_STATUS.md`, `docs/mandates/status/LIVE_OPERATIONS_ONE_SCREEN_STATUS.md`.

**Architecture.**
- One one-screen kit for Overview, Check-In and Live Operations: `apps/pos-web/src/components/OneScreenKit.tsx` (`Card`, `Empty`, `More`, `useFitRows`) + the `:is(.overview-page,.check-in-page,.live-ops-page)` block in `styles.css`; each page sets its own row budget / column split after it.
- Check-In (`POSCheckInScreen.tsx`): KPI 74 · queue | Quick Check-In | insights · arriving | lounge | technicians · 4 analytics (136) · 9 Quick Actions (60). Live Operations (`POSDashboardScreen.tsx`): KPI 80 · snapshot | activity | AI · trend | technicians · 4 analytics (150) · 9 Quick Actions.
- Check-In server rules: `modules/queue/src/check-in/check-in-floor.ts` (arriving window, trend, on-duty staff, insights, KPI definitions) used by `mapToCheckInState`; Available Technicians = `KyselyQueueRepository.techSignals` → `projectOnDutyStaff` (extracted from `queue-floor.ts`, shared with the Customer Queue).

**Main bugs fixed.**
- Check-In: Quick Actions New Check-In / Walk-In navigated to the page itself (dead); the New Customer email was collected and dropped; "Techs Available" = no queue entry; hard-coded 0 % trend and 0 no-shows; two labels (2 h / 3 h) over the whole day's appointments; customer search and every walk-in read the tenant's WHOLE customer directory (+ all paid tickets); appointment labels N+1; one idempotency key per click.
- Live Operations: on duty from the legacy log; walk-ins = appointments with source manual / phone; "next 3 hours" on the database's UTC clock; Multi-Location showed every branch to anyone (now `authz.branchIds`, part of the cache key); Start Service / Assign Tech / Add Product routes; full-page error.
- Kit: `useFitRows` 1 ↔ 2-row loop (React #185) fixed.

**To do.** jsdom tests (`POSCheckInScreen*.test.tsx`, `QuickCheckInPanel.test.tsx`, `POSDashboardScreen.test.tsx` — updated), pos-web `tsc` / lint, check-in pgtests, Edge / branded Chrome, the physical touchscreen, a two-station realtime pilot. Nothing pushed (K-12).

## Oct 28 2026 — Overview 27-Inch One-Screen + Module Wiring (AI_PowerSalon_Overview_27in_One_Screen_Module_Wiring_UX_Completion_Mandate.pdf)

Full report: `docs/mandates/status/OVERVIEW_ONE_SCREEN_STATUS.md`.

**Architecture (final).**
- Screen `apps/pos-web/src/screens/POSOverviewScreen.tsx` (route `/overview`) renders two server answers and derives nothing: `GET /pos/overview/state` (KPIs, appointments, analytics, insights) and `GET /pos/overview/board` (arrivals, live tech queue, flow sublists, communications, retention, inventory).
- Server rules live in `modules/analytics/src/overview/overview-floor.ts` (top-row counts, waiting statuses, `fillRevenueTrend`, `liveMinutesLeft`, `inventoryAlertStatus`, `buildOverviewInsights`, `OVERVIEW_KPI_DEFINITIONS`), used by `overview.kysely.repository.ts` and `overview-board.service.ts`.
- Every board list is top-N + `count(*) OVER ()`; the card shows the rows that fit (`useFitRows`) + "+N more" from the server total + View All.
- Layout: `.work.ov.overview-page` = `calc(100dvh - var(--pos-header-height))`, `overflow: hidden`; grid rows `74 px · 1.1fr · 1fr · 152 px · 60 px`, gaps 7 px; TIGHT / COMFORTABLE / FALLBACK density media queries. No scale / zoom.

**Main bugs fixed.**
- Staff On Duty counted employed technicians from the legacy status log; now `technician_workforce_state` (clocked in / on break / on shift).
- Waiting Guests counted `waiting` only (now waiting / called / assigned / ready_for_tech); Active Services / Ready for Checkout counted removed or closed tickets.
- The screen invented arrivals, the tech queue and the sublists from appointment rows; Completed counted appointments (now tickets paid today).
- Insights were an always-on trio; now advisory, only when there is something to say, ≤ 5, each with an Open route.
- Reminders were every branch, any day; Messages showed without `communications.view`; minutes left used a universal default; the trend skipped zero days; inventory ignored the branch overrides.
- `check:sql:select` treated every BIGSERIAL column as missing (checker fixed + sanity case).

**Kept as is (documented).** The 60 px shell header (shared by every POS page) and the 248 px sidebar (the real group labels truncate below it).

**To do.** Run the jsdom tests (`POSOverviewScreen*.test.tsx`, updated), pos-web `tsc` / lint with real dependencies, Edge / branded Chrome and the physical touchscreen. Nothing pushed (K-12).

## Oct 28 2026 — Customer Queue One-Screen + Guest Flow & Assignment (AI_PowerSalon_Customer_Queue_Claude.pdf)

Full report: `docs/mandates/status/CUSTOMER_QUEUE_ONE_SCREEN_STATUS.md`.

**Main bugs fixed.**
- Start Service / Send to Tech Queue kept their "already moved" keys in in-process Maps, so after a restart (or on a second API replica) a repeat tap said "Cannot start service". They now use the persisted columns, and a guest already moved answers `duplicate: true`, including the concurrent loser.
- The controller dropped every `withCode()` code, so refusals came back as a bare 400. They now carry the registry code and status.
- The board stages and the priority order were invented in the browser (VIP above Urgent). They now come from one server projection (`queue-floor.ts`, both adapters): canonical statuses with whole-queue counts, the existing `rankQueue` policy, and technicians from their real signals (8 rows + summary).
- A priority raise now needs a reason (`PRIORITY_REASON_REQUIRED`).
- Send Wait Alert now reaches the Customer App (the push path Call Next uses).
- KPIs with nothing to measure are `null`.
- Revenue uses the approved override.
- The queue trend uses the branch's hour.

**Screen.**
- It fits 1920×1080 with 0 page scroll in every state (was 436 px normal / 1,042 px long names).
- Manage is an overlay: rows never expand.
- Every Quick Action and profile button does real work.
- New Walk-In pointed at a route that does not exist (`/checkin`); it now opens `/booking/walk-in`.
- Add to Queue = the canonical walk-in check-in.

**Also fixed in Serving and Service Done (shipped earlier today).** The overlay box was declared inside the screen and remounted on every keystroke, so a text field kept one letter. Each one is now a module-level component, and the E2E scripts type key by key.

**To do.** Run the jsdom tests, the pgtests and `tsc` with real dependencies, then the live two-station pilot. Nothing pushed (K-12).

## Oct 28 2026 — Serving One-Screen + Live Service Floor (AI_PowerSalon_Serving_Claude.pdf)

Full report: `docs/mandates/status/SERVING_ONE_SCREEN_STATUS.md`.

**Main bugs fixed.** Start Service had no guard in Postgres: two stations both started, the second overwrote the start time and wrote a second `service.started`; the transaction's error was swallowed. It is now a compare-and-set on `serving_started_at IS NULL` (verified with two PostgreSQL 16 sessions), and Start / Mark Ready / Send answer `duplicate: true` on a repeat. Add-on and retail inserts no longer swallow errors; a `clientRequestId` makes the same add-on from two terminals one line. A mid-service reassignment no longer moves the worked minutes to the new technician.

**Screen.** It fits 1920×1080 with 0 page scroll in every state (was 505 px normal / 607 px busy). Every Quick Action is wired: Start Service, Move Stage (legal next states from the server), Add Upsell (catalog add-on service or retail), Send Update (customer-app feed; SMS honest), Mark Ready, Open Customer (context kept), View Reports; Auto Balance recommends and a person assigns; Send Staff Alert writes `technician_notifications`.

**To do.** Run the pgtests and the jsdom tests, then the live two-station pilot. Nothing pushed (K-12).


## Oct 28 2026 — Service Done One-Screen + Completion Handoff (ServiceDone.pdf)

Full report: `docs/mandates/status/SERVICE_DONE_ONE_SCREEN_STATUS.md`.

**Main bug fixed.** The Postgres Service Done repository kept the whole workflow in the API process's memory: quality, checklist, notes, helper, checkout status and the send key. It is now in the ticket columns (migration 025, plus **707** `service_done_checklist`), guarded by two new state machines.

**Handoff.** Move to Checkout is one compare-and-set UPDATE, verified on PostgreSQL 16 with two sessions: one handoff; a retry or a second station gets idempotent success.

**Screen.** It fits 1920×1080 with 0 page scroll; before it was 404 px (normal) up to 2,826 px (busy). Every Quick Action is wired. The dead `/tenant/reports` links (a path with no route) are fixed in four screens.

**To do.** Run migration 707 and the pgtests, then pilot. Nothing pushed.

## Oct 28 2026 — Checkout One-Screen + Payment Safety (checkout.pdf)

Full report: `docs/mandates/status/CHECKOUT_ONE_SCREEN_STATUS.md`. The Checkout board fits 1920×1080 (page 1920×945) with **0 page
scroll in every state**: before it was 344 px (normal) up to 5,888 px (busy). It also fits 1600×900, 2560×1440 and 1366×768.

Two money fixes:
- the paid read fails **closed** (it used to answer 0 on an error, so the full amount could be charged again);
- the bill is **locked** while a tender is unsettled, a payment holds the lock, or money was taken (`TOTALS_LOCKED_AFTER_CAPTURE`).

KPI, attention and receipt-rate definitions are now server-side, in `checkout-board-signals.ts`.

New harness: `tooling/checkout-one-screen/`, with `build.mjs`, then `measure.mjs` and `interact.mjs`. Decision open for Kevin:
**Split Ticket** (the button now says Split Payment). No migrations. Nothing pushed.

## State at Oct 28 2026 — Full System Test (read this first)

**Verdicts** (`PRODUCTION_READINESS.md`): **CODE_READY_FOR_DEVELOPER_HANDOFF = YES** · **PRODUCTION_READY = NO**
(P0-1 K-12 open, P0-2 no real MID UAT, P0-3 the 103 commits since Oct 27 are not yet compiled / suite-tested / piloted).

| Field | Value |
|---|---|
| Commit | branch `merge-github-main`; code `07e599ea`, docs / tooling on top. **Nothing pushed** (K-12 first). |
| App versions | API 1.0.0 · POS 0.1.0 · Super Admin 0.1.0 · Owner / Tech / Customer 1.6.0 · Tap to Pay 1.0.0 · Customer Display 0.1.0 · kiosk 0.1.0 |
| DB migration head | `706` (646 files) — applied from zero on real PostgreSQL 16 today |
| Environment | sandbox, 2 vCPU, Node 22.23.4, PostgreSQL 16.15; **no npm registry → no `node_modules`**; TypeScript 6.0.2 from the offline cache (repo pins 5.4.5) |
| Services started | PostgreSQL only — the API, workers, realtime and the web apps cannot start without their packages |
| Reviewed | 27 modules, 10 apps, 21 packages, 3,123 routes, 646 migrations, 773 tables (`MODULE_INVENTORY.md`) |
| Executed today | 72 / 78 gates PASS (6 BLOCKED_DEPENDENCY); 646 / 646 migrations; DB races / triggers / RLS 22 / 22 (+ negative control 8 FAIL as designed); backup + PITR drill PASS; 6,912 / 6,912 sources parse; whole-backend shimmed type-check 0 repo-internal errors; unit sweep via a stand-in harness: 1,013 / 2,180 `.ts` spec files, 681 PASS, 6,966 tests passed, the rest environment (`TEST_RESULTS.md` §4) |
| Fixed today | owner PIN from the CSPRNG + `error-text` baseline (`2ca43279`); four spec files with a duplicate import (`42f77325`); WebAuthn `verified` must be exactly `true` (`07e599ea`) |
| Open P0 / P1 / P2 / P3 | 3 / 4 / 6 / 3 (`SYSTEM_STATUS.md` §3) |

**One-page action summary (in order):**
1. **Developer — V-28 first:** `npm ci` → `npm run typecheck` → `npm run ci:gates` → `npm run ci:test:packages`,
   `ci:test:modules`, `ci:test:apps`, `ci:test:api` → race lane → `live-pilot-day.mjs` on a fresh DB through 706. Exact commands
   and pass conditions: `TEST_RESULTS.md` §7. A removed `as any` (`c2292a19`) can be a compile error — type what typecheck names.
2. **Kevin's developer — K-12**, in order (`SECURITY_REMAINING_ACTIONS.md` A), then the push.
3. **Kevin — P0-2:** one salon's MID in Super Admin → `cd apps/api && npm run uat:cardpointe`.
4. **Hosting:** `DB_TENANT_RLS=1` + `DB_TENANT_RLS_STRICT=1`, DB roles, private 5432, WAF, `_headers`; a production restore + PITR
   drill (`tooling/full-system-test/backup-drill.sh` shows the checks).
5. Provider accounts as they arrive (`EXTERNAL_SETUP_CHECKLIST.md`), then the penetration test.

**How to resume this work in an environment like this one** (no registry): `tooling/full-system-test/` has the psql migration
runner, the DB race / trigger / RLS suite, the backup drill, `run-all-gates.sh` and `pg-standin/` (runs the PGlite-based DB
gates against a real server). Logs of today's run: `docs/full-system-test/2026-10-28/` (task log `DEV_HANDOFF_LOG.md` there).

## State at Oct 27 2026 — final pass

**Code:** branch `merge-github-main`; the final-pass code is `3c5ae402` / `b01f8d71`, records on top of it. Migrations through
**702** (642 files). **Nothing is pushed** — K-12 first. Run everything with `TZ=UTC`.

**Proven on that code** (`TEST_REPORT.md` "Oct 27 2026 — final pass", evidence `docs/pilot-runs/2026-10-27-final/`):
19,281 unit / PGlite tests passed, 0 failed (packages 1,247 · modules 11,027 · apps 3,897 · API 3,110); race lane 336; harnesses
9 / 0 / 1; route sweep 15 / 15; event wiring 19 / 19; display lifecycle 30 / 30; 24 / 24 live proofs (606 checks); announcement
browser proof 58 / 58; Vietnamese one-screen 18 / 18 primary (empty / light / busy); **pilot day 235 / 235** on a fresh DB with
every phase; restore drill 12 / 12; §163 injection run 3 0 failing; `ci:gates` 54 + 21 green at `3c5ae402`.

**Before you start:** `ci:gates` on the branch HEAD is **red (7 FAIL)** from work by other agents after the final pass
(`6a1a76e8` payments types; uncommitted pay-stub PDF routes) — `NEXT_STEPS.md` I-20. Check `git status`: that work may still be
in the tree.

**Fixed in the final pass:** OCR bodies strict (`7f86355f`); SD-21 attempt-by-key scoped to the location (`df8bf3b0`); 13 routes
that answered 5xx to malformed input (`eca99938`); QR handoff code 401 `HANDOFF_TOKEN_INVALID` (`b2783117`); `check:unreached`
Owner App suggested-expense link, lint / silent catches (`73acd523`); V-5 coded refusals (`2fa57469`); Kevin's §24 decision —
technicians with **no services set up** are bookable through the category fallback, configured technicians stay exact-skill,
one function (`serviceSkillVerdict`), refusals carry `details.basis` (`ded4729d`); API-lane drift (`3f299d0a`). Bug rows
B-94 … B-105 in `BUG_REGISTER.md`.

**Open (internal):** V-5 remainder (264 free-text refusals in checkout / booking / queue / deals), I-18 busy one-screen
responsive 55 / 90, I-19 harness flake, B-93 OCR store swallows writes, I-20 gates on HEAD, plus the rest of `NEXT_STEPS.md`.

**Mandate counts (DONE / PARTIAL / NOT DONE / BLOCKED_EXTERNAL):** Secure Tap 67 / 10 / 0 / 1 · 200-Tech 102 / 3 / 0 / 0 ·
Remaining Production 52 / 1 / 0 / 20 · Security 155 / 20 / 0 / 17 · Announcement 168 / 0 / 0 / 0 · Vietnamese POS 116 / 8 / 3 / 0
· Platform Architecture Audit 218 / 41 / 0 / 3 · Weekly Paycheck 160 / 1 / 0 / 0 · Receipt / OCR 192 / 18 / 1 / 1 · Full System
Run: SKIPPED by Kevin's decision Oct 27 (`docs/MANDATE_COMPLETION_MATRIX.md`).

## State at Oct 26 2026 (kept as written)

**Tree:** branch `merge-github-main`, HEAD `47c4044b` (+ this documentation commit). History is single-parent (the
rejected developer upload is not an ancestor). **Nothing is pushed** — the K-12 security sequence comes first and is now
owned by Kevin's developer (see "Pre-deploy checklist"). Node 22, npm 10, PostgreSQL 16; run everything with `TZ=UTC`
(CI does). A dead-code removal pass (batch 2) may be in progress in the working tree — check `git status` before you
start and `docs/DEAD_CODE_REPORT.md` for what was removed.

Read in this order:

| File | What it gives you |
|---|---|
| `CONTINUE_HERE.md` | where the work stopped and the next concrete steps |
| `docs/MANDATE_COMPLETION_MATRIX.md` + `docs/mandates/status/*.md` | Kevin's five open mandates, section by section (DONE / PARTIAL / NOT DONE / BLOCKED_EXTERNAL), each ending with an INTERNAL and an EXTERNAL list |
| `NEXT_STEPS.md` | the ordered work queue: internal items first, then Kevin's external items |
| `PROJECT_STATUS.md` (top) | status per area + the mandate counts |
| `SECURITY_REVIEW.md` (top) | the Oct 26 security build, the malware scan, open security items |
| `INTEGRATION_STATUS.md`, `DATABASE_STATUS.md` | providers; migrations 679–692 |
| `PERFORMANCE_REPORT.md`, `EVENT_ARCHITECTURE_REPORT.md` (§7d) | 200-technician numbers, M4 follow-ups, outbox ordering |
| `docs/PILOT_DAY_REPORT.md` (top), `docs/pilot-runs/2026-10-2*/` | executed pilot evidence |
| `docs/security/SECURE_TAP_TO_PAY_ENGINEERING_REPORT.md` | Tap to Pay device authentication design + build matrix |
| `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md` | **English + Vietnamese POS**: locale architecture, Super Admin English-only rule, how to add a string / namespace / language, gates, the A–L matrices, remaining gaps |
| `TEST_REPORT.md` | every lane with commands and counts; the newest is "Oct 27 2026 — final pass" at the end |

### Mandate counts (after the Oct 26 build)

| Mandate | Sections | DONE | PARTIAL | NOT DONE | BLOCKED_EXTERNAL |
|---|---|---|---|---|---|
| Secure Tap to Pay device authentication (Oct 27) | 78 | 67 | 10 | 0 | 1 |
| 200-Technician large salon | 105 | 94 | 11 | 0 | 0 |
| Remaining production work | 73 (+23 acceptance rows) | 36 | 18 | 0 | 19 |
| Security deep scan / zero trust | 192 | 140 | 34 | 1 | 17 |
| Platform announcement (POS top bar) (Oct 27) | 168 | 166 | 2 (§108 header room at 1366 / 1280, §165) | 0 | 0 |
| English + Vietnamese POS (Oct 27, final) | 127 | 113 | 11 | 3 (§50/§52/§53 — not built by Kevin's ruling) | 0 |

All 10 Secure Tap PARTIAL rows wait only on a device / CommerceHub (Oct 27: §51 closed, `278c5bad`; §35/§36/§73 software halves proven, `d90c1bfe`). 200-tech §6 / §54 (Print Schedule) count as DONE
because Kevin decided against them. Remaining-production was not built on Oct 26; its INTERNAL list is unchanged.

### Done

| Milestone | Commits | What |
|---|---|---|
| **M6 Secure Tap to Pay** (Oct 23–24) | `cdcfe20d` … `e43c8b43` | The server decides payments; the phone's answer is never treated as money. `/reconcile` asks the provider, there is one stable idempotency key per logical payment, and `IDEMPOTENCY_KEY_REUSED` is enforced. Claims belong to the signed-in session. Each device has a P-256 identity (migration 687), and `DeviceProofGuard` signs every request with a single-use nonce. Pairing uses a single-use 5-minute POS QR code, and devices are authorized per branch. Shared salon phones are supported (688). Step-up is required on every trust decision. Revoke is final. Refresh families with reuse detection are in 689, and the checkout claim version / `CHECKOUT_STALE` is in 690. `@Idempotent` is on the money routes. Each device has its own realtime room. The phone reads the unsettled-tender view. The owner has a device activity dashboard. |
| **M5 200-technician pilot** (Oct 24) | `32049600` … `246df92c` | The pilot ran 177/177. The board no longer reloads for off-screen changes. A transferred technician's week moves with her. The owner can open a new location. The outbox drains a backlog. Payroll week review gained exceptions-only, search and branch filters. |
| **M4 200-technician scale** (Oct 23–24) | `35ab6135` … `ef7eb6bf` | The board is server-paged (17 × 12). Six lookup indexes were added and measured (691). The rate limit is sized for 200 technicians. The change feed pages instead of resyncing. Queue state dropped from 1.75 s to about 0.26 s. Outbox lanes and concurrent consumers were added. Pilot 177/177. |
| **M4 follow-ups + M4-1** (Oct 26) | `146a3f55` | Three outbox-lane review risks were fixed: the recipe stock lock order, deterministic loyalty netting, and a worker-pool consumer budget. **M4-1 (Kevin chose "lower the hash cost"):** the Clock PIN now has its own scrypt cost, N=2048 (about 4 ms instead of 34 ms). Old hashes still verify and are re-hashed on the next clock-in. API CPU per 100-tap burst fell about 3×. |
| **Outbox order fix** (Oct 26) | `044a1878` | Per-aggregate order now holds across failures, ticks and instances. The claim is serialized under an advisory lock and uses `FOR UPDATE OF o SKIP LOCKED` with a `pending` re-check and a head-of-line rule. Before this, two instances could double-claim rows. |
| **Security deep scan, internal gaps** (Oct 26) | `2881125c`, `d571dbab` | The Super Admin network policy is enforced (IP blocks + allowlist, migration 692). Step-up was added on the salon role / access mutations. `@AnonRateLimit` applies a per-IP limit to every public route that had none. A cross-branch isolation suite was added. Security signals now cover platform-admin changes, merchant config, unknown retries and upload malware. Strict bodies are on for auth / merchant-config / platform-security. Webhook envelope schemas were added. Sorts use own-key lookups. An HTML escaping gate was added. |
| **Secure Tap internal gaps** (Oct 26) | `0c18a930`, `f8e3c0d3`, `33807ecf`, `b52e05d4`, `97d68d74`, `a78f2f60` | The missing cross-surface unsettled-tender spec was written. Devices can be renamed. Three biometric failures force a full sign-in. Return to Staff requires the password when Face ID is unavailable. The store switch checks the target location's merchant first. Device counters and security events were added. A server attestation intake (`TTP_ATTESTATION_POLICY`) was added. Pilot phase 12 S10–S14: 133/133. |
| **200-technician internal gaps** (Oct 26) | `02906764` … `d90be7df`, `b72d7d9c` | The board's technician selects use a server-paged picker. Tech Queue gained search, a status filter and paging. The Team page filters by role and branch on the server. New payroll exceptions: `UNALLOCATED_TIP` and `MISSING_COMMISSION_RULE`. The Owner paycheck screen filters by branch. Owner Staff Performance is paged. The board has First / Last buttons and next-page prefetch. Race tests cover the same customer and shared resources. The pilot gained lunch / break / time-off blocks. Print Schedule was built and then backed out under the no-print rule. |
| **Malware / supply-chain scan** (Oct 26) | `eb691b77` | No malware was found in the tree, the history or the dependencies (`docs/security/MALWARE_SCAN_REPORT.md`). Raw bidi characters are now `\u` escapes, and hidden-code gate rule 5 was added. 24 dev lockfile entries now carry integrity. |
| **Dead-code batch 1** (Oct 26) | `246be7a7`, `47c4044b` | 69 files (27,195 LOC) removed. Two broken AI scripts were repointed. Two runner-less specs were ported. Two `\|\| true` sites were pinned by tests. See `docs/DEAD_CODE_REPORT.md`. |
| **English + Vietnamese POS** (Oct 26–27) | `41f5db11` … (WP-J docs commit) | Users switch English / Tiếng Việt instantly, with no reload and no lost state. The language is the user's choice, then the salon default (one authority, migration 695), then English. Super Admin stays English (gated). There are 13 semantic namespaces (12,133 POS keys, VI complete); status / error / server-text codes are worded at render. Search ignores accents (694 + `foldVi`), and search boxes are IME-safe. Announcements (696) and customer messages are available in both languages. The 9 primary modules fit one 1920×1080 screen in both languages and three states (54 / 54) with Hanken Grotesk. Pilot phase 13: **224 / 224** (fresh DB, all phases). Read `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md`. 3,465 strings wait for Kevin's review in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`. |
| **Kevin's Oct 26 decisions** | `0d1f1db8` | The no-print rule stays (`PRINT_FEATURES_REMOVED.md`, `check:no-print`). An accepted tech-queue offer stays `ready_to_start` (`modules/queue/src/tech-queue/tech-queue.service.ts`, pinned by `tech-queue-accept-status.vitest.spec.ts`). |

### Open — internal (a developer can do it here)

This list is in priority order. The full list is in `NEXT_STEPS.md`.

1. Run the full regression on HEAD and log it in `TEST_REPORT.md`. That means `tooling/ci/final-run.sh`, `tooling/ci/live-proofs.sh` and the whole pilot including the new phase-11 blocks.
2. Add the recovery flows to the pilot day (remaining-production §68). These are: a lost top-up answer, a Skip-the-Line intent, a lost split-card answer and a refund timeout.
3. Wallet webhook leg (§15/§16/§58). Add the split-tender race the mandate names (§60/§22). Finish the cost-allocation matrix (§65).
4. 200-tech:
   - Add an Owner App Team / Performance / Reports pilot step at 200 (§62/§69).
   - Run a realtime-first outbox lane, then re-measure (§90/§1).
   - Appointment Soon / Hold in the Tech Queue (§33).
5. Security:
   - Quarantine unscanned images (§104/§106).
   - Turn on strict bodies schema by schema (§40, S-A14).
   - Lockfile hygiene gate (§13).
   - Outbound-host gate and egress allowlist (§12/§93).
   - Drop `style-src 'unsafe-inline'` (§89).
   - Log-capture scan (§128).
   - Pre-commit hook (§144).
   - Local injection pass (§163).
   - Lower-environment data policy (§157).
   - Trusted device for platform sign-in (S-A13).
6. ~~Secure Tap §51~~ — DONE Oct 27 (`278c5bad`): unusual-registration rule + owner / platform payment-phone panels.
7. Platform announcement: everything internal DONE Oct 27 (`4dd41f0e`, `d6631f8e`) except §108 — the header language switch left the message < 200 px of text at 1366 and < 150 px at 1280 (browser proof 56 / 58); a POS header layout fix.
8. Realtime clients do not read `resourceVersion` yet. The M4 lane commit claimed they drop stale frames, and they do not.
9. Dead-code batch 2 (exports, dead client methods, manager-pay i18n keys) — `docs/DEAD_CODE_REPORT.md`.
10. Ratchets: lint warnings and `as any` may only shrink.

### Open — external (Kevin / his developer)

- **K-12 security sequence, owned by Kevin's developer.** Do these in order:
  1. Rebuild the machine.
  2. Rotate every credential.
  3. Revoke the Firebase key.
  4. Create new Play upload keys.
  5. Change the DB password and close port 5432.
  6. Only then push the rewritten history (`docs/COMMIT_MAP_K12_REWRITE.md`).
- **Tap to Pay:**
  - Apple entitlement.
  - The Fiserv CommerceHub SDK, credentials and webhook secret.
  - Per-location CommerceHub merchant onboarding. Today one `COMMERCEHUB_TTP_MERCHANT_ID` serves every location.
  - Sandbox access to implement `inquireByOrderId`.
  - A Mac and three iPhones.
- **CardPointe:** a real MID per salon, plus UAT credentials for `npm run uat:cardpointe`. B-23 (the refund inquiry shape) needs to be confirmed against UAT.
- **Providers:**
  - Twilio: platform account, A2P brand/campaign, Verify.
  - SendGrid.
  - Firebase (a new service account) and APNs.
  - AI provider keys.
  - S3 bucket + IAM, ClamAV, Textract.
- **Hosting:**
  - TLS, WAF/edge.
  - Private DB with the `aps_api` / `aps_worker` roles.
  - Railway variables (below).
  - KMS or an accepted alternative.
  - Encrypted backups and a real restore.
  - GitHub branch protection and scanning.
  - Base-image digest pins.
  - A penetration test on staging.
- **Decisions still open:** S-B11 (the admin password-reset matrix), S-A9 (map tile provider), K-05 / K-07 … K-11 / K-13 (`BUG_REGISTER.md`). Also: does Kevin want the Tech App Face-ID auto-prompt that `update_tech_login.patch` carried? The patch was deleted and is kept in git history.

### How to run

1. Install, set up the database, seed and run: `START-HERE.md` / `LOCAL_DEVELOPMENT.md`.
2. Build: `npm run build:packages && npm run build:modules && npm run build:api && npm run build:frontends`.
3. Static checks:
   - `npm run typecheck`
   - `node tooling/ci/lint-ratchet.mjs`
   - `npm run ci:gates` — all **54 gates + 17 audits** must pass.
   - `npm run security:deps`
   - `node apps/api/scripts/check-critical-step-up.mjs`
4. Suites: `npm run ci:test:packages`, `ci:test:modules`, `ci:test:apps`, `ci:test:api` (with `TZ=UTC`).
5. Race lane on real PostgreSQL: `PG_RACE_URL=postgres://…/<migrated scratch db> npm run ci:test:race`. If the lane is full of SKIPPED, PostgreSQL is down; start it with `pg_ctlcluster 16 main start`.
6. Pilot day (with `apps/api` built): `DATABASE_URL=postgres://…/<fresh scratch db> PORT_PROOF=3201 node apps/api/scripts/live-pilot-day.mjs`.
   - `PILOT_SKIP=11` skips the 200-technician phase, which is the quick re-run of phase 12 (Tap to Pay).
   - `PILOT_SKIP=11m5` skips only its M5 continuation.
   - `PILOT_SKIP=11blocks` skips only the blocked-time dataset.
   - Evidence goes under `docs/pilot-runs/<date>-<name>/` (`pilot.log`, `pilot.json`, `shots/`).
   - Last runs: `2026-10-24-m4` (177/177, through 691) and `2026-10-26-secure-tap` (133/133 with `PILOT_SKIP=11`, through 692).
7. Benches:
   - `apps/api/scripts/m4-clock-burst-bench.mjs --pin-hash pin`
   - `apps/api/scripts/m4-outbox-burst-bench.mjs --events 1000 --concurrency 2x2 --pool 5`
   - `apps/api/scripts/m4-large-salon-explain.mjs`
8. Full regression: `tooling/ci/final-run.sh` (all lanes, about 1 h) and `tooling/ci/live-proofs.sh`.
9. After you add a route, table or status, regenerate the matching file on purpose:
   - `node apps/api/scripts/openapi.mjs --manifest`
   - `node apps/api/scripts/attack-surface.mjs`
   - `node apps/api/scripts/db-ownership.mjs --write`
   - `node apps/api/scripts/role-matrix.mjs --write`
   - `node apps/api/scripts/audit-state-transitions.mjs --write-vocab`, and declare a `defineStateMachine` for the new status column.

### Migrations 679–692

All of these are expand-only and idempotent. Per-migration detail is in `DATABASE_STATUS.md`. There are 632 migration files in all (`001` … `692`, with reviewed gaps).

| # | One line |
|---|---|
| 679 | `wallet_topup_intents` — a wallet top-up is a durable intent, so a lost answer is settled from the processor (B-79) |
| 680 | `payment_intents` recovery columns (`charge_started_at`, processor ref, settled by / last inquiry) for Skip-the-Line Verify + sweep (B-80) |
| 681 | expense `shared_cost_policy` / `shared_cost_shares` — NONE or MANUAL_PERCENTAGE split of salon-wide costs (P2-3) |
| 682 | SMS pricing tiers data update (`sms_verification_packages`), merged from the developer tree and renumbered from 664 |
| 683 | Clock PIN keyed lookup digest (`pin_lookup`, `pin_lookup_kid`) — the kiosk finds a technician without one scrypt per technician |
| 684 | trigger: a messaging number never changes salon (security E1, TCPA) |
| 685 | index for the Go Check-In per-salon 15-minute caps (security E10) |
| 686 | security-event CHECK gains `MFA_REPLACE_REFUSED` (security C1) |
| 687 | payment-device identity: P-256 public key + unique fingerprint, `attestation_status`, device branches, nonces, pairing codes |
| 688 | shared salon payment phones |
| 689 | `refresh_tokens.family_id` — reuse revokes the family (`TOKEN_REUSE_DETECTED`) |
| 690 | `checkout_locks.checkout_version` — a stale phone claim gets `CHECKOUT_STALE` |
| 691 | six large-salon lookup indexes (`CONCURRENTLY`, no-transaction), measured before and after |
| 692 | security-event CHECK gains `NETWORK_POLICY_DENIED` (Super Admin network policy) |

### Pre-deploy checklist

Use env var names only and never paste values anywhere. Every item applies to the API service, and to the worker where it reads the variable.

1. **K-12 is complete.** Kevin's developer has confirmed each step in order, and only then is the rewritten history pushed. After that, remove `continue-on-error` from the gitleaks full-history CI step.
2. **Super Admin allowlist check** (`docs/security/SUPER_ADMIN_NETWORK_POLICY.md`). Before the first deploy with this code, run
   `select target, reason from ip_block_rules where is_allowlist and status = 'whitelisted';`
   Any row there now **restricts** Super Admin to those addresses. It must hold the operators' addresses or be empty.
   - `SUPER_ADMIN_NETWORK_POLICY` defaults to `enforce`. Break-glass values are `report` and `off`.
   - `SUPER_ADMIN_IP_ALLOWLIST` is optional (CIDRs) and is unioned with the DB allowlist.
   - `NETWORK_POLICY_CACHE_MS` defaults to 15000.
3. **`REDIS_URL`** (or `RATE_LIMIT_REDIS_URL`) with `RATE_LIMIT_STORE=redis`. The per-IP anonymous limiter, the tenant limiter and the login throttle only share their counts across replicas through Redis. Without it each process counts alone. Also set `LOGIN_THROTTLE_STORE=redis`.
4. **`ANON_RATE_LIMIT`.** Leave it unset, which means on. `off` is an emergency switch only.
5. **`CLOCK_PIN_LOOKUP_KEY`.** Set an explicit high-entropy key; when it is unset, the key is derived from `AUTH_SESSION_SECRET`. Rotation is safe because rows are re-keyed on their next match.
6. **`PG_WORKER_POOL_MAX`.** The default is 5, which gives the outbox a consumer budget of 3. Set it to 6 for the full 2 × 2 lanes.
7. **`TTP_ATTESTATION_POLICY`.** It defaults to off. `enforce` marks a phone that fails attestation as compromised. Turn it on only once a real App Attest verifier is configured.
8. **`MOBILE_PAY_DEVICE_KEYS`.** This is a policy switch, not a key. Production defaults to `required`, meaning no unkeyed payment phone can take money. `optional` is for legacy phones only.
9. Also from S-B3:
   - `NODE_ENV=production`
   - `WEB_CORS_ORIGINS` without the marketing origins
   - `TWILIO_ACCOUNT_SID`
   - `PAYMENTS_WEBHOOK_RAW_BODY=1`
   - `MEDIA_STORE=s3` + `EVIDENCE_S3_BUCKET` (production refuses to boot without object storage)
   - `CLAMAV_HOST` + `CLAMAV_REQUIRED=1`
   - the CommerceHub variables `COMMERCEHUB_TTP_*`, when Tap to Pay is enabled
10. Database:
    - Run `apps/api/scripts/db-provision-roles.mjs`.
    - Run the API as `aps_api` and the worker as `aps_worker`.
    - Use the private URL only.
    - Confirm the boot log has no `DB_ROLE_POSTURE` error.
11. Confirm `_headers` (CSP / HSTS) are served by the static hosts, and that HTTP redirects to HTTPS.
12. Migrations run through `apps/api/scripts/migrate.mjs`. 691 runs outside a transaction (`CONCURRENTLY`).

### Earlier hand-offs (newest first, short)

- **Oct 23 2026 (evening):** Security Deep Scan (58 findings, the P0 and all P1 fixed, migrations 683–686) and post-hardening proof (pilot 117/117, restore drill 12/12). `SECURITY_REVIEW.md` (Oct 23 section), `docs/security/*`.
- **Oct 22 2026 (evening):** the deep-scan / wiring-repair / pilot hand-back. This was the seventh full run, logged in `TEST_REPORT.md` "Oct 22 2026 — handoff run". `BUG_REGISTER.md` B-01 … B-78.
- **Oct 20 2026:** the mandate run (malware verdict, nine P0/P1 fixes). `PROJECT_STATUS.md` records it.
- **Oct 10–13 2026:** `START-HERE.md` is the build/run entry point. The Oct 13 tree description is `DEVELOPER_HANDOFF_2026-10-13.md`.

---

## Application inventory

| Application | Purpose | Location | Status (Oct 26) | Dev command |
| --- | --- | --- | --- | --- |
| API | The one backend (about 3,100 routes; generated: `API_INVENTORY.md`, `apps/api/openapi/manifest.txt`) | `apps/api` | WORKING | `npm run dev:api` |
| POS | Tenant POS, 27" touchscreen | `apps/pos-web` | WORKING | `npm run dev:pos` |
| Super Admin | Platform console | `apps/admin-web` | WORKING (network policy enforced) | `npm run dev:admin` |
| Owner App | Multi-salon owner portal | `apps/owner-web` | WORKING (web); native build needs a Mac | `npm run dev:owner` |
| Technician App | Tech queue / schedule / earnings | `apps/tech-web` | WORKING (web; driven at 390×844 by the pilot); native shells not driven | `npm run dev:tech` |
| Customer App | Booking, wallet, loyalty | `apps/customer-web` | WORKING (web); native needs keys / Mac | `npm run dev:customer` |
| Tap to Pay | Manager / shared-phone mobile checkout | `apps/manager-pay-web` | Device authentication complete (signed requests, pairing, revoke). The real CommerceHub charge / inquiry is BLOCKED_EXTERNAL | `npm run dev:managerpay` |
| Customer Display | Chairside tip / signature screen | `apps/customer-display` | WORKING (follows a phone payment, pilot S12) | `npm run dev:display` |
| Go Check-In Kiosk | Walk-in self check-in + clock-in | `apps/go-check-in-kiosk` | WORKING (single-file HTML) | open `www/index.html` |
| Guest booking page | No-login booking from a signed link | `apps/booking-public` | WORKING (static) | open `index.html` |
| Marketing site | aipowersalon.com (WordPress) | `marketing/` | Package ready; deploys separately | — |

## The rules your work is accepted against

These are in `ENGINEERING_RULES.md`:
- integer cents
- server-derived tenant
- expand-only migrations
- targeted realtime
- no fake success
- a test with every change
- no second system next to an existing one
- no print features (rule 17, `check:no-print`)

Everything must be green before AND after every change. A failing test is rewritten to pin the new truth, never deleted.

## New-developer walkthrough

| Question | Answer lives in |
| --- | --- |
| What is this project / how is it structured? | README.md · ARCHITECTURE.md |
| Install / configure / database / start / seed logins | START-HERE.md · LOCAL_DEVELOPMENT.md (env names: `.env.example`, SECRETS_REQUIRED.md, ENV_INVENTORY.md) |
| What works / what doesn't? | PROJECT_STATUS.md (top) · docs/mandates/status/*.md · KNOWN_ISSUES.md |
| What should I do first? | NEXT_STEPS.md |
| Where are the APIs? | API_INVENTORY.md (generated) · `apps/api/openapi/manifest.txt` |
| Where are migrations? | `apps/api/db/migrations/` (632 files, through 692) — DATABASE_STATUS.md |
| Tenant isolation / branch isolation | AUTH_AND_SECURITY.md · `cross-tenant-suite.pgtest` · `cross-branch-suite.pgtest` |
| How do payments / Tap to Pay work? | PAYMENTS_INTEGRATION.md · docs/security/SECURE_TAP_TO_PAY_ENGINEERING_REPORT.md |
| How does realtime / the outbox work? | EVENT_ARCHITECTURE_REPORT.md · REALTIME_INVENTORY.md |
| How is production deployed? | DEPLOYMENT.md · docs/HOSTING_ACTIONS_FOR_KEVIN.md (nothing is hosted yet) |
| Why is there no print button? | PRINT_FEATURES_REMOVED.md — Kevin's decision, re-confirmed Oct 26 2026; gate-enforced; do not re-add |
| What did earlier work decide and why? | CHANGELOG_HANDOFF.md + the dated reports at root (HANDOFF_MANIFEST.md) |

## What Kevin (owner) provides — and the ground rules

Kevin provides:
- the credentials in SECRETS_REQUIRED.md
- hardware
- store accounts
- the open decisions

Ground rules:
- Accounts stay owner-held, and the developer gets limited roles.
- Keys rotate on offboarding.
- **A GitHub push is not a deployment** (PUSH_TO_GITHUB.md).
- Never put a secret value in a document, a commit or a chat. Use env var names only.
