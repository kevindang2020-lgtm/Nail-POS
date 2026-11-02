# OVERVIEW_ONE_SCREEN_STATUS.md — Overview 27-Inch One-Screen, Module Wiring & UX Completion (Oct 28 2026)

Mandate: `AI_PowerSalon_Overview_27in_One_Screen_Module_Wiring_UX_Completion_Mandate.pdf` (§1–§42). Branch
`merge-github-main`; commits listed in CHANGELOG_HANDOFF. **Nothing pushed** (K-12 first).

Environment (the same as for Checkout, Service Done, Serving and Customer Queue):
- sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**, TypeScript 6.0.2;
- Chromium + Playwright from `/opt/npm-tools`;
- Inter / DejaVu Serif stand in for Hanken Grotesk / Playfair Display. They are wider than the real fonts, so the fit numbers are conservative.

**Verdicts for this mandate:**
- CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**.
- PRODUCTION_READY = **NO**. Still to do on a real environment:
  - the pos-web jsdom tests (`POSOverviewScreen.test.tsx`, `.vi.test.tsx` — updated, NOT_RUN here);
  - `npm run typecheck` / lint with the real dependencies;
  - Edge and branded Chrome, the physical 27-inch touchscreen;
  - a live pilot with realtime on two POS stations.
- No migration in this mandate. No new route; no permission added (`communications.view` already existed).

---

## A. Existing Overview code found (inspected first; nothing duplicated, no "V2")

| Piece | Path |
|---|---|
| Overview page | `apps/pos-web/src/screens/POSOverviewScreen.tsx` (route `/overview`, the POS landing page) |
| Shell / layout, Top Bar, Sidebar | `apps/pos-web/src/shell/*` (`PosShell`, `header.topbar`, `tenant-nav.tsx`), `PlatformAnnouncementBar.tsx` |
| KPI cards, Arrivals, Live Tech Queue, Service Flow, Appointments, Communications, AI Insights, Revenue Trend, Technician Performance, Retention, Payment Mix, Inventory Alerts, Quick Actions | all inside `POSOverviewScreen.tsx` (`Card`, `More`, `useFitRows`, `StatusPill`, the full-list overlay) |
| Styles | `apps/pos-web/src/styles.css` — the "Overview 27-inch" block (scoped `.work.ov.overview-page`) |
| API client | `apps/pos-web/src/api/posOverviewApi.ts` — `GET /pos/overview/state`, `GET /pos/overview/board` (unchanged) |
| Backend: state (KPIs, appointments, analytics, insights) | `modules/analytics/src/overview/overview.controller.ts` → `overview.service.ts` → `overview.kysely.repository.ts` (Postgres) / `overview.repository.ts` (port + in-memory) · DTO `overview.dto.ts` |
| Backend: live board (arrivals, tech queue, flow sublists, communications, retention, inventory) | `overview-board.controller.ts` → `overview-board.service.ts` |
| Server rules (new) | `modules/analytics/src/overview/overview-floor.ts` (+ `overview-floor.vitest.spec.ts`) |
| Realtime | `apps/pos-web/src/realtime/useRealtime.ts` channel `overview`; status from `realtime-client.ts` (`REALTIME_STATUS`) |
| Authorities read | `technician_workforce_state` (on duty, migration 579), `pos_queue_items`, `tickets` / `ticket_service_lines`, `payments` (`REVENUE_BEARING_STATUSES`), `communication_threads` (Unified Inbox), `appointment_reminder_attempts`, `inventory_products` + `inventory_location_stock` (`stockStatus` from `@aipowersalon/inventory`) |

## B. Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 VIEWPORT OVERFLOW** | 1920×945: normal scrolled 183 px, busy / very busy 287, long names 282. 1600×765: every state scrolled (117–541 px). Quick Actions below the fold. | 0 / 0 in every state at every one-screen size (C). |
| **P1 NOT_WIRED / FRONTEND-ONLY** | When the board was empty the screen **derived** arrivals, the live tech queue and the flow sublists from whatever appointment rows it had loaded. Service Flow "Completed" counted completed appointments. Insights were an always-on trio ("High revenue service —", "Staff on break 0", "Inventory low 0") with no action. | The screen renders only server answers. Completed = tickets paid today. Insights come from `buildOverviewInsights` (only when there is something to say, ≤ 5, each with a route). |
| **P1 DATA ACCURACY** | Staff On Duty counted employed technicians from the legacy `technician_statuses` log (100 clocked-out technicians counted as on duty in the PG proof). Waiting Guests = `waiting` only (9 vs 18 real). Active Services counted removed tickets; Ready for Checkout counted removed / closed tickets. Minutes left used a universal 45-min default. Revenue trend skipped days with no sale (the line bent). Inventory ignored the branch overrides and archived / inactive flags. Top services / technicians counted removed lines. | Every KPI from its authority with a written definition (§28 table below); minutes left = the visit's own durations − elapsed − paused (`null` → "—"); trend filled for 7 days; inventory = Inventory's own `stockStatus` with overrides. |
| **P1 TENANT / BRANCH SCOPE** | Reminders were every branch, any day (19 rows in the proof instead of 12). Messages showed without `communications.view`. Time-of-day labels used the API server's zone. | Reminders: this branch, the branch's business day. Messages only with `communications.view` ("Messages need the Communications permission" otherwise). Branch / tenant zone via `safeZoneName`. Tenant leak 0, branch leak 0 on PostgreSQL (F). |
| **P1 REALTIME** | "Live" was static green text. | The chip is the real `realtimeStatus()` (Connected / Reconnecting / Degraded / Offline, text + colour). Events refetch in place; old values stay until new ones arrive; card boxes identical across states (E2E). |
| **P1 TOUCH UX** | 26–30 px Quick Actions, 18 px row chips. | Quick Actions 44 px (60 px bar). Row chips keep a 28 px face with a ≈ 40 px hit area (`.mini::after`), proven by a tap 5 px above the chip. |
| **P2 EXCESS CARD HEIGHT** | Cards grew with data (every arrival, every alert). | Fixed grid rows; each list shows the rows that **fit** (`useFitRows`, capped at the server top rows) + "+N more" from the server total + View All. |
| **P2 EXCESS SPACING** | 12–16 px gaps, 64 px KPI padding. | 7 px gaps (COMPACT), 6 (TIGHT), 10 (COMFORTABLE). |
| **P2 QUERY PERFORMANCE** | The board read whole lists and counted in JS. | Top-N + `count(*) OVER ()` in one statement per list; EXPLAIN in F. |
| **P2 EMPTY-STATE DESIGN** | Empty cards collapsed or showed decorative zeros. | One-line compact empty states; the same card boxes as busy. |
| **P2 ERROR STATE** | A failed `/state` replaced the whole page with an error card. | A floating alert (`role="alert"`, Retry); the grid keeps its footprint. |
| **P2 LARGE VALUES** | `$2,450,000.00` widened the KPI card. | ≥ $100,000 shows compact (`$2.45M`) with the exact amount as the tooltip (`fmtMoneyCompact`). |
| P3 VISUAL POLISH | Ellipsis missing on long names; legend amounts crowded Payment Mix. | Ellipsis + `title` everywhere; legend = method + %, amounts in the tooltip. |
| Gate-tool bug (found by this work) | `check:sql:select` treated every `BIGSERIAL` column as missing (`appointment_reminder_attempts.id`). | Added BIGSERIAL / SMALLSERIAL to its type list + a sanity assertion (`apps/api/scripts/audit-select-columns.mjs`). The column is real on PostgreSQL 16. |

## C. Before / after measurements (real POS bundle, Chromium, fixture API)

CSS viewport = the browser's inner size. 1920×945 is the mandate's 1920×1080 at 100 % zoom with the browser bars and
taskbar; 1600×765 = 1600×900 likewise; 2560×1305 = 2560×1440. The page box is `100dvh − 60` (POS header).

| State | Viewport | BEFORE content / page / scroll | AFTER content / page / scroll |
|---|---|---|---|
| empty | 1920×945 | 885 / 885 / 0 | 885 / 885 / 0 |
| normal | 1920×945 | 1,068 / 885 / **183** | 885 / 885 / 0 |
| busy | 1920×945 | 1,172 / 885 / **287** | 885 / 885 / 0 |
| very busy | 1920×945 | 1,172 / 885 / **287** | 885 / 885 / 0 |
| 200 techs | 1920×945 | 1,068 / 885 / **183** | 885 / 885 / 0 |
| long names | 1920×945 | 1,167 / 885 / **282** | 885 / 885 / 0 |
| empty / normal / busy / vbusy / 200 / long | 1600×765 | 822–1,246 / 705 / **117–541** | 705 / 705 / 0 (all six) |
| all six | 2560×1305 | 1,245 / 1,245 / 0 | 1,245 / 1,245 / 0 |
| all six | 1920×1080, 1600×900, 2560×1440 (no chrome) | not measured before | 0 / 0 (all) |
| all six | 1366×633 | — | 125 px scroll **by design** (FALLBACK density, §26: 1366 is a fallback; the page scrolls rather than shrinking text) |

Horizontal overflow: 0 before and after at every size. AFTER = 36 / 36 one-screen cells PASS (6 states × 6 viewports);
the 6 cells at 1366×633 are the documented fallback. Safety margin at 1920×945: the Quick Actions bar ends at y = 937
(8 px to the viewport bottom); the grid rows are fr-based, so the margin is the 7 px gap + page padding, not spare height.
Raw: `tooling/checkout-one-screen/results/ov-before/measurements.json`, `results/ov-after/measurements.json`.

## D. Final layout (1920×945 page; COMPACT density)

| Region | Mandate start target | Final |
|---|---|---|
| POS header (shell) | 48–52 | **60 (unchanged)** — the shared shell header of every POS page (search, branch, language, alerts, user, Platform Announcement). Shrinking it changes Checkout / Service Done / Serving / Queue, which were measured at 60; not changed here. |
| KPI row | 68–78 | 74 (TIGHT 64, COMFORTABLE 84) |
| Primary row (Arrivals · Live Tech Queue · Service Flow) | 140–160 | 291 (`minmax(0, 1.1fr)`) — the targets sum to ≈ 600 px of an 885 px page, so the two operational rows take the remaining height (§7: "starting targets, not blind constants"); TIGHT 224 |
| Secondary row (Appointments · Communications · AI Insights) | 130–150 | 264 (`minmax(0, 1fr)`); TIGHT 203 |
| Analytics row (5 cards) | 135–155 | 152; TIGHT 126; COMFORTABLE 170 |
| Quick Actions | 56–64 | 60 bar, 44 px buttons; TIGHT 52; COMFORTABLE 64 |
| Grid gaps | 6–8 | 7; TIGHT 6; COMFORTABLE 10 |

- Container (§8): `.work.ov.overview-page { height: calc(100dvh - var(--pos-header-height)); overflow: hidden; min-height: 0 }`;
  grid rows `var(--ov-kpi) minmax(0,1.1fr) minmax(0,1fr) var(--ov-ana) var(--ov-qa)`. Card bodies `min-height: 0`.
  **No `transform: scale`, no `zoom`** (measured: `scaleHacks: false`).
- Card header padding 7 / 12 px, body 0 12 4 px; card title 13.5 px serif (COMFORTABLE 15.5); table rows 29 px, 11.5 px
  text (TIGHT 27 px; COMFORTABLE 34 px / 13 px); KPI value 19 px, `line-height: 1.1` (TIGHT 17, COMFORTABLE 23), label
  10.5 px, sub-line 10 px; Quick Action labels 11.5 px bold. (Inter stands in for Hanken Grotesk — see the environment note.)
- Rows: each list renders exactly the rows that fit its fixed body at the current density (`useFitRows`: measured
  before paint and on resize, capped by the server's top rows), so "+N more" counts only what is not on screen. The E2E
  checks that no row hides behind a card's internal scroll at 1920×945 and 1600×765.
- Density (§26): COMPACT ≥ 1280 wide (the 1920 target); TIGHT when the page is ≤ 820 px high (1600×900 with chrome);
  COMFORTABLE ≥ 2200×1200; FALLBACK ≤ 660 px high (1366×768) — the page scrolls.
- Status is text + colour (pills), never colour alone. Long names truncate with ellipsis + `title`.
- **Sidebar (§23):** left at **248 px**. At 175–195 px the real group labels truncate ("SERVICES & PRODUCTS",
  "MARKETING & GROWTH", "PAYMENTS & MONEY", "DEVICES & INTEGRATIONS", "COMMUNICATIONS" — measured with
  `scratchpad/ov/sidebar.mjs`), so "if the real labels permit it" is not met. Nav rows are 40 px (§23 38–42 ✔).

## E. Functional wiring (UI → API → service → database → realtime → test)

| Module | UI | API | Service / rule | Data | Realtime | Test |
|---|---|---|---|---|---|---|
| 8 KPIs | `.ov-kpis` (button → domain page) | `/pos/overview/state` | `overview.kysely.repository.ts` | see the definitions table | `overview` refetch | `overview-floor.vitest` §28; E2E $2.45M; PG proof |
| Arrivals & Check-In | `ov-arrivals` + View All overlay ("7 of 18" + View Full Queue) | `/pos/overview/board` | `arrivals`: today, waiting / called / assigned / ready_for_tech | `pos_queue_items` | refetch | E2E "+11 more"; PG 18 |
| Live Tech Queue | `ov-techq` | board | `liveTechQueue` from serving tickets; `liveMinutesLeft` | `tickets`, `ticket_service_lines` | refetch | unit (minutes left); E2E 6 of 12; 200 techs = 6 rows |
| Service Flow | `ov-flow` stages (buttons → `/queue`, `/queue?assign=1`, `/serving`, `/checkout`, `/reports`) + 2 sublists | state + board | server counts; Completed = `checkoutToday.paidTickets` | queue, tickets, payments | refetch | E2E stage → `/checkout`; "+N more" |
| Today's Appointments | `ov-appts` (date ‹ ›, View All → `/booking`) | `/pos/overview/state?date=` | schedule preview; every status except cancelled, from the first unfinished | `pos_tech_appointments` | refetch | jsdom (NOT_RUN) |
| Communications | `ov-comms` tabs Reminders / Messages / Missed Calls | board | reminders: branch + business day; messages: `communication_threads`, unread first, `communications.view` only; missed calls: honest "not connected" | `appointment_reminder_attempts`, `communication_threads` | refetch | E2E tab counts; PG 12 / 28 |
| AI Insights | `ov-insights` (Open → route; View All) | state | `buildOverviewInsights` (advisory, ≤ 5) worded by `ops.overview.insight.<id>` | aggregates | refetch | unit 4 cases; E2E Open → `/queue`; jsdom wording |
| Revenue Trend | `ov-revenue` | state | `fillRevenueTrend` (7 days) | payments | refetch | unit |
| Technician Performance | `ov-perf` top 3 + View Leaderboard → `/tenant/reports/technicians` | state | removed lines and null technicians excluded | tickets / lines | refetch | jsdom |
| Customer Retention | `ov-retention` | board | unchanged (returning / new / inactive) | customers / visits | refetch | jsdom |
| Payment Mix | `ov-paymix` | state | `REVENUE_BEARING_STATUSES` only — failed / UNKNOWN never counted | payments | refetch | existing payment-mix spec |
| Inventory Alerts | `ov-inventory` top rows + "+N more" + View All Inventory | board | `stockStatus` with overrides, out → critical → low | `inventory_products`, `inventory_location_stock` | refetch | unit; E2E 100 alerts = rows + "+N more"; PG 23 |
| Quick Actions (9) | `.ov-qa` | — | New Check-In / Walk-In → `/check-in`; New Booking → `/booking`; Assign Tech → `/queue?assign=1`; Start Service → `/queue?status=ready_for_tech`; Take Payment → `/checkout`; Add Product → `/tenant/inventory?add=1`; Send Message → `/messages`; Open Cash Drawer → `/cash-drawer` (its own `checkout.process_payment` permission + audit) | — | — | E2E: all 9 open real routes |

### KPI definitions (§28 — also `OVERVIEW_KPI_DEFINITIONS`)

| KPI | Definition |
|---|---|
| Today's Check-ins | Queue entries checked in on the branch's business day (`pos_queue_items.checked_in_at` in the branch zone). |
| Waiting Guests | Active queue entries in waiting / called / assigned / ready_for_tech, now (the Customer Queue's "Guests Waiting"). |
| Walk-ins | Of today's check-ins, `source = walk_in`. |
| Active Services | Tickets in service now: status serving, `serving_started_at` set, `service_done_at` not set, not removed (paused included). |
| Ready for Checkout | Tickets with `ready_checkout_at` set, not paid / void / cancelled / refunded / closed, not removed — any age. |
| Today's Revenue | Payments in approved / partial / paid / captured created on the branch's business day; failed, cancelled and unresolved payments never count. Compact ≥ $100,000 (exact in the tooltip). |
| Average Ticket | Today's revenue ÷ tickets paid on the business day; 0 with no paid ticket. |
| Staff On Duty | Active technicians clocked in / on break / on shift (`technician_workforce_state`) ÷ technicians with a shift today (at least the on-duty count); sub-line = on break. |

## F. Performance, isolation (PostgreSQL 16, seeded scratch tenants, removed afterwards)

- PG proof (`scratchpad/ov/queries.sql` → `queries.out`): on duty 100 (10 on break, 20 available; old query counted 100
  clocked-out); waiting 18 (old 9); serving 12 (old 13 — counted a removed ticket); ready 8 (old 9 — counted a closed one);
  live tech top 6 / total 12; assignment 12; checkout 8; arrivals 18; reminders 12 (old population 19); messages 28 (10
  unread); inventory 23 (overrides applied, archived / inactive excluded). **Tenant leak 0, branch leak 0.**
- EXPLAIN ANALYZE: live tech queue 0.64 ms, inventory 0.16 ms, staff on duty 0.085 ms (sequential scans on small tables;
  no index added — §37 "EXPLAIN before indexes").
- Browser (`overview-announce-perf.mjs`, fixture API): **2 Overview API calls** on first load (`/state`, `/board`); largest
  payload 31.7 KB (200 techs) / 40.5 KB (very busy); KPIs painted ≈ 1.0–1.2 s, settled ≈ 1.5–1.7 s (two runs) (local bundle, no DB);
  200 technicians → 6 Live Tech Queue rows, ≈ 800 DOM nodes. Raw: `results/ov-perf/perf.json`.
- Scale (§32): 200 technicians, 1,000+ appointments, 100 inventory alerts and 300 reminders all fit; the cards show top
  rows + the server totals.

## G. Files changed

- **Created:** `modules/analytics/src/overview/overview-floor.ts`, `overview-floor.vitest.spec.ts`;
  `tooling/checkout-one-screen/fixtures-ov.mjs`, `interact-overview.mjs`, `overview-announce-perf.mjs`; this file.
- **Modified:** `modules/analytics/src/overview/overview.kysely.repository.ts`, `overview-board.service.ts`,
  `overview-board.controller.ts`, `overview.dto.ts`; `apps/pos-web/src/screens/POSOverviewScreen.tsx`,
  `POSOverviewScreen.test.tsx`; `apps/pos-web/src/styles.css`; `apps/pos-web/src/i18n/format.ts`;
  `apps/pos-web/src/i18n/ns/ops.en.ts`, `ops.vi.ts`; `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (A33);
  `docs/security/attack-surface-routes.csv` (regenerated); `apps/api/scripts/audit-select-columns.mjs` (BIGSERIAL);
  `tooling/checkout-one-screen/server.mjs`, `measure.mjs`.
- **Deleted / deprecated:** none. The screen's client-side fallbacks (arrivals / tech queue / sublists derived from
  appointments) were removed from inside the component; no file removed.

## H. Screenshots (`tooling/checkout-one-screen/results/`)

- `ov-after/overview-{empty,normal,busy}-1920x1080.png`, `overview-busy-1600x900.png`, `overview-busy-2560x1440.png`,
  `overview-busy-1920x945.png`, `overview-busy-1366x633.png` (fallback) — committed; every state × size in `ov-after/`.
- BEFORE: `ov-before/overview-busy-1920x945.png` (committed).
- Platform Announcement none / short / long / long expanded / urgent: `ov-announce/*.png` — 5 / 5 no page scroll.

## I. Touch testing

- Chromium with `hasTouch`: Quick Actions 44 px; row chips ≈ 40 px hit area — **PASS** (emulated).
- Physical 27-inch touchscreen — **NOT_TESTED**.

## J. Build matrix (executed evidence only)

| Gate | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS** (esbuild bundle) | `node tooling/checkout-one-screen/build.mjs` — the real `apps/pos-web` source; the Vite build needs `node_modules` (NOT_RUN) |
| TYPECHECK | **PASS (no new errors)** | shimmed backend typecheck: 5,354 lines = the Customer Queue baseline, identical set; pos-web `tsc` NOT_RUN (no `@types/react`) |
| LINT | NOT_RUN | `check:lint` needs `node_modules` (same baseline FAIL as before this mandate) |
| OVERVIEW UNIT TESTS | **PASS** | `overview-floor.vitest` 11 / 11; overview core 32 / 32, cache 3 / 3, schedule 2 / 2; analytics sweep 327 passed / 5 pre-existing failures (`ai-business-admin`, `owner-dashboard-business-date` — fail on HEAD too) |
| OVERVIEW INTEGRATION | **PASS (PostgreSQL 16)** | `scratchpad/ov/queries.sql` against the migrated schema (F) |
| OVERVIEW E2E | **PASS** | `interact-overview.mjs` 22 / 22 |
| TENANT ISOLATION | **PASS** | PG: leak 0 |
| BRANCH ISOLATION | **PASS** | PG: leak 0; reminders branch + day |
| REALTIME | **PASS (no layout shift)** | E2E: Live chip = real status; card boxes identical empty → very busy. A live two-station test is NOT_RUN. |
| 200-TECH PERFORMANCE | **PASS** | fit + 6 rows; 31.7 KB state; EXPLAIN 0.085 ms |
| 1920x1080 ONE-SCREEN | **PASS** | 1920×945 and 1920×1080, all 6 states |
| EMPTY / NORMAL / BUSY-STATE FIT | **PASS** | C |
| NO VERTICAL / HORIZONTAL OVERFLOW | **PASS** | 0 / 0 at every one-screen size |
| TOUCH TARGETS | **PASS (emulated)** | I |
| PLATFORM ANNOUNCEMENT FIT | **PASS** | 5 / 5 |
| CHROME | **PASS (Chromium)** | branded Chrome NOT_RUN |
| EDGE | NOT_RUN | |
| PHYSICAL TOUCHSCREEN | NOT_TESTED | |
| Regressions (shared `styles.css`, `format.ts`) | **PASS** | Checkout / Service Done / Serving / Queue measure 24 / 24; E2E 26 / 29 / 36 / 34 |
| Gates | baseline | `run-all-gates.sh`: the same 12 FAILs as before (all `node_modules`-bound); `check:sql:select` newly failed on a checker bug, fixed (0 findings); `check-silent-catch`, `check-as-any`, `check-raw-sql-inputs`, `openapi --check`, `pos-i18n`, `check-vi-glossary` PASS |

Not done (decisions / follow-ups): the 60 px shell header and 248 px sidebar (D); missed calls stay "not connected"
(nothing records caller numbers yet); VI strings A33 await review.
