# SERVING_ONE_SCREEN_STATUS.md — Serving 27-Inch One-Screen Fit, Live Service Floor, Service Progress & Module Completion (Oct 28 2026)

Mandate: `AI_PowerSalon_Serving_Claude.pdf` (150 sections). Branch `merge-github-main`; commits listed in CHANGELOG_HANDOFF.
**Nothing pushed** (K-12 first).

Environment (as for Checkout / Service Done):
- sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**, TypeScript 6.0.2;
- Chromium + Playwright from `/opt/npm-tools`;
- Inter / DejaVu Serif stand in for Hanken Grotesk / Playfair Display (wider than the real fonts, so fit numbers are conservative).

**Verdicts for this mandate:**
- CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**.
- PRODUCTION_READY = **NO**. Still to do on a real environment: the pos-web jsdom tests and the pgtests; the Kysely adapter
  run end-to-end (its SQL was verified statement by statement on PostgreSQL 16, see F); the physical touchscreen, Edge and
  branded Chrome; the live Queue → Serving → Service Done → Checkout pilot with two POS stations and the Technician App.
- No migration in this mandate.

---

## A. Existing Serving architecture found (inspected first; nothing duplicated)

| Piece | Path | Notes |
|---|---|---|
| Screen | `apps/pos-web/src/screens/POSServingScreen.tsx` | Kept every module, the retail sale + manager PIN, the change-request approvals, the revision timeline, helper / delay / move-tech, the iPad full view. Rebuilt: layout, overlays, Quick Actions, Move Stage, Add Upsell, Send Update, Staff Alert, Auto Balance. |
| API client | `apps/pos-web/src/api/posServingApi.ts` | `+ addService, notifyCustomer, staffAlert, balanceSuggestions`. |
| Controller | `modules/queue/src/serving/serving.controller.ts` | `+ GET balance-suggestions`, `+ POST staff-alert`, `+ POST tickets/:id/notify-customer`. |
| Service | `serving.service.ts` | Start / pause / resume, add / edit / remove line, retail, assign technician / helper, mark done, send to Service Done, reopen, delay, tech-app live edit. |
| Repositories | `serving.kysely.repository.ts` (Postgres) · `serving.repository.ts` (port + in-memory) | Durable state since migration 586: `tickets.serving_*`, `ticket_service_sessions`, `ticket_service_lines`. |
| Service state | `serving.dto.ts` (`SERVING_FLOW`, `servingNextActions`) · Kysely `deriveStatus` | The Serving vocabulary is a projection of `tickets.status` + the live session + the Service Done lock + the delay marker. |
| Session machine | `modules/queue/src/queue-lifecycles.ts` `TICKET_SERVICE_SESSION`, `SERVING_DELAY` | Unchanged. |
| Service Done handoff | `modules/queue/src/service-done/service-done-transition.ts` | **The one completion** (tech app, Serving Mark Ready, Serving Send). Unchanged. |
| Technician eligibility | `@aipowersalon/workforce` `TechnicianEligibilityService` | The one authority for skills / branch / certification / schedule / already-serving. Unchanged. |
| Fair Turn | `turnServiceStart` (start) / `turnServiceComplete` (completion) | Unchanged. |
| Realtime | `packages/realtime-contracts` — `service_started`, `service_paused`, `service_resumed`, `service_done`, `ticket_service_line_*` route to `serving` | Domain events via the outbox when the publisher is on. |
| Tests | `modules/queue/src/serving/*.spec.ts` (25 files, + `serving-floor.vitest.spec.ts`) · `apps/pos-web/src/screens/POSServingScreen*.test.tsx` | |

---

## B. Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 VIEWPORT OVERFLOW** | At 1920×945 the page scrolled 505 px (normal) / 607 px (busy). The analytics row and all 7 Quick Actions were below the fold; at 1600×765 three more modules were. | 0 / 0 in every state (C). |
| **P1 SERVICE STATE / CONCURRENCY (start)** | Kysely `start()` updated `serving_started_at = now()` with no guard: two stations both passed, the second **overwrote the start time** and wrote a second `service.started` + Fair Turn move. The transaction's error was **swallowed** (`.catch(() => undefined)`) and start answered success with nothing written. A second tap answered a 400. | Compare-and-set on `serving_started_at IS NULL` inside the transaction; the event and Fair Turn move only when the row moved; errors propagate; the loser / a repeat answers the same state with `duplicate: true` and no second revision / audit. |
| **P1 SERVICE DONE HANDOFF (Mark Ready / Send)** | A repeated Mark Ready answered `CANNOT_MARK_DONE`; two stations at once both recorded a revision; two concurrent Sends: one errored `ALREADY_SENT`. | Repeat / race = idempotent success (`duplicate: true`), one transition, one revision, one Service Done entry (the shared completion's `FOR UPDATE` + key in Postgres; compare-and-set in memory). |
| **P1 DUPLICATE SERVICE LINE** | Add-on insert errors were swallowed (the event was written and success answered with no line); nothing stopped the same add-on twice from two terminals. Retail insert errors were swallowed too ("sold", nothing on the bill). | `clientRequestId` → deterministic line id (§103): the second insert hits the primary key → `duplicate`. No swallow on either insert. |
| **P1 NOT_WIRED** | Start Service = a note. Move Stage = Mark Ready (no stage choice). Send Update = "not connected" note. Auto Balance Floor = refresh. Send Staff Alert = note. View Full Service Floor = refresh. Add Upsell sold only retail — no add-on **service**. Open Customer had no context. Insight actions routed to `/serving` itself. | All wired (D, E). |
| **P1 REALTIME** | "Live" was static text; Auto Refresh was a refresh button; `start` and `addService` / `editService` emitted nothing in non-outbox mode. | Live = real `realtime.status`; Auto Refresh is a real switch; the emits were added. |
| **P1 CONTROLLER** | `run()` mapped only `e.code`; `withCode()` sets `apiCode` → coded refusals reached the POS as a bare 400; a `ConflictError` dropped its code. | Maps `code ?? apiCode`; conflicts carry their registry code. |
| **P1 TECHNICIAN REASSIGNMENT HISTORY** | A mid-service reassignment rewrote `technician_id` on the **live session row** — the minutes already worked moved to the new technician. | The old session is COMPLETED (`completion_source='reassigned'`) and a new one opened, in one transaction (machine-guarded). |
| **P1 PRICE OVERRIDE** | `addService` checked `pos.serving.edit_services` for a manual price — the permission every caller of that route already has, so any desk user could price. | A manual price needs the manager override (`resolveManagerOverride` → `pos.booking.override_conflict`, audited). |
| P2 TIMING LOGIC | Kysely estimate fell back to **45 min** when lines had no duration (a universal duration, §32). The board's "Just Started" column was a hard-coded **12-minute** rule on the client. A delayed guest was counted in both Finishing and Delayed. | Estimate = the ticket's own line snapshots (none → never finishing / delayed). Columns follow the server's canonical stage; "Ready to Start" = assigned, not started. One bucket per guest. |
| P2 KPI definitions | Satisfaction `coalesce(…, 0)`; on-time 0 with nothing judged; avg time 0; add-on conversion 0 with no visit; "Completed today" counted tickets still at service_done (a guest who moved to checkout dropped out of today); Technicians Busy counted primary only over the roster; "vs 30 min ago" label on a vs-yesterday trend. | `null` → "—" + "Not enough data"; completed-today = `service_done_at` since branch midnight; busy = line-owner aware / on duty; trend label honest; null KPIs are not snapshotted. Definitions in `SERVING_KPI_DEFINITIONS`. |
| P2 ADD-ON / UPSELL | `isAddOn` was `category === 'Add-on'` in three places (the floor's own `isAddOnCategory` exists); Potential Revenue left a ready guest's add-ons out and the in-memory adapter answered 0 for three buckets. | One rule (`isAddOnCategory`); one Potential Revenue projection for both adapters (`buildFloorProjection`). |
| P2 200-TECH | The staff list was every technician on duty (100); availability treated `active` as available (§59). | 8 rows + `staffSummary` (shared `capReadyStaff`); only an authoritative status row counts as on duty. |
| P2 QUERY PERFORMANCE (N+1) | `loadAll` hydrated each ticket with 3–4 queries (a 100-guest floor ≈ 400). | `hydrateMany`: 4 batch queries for any floor size (F). |
| P2 PROGRESS BOARD | Column counts were counted from the loaded page (default 20 rows) — at 51 guests "Finishing Soon 0" while 15 were finishing. | `stageCounts` over every matched ticket. |
| P3 VISUAL / TOUCH | 8-column floor table with horizontal scroll at 800 px; 10 px text; low-contrast tones. | 5-column two-line rows (fixed layout), stronger tones, actions ≥ 40 px, Quick Actions 58 px. |
| Kept (decision) | Send Update by SMS answers `configured: false` (no provider call from Serving), as Service Done does. The app channel writes the guest's `customer_notifications` feed. | A real SMS needs a template + consent decision (Kevin). |

---

## C. Before / after measurements (real POS bundle, Chromium, fixture API)

Method: `PAGE=serving node tooling/checkout-one-screen/measure.mjs <label> <states> <viewports>` — document overflow, the
`.serving-page` container's own overflow, and whether the title, every module, all 9 KPIs and all 7 Quick Actions are painted
(`elementFromPoint`). Primary target: the 1920×945 page a 1920×1080 screen leaves after the Chrome bars and the taskbar.
BEFORE = the unchanged screen with the old server's answer (`SD_SERVER=old`: every on-duty technician, decorative 0 KPIs).

| State (1920×945 page) | BEFORE page scroll · content / page · hidden items | AFTER |
|---|---|---|
| empty | 8 px · 893 / 885 · 0 | **0 · 885 / 885 · 0** |
| normal (8 guests across every stage) | 505 · 1390 / 885 · 12 | **0 · 0** |
| busy (§86: 200 techs / 100 on duty, 40 serving, 10 finishing, 8 ready, 5 delayed, 3 ready to start) | 607 · 1492 / 885 · 12 | **0 · 0** |
| 200-tech | 505 · 1390 / 885 · 12 | **0 · 0** |
| 100 active services (§88) | 607 · 1492 / 885 · 12 | **0 · 0** |
| long names (§89) | — | **0 · 0** |

- BEFORE: 3 of 15 cells passed (1920×945, 1600×765, 2560×1305). At 1600×765 the secondary row, the analytics row and all Quick Actions were hidden; the board counted only the loaded page ("Finishing Soon 0" with 15 finishing).
- AFTER: **36 / 36** pass — 6 states × 1920×945, **1920×1080**, **1600×900**, **2560×1440**, 1600×765, 2560×1305 (`results/serving-after/`). 1366×633 (a 1366×768 screen with the bars) scrolls **145 px by design** (§129: no unusably small text; the same fallback as Checkout / Service Done).
- No `transform: scale`, no `zoom` (checked by the harness). Quick Actions 58 px at 1920 (50 tight, 62 roomy).
- Regression after the shared CSS change: Checkout 21 / 21 + E2E 26 / 26; Service Done 18 / 18 + E2E 29 / 29 (their 1366×633 cells scroll by design, as before).

**Behaviour E2E:** `node tooling/checkout-one-screen/interact-serving.mjs` → **36 / 36** (`results/serving-interact/interact.json`):
row tap fills Guest Service Details with no row / page growth · Move Stage offers only Start for a Ready-to-Start guest and
Pause · Report Delay · Mark Ready · Send for an in-service one · Mark Ready off for a never-started guest · Start → In
Service; a second tap → "Already in service", one start request · Mark Ready → Ready for Service Done · Send → one handoff ·
Add Upsell sends `serviceId` + `clientRequestId` and no price; the add-on reaches Guest Details and Potential Revenue · Send
Update by text is honest; by app posts `notify-customer` · Staff Alert reaches one technician · Open Customer carries
`customerId`; Back restores the filter and the selected guest · Live is the real state; Auto Refresh toggles · busy: no
page scroll; board counts are the server's 3 · 30 · 10 · 8 over the whole floor; staff 8 rows + "100 on duty"; delayed
shows ⚠ + text · Auto Balance recommends 2 and assigns nothing until a person taps Assign (one request) · a note does not
move the layout · touch: Quick Actions 58 px, guest actions 40 px, nothing visible under 30 px · scrolling sends no action
· empty: compact empty state, 6 contextual actions off, "Not enough data" KPIs · 100 rows stay in the panel (internal
scroll 1,970 px), View Full Service Floor shows all 100 · long names keep 43 px rows.

---

## D. Final layout (1920×945 page; COMPACT density)

| Row | Height |
|---|---|
| POS header (shell) | 60 (unchanged) |
| Title + search / service / timing / status filters + Live + Auto Refresh + Refresh | 42 (one row, §74) |
| KPI row (9) | 68 |
| Primary: Live Service Floor · Service Progress Board · AI Service Insights | ~1.12 fr (~290) |
| Secondary: Technician Service Performance · Guest Service Details · Available / Finishing Technicians | ~1 fr (~258) |
| Analytics: Service Time Trend · Service Mix · Add-On Mix · Completion Funnel · Potential Revenue | 124 |
| Quick Actions (7) | 58 |
| Gaps / padding | 7 / 8–12 |

- Columns 1.2 / 1.5 / 1 fr (the shared `.sd-main` grid — Service Done's, reused, not copied).
- Live Service Floor: 43 px two-line rows — guest over technician(s) · service over add-ons · stage chip · elapsed / estimate over start time · Manage. Below 1500 px the service column steps aside and the guest's second line carries the service.
- Density modes (shared `co-*` variables; `.serving-page` added to the shared selectors): COMFORTABLE ≥ 2200×1200 · COMPACT 1920 · TIGHT ≤ 820 px high · FALLBACK ≤ 660 px high (page scrolls by design, §129). No `transform: scale`, no `zoom`.
- Overlays (the page never grows): View Full Service Floor (100 rows), Manage (delay / helper / sell product / full view), Move Stage (legal next states only), Add Upsell (add-on service · retail product), Send Update, Send Staff Alert, Auto Balance, View All insights.
- Loading = the board's own skeleton (same modules); a load error stays in the floor panel with Retry; a refresh error is a floating note (§123–§124).

---

## E. Service state model, multi-technician handling, add-on flow

**Canonical states** (`SERVING_FLOW`, a projection derived in `deriveStatus`): `not_started` (accepted, assigned, no
`serving_started_at`) → `in_service` ⇄ `paused`; `in_service` → `delayed` (reported or derived) → `in_service` (cleared);
`in_service | paused | delayed` → `completed` (Mark Ready = the shared Service Done completion) → `sent_to_service_done`
(locked). `completed | sent_to_service_done` → `in_service` **only** through the audited Reopen (reason required).
Invalid: not started → Service Done (`CANNOT_MARK_DONE` / `CANNOT_SEND_TO_SERVICE_DONE`); completed → Start
(`SERVICE_START_STATE_INVALID`). Terminal for Serving: `sent_to_service_done` (Service Done / Checkout own it from there).

**Move Stage (§31)** shows `allowedActions` from the server: status ∩ workflow settings (pause allowed) ∩ the user's
permissions (`SERVING_ACTION_PERMISSION`). Drag-and-drop is not offered (§29 "if supported"); a tap only selects (§114).

**Finishing Soon (§32)** = elapsed ≥ 0.85 × the ticket's own estimate (sum of its line duration snapshots; an add-on adds
its duration, so delay re-computes, §95). **Delayed (§33)** = reported, or elapsed > estimate + `delayAlertMinutes` (10)
(`deriveDelayStatus` late / critical). Shown with ⚠ + "Delayed" text + colour (§34).

**Start validation (§24):** tenant / branch from the session; `pos.serving.start`; the ticket exists in scope; an assigned
technician (`TECHNICIAN_REQUIRED`); eligibility (skills, certification, branch, employment) through the one authority; not
already serving elsewhere (service check + the 586 partial unique index); start from not started / paused only.

**Ready for Service Done (§35–§38):** Mark Ready = `completeServiceDone` (transactional, `FOR UPDATE`, idempotent key,
commission stamped, Fair Turn complete, `service.completed` outbox). It moves the same ticket — no new visit, no new line.

**Multi-technician (§44–§45, §90–§92):** each line keeps its own `technician_id` (an add-on's owner is the technician picked
in Add Upsell, eligibility-checked for that service). The floor shows every technician on the visit (`technicianNames`).
Load is per technician per open line (`servingTechnicianLoad`): a technician whose own lines are done carries no load while
the guest stays in Serving with another. A line marked done never completes the visit (unit-tested); the visit completes
only by Mark Ready (no partial handoff — policy unchanged; decision listed below).

**Add-on / upsell (§46–§53, §93):** catalog lookup (`serviceCatalog`, tenant / branch scoped) → `pos.serving.edit_services`
→ price from the catalog (a manual price needs the manager override) → line owner → duration added to the estimate →
`ticket.service_line_added` (outbox) / realtime → Potential Revenue (Add-Ons Pending), Add-On Mix, Upsell Revenue move.
Retail stays its own line kind (`line_kind='retail'`, no duration). §94 appointment protection: the eligibility service's
schedule-conflict check applies to an add-on technician; the added duration's effect on that technician's NEXT appointment
is not checked yet (NEXT_STEPS).

**Decisions for Kevin:** (1) SMS for Send Update (template + consent); (2) partial handoff (one technician done, another
serving) — not allowed today; (3) whether Auto Balance may ever execute automatically (today: recommend only).

---

## F. Concurrency, realtime, permissions, isolation, performance

| Action | Protection |
|---|---|
| Start Service | CAS `serving_started_at IS NULL` in the start transaction + one live session per technician (partial unique index) |
| Move Stage (pause / resume / delay) | `serving_paused_at` guarded UPDATEs; session moves through `TICKET_SERVICE_SESSION`; delay through `SERVING_DELAY` |
| Add Upsell | deterministic line id from `clientRequestId` → primary key |
| Mark Ready / Send | the shared completion (`FOR UPDATE` + completion key) |
| Line edits | `expectedVersion` (`TICKET_CHANGED_RELOAD`), Service Done lock |
| Technician reassignment | eligibility (skill / branch / schedule / already serving) + session close / open in one transaction |

**Verified on PostgreSQL 16 (`fst_conc`, raw SQL equal to the adapter's statements):**
- two sessions start the same guest: A updates 1 row and holds it 2 s; B blocks, re-checks, **UPDATE 0**; one start time;
- the same add-on line id twice → `23505 ticket_service_lines_pkey` (one line);
- reassignment: Bea's session `COMPLETED / reassigned`, Amy's `STARTED`; Amy then refused a second live primary session (`uq_ticket_service_sessions_one_active_per_tech`);
- floor read with Ready-to-Start (accepted + technician) rows; `customer_notifications` insert; branch / tenant mismatch → 0 rows;
- `EXPLAIN ANALYZE` floor query: index scan `idx_tickets_tenant_branch`, 0.027 ms. **Index audit (§110–§111):** tenant / branch / status / technician / ticket / `service_done_at` are indexed (tickets ×12, lines ×8, sessions ×5); nothing was slow, so no index was added.

**Realtime:** `service.started / paused / resumed / completed`, `ticket.service_line_*` (outbox → realtime, tenant room, ids
only; the Customer App ticket room for line changes). Snapshot → subscribe → safety sync; Auto Refresh off = no refetch on
events. The Technician App reads `technician_notifications` (Staff Alert) on its own refresh — it subscribes to no notification event.

**Permissions (§98):** start `pos.serving.start`; pause / resume `pause_resume`; delay `report_delay`; Mark Ready
`mark_done`; send `send_to_service_done`; add-on / retail `edit_services` (+ manager override for a manual price); move
technician `assign_technician` (+ override); Staff Alert `assign_technician`; Send Update `pos.communications.send`;
corrections (reopen) `send_to_service_done` + reason; all audited.

**Performance (counted from code, not timed):** floor read = 4 hydrate queries + ~12 fixed (was 3–4 per ticket + ~12);
staff payload 8 rows (was every on-duty technician); floor page 50 rows (full floor 100 in the overlay). **NOT_RUN:** API /
stage-transition / add-on / realtime latency, browser memory (need the built API).

---

## G. Screenshots (`tooling/checkout-one-screen/results/`)

- 1920×1080 (1920×945 page): `serving-after/serving-{empty,normal,busy,tech200,q100,long}-1920x945.png`
- 1600×900: `serving-after/serving-busy-1600x765.png` · 2560×1440: `serving-after/serving-busy-2560x1305.png`
- BEFORE: `serving-before/serving-*-1920x945.png`

---

## H. Build matrix (executed evidence only)

| Validation | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS (stand-in)** | `build.mjs` (esbuild, 650 inputs). `vite build` NOT_RUN (no node_modules). |
| TYPECHECK | **PARTIAL** | Shimmed backend typecheck vs baseline: only +1 TS7006 (an untyped `trx` callback — shim effect) in `serving.kysely.repository.ts`; the port types updated; a TS2322 from the Service Done commit fixed. pos-web `tsc` NOT_RUN (no `@types/react`). |
| LINT | **NOT_RUN** | eslint not installed. |
| SERVING UNIT TESTS | **PASS** | `serving-floor.vitest.spec.ts` **25 / 25**; serving-core 102 / 102; addon, ontime, analytics specs updated to the null / "Ready to Start" definitions. Queue stand-in sweep: **1011 passed / 94 failed** = the earlier 986 / 94 (same files, same counts — stand-in limits) + the 25 new. |
| INTEGRATION TESTS | **PARTIAL** | Serving SQL on PostgreSQL 16 (F). pgtests NOT_RUN (no PGlite); the stand-in cannot run Kysely's builder. |
| E2E TESTS | **PASS** | `interact-serving.mjs` 36 / 36; `measure.mjs` 36 / 36. |
| START SERVICE | **PASS** | unit + E2E. |
| START IDEMPOTENCY | **PASS** | unit ×3, E2E double tap. |
| SERVICE STATE TRANSITIONS | **PASS** | `SERVING_FLOW` / `servingNextActions` unit; server refusals unit; Move Stage E2E. |
| DELAYED SERVICE LOGIC | **PASS (unit + E2E display)** | `deriveDelayStatus` (existing tests) + indicator E2E. |
| FINISHING SOON | **PASS (unit)** | own-estimate rule; no universal duration. |
| ADD-ON / UPSELL | **PASS** | unit (price, owner, duration, revenue, mix, duplicate) + E2E. |
| MULTI-TECH SERVICE | **PASS (unit)** | per-line ownership, `technicianNames`. Live pilot NOT_RUN. |
| PARTIAL COMPLETION | **PASS (unit)** | line done ≠ visit done; owner load freed. |
| MARK READY | **PASS** | unit ×2 + concurrent; E2E. |
| SERVICE DONE HANDOFF | **PASS** | one completion (unchanged), Send ×2 / concurrent → one handoff. |
| VISIT DEDUPLICATION | **PASS (design + unit)** | the same visit id moves; no visit is created. |
| SERVICE-LINE DEDUPLICATION | **PASS** | unit + PostgreSQL 16 primary key. |
| CONCURRENT START | **PASS** | PostgreSQL 16 two sessions + unit `Promise.all`. |
| CONCURRENT STAGE CHANGE | **PASS (unit + guards)** | Mark Ready / Send race unit; pause / resume guarded UPDATEs; line edits `expectedVersion`. Two-station pilot NOT_RUN. |
| TENANT ISOLATION | **PASS** | unit (start / add-on / staff alert / state) + SQL 0 rows. |
| BRANCH ISOLATION | **PASS (code + SQL)** | `scoped()` on every read / write; SQL 0 rows for another branch. Live multi-branch pilot NOT_RUN. |
| REALTIME | **PASS (floor)** | Live state, Auto Refresh, emits on start / lines. Cross-station latency NOT_RUN. |
| TECHNICIAN APP UPDATE | **NOT_RUN** | needs the built API + tech-web (unchanged paths: sessions, notifications). |
| 200-TECH PERFORMANCE | **PARTIAL** | payload capped, N+1 removed, EXPLAIN 0.027 ms. API timing NOT_RUN. |
| 1920x1080 ONE-SCREEN | **PASS** | C. |
| NO VERTICAL PAGE OVERFLOW | **PASS** | C (1366×633 by design). |
| NO HORIZONTAL PAGE OVERFLOW | **PASS** | C. |
| BUSY-STATE FIT | **PASS** | C. |
| TOUCH TARGETS | **PASS** | E2E touch checks. |
| EDGE | **NOT_TESTED** | |
| CHROME | **PASS (Chromium)** | branded Chrome NOT_TESTED. |
| PHYSICAL TOUCHSCREEN | **NOT_TESTED** | |
| Repo gates | **PASS for every gate this touches** | silent-catch, as-any, mass-assignment, state-transitions, error-text, raw-sql-inputs, event-producers, realtime-catalog, money, pos-i18n, vi-glossary, openapi (manifest regenerated, +3 routes), attack-surface (regenerated); DB gates 0 on real Postgres. Remaining failures = the BLOCKED_DEPENDENCY set (lint, api-contract, strict-bodies-types, architecture TS 6 line, frontend builds, app types). |
| pos-web jsdom tests | **NOT_RUN** | not installed; the existing selectors (Manage → Report Delay / Clear Delay / Apply Helper in a `tr`, "No active services.", Change History, Send to Service Done) were kept. |

## Permanent rules (§148)

Serving is a one-screen live service-floor workspace. The backend is the service-state authority: Start is idempotent,
timing is server truth, stages follow the canonical flow and invalid jumps are refused. Serving never duplicates a visit or
a line; multi-technician work keeps line ownership; partial completion does not complete the visit. Mark Ready hands off to
Service Done — it is not Checkout. Add-ons use the catalog, price, permission and ownership rules and move the estimate.
AI insights are advisory; Auto Balance recommends and a person assigns. Potential revenue is not settled revenue. No
payroll data. 200 technicians are a capped panel. High-volume data stays inside fixed panels. Tenant and branch data
never leak. Realtime updates the floor without a page refresh. Touch targets stay finger-friendly.
