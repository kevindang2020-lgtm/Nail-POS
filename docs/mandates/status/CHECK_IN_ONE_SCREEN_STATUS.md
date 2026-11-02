# CHECK_IN_ONE_SCREEN_STATUS.md — Check-In 27-Inch One-Screen, Functional Wiring & Module Completion (Oct 28 2026)

Mandate: `CheckIn.pdf` ("Check-In — 27-Inch Touchscreen One-Screen Fit, Functional Wiring & Module Completion", §1–§115 +
appendix). Branch `merge-github-main`; commits listed in CHANGELOG_HANDOFF. **Nothing pushed** (K-12 first).
Delivered together with the Live Operations mandate (`LIVE_OPERATIONS_ONE_SCREEN_STATUS.md`); both pages and the Overview
now share one one-screen kit (`apps/pos-web/src/components/OneScreenKit.tsx` + the `:is(.overview-page,.check-in-page,
.live-ops-page)` block of `styles.css`).

Environment: sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**, Chromium + Playwright, Inter / DejaVu Serif
standing in for Hanken Grotesk / Playfair Display (wider — the fit numbers are conservative).

**Verdicts:** CODE_READY_FOR_DEVELOPER_HANDOFF = **YES** · PRODUCTION_READY = **NO** (still to run on a real environment:
the pos-web jsdom tests, pos-web `tsc` / lint, the check-in pgtests, Edge / branded Chrome, the physical 27-inch touchscreen,
the live two-station realtime pilot). No migration; no new route; one request-schema addition (walk-in `customerEmail`,
`smsOptIn`).

---

## A. Existing Check-In code found (inspected first; nothing duplicated)

| Piece | Path |
|---|---|
| Page (`/check-in`) | `apps/pos-web/src/screens/POSCheckInScreen.tsx` — rebuilt on the one-screen kit; every module kept |
| KPI cards, Live Queue, Appointments Arriving, Waiting Lounge, Available Technicians, Insights, Analytics, Quick Actions | inside `POSCheckInScreen.tsx` (+ the module-level `GuestDetail` visit drawer) |
| Quick Check-In | `apps/pos-web/src/components/QuickCheckInPanel.tsx` (Existing / New / Walk-In) |
| Shared kit (new) | `apps/pos-web/src/components/OneScreenKit.tsx` — `Card`, `Empty`, `More`, `useFitRows` (moved out of the Overview screen) |
| CSS / layout | `apps/pos-web/src/styles.css` — the one-screen kit block + the "Check-In one-screen front desk" block |
| API client | `apps/pos-web/src/api/posCheckInApi.ts` (unchanged) |
| Routes | `modules/queue/src/check-in/check-in.controller.ts` (`/pos/check-in/*`, unchanged) |
| Service | `check-in.service.ts` (walk-in duplicate check, new-customer email / consent) |
| Repositories | `check-in.kysely.repository.ts` (Postgres) · `check-in.repository.ts` (port + in-memory) |
| State projection | `check-in.dto.ts` `mapToCheckInState` · new pure rules `check-in-floor.ts` (+ `check-in-floor.vitest.spec.ts`) |
| Technician signals | `modules/queue/src/queue/queue.kysely.repository.ts` `techSignals` + `queue-floor.ts` `projectOnDutyStaff` (extracted, shared with the Customer Queue) |
| Realtime | `useRealtime('check-in', reload)` + the shell's realtime status (`REALTIME_STATUS`) |

## B. Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 VIEWPORT OVERFLOW** | 1920×945: normal / busy / very busy / 200 techs scrolled **174 px**, long names **334 px**; Quick Actions below the fold. 1600×765: 44–711 px. | 0 / 0 in every state at every one-screen size (C). |
| **P1 NOT_WIRED** | Quick Actions **New Check-In and Walk-In navigated to `/check-in` — the page itself** (dead). Assign Tech → `/queue` (no sheet), Start Service → `/serving` (nothing can be started there), Add Product → the inventory list. The New Customer tab **collected an email and dropped it**; no last name, no consent. Walk-In had no Notes. Queue row "View" → `/customers` with no context. Insight actions routed by matching the server's **English text**. | New Check-In / Walk-In open the Quick Check-In tab in place; Assign Tech `/queue?assign=1`; Start Service `/queue?status=ready_for_tech`; Add Product `/tenant/inventory?add=1`. New Customer = first / last / phone / optional email / SMS consent → sent and stored (`customerEmail`, `smsOptIn` on the walk-in body). Walk-In Notes sent. A guest row opens the visit drawer (§19). Insights carry a server `route`. |
| **P1 DATA ACCURACY (fake / mock values)** | "▲ 0 % vs yesterday" was a hard-coded 0. No-Shows was a hard-coded 0. **"Techs Available" = technicians with no queue entry** (clocked-out, on-break and off-shift technicians counted as available); Load = assignments × 25 %; Specialty always "—"; Next "—". The KPI said "Next 2 hours" and the card "Next 3 hours" over the SAME list, which was every not-checked-in appointment of the day. The appointment time column was blank (a branch `HH:MM` parsed as a date). Lists showed a 20-row page as everything. | Trend vs yesterday up to the same clock time (none without a baseline). Real no-shows. Available Technicians = the on-duty projection from real signals (clock, schedule, break, block, service in progress — the Customer Queue's rule), Load = guests assigned and not yet in service, Next = Now / minutes / —, Specialty = top skills, status as text. One arriving window (180 min, late ones kept) for the KPI and the card. Times formatted in the branch zone. Every card = the rows that fit + "+N more" from the server total. |
| **P1 CHECK-IN DUPLICATION** | The idempotency key was minted **per click** and the button only disabled after a re-render — three fast taps could send three keys. | One key per attempt (kept across taps / retries, renewed after success), an in-flight guard; the server's key replay and one-active-entry index (migrations 503 / 665) unchanged. E2E: three taps → 1 request, 1 key, 1 visit. |
| **P1 TOUCH UX** | Inputs / tabs / Search 34 px, row buttons 18–20 px, table text 8.5–9.5 px, Quick Actions wrapped. Sub-components declared inside the panel remounted on every keystroke (the technician picker lost its state). | Inputs / tabs / Search 40 px, Complete Check-In 44 px, Quick Actions 44 px on one row (primary four stronger), row chips 28 px with a ≈ 40 px hit area, table 11.5 px / 29 px rows; render helpers instead of inner components. |
| **P1 REALTIME** | "● Live" was static green text. | The chip is the real realtime status; refetches keep the old values until the new ones arrive; every card keeps its box (E2E). |
| **P2 QUERY PERFORMANCE** | **Customer search read the tenant's whole directory + every paid ticket and filtered in JavaScript** (50,040 rows per search in the proof). Every walk-in read the whole directory for the duplicate check. `/state` read every customer + paid ticket for the customer mix, and loaded each appointment's labels with 3 queries per appointment (N+1). | One indexed query, top 20 (phone-shaped → phone trigram index; otherwise vi_fold name + email): **0.06–0.07 ms** on 50,000 customers. Duplicate check by the stored phone: **0.03 ms** (index scan). Customer mix: paid visits for today's check-in customers only. Appointment labels: 3 batched reads. |
| **P2 EXCESS CARD HEIGHT / EMPTY STATE** | Cards sized to content; empty states padded; `p-5` page padding; KPI 8.5 px labels. | Fixed grid budget; one-line empty states; compact padding. |
| P3 VISUAL POLISH | Faint 8.5 px labels; colour-only technician dots. | 10–11 px labels, status pills with text. |

### KPI definitions (§84 — `CHECK_IN_KPI_DEFINITIONS`)

| KPI | Definition |
|---|---|
| Check-Ins Today | Queue entries checked in on the branch's business day. Trend = vs yesterday up to the same clock time; none without a baseline. |
| Waiting Guests | Entries checked in and not yet sent to a technician (queue status `waiting`), now. |
| Walk-Ins | Of today's check-ins, `source = walk_in`. |
| Appt. Arriving Soon | Today's appointments not yet checked in starting within 180 minutes (late ones included) — the same list as the card. |
| Ready for Service | Entries sent to a technician (`assigned` / `called`) not yet in service. |
| Average Wait Time | Mean minutes waited by the guests waiting now. |
| No-Shows | Today's appointments with status `no_show`. |
| Techs Available | On-duty technicians whose real signals say available now (shown "available / on duty"). |
| Customer Return Rate | Of today's check-ins, the share with an earlier paid visit. |

## C. Before / after (real POS bundle, Chromium, fixture API `fixtures-ci.mjs`)

CSS viewport = the browser's inner size; 1920×945 = 1920×1080 at 100 % with the browser bars and the taskbar. Page box =
`100dvh − 60` (shell header).

| State | 1920×945 BEFORE (content / page / scroll) | AFTER | 1600×765 BEFORE | AFTER |
|---|---|---|---|---|
| empty | 885 / 885 / 0 | 885 / 885 / 0 | 749 / 705 / **44** | 705 / 705 / 0 |
| normal | 1,059 / 885 / **174** | 0 | 1,178 / 705 / **473** | 0 |
| busy (25 waiting · 18 arriving · 12 available · 20 insights) | 1,059 / 885 / **174** | 0 | 1,173 / 705 / **468** | 0 |
| very busy (50 waiting · 200 technicians · 1,040 check-ins) | 1,059 / 885 / **174** | 0 | 1,173 / 705 / **468** | 0 |
| 200 technicians | 1,059 / 885 / **174** | 0 | 1,178 / 705 / **473** | 0 |
| long names | 1,219 / 885 / **334** | 0 | 1,416 / 705 / **711** | 0 |

2560×1305: all six fit before and after. AFTER = **36 / 36** one-screen cells (6 states × 1920×945, 1920×1080, 1600×900,
2560×1440, 1600×765, 2560×1305); 1366×633 scrolls 131 px by design (§80 fallback). Horizontal overflow 0 everywhere.
Largest BEFORE contributors: the 64 px two-line Quick Action tiles + their heading row, cards sized to their content
(`items-start` grids), the 104 px trend chart and 88 px donuts, `p-5` page padding. Safety margin at 1920×945: the Quick
Actions end at y = 937. Raw: `tooling/checkout-one-screen/results/checkin-before/` (from a HEAD worktree, `SD_SERVER=old`)
and `results/checkin-after/measurements.json`.

## D. Final layout (1920×945 page; COMPACT)

| Region | Mandate start | Final |
|---|---|---|
| Shell header | 48–52 | **60 (unchanged)** — shared by every POS page (search, branch, language, alerts, user, Platform Announcement); changing it moves every one-screen page measured at 60 |
| KPI row (9) | 68–78 | 74 (TIGHT 68, COMFORTABLE 84) |
| Primary (queue · Quick Check-In · insights) | 150–175 | 299 (`minmax(0,1.1fr)`; TIGHT 221) — the start targets sum to ≈ 600 of 885 px, so the operational rows take the rest |
| Secondary (arriving · lounge · technicians) | 145–165 | 272 (`1fr`; TIGHT 200) |
| Analytics (4) | 120–140 | 136 (TIGHT 128, COMFORTABLE 160) |
| Quick Actions (9, one row) | 56–64 | 60 bar / 44 px buttons |
| Gaps | 6–8 | 7 (TIGHT 6, COMFORTABLE 10) |

Card header 7/12 px, body 0 12 4 px; titles 13.5 px; tables 11.5 px, 29 px rows (27 TIGHT), 10 px sticky column heads;
KPI value 19 px, label 10.5, sub-line 10. Quick Check-In scrolls inside its card (Complete Check-In 44 px). Columns use
ellipsis + the full value as the tooltip; Phone hides at TIGHT. Density (§77–§80): COMPACT ≥ 1280 wide; TIGHT ≤ 820 px high;
COMFORTABLE ≥ 2200×1200; FALLBACK ≤ 660 px high (scrolls). No `transform: scale` / `zoom`. **Sidebar** kept at 248 px —
at 175–195 px the real group labels truncate ("SERVICES & PRODUCTS", "MARKETING & GROWTH" …); rows are 40 px.
**Phone numbers** stay as the product shows them today (§76: masking is a product privacy decision — not changed).

## E–G. Functional fixes · API / backend · realtime

| Module | UI → API → service → data | Test |
|---|---|---|
| KPIs | `/pos/check-in/state` → `mapToCheckInState` ← `KyselyCheckInRepository.query` (yesterday baseline, no-shows, branch clock) | `check-in-floor` (trend, window); E2E KPI line |
| Live Check-In Queue | `activeRows` (every active check-in today) → top 8 + `totals.arrivals`; row actions move-to-queue / start-service / update-wait-estimate; tap → `GET /pos/check-in/:id` drawer | E2E "+34 more", drawer; jsdom row actions |
| Quick Check-In | `POST /pos/check-in/walk-in` (`Idempotency-Key`), service: indexed duplicate check, new-customer email + consent | E2E triple tap = 1 visit; New Customer body; jsdom submission |
| Appointments Arriving | `arrivingWithin` (180 min, late kept) → `POST /pos/check-in/appointment/:id` (canonical visit) | unit; E2E check-in + refresh |
| Waiting Lounge | waiting rows, longest wait first, top 6 + total; Assign → `/queue?assign=1`; Full View (iPad) kept | E2E "+19 more" of 25 |
| Available Technicians | `KyselyQueueRepository.techSignals` → `projectOnDutyStaff` (shared with the Customer Queue) | unit (break / serving / off shift / 200) |
| Front Desk Insights | `buildCheckInInsights` (≤ 5 shown, total, `route`) — advisory only | unit; E2E Open → `/queue` |
| Analytics | arrival trend / source mix / customer type / daily performance (server aggregates; customer mix = today's customers only) | E2E fit |
| Quick Actions | see B | E2E 9 / 9 |

Realtime: the `check-in` channel refetch is unchanged (events from check-in / queue / appointments); the Live chip now
reads the real connection state; no full reload, no scroll reset, no layout shift (E2E: card boxes identical across states).

**Files** — created: `modules/queue/src/check-in/check-in-floor.ts`, `check-in-floor.vitest.spec.ts`,
`apps/pos-web/src/components/OneScreenKit.tsx`, `tooling/checkout-one-screen/{fixtures-ci,interact-checkin}.mjs`, this doc.
Modified: `check-in.dto.ts`, `check-in.kysely.repository.ts`, `check-in.repository.ts`, `check-in.service.ts`,
`modules/queue/src/request-schemas.ts`, `modules/queue/src/queue/queue-floor.ts`, `POSCheckInScreen.tsx` (+ `.test.tsx`),
`QuickCheckInPanel.tsx` (+ `.test.tsx`), `POSOverviewScreen.tsx` (kit import), `styles.css`, `i18n/ns/ops.{en,vi}.ts`,
`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (A34), `tooling/checkout-one-screen/{server,measure}.mjs`. Deleted: none.

## PostgreSQL 16 proof (`scratchpad/ci/seed.sql` + `queries.sql` → `queries.out`; seeded and removed)

- Customer search on **50,000 customers**: phone `4242` → 15 matches, tenant X's customer with the same phone **not** in A's
  answer (0); "nguyen thi huong" finds "Nguyễn Thị Hương". The OLD path read 50,040 rows per search.
- EXPLAIN ANALYZE: phone → `idx_customers_phone_trgm` **0.06 ms**; name → BitmapOr on `idx_customers_full_name_vi_fold_trgm`
  + `idx_customers_email_trgm` **0.07 ms**; walk-in duplicate check → `ix_customers_normalized_phone` **0.03 ms**. A first draft
  that OR-ed all three got a **sequential scan once (1,044 ms)** and a BitmapOr later (0.34 ms) — so the query is split.
- Yesterday-same-time baseline 11 (10 seeded before the clock time + one that crossed it while the proof ran); no-shows 3
  (was a hard-coded 0); customer mix query 0.03 ms (grouped, today's customers only).

## J. Screenshots (`tooling/checkout-one-screen/results/`)

`checkin-after/check-in-{empty,normal,busy}-1920x1080.png`, `check-in-busy-{1600x900,2560x1440,1920x945,1366x633}.png`
(committed); BEFORE `checkin-before/check-in-busy-1920x945.png` (committed); every state × size in `checkin-after/`.

## K. Touch testing

Chromium `hasTouch`: Quick Actions 44 px, Quick Check-In tabs / inputs 40 px, Complete 44 px, row chips ≈ 40 px hit area —
**PASS (emulated)**. Physical ASUS 27-inch touchscreen — **NOT_TESTED**.

## L. Build matrix (executed evidence only)

| Gate | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS** (esbuild) | `node tooling/checkout-one-screen/build.mjs`; Vite NOT_RUN |
| TYPECHECK | **PASS (no new errors)** | shimmed backend typecheck 5,351 lines ⊂ the Overview baseline (3 fewer); pos-web `tsc` NOT_RUN |
| LINT | NOT_RUN | needs `node_modules` |
| CHECK-IN UNIT TESTS | **PASS** | `check-in-floor.vitest` 12 / 12; check-in + queue stand-in sweep = HEAD + the 12 new (same failing pgtest set on HEAD) |
| CHECK-IN INTEGRATION | **PASS (PostgreSQL 16)** | proof above |
| CHECK-IN E2E | **PASS** | `interact-checkin.mjs` 26 / 26 |
| DUPLICATE CHECK-IN | **PASS** | E2E triple tap → 1 visit; server key replay (existing pgtests NOT_RUN here) |
| TENANT ISOLATION | **PASS** | search leak 0 |
| BRANCH ISOLATION | **PASS** | every query keeps the branch scope (`scoped()`); proof queries branch-filtered |
| REALTIME | **PASS (no layout shift)** | E2E; two-station NOT_RUN |
| 1920×1080 ONE-SCREEN · NO V / H OVERFLOW · BUSY-STATE ONE-SCREEN | **PASS** | C |
| TOUCH TARGETS | **PASS (emulated)** | K |
| PLATFORM ANNOUNCEMENT | **PASS** | E2E info / long / urgent |
| CHROME | **PASS (Chromium)** | branded Chrome NOT_RUN |
| EDGE · PHYSICAL TOUCHSCREEN | NOT_RUN · NOT_TESTED | |

Open items: shell header 60 px and sidebar 248 px (decisions, D); phone masking (product decision); Avg. Check-In Time
stays "—" (nothing records check-in duration yet); VI strings A34 await review.
