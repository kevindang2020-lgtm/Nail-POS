# PROJECT_STATUS.md — AI PowerSalon, Oct 27 2026

## Oct 28 2026 — Check-In + Live Operations 27-Inch One-Screen

- **Fit:** both pages 36 / 36 one-screen cells (6 states × 1920×945, 1920×1080, 1600×900/765, 2560×1440/1305). Before, Check-In scrolled 174–334 px and Live Operations 128–2,112 px at 1920×945. 1366×633 scrolls by design (131 / 91 px). E2E `interact-checkin.mjs` 26 / 26, `interact-liveops.mjs` 20 / 20.
- **Check-In wiring:** Quick Actions, New Customer email / consent, real Available Technicians, real trend / no-shows, one arriving window, duplicate-tap = one visit, indexed customer search (0.06 ms on 50,000 customers; the old path read them all).
- **Live Operations data:** workforce on-duty, canonical walk-ins, branch-clock upcoming, branch-authorized Multi-Location.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO.

## Oct 28 2026 — Overview 27-Inch One-Screen + Module Wiring

- **Fit:** all 6 states (empty, normal, busy, very busy, 200 techs, long names) pass at 1920×945, 1920×1080, 1600×900/765 and 2560×1440/1305 — 36 / 36. Before, 1920×945 scrolled 183–287 px and every 1600×765 cell scrolled. 1366×633 scrolls 125 px by design (fallback). E2E `interact-overview.mjs` 22 / 22.
- **Data:** 8 KPIs from their authorities with written definitions; board lists are server top rows + totals; insights advisory; payment mix revenue-bearing only; tenant / branch leak 0 on PostgreSQL 16.
- **Closed:** the Overview long-page / scroll issue, the static "Live" chip, the dead / client-derived modules.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO. See `docs/mandates/status/OVERVIEW_ONE_SCREEN_STATUS.md`.

## Oct 28 2026 — Customer Queue One-Screen + Guest Flow & Assignment

- **Fit:** every state passes at 1920×945, 1920×1080, 1600×900/765 and 2560×1440/1305. Before, the page scrolled 433–1,042 px at 1920. 1366×633 scrolls 145 px by design. E2E `interact-queue.mjs` 34 / 34.
- **Queue state:** Start Service / Send to Tech Queue are idempotent across restarts and replicas (durable keys) and under a race (the loser gets duplicate). One active entry per guest; Add to Queue = the canonical check-in.
- **Server authority:** board counts, priority order (`rankQueue`), technician availability (real signals, top 8 + summary), insights (advisory) and `waitLevel` come from one server projection. Null KPIs show "Not enough data".
- **Overlay focus bug** fixed in Queue, Serving and Service Done.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO. See `docs/mandates/status/CUSTOMER_QUEUE_ONE_SCREEN_STATUS.md`.

## Oct 28 2026 — Serving One-Screen + Live Service Floor

- **Floor fit:** every state passes at 1920×945, 1920×1080, 1600×900/765 and 2560×1440/1305 (before: page scroll 505–607 px at 1920). 1366×633 scrolls 145 px by design, as on Checkout / Service Done. E2E `interact-serving.mjs` 36 / 36.
- **Service state:** Start is a compare-and-set (one start time, one event); Start / Mark Ready / Send are idempotent; Move Stage offers only the server's legal next actions.
- **Add-ons:** catalog price, line owner, duration and revenue effects, one line per logical add-on.
- **KPIs:** no decorative values (null → "Not enough data"); the board counts are the server's stage counts over the whole floor.
- **Scale:** staff panel 8 rows + counts; the floor is read in 4 batch queries instead of 3–4 per ticket.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO. See `docs/mandates/status/SERVING_ONE_SCREEN_STATUS.md`.


## Oct 28 2026 — Service Done One-Screen + Completion Handoff

- **Board fit:** 30 / 30 state × viewport cells pass, against 3 / 36 before. The E2E run passes 29 / 29.
- **Workflow state:** now persisted in the ticket columns (migration 707), with two state machines (`SERVICE_DONE_CHECKOUT`, `SERVICE_DONE_QUALITY`).
- **Handoff:** atomic and idempotent.
- **KPIs:** no more decorative values. Accuracy, rebooking and satisfaction show "Not enough data" when there is none, and rebooking means "booked after the service".
- **Staff panel:** 8 rows plus counts.
- **Board queries:** the N+1 is removed.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO. See `docs/mandates/status/SERVICE_DONE_ONE_SCREEN_STATUS.md`.

## Oct 28 2026 — Checkout One-Screen + Payment Safety

- **Board fit:** Checkout fits one screen at 1920×1080. All 35 state × viewport cells pass, against 4 before. All 21 chrome-adjusted cells pass. The E2E run passes 26 of 26.
- **Money paths:** the paid read now fails closed, and the totals lock is in place.
- **Server-side definitions:** Pending Payments, attention and receipt rate are defined on the server, the staff panel is capped at 8 rows, and the detail now carries tenders, paid and balance.
- **Status:** CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO. The pos-web jsdom tests, pgtests and a physical touchscreen pilot are still to run. See `docs/mandates/status/CHECKOUT_ONE_SCREEN_STATUS.md`.

## Current status (Oct 27 2026 — final pass)

**Tree:** branch `merge-github-main`. The final-pass code is `3c5ae402` (build / unit lanes) and `b01f8d71` (API lane, pilot
day, live proofs); records committed on top of it. Migrations run through **702** (642 files). Nothing has been pushed;
K-12 comes first and is owned by Kevin's developer.

Evidence (`TEST_REPORT.md` "Oct 27 2026 — final pass", `docs/pilot-runs/2026-10-27-final/`):
- Unit / PGlite: **19,281 passed, 0 failed** — packages 1,247 · modules 11,027 (27 suites) · apps 3,897 (8) · API 3,110.
- Race lane on `race_final` (through 702): **99 files, 336 tests**. Harnesses 9 / 0 / 1. Restore drill 12 / 12.
- Live: route sweep 15 / 15 · event wiring 19 / 19 · display lifecycle 30 / 30 · **24 / 24 live proofs (606 checks)** ·
  announcement browser proof **58 / 58** · Vietnamese one-screen matrix 18 / 18 primary in each state.
- **Pilot day 235 / 235** on a fresh database, every phase, no `PILOT_SKIP`, screens on.
- §163 injection pass run 3: 22,250 requests, 0 failing.
- `ci:gates`: **54 gates + 21 audits green at `3c5ae402`** (and after the one role-checks fix, `b01f8d71`). **On the branch HEAD
  it is red (7 FAIL)** because of work by other agents after the final pass (`6a1a76e8` payments types → silent-catch /
  tenant-builder; uncommitted pay-stub PDF routes → unreached / openapi / api-contract / list-queries / attack-surface).

Closed in the final pass: SD-21 (attempt-by-key scoped to the location), the 13 routes that answered 5xx on malformed input,
the 10e2 QR-handoff code (`HANDOFF_TOKEN_INVALID`, EN / VI), `check:unreached` (Owner App suggested-expense link), OCR body
routes strict, V-5 (25 registry codes on 74 throw sites; deal reasons worded by the POS), Announcement §108 / §165, and Kevin's
§24 decision (technicians with NO services set up are bookable through the category fallback — and only they; the verdict
carries `basis`).

Open (internal): 264 free-text server refusals left in checkout / booking / queue / deals (V-5 remainder); busy-state
one-screen responsive report 55 / 90 (85 / 90 in the earlier Oct 27 run — not investigated); first-pass harness failure
(`verify-terminal-capture` 12 / 17, not reproduced); B-93 (OCR store swallows writes); the gate failures above (owner: the
agents doing that work). Full list: `NEXT_STEPS.md`.

### Mandate counts (Oct 27 final pass — `docs/MANDATE_COMPLETION_MATRIX.md`)

| Mandate | DONE | PARTIAL | NOT DONE | BLOCKED_EXTERNAL |
|---|---|---|---|---|
| Secure Tap to Pay device authentication | 67 | 10 | 0 | 1 |
| 200-Technician large salon | 102 | 3 | 0 | 0 |
| Remaining production work | 52 | 1 | 0 | 20 |
| Security deep scan / zero trust | 155 | 20 | 0 | 17 |
| Platform announcement (POS top bar) | 168 | 0 | 0 | 0 |
| English + Vietnamese POS | 116 | 8 | 3 | 0 |
| Platform Architecture Audit (262) | 218 | 41 | 0 | 3 |
| Weekly Technician Paycheck | 160 | 1 | 0 | 0 |
| Receipt / Expense / Invoice / OCR | 192 | 18 | 1 | 1 |
| Full System Run | SKIPPED by Kevin's decision Oct 27 | | | |

## Oct 26 2026 status (kept as written)

**Tree:** branch `merge-github-main`, HEAD `47c4044b`. The migrations run through **692** (632 files).

Evidence on the code as of Oct 26:
- `npm run ci:gates` gives **54 gates + 17 audits passed** (`47c4044b`).
- Pilot day **177/177** on the M4 code, through 691 (`docs/pilot-runs/2026-10-24-m4/`).
- Pilot **133/133** with `PILOT_SKIP=11`, phase 12 36/36, through 692 (`docs/pilot-runs/2026-10-26-secure-tap/`).
- The malware scan was clean (`docs/security/MALWARE_SCAN_REPORT.md`).

**Not yet run:** a full logged regression on HEAD. The last full run is Oct 22, and the Oct 26 run is pending in
`TEST_REPORT.md`. Nothing has been pushed. K-12 comes first and is owned by Kevin's developer.

### Mandate counts (section-by-section reports in `docs/mandates/status/`, updated after the Oct 26 build)

| Mandate | Sections | DONE | PARTIAL | NOT DONE | BLOCKED_EXTERNAL |
|---|---|---|---|---|---|
| Secure Tap to Pay device authentication (Oct 27) | 78 | 67 | 10 | 0 | 1 |
| 200-Technician large salon | 105 | 94 | 11 | 0 | 0 |
| Remaining production work | 73 (+23 acceptance rows: 11 / 2 / 0 / 10) | 36 | 18 | 0 | 19 |
| Security deep scan / zero trust | 192 | 140 | 34 | 1 | 17 |
| Platform announcement (POS top bar) (Oct 27) | 168 | 166 | 2 (§108, §165) | 0 | 0 |

Notes:
- `docs/MANDATE_COMPLETION_MATRIX.md` carries the pre-build audit counts taken at `ef7eb6bf`.
- All 10 Secure Tap PARTIAL rows wait only on a device or on CommerceHub (Oct 27).
- 200-tech §6 / §54 (Print Schedule) are DONE as decided-against: Kevin kept the no-print rule on Oct 26.

### Status by area (Oct 26)

| Area | Status | What is missing |
|---|---|---|
| Multi-tenant core / isolation | **Complete** — tenant gates, same-tenant triggers. A **cross-branch suite** (`cross-branch-suite.pgtest`) was added Oct 26. | RLS strict mode is a Kevin switch |
| Authentication / sessions | **Complete** — refresh families with reuse detection (689). Step-up on the salon role / access mutations (Oct 26). | trusted device for platform sign-in (S-A13) |
| Super Admin / control plane | **Complete** — the **network policy is enforced** (IP blocks + allowlist, `SUPER_ADMIN_IP_ALLOWLIST`, migration 692). | check the DB allowlist before the first deploy |
| POS check-in → queue → serving → checkout | **Complete**. An accepted offer lands on `ready_to_start` (Kevin, Oct 26). | Appointment Soon / Hold lane states (200-tech §33) |
| Booking (POS, customer, public, AI receptionist) | **Complete at 200 technicians** — 17 × 12 server-paged board, paged picker, prefetch, First / Last. | live re-run of the blocked-time lines |
| Payments — CardPointe / Bolt / Clover | **Complete on sandbox / loopback**. Recovery for top-ups, Skip-the-Line and split cards (Oct 23). | real MIDs + UAT (Kevin); the wallet webhook leg; recovery flows in the pilot |
| Tap to Pay (manager-pay / shared phones) | **Device authentication complete** — signed requests, pairing, revoke, claim version, attestation intake, store switch with a merchant check. | CommerceHub SDK / inquiry / per-location MIDs, the native key store, iPhones (external) |
| Payroll & compensation | **Complete at 200** — `UNALLOCATED_TIP` / `MISSING_COMMISSION_RULE` exceptions and an Owner branch filter (Oct 26). | Owner App at 200 pilot step |
| Owner App | **Complete (web)** — Staff Performance is paged / searched / sorted for 200 (Oct 26). | native build (Mac) |
| Technician App / Go Check-In | **Complete (web)**. The clock PIN uses its own scrypt cost (M4-1). | clock-in p95 read-back on the pilot host; native shells |
| Events / realtime | **Complete** — per-aggregate order holds across failures, ticks and instances (Oct 26). | realtime-first lane (lag p95 < 2 s target); clients don't read `resourceVersion` |
| Communications (SMS / e-mail / push) | **Partial / Blocked** — providers | Twilio A2P / Verify, SendGrid, Firebase + APNs (Kevin) |
| Expenses / receipt OCR | **Complete without providers** | S3 + ClamAV + Textract (Kevin); pHash; OCR through the AI gateway |
| Platform announcements | **Complete** (159 / 168) | 8 PARTIAL polish rows (telemetry, ordering, Creator column, EXPLAIN, contrast, icons) |
| Security & supply chain | **Complete for code P0 / P1**. On Oct 26: malware scan clean, per-IP anonymous limiter, signals, strict bodies (partial). | the internal list in `SECURITY_DEEP_SCAN_STATUS.md`; edge / hosting / pen test (Kevin) |
| Mobile (4 Capacitor apps) | **Blocked** for store builds | upload keys (K-12), a Mac |
| Hosting | **Blocked** | `docs/HOSTING_ACTIONS_FOR_KEVIN.md` |

### Migrations since Oct 22

| Range | What |
|---|---|
| 679–681 | Recovery and finance: wallet top-up intents, payment-intent recovery and shared-cost policy (Oct 23) |
| 682 | SMS tiers data update |
| 683 | Clock PIN lookup digest |
| 684–686 | Security fixes |
| 687–690 | Tap to Pay: device identity, shared phones, refresh family and claim version |
| 691 | Large-salon indexes |
| 692 | `NETWORK_POLICY_DENIED` |

One line each is in `DATABASE_STATUS.md`.

**Open work:** `NEXT_STEPS.md` (internal I-1 … I-16, then Kevin's external items).

---

## Oct 22 2026 record (kept as written)

**Verified state (Oct 22 2026, evening — the hand-back):** tree `work/dual-screen-display` at **`a42dd40f`** + the hand-back
documents. **Seventh full run** (`TEST_REPORT.md` "Oct 22 2026 — handoff run"): 618 migrations on a fresh database; builds,
typecheck, lint; **51 gates + 16 audits**; unit / pgtest **17,974 passed, 0 failed**; race **311 / 0**; harnesses **37 / 0**;
route sweep 15/15; event wiring 19/19; display 30/30; **pilot day 96/96** (incl. the mandate's phase 10); restore drill 12/12;
e2e green; **the 24 other live proofs 603 / 603**. Fixed today: **B-66 … B-78** (two P0 money bugs found by the pilot);
open with safe defaults: B-23, **B-79 … B-82** — `NEXT_STEPS.md`. Nothing pushed (K-12 first).

### Module matrix (Oct 22, logged run)

| Module | Tests passed | Status | Changed Oct 22 |
|---|---|---|---|
| `modules/ai` | 2,002 | PASS without a provider (keys = Kevin) | Fair Turn hard rule exact (B-71) |
| `modules/analytics` | 279 | PASS | — |
| `modules/appointments` | 32 | PASS | — |
| `modules/audit` | 35 | PASS | — |
| `modules/booking` | 704 | PASS | availability by skill (B-75) |
| `modules/catalog` | 45 | PASS | — |
| `modules/checkout` | 769 | PASS (Tap to Pay BLOCKED_EXTERNAL) | no tender while a card attempt is unsettled (B-66); lost / unknown answers (B-68, B-69) |
| `modules/communications` | 451 | PARTIAL — providers (Twilio A2P, SendGrid, push) = Kevin | SMS sender route, migration 678 (B-77) |
| `modules/customers` | 222 | PASS | — |
| `modules/deals` | 232 | PASS | — |
| `modules/finance` | 51 | PASS | salon-wide expenses + All branches (B-72, B-73) |
| `modules/gift-cards` | 35 | PASS | — |
| `modules/identity` | 542 | PASS | — |
| `modules/inventory` | 29 | PASS | — |
| `modules/loyalty` | 10 | PASS | — |
| `modules/marketing` | 102 | PASS | — |
| `modules/memberships` | 139 | PASS | — |
| `modules/payments` | 243 | PASS on sandbox / loopback; live MIDs = Kevin | wallet top-up never "declined" on an unknown answer (B-69); B-79 open |
| `modules/platform` | 114 | PASS | — |
| `modules/queue` | 669 | PASS | exact-service eligibility (B-71) |
| `modules/reports` | 15 | PASS | — |
| `modules/safety` | 530 | PASS; receipt OCR reading BLOCKED_EXTERNAL (S3 + scanner + Textract) | receipt uploads (B-70); OCR settings save (B-76) |
| `modules/security-center` | 14 | PASS | — |
| `modules/super-admin` | 1,947 | PASS | — |
| `modules/support` | 34 | PASS | — |
| `modules/tenants` | 150 | PASS | — |
| `modules/workforce` | 980 | PASS | no overlapping pay periods (B-67); paycheck approve after submit (B-74) |

### App matrix

| App | Tests passed | Build | Status | Changed Oct 22 |
|---|---|---|---|---|
| `apps/api` | 2,920 (+ 37 harnesses, 311 race) | built · typecheck 0 | PASS | — |
| `apps/pos-web` | 1,410 | built · typecheck 0 | PASS | New Booking open times, Best Matches, full-day board (B-75) |
| `apps/admin-web` | 1,048 | built · typecheck 0 | PASS | — |
| `apps/owner-web` | 348 | built · typecheck 0 | PASS (web); native = Mac / keys | finance "All branches" (B-73) |
| `apps/customer-web` | 280 | built · typecheck 0 | PASS (web); native = keys | skip-the-line messages (B-69) |
| `apps/tech-web` | 187 | built · typecheck 0 | PASS (web) | cash confirmation proved live |
| `apps/manager-pay-web` | 90 | built · typecheck 0 | PASS on loopback; Tap to Pay BLOCKED_EXTERNAL | — |
| `apps/customer-display` | 201 | built · typecheck 0 | PASS (23" hardware = Kevin) | — |
| `apps/go-check-in-kiosk` | e2e:html | wrapper | PASS | — |
| `apps/booking-public` | e2e:html | static | PASS | — |

### Engineering matrix

| Control | State | Where |
|---|---|---|
| Gates + audits | 51 + 16, all passing | `npm run ci:gates` (`tooling/ci/run-gates.mjs`) |
| Ratchets (may only shrink) | lint warnings, `as any` (per file), silent catches, unreached routes | `lint-ratchet.mjs`, `check:as-any`, `check:silent-catch`, `check:unreached` |
| Money | integer cents, no float money columns; double-charge + double-pay guards (B-66, B-67) | `check:money`; race lane |
| Tenancy | tenant predicate on every query (static), same-tenant FK triggers, RLS trial 20/20 | `check:tenant`, `tenant-consistency.pgtest`, `live-rls-trial` |
| Migrations | expand-only, idempotent, safety gate, no NOT VALID left | `check:migration-safety`, `validate-not-valid-547.pgtest` |
| Concurrency | 90 real-PostgreSQL race files / 311 tests | `tooling/ci/run-race-tests.mjs` |
| Live proofs | final-run lanes + the 24 proofs | `tooling/ci/final-run.sh`, `tooling/ci/live-proofs.sh` |
| i18n | EN / VI complete with matching placeholders | `check-i18n` |
| Env vars | every name the code reads, names only | `ENV_INVENTORY.md` (`tooling/ci/gen-env-inventory.mjs`) |

The sixth-run record follows, kept as written.



**Verified state (Oct 22 2026):** tree `work/dual-screen-display` at `5349c92d` — the **sixth full run** (`final-run/summary.txt`,
`TEST_REPORT.md` "Oct 22, 2026"): every lane green after the fixes it found — 617 migrations on a fresh database; builds, typecheck,
lint; **all 51 gates + 16 audits**; unit / pgtest **17,935 passed, 0 failed**; race lane **310 / 0**; harnesses **37 / 0**; route sweep
**15/15**; event wiring **19/19**; display **30/30**; **pilot day 74/74**; restore drill **12/12**; e2e green; live IDOR **8/8, 0 leaks**.
The Oct 14 source zips are byte-for-byte `6ffc9c78` in this history — nothing to merge; this is the one tree.

The Oct 21 record (fifth run) follows, kept as written.

**Verified state:** tree `work/dual-screen-display` — **fifth full run** (Oct 21, midday) on `444f3852` (the M1–M4 rebuild head, B-33 … B-48); its api-lane failures were test artefacts of the §43 envelope and one generated file (fixed `766c0b2a`, `1e05abda`), its pilot-day miss the proof's own timing (`4befec49`), its harness misses environmental — every lane green at the final head (`TEST_REPORT.md`, "Oct 21 (midday)"). The fourth run (early Oct 21, `8d41bd7a`) stands as the previous record. Every number here is copied from **one logged run** — `tooling/ci/final-run.sh` → `final-run/summary.txt` (per-lane logs beside it; earlier runs in `final-run-pass1..4/`).

| Lane (fifth run) | Result |
|---|---|
| Clean install · fresh-DB migrations | rc=0 · **611 applied, 0 already present** |
| Builds: packages · modules (26) · API · frontends | rc=0 · rc=0 · rc=0 · rc=0 |
| Typecheck · lint ratchet | rc=0 · rc=0 |
| Gates + audits (`ci:gates`) | **all 51 gates + 15 audits, first pass** |
| Unit / pgtest lanes: packages · modules · apps · api | **1,105 · 10,197 (282 skipped) · 3,515 · 2,895 (134 skipped) — 0 failed** at the final head (api lane rerun `tests-api-rerun` rc=0) (api first pass 14 failed: §43 envelope / stale `_headers` — test artefacts) |
| Harnesses | **37 passed, 0 failed, 1 skipped-by-design** (two environmental reruns, each miss passing alone) |
| Real-Postgres race lane (fresh DB) | **88 files, 307 passed, 0 failed** |
| Live route sweep · event wiring · display lifecycle · pilot day · restore drill · e2e:html | **15/15** · **19/19** (+ the two new proofs) · **30/30** · **74/74** (after the proof's wait fix) · **12/12** · **green** |
| POS viewport / touch audit (real logged-in app, 6 viewports × 10 screens) | **60/60** — shell controls all ≥ 40 px after `e8990543` |

Status words below (mandate §250): **Complete** = built, wired end to end, proven in this run · **Partial** = a named piece missing (bug id) · **Blocked** = needs an account / device / hosting step only Kevin can do (`docs/HOSTING_ACTIONS_FOR_KEVIN.md`, K-13) · **Deprecated** = removed on purpose, do not re-add.

## 1. What changed on Oct 20 2026 (the mandate run)

Malware: the developer's `Power-Salon-main_New.zip` was confirmed infected (obfuscated `api.js` + a second copy hidden behind ~14,000 spaces in `eslint.config.mjs`, wired into `package.json` build/dev; a real Firebase private key; three upload keystores with passwords). **This tree has none of it** — scanned the same way, and gate R7 now refuses any tracked credential file. The zip's content had already been ported on Oct 12; nothing from it was executed or merged again. Details: `SECURITY_REVIEW.md` §1.

Nine code commits (plus the run-plumbing commits `ac22b13c`…`c1cfcd41`: harness runner, final-run scripts, proof fixtures, the drill hold-proof placement), each with a failing test first and a real-Postgres or browser proof (`BUG_REGISTER.md` "Fixed Oct 20"):

| Commit | What |
|---|---|
| `faef6aed` P0 | tracked Android upload keystores + `key.properties` removed; supply-chain gate R7 |
| `be06283e` P0 | payment-less gift-card reload back door removed; void = balance + ledger in one transaction; swallowed ledger error surfaced and fixed |
| `c2a344f9` P0 | a card refund whose processor answer was lost is held in `processing` and settled only from the processor's record (sweep or manager with step-up); never sent twice; migration 664; `refund-race` moved into the race lane and run for the first time |
| `6f37bab4` P1 | commission precedence ladder re-ranked (Service > service row rate > Category > Branch Default > Salon Default; Branch + Category ranked) |
| `27e3b997` P1 | one technician-eligibility authority on every booking path (POS, customer, first-available, reschedule, assign); approved time off blocks the booking day |
| `5d6dc0ca` P1 | durable idempotency on booking create and both check-ins; walk-in keys on the row (migration 665), replay across replicas |
| `cef689c8` P1 | a processor problem (CardPointe `B`, Clover `pending`, timeout) is never recorded or shown as a card DECLINE |
| `ef303be2` P1 | production refuses to start without object storage (`MEDIA_STORE=s3`) |
| `79df7020` P1 | `POST_RESTORE_HOLD` — after a restore nothing is re-sent or re-billed; DR §3.1 checklist; drill proves it |

Afternoon (same day): the harness lane repaired (B-27 — 37/37) and one real defect it surfaced fixed (B-29: deleting a portfolio photo left the image in storage); new open items B-28 (unbounded salon browse) and B-30 (cold index report). Plus this package: `tooling/ci/final-run.sh`, `final-run-rerun.sh`, `live-api-harnesses.sh`, the status reports listed above, `docs/runbooks/refund-status-unknown.md`, `docs/HOSTING_ACTIONS_FOR_KEVIN.md` §F.

Evening (same day): the P2 / P3 debt, each item test-first, gated, its own commit — **B-12** `ce2fa5f5` (same-tenant trigger on every tenant FK, migration 666) · **B-13** `f4c00116` (end employment for non-technician staff) · **B-14 part 1** `51c3f827` (one Twilio client; 4 of 5 direct realtime pushes → domain events + projection) · **B-15** `e7463677` (`check:migration-safety`, the 48th gate) · **B-17** `602fad5d` (retail stock reversible unit by unit, migration 667) · **B-28 / B-30** `16f3fa89` (paged salon browse in SQL; cached index report). The third full run then found **B-31** (owner attendance counted New York's day for every salon — real, fixed `a5bdce20`) and that B-30's first round had not fixed the cold first request (round 2 `4428ea3c`).

### 1b. What changed on Oct 21 2026 (the Oct 14–19 rebuild — M1 money → M2 booking → M3 architecture → M4 screens / proofs)

The Oct 14–19 work had been lost with the developer's machine (`NEW_CHAT_START_HERE.md`); the merge of the four bundles was
already complete (`6ffc9c78` is an ancestor of the tree), so the gap list was rebuilt item by item, test-first, each its own
BUG_REGISTER row (**B-33 … B-48**) and commit:

| Commit | What |
|---|---|
| `98844041` `1047ee01` `db68c371` (M1) | B-33 refund to the gift card that paid (atomic, refuses no-card / other-salon / not-creditable); B-34 cancel a terminal prompt (`cancel-terminal`, Bolt `/cancel`); B-35 merchant routing: a failed read is a `ProcessorError`, never "not configured" |
| `2ce2c0b3` (M2) | **B-36 booking deposits (D11)** end to end — migration 669, state machines, capture at booking, applied first at checkout as a `deposit` payment, remainder refunded, cancel-by-window / no-show forfeit, customer card; the payment router under the `PAYMENT_GATEWAY` string token so booking never imports payments (§105 cycle); **B-38** branch price / duration / availability; **B-39** one appointment writer (five insert sites → `AppointmentWriter`, `appointment.created` with the row version); **B-42** guard reads fail closed; **B-43** projected payloads carry `resourceType / resourceId / resourceVersion` |
| `59eda92b` | **B-37** reminder ladder 24 h / 2 h / 30 min (migration 670, per-rung sent log, in-process scheduler) |
| `a8e888da` (M3) | **B-40** one tax calculation (`taxCents()`, seven sites, gate); **B-41** `posHttp()` (fourteen POS api modules); **B-44** rollout flags `mobile_tap_to_pay` / `new_payroll_engine` (migration 671; a flag that cannot be read fails CLOSED); `check:silent-catch` and **B-45** `check:as-any` ratchets; `check-zoom` audit |
| `7933409a` `1853163c` (M4) | axe (a11y) tests on five screens (`@aipowersalon/testing/a11y`), pinch-zoom restored on four apps, EN/VI on the public booking page and the kiosk; **B-46** System Status Storage + Deployments panels (`/super-admin/system-status/infrastructure`); **B-47** `check-i18n` audit (9 dictionaries, 562 keys); **B-48** `live-payroll-plans` (23) + `live-multibranch` (12) proofs in the event-wiring flow list |
| `bf9903a3` `e8990543` | the POS viewport audit repaired (it had measured the login page, then one screen ten times) and the shell's controls raised to 40 px |

| POS Vietnamese (1/3 `45e309bf`, 2/3 `c025890c`, 3/3 this commit) | **B-49 … B-52**: the POS in English or Vietnamese — a topbar EN/VI switch saved per person, a salon default in Settings → Business, 8,490 keys generated from the exact screen text and all translated, `enPlural()` for English plural endings, `serverText()` for known API labels, the `check:pos-i18n` gate and `check-i18n` audit. Proof: `final-run/pos-vi/*.png` (six real screens on Postgres, signed in as the PALACE owner) |

Not done, by name: Super Admin stays English (Kevin: "For Super Admin apps I only use English"); in the POS, free text that
the API composes (go-live "pending" reasons, error messages from the server, customer / service names) is shown as sent;
per-screen filter selects at 31–36 px (recorded in `final-run/viewport-audit.log`).

**Receipts & Expenses (finance mandate, Oct 21 evening) — B-53 … B-62:** `modules/finance` — the one expense authority (receipt → expense → category → vendor → reports → accountant export), migration 672, `/owner/finance/*` (33 typed routes), the OCR receipt posting through it (idempotent, retried), events + realtime + owner alerts, the POS Receipts & Expenses screen (EN/VI) and the Owner App Expenses screen rebuilt; the older `/owner/expenses*` routes and scan-receipt delegate (kept). Also fixed a build break left by POS Vietnamese 1/3 (B-62).

**Weekly Technician Paycheck, Cash Payout & Owner Approval (Oct 21 night) — B-63, B-64:** the ONE payroll extended (migration 673, no second payroll): pay schedule + policy, immutable pay statements `PAY-YYYY-NNNNNN` (one per technician per week, branch breakdown), 50 / 50 check / cash default with the odd cent to the primary method, custom percent / dollar splits with a reason, manager submit → Owner App approve all / hold / return / reject (PIN, separation of duties), checks (number, deliver, clear, void + replacement), cash (drawer movement in the same transaction, insufficient-cash refusal, handoff, technician PIN / app confirmation, dispute, cancel), PARTIALLY_PAID → PAID, weekly worker (off by default), notifications, realtime, reports with the accounting rule (payroll expense counted once). Report: `docs/PAYCHECK_FINAL_REPORT.md`.

**Super Admin POS Top-Bar Announcements & Platform Broadcast (Oct 22) — B-65:** Super Admin › Communications › Platform Announcements writes plain-text notices (type, priority, all salons / selected salons / selected branches, publish now or schedule, end time, dismissible, "I understand") with a live header preview at 1920 and 1366, double confirmation for every-salon or high / critical, pause / resume / archive (step-up), duplicate, version conflicts, revisions and audit (migration 674). The POS shows them between Search and the clock — one line, two lines, then clamp + More — in realtime with no refresh (one ids-only event per targeted salon; snapshot on start / reconnect; timer at the next start / end; 60 s safety sync). Proven: pgtest 20, unit 26, real browser 51 / 51 at 1920 / 1600 / 1366 / 1280. Report: `docs/PLATFORM_ANNOUNCEMENTS_FINAL_REPORT.md`.

Not done, by name (finance): an AI category suggestion is wired as a port but no AI provider is bound (the deterministic rules decide;
OCR reading itself needs Textract + the evidence bucket = Kevin); bill reminders are off until `EXPENSE_BILL_REMINDERS_ENABLED=1`
and reach the owner as in-app alerts only (SMS / e-mail / push need providers = Kevin); server-written insight sentences
are English in the Vietnamese POS; no QuickBooks / Xero connector (CSV / XLSX export only).

## 2. Status by area

| Area | Status | Evidence / what is missing |
|---|---|---|
| Multi-tenant core (tenants, branches, users, RBAC, isolation) | **Complete** | gates `tenant`, `tenant-builder`, `perms`; route sweep cross-tenant probes; RLS on 11 tables behind `DB_TENANT_RLS` |
| Authentication (4 realms, MFA, WebAuthn, biometrics, step-up, sessions) | **Complete** | `auth-matrix`, realtime authz revalidation |
| POS: check-in → queue / Fair Turn → serving → service done → checkout | **Complete** | pilot day (lane `live-pilot-day`), race lane; idempotent check-in (Oct 20) |
| Booking (POS, customer app, public link, AI receptionist) | **Complete** — B-22 closed Oct 22 (real drafts on `booking_holds`) | skills + time-off authority (Oct 20); `booking-time-off.postgres-race` |
| Payments — card via CardPointe / Bolt / Clover | **Complete on sandbox / loopback; Blocked for live** | outcome mapping + refund lost-answer handling (Oct 20); real MIDs = Kevin |
| Tap to Pay (Manager Pay) | **Blocked** (Apple entitlement, CommerceHub SDK) | app proven on loopback incl. unknown-state recovery |
| Gift cards, loyalty, memberships, deals | **Complete** | gift-card ledger authority fixed (Oct 20); renewals need the two env switches (HOSTING F3) |
| Payroll & compensation | **Complete** (external payroll provider = NOT_IMPLEMENTED port) | ladder fix (Oct 20) |
| Inventory & catalog | **Complete** — B-19 (manager override, audited), K-01 (the category is the one add-on model), K-03 (recipes leave the shelf at Service Done) closed Oct 22 | B-17 fixed (retail stock reversible on remove / void / refund, locked picks) |
| Communications (SMS / e-mail / push / in-app) | **Partial / Blocked** — providers (Twilio A2P, SendGrid, FCM/APNs) = Kevin; B-16 platform-managed provisioning built (`f7880f1a`; A2P on its service + offboarding not built) | unconfigured channels are honest `not_configured`, never metered |
| Customer display + Go Check-In kiosk | **Complete** (real 23" hardware test = Kevin) | `DUAL_SCREEN_FINAL_REPORT.md` |
| AI platform (gateway, registries, budgets, copilot, receptionist, queue assignment, scheduling, forecasting) | **Complete without a provider** — keys = Kevin; B-14 | deterministic fallbacks in the pilot |
| Super Admin / control plane | **Complete** | 1,126 routes, 153 screens |
| Analytics & reports | **Complete** | profit now subtracts APPROVED expenses only (B-54) |
| Expenses / receipts / bills / accountant export | **Complete without providers** — OCR reading (Textract + bucket), AI category suggestions and reminder delivery need Kevin's accounts | `modules/finance` 32 unit + 18 pgtests; `verify-owner-expenses` 19/19; POS 11 + Owner App 13 screen tests |
| Weekly paychecks (statements, check / cash split, owner approval, check + cash lifecycles, reports) | **Complete** — automatic weekly preparation is off until `PAYROLL_WEEKLY_PREP_ENABLED=1` (and each salon turns it on); ACH / direct-deposit / payroll-provider payouts are recorded methods, no provider is connected | `modules/workforce/src/payroll/payroll-paycheck*` |
| Platform announcements on the POS top bar (Super Admin authoring, targeting, schedule / expiry, dismiss / acknowledge, realtime) | **Complete** for the POS — the Owner / Tech / Customer apps do not show them yet (`surfaces` column ready) | `modules/communications/src/platform-announcements/`, `apps/pos-web/src/shell/PlatformAnnouncementBar.tsx` |
| Security & audit | **Complete** | `SECURITY_REVIEW.md`; B-12 closed (same-tenant trigger on every tenant FK, migration 666); B-13 closed (end employment) |
| Events / jobs / workers / realtime | **Complete** (B-21) | `REALTIME_INVENTORY.md`; lane `live-event-wiring`; B-14 closed — direct emitters 0 (`51c3f827`, `331b5b67`) (was: 4 of 5 direct pushes are domain events + projection) |
| Observability & health | **Complete** (B-20) | `post_restore_hold` component (Oct 20) |
| Files / media | **Complete without ClamAV** — B-18 closed Oct 22 (export files to the private object store, legacy avatars rendered + backfill script); the ClamAV service = Kevin | production requires S3 (Oct 20) |
| Mobile (4 Capacitor apps) | **Blocked** for store builds — upload keys, iOS machine | `check-native-config` clean, no signing file in the tree |
| Hosting (Railway, TLS, WAF, backups, PITR, restore, Redis HA, OTLP) | **Blocked** — `docs/HOSTING_ACTIONS_FOR_KEVIN.md` A–F | nothing is hosted; no live provider has been exercised; no salon has run a real day |

## 3. Deprecated (removed on purpose — do not re-add)

| What | When / why |
|---|---|
| `POST /pos/checkout/gift-cards/:code/reload` (payment-less reload) | Oct 20 — stored value without a payment (B-02); reload is payment-first only |
| Tracked signing / credential files (`*.jks`, `key.properties`, `firebase-admin*.json`, real `.env`) | Oct 20 — gate R7 (B-01); `FCM_SERVICE_ACCOUNT_JSON` env instead |
| Process-local idempotency Maps (walk-in `walkInIdemIndex`) | Oct 20 — replaced by `api_idempotency` + the queue row key |
| Print features, `apps/booking-html`, `apps/go-check-in-admin`, `owner_notifications` duplicate consumer | Oct 10–13 (Constitution 13); see `PRINT_FEATURES_REMOVED.md`, `DEVELOPER_HANDOFF_2026-10-13.md` |

## 4. Open work, in order

1. **Kevin, before anything is pushed or deployed** — K-12 security actions (machine rebuild, rotate every credential, revoke the Firebase key, new Play upload keys, DB password + port 5432, then the history rewrite) and HOSTING A1–A14.
2. **P1 internal (opened Oct 22 evening, each with a safe default)**: B-79 wallet top-up settlement, B-80 skip-the-line Verify, B-81 split-card reservation in the unsettled guard, B-82 remaining category-based suggestions — `NEXT_STEPS.md` P1-1 … P1-4.
   **P2 internal**: none open. Closed on Oct 20: B-12, B-13, B-14 (both parts), B-15, B-16, B-17, B-28, B-30, B-31; on Oct 21: B-32 (race-lane deadlock on simultaneous holds), then the Oct 14–19 rebuild B-33 … B-48 (§1b). Named follow-ups of B-16: the A2P campaign on a platform-managed salon's Messaging Service, and offboarding (release the number, close the subaccount).
3. **P3**: B-18 … B-22, B-24 … B-26 closed Oct 22 (see BUG_REGISTER "Fixed on Oct 20–22"); B-23 stays (a CardPointe sandbox run, not code). Kevin's decisions: K-01 … K-04 and K-06 BUILT on Oct 22 ("use the recommended"); K-05, K-07 … K-11 are "keep as is" (nothing to build); K-12 / K-13 are Kevin's accounts and security steps.
4. First live provider runs on staging (CardPointe UAT lost-refund case B-23, Twilio, SendGrid), then the first real salon day with the pilot script as the checklist.
