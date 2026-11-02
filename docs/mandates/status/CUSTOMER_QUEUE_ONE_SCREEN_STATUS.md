# CUSTOMER_QUEUE_ONE_SCREEN_STATUS.md — Customer Queue 27-Inch One-Screen Fit, Guest Flow, Assignment & Module Completion (Oct 28 2026)

Mandate: `AI_PowerSalon_Customer_Queue_Claude.pdf` (110 sections). Branch `merge-github-main`; commits listed in
CHANGELOG_HANDOFF. **Nothing pushed** (K-12 first).

Environment (the same as for Checkout, Service Done and Serving):
- sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**, TypeScript 6.0.2;
- Chromium + Playwright from `/opt/npm-tools`;
- Inter / DejaVu Serif stand in for Hanken Grotesk / Playfair Display. They are wider than the real fonts, so the fit numbers are conservative.

**Verdicts for this mandate:**
- CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**.
- PRODUCTION_READY = **NO**. Still to do on a real environment:
  - the pos-web jsdom tests and the queue pgtests;
  - `npm run typecheck` / lint with the real dependencies;
  - the physical touchscreen, Edge and branded Chrome;
  - the live Check-In → Queue → Tech Queue → Serving pilot with two POS stations and the Technician App.
- No migration in this mandate. The durable idempotency columns already existed (migrations 026 / 503 / 665); the code now uses them.

---

## A. Existing Customer Queue architecture found (inspected first; nothing duplicated)

| Piece | Path | Notes |
|---|---|---|
| Screen | `apps/pos-web/src/screens/POSQueueScreen.tsx` | Rebuilt the layout, overlays, Quick Actions and profile actions. Kept every feature: parties, drag / Move up-down reorder, manager locks, VisitPlanPanel / PartyPlanPanel (split visits), the assign sheet, change requested technician, Auto Balance preview → apply, Guest declined, Unassign, Cancel with a reason, history, membership chips, the iPad full view, the override-reason flow, the conflict messages, and the `?assign=1` / `?status=` deep links. |
| API client | `apps/pos-web/src/api/posQueueApi.ts` | Added `updateServices`. |
| Controller | `modules/queue/src/queue/queue.controller.ts` | Routes unchanged. `run()` now maps the coded refusals (see B). |
| Service | `queue.service.ts` | Exact-skill eligibility goes through the workforce authority. Best Match and Auto Balance come from the AI engine (`QUEUE_RECOMMENDER`). Fair Turn is used through `@aipowersalon/workforce` (`turnAssign` and the related functions). |
| Repositories | `queue.kysely.repository.ts` (Postgres) · `queue.repository.ts` (port + in-memory) | `setStatus` is a compare-and-set through the `QUEUE_ITEM` machine. The batched `loadAll` is used. |
| Server projection (new) | `modules/queue/src/queue/queue-floor.ts` | A pure projection, shared by both adapters. It holds the flow board, the priority panel, the technician panel, the insights, `waitLevel` and `QUEUE_KPI_DEFINITIONS`. |
| Canonical walk-in | `modules/queue/src/check-in/*` · `apps/pos-web/src/components/QuickCheckInPanel.tsx` · `screens/POSWalkInScreen.tsx` | `POST /pos/check-in/walk-in` takes an idempotency key (`check_in_idempotency_key`, migration 665) and enforces one active entry per guest (migration 503). The queue now uses it. |
| Technician signals | `queue-signals.ts` `computeTechSignals` + the Kysely `techSignals` | Reads clock-in, schedule, breaks, blocks, appointments and services in progress. These are the same inputs Fair Turn and the engine read. |
| Tests | `modules/queue/src/queue/*.spec.ts` (+ the new `queue-floor.vitest.spec.ts`) · `apps/pos-web/src/screens/POSQueueScreen*.test.tsx` | |

---

## B. Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 VIEWPORT OVERFLOW** | At 1920×945 the page scrolled 436 px (normal), 433 (busy) and 1,042 (long names). The analytics row and all 8 Quick Actions were below the fold. At 1600×765, 17 items were hidden. | 0 / 0 in every state (C). |
| **P1 ROW EXPANSION** | Manage expanded the row in place (an inline `<tr>` drawer) and pushed the page down. | Manage is a fixed overlay. A row tap only selects (§19). |
| **P1 FRONTEND-ONLY STATE (board)** | The Flow Board stage was derived in the browser from wait minutes ("Arrived" under 3 min, "Lounge", "Ready for Assignment" at ≥ 24 min or high / VIP). It counted only the 20 loaded rows. | Columns are the canonical statuses (waiting · called · assigned · ready for service · sent to Tech Queue). The counts and first rows come from the server (`flow`) and cover the whole queue (§20). |
| **P1 PRIORITY RULE INVENTED** | The priority panel was sorted in the browser: VIP above Urgent, then wait, top 5 of the loaded page. The server's policy (`rankQueue`: urgent > vip > high > normal when `vipPriorityEnabled`, then the longest wait) was not used. | The server's `rankQueue` order is used, with ties broken by check-in time, then id. It covers the whole waiting population, shows the top 8 plus counts per level, and View All (§22). |
| **P1 PRIORITY OVERRIDE** | Raising a guest above Normal needed no reason. | A reason is required to raise above Normal (`PRIORITY_REASON_REQUIRED`, new registry code + EN / VI text). It is written to the history / audit row. Lowering back to Normal needs no reason (§23). |
| **P1 IDEMPOTENCY (Start Service / Send to Tech Queue)** | The "already moved" keys lived in **in-process Maps**. After an API restart, or on a second replica, a repeat tap answered "Cannot start service" (`ALREADY_IN_SERVICE`). The concurrent loser of the status compare-and-set got a 400. | The keys are now the persisted columns (`serving_idempotency_key` / `tech_queue_idempotency_key`). A guest who is already in service / in the Tech Queue answers the existing ticket / hand-off with `duplicate: true`. The concurrent loser re-reads and answers duplicate (§32, §53, §55). |
| **P1 DUPLICATE ACTIVE ENTRY** | `queue.create()` let the active-entry unique index surface as a 500. | A unique violation returns the entry that already exists (`duplicate: true`). The UI's Add to Queue uses the canonical walk-in check-in, which uses one idempotency key per submit (§53, §76). |
| **P1 NOT_WIRED / DEAD CONTROLS** | Assign Tech = a no-op. Add to Queue = the assign sheet (no guest was ever added). View Customer = `/customers` with no context. Add Note = a note. Profile Call / Add Note / Add Upsell = notes; Move Queue = a no-op. View Full Queue / View All Waiting = `load({})` (cleared the filters). Insight actions routed to `/queue` itself. **New Walk-In went to `/checkin` — no such route; it fell back to Overview.** | All wired (D). New Walk-In → `/booking/walk-in` (the canonical walk-in screen, `posCheckInApi.walkIn`). |
| **P1 SEND WAIT ALERT** | It sent `channel: 'sms'`, which is answered `configured: false`. The app channel only stamped `customer_notified_at` and delivered nothing. | Send Wait Alert → the Customer App through the push dispatch the queue already uses for Call Next. The result says delivered / not delivered honestly. A guest without the app is not reported as alerted (§56). SMS is unchanged (not configured). |
| **P1 CONTROLLER** | `run()` mapped only `e.code`. `withCode()` sets `apiCode`, so 46 coded refusals reached the POS as a bare English 400. | Maps `code ?? apiCode` with the registry status (e.g. `CANNOT_START_SERVICE` 409, `QUEUE_ITEM_NOT_FOUND` 404). |
| **P1 REALTIME** | "Live" was static green text. Auto Refresh was a one-shot reload that dropped the source and service filters. | Live = the real `realtime.status`. Auto Refresh is a persisted switch: realtime events refetch only while it is on (§46–§49). |
| **P2 KPI definitions** | Avg Wait showed a decorative `0` when nobody waited. Return Rate was `0 %` with no identified customer (and always 0 in the in-memory adapter). Est. Queue Revenue ignored approved price overrides. The queue trend was bucketed in the **API server's** hour, not the branch's. | `null` → "—" + "Not enough data". Revenue = override ?? catalog, labelled "Projected — not yet earned". The trend uses the branch time zone. All definitions are in `QUEUE_KPI_DEFINITIONS` (below). Null KPIs are not snapshotted for trends. |
| **P2 200-TECH** | The staff list was **every** technician (`available` = `status === 'active'`); a 200-technician roster sent 200 rows. The in-memory adapter returned `staff: []`. | The on-duty projection comes from the real signals: off shift and blocked are excluded; Available is in Fair Turn rotation order, then Finishing Soon (≤ 15 min), Busy and Break. The panel shows the top 8 plus `staffSummary` for the whole roster. Both adapters (§25–§29). |
| **P2 INSIGHTS** | "Upsell opportunity" was a fabricated regex on service names containing "pedicure". The peak insight's action was Auto Balance. | Advisory insights, at most 5 in a fixed order: the longest-delayed guest, a VIP waiting, guests without a technician while some are free, appointment guests at no-show risk, and the peak hour. They open a guest, the assign sheet or the Auto Balance **preview**. They never change the queue themselves (§21). |
| **P2 WAIT TIME** | The wait colour and "delayed" were browser thresholds. | `waitLevel` comes from the server (waited > average service time, the Delayed KPI's own rule). It shows as ⚠ + red text + an accent bar, not colour alone (§36). |
| **P2 QUEUE NUMBERING** | `Q-###` counted **down** from the page length: the first guest in line was "Q-020". | `Q-001` = first in the server's order, offset by the page. |
| **P2 OVERLAY REMOUNT (also Serving and Service Done)** | The overlay box was declared *inside* the screen, so it was a new component type on every render. React remounted it on every keystroke, and a text field inside kept **one letter**. Proven in Chromium on the Serving staff alert: typed "Please come to station 4" → kept "P". The Serving and Service Done screens shipped earlier today had this bug. | The overlay box is a module-level component in Queue, Serving and Service Done. The E2E scripts now type key by key: Serving staff alert, Service Done note / upsell reason, Queue note. Checkout's overlay has no text fields, so it was left unchanged. |
| P3 VISUAL / TOUCH | 10 px rows, 9–24 px buttons, 8.5 px board text. | 41 px rows, actions ≥ 32 / 40 px, Quick Actions 58 px, board text 10–11 px. |
| Kept (decision) | SMS for wait alerts is still `configured: false` (no provider call from the queue). | A real SMS needs a template + consent decision (Kevin). |

**KPI definitions (`QUEUE_KPI_DEFINITIONS`, §15).** All are computed by the server over the whole branch queue, never from the loaded rows:
- **Guests Waiting:** active entries in waiting / called / assigned / ready_for_tech, as of now.
- **Walk-Ins:** the walk-in entries of that population.
- **VIP Guests:** entries marked VIP or with priority vip.
- **Ready for Assignment:** waiting or called entries with no technician.
- **Avg Wait:** the mean of (now − checked_in_at), in whole minutes; null when nobody is waiting.
- **Est. Queue Revenue:** projected, not earned. Each requested line's approved override, else its catalog price; cancelled and removed visits are excluded.
- **Ready for Service:** entries that are assigned or ready_for_tech.
- **No-Show Risk:** appointment entries that have waited longer than max(15 min, the average service time).
- **Return Rate:** the share of the identified waiting customers with at least one prior paid visit; null when there is nobody to measure.

---

## C. Before / after measurements (real POS bundle, Chromium, fixture API)

**Method.**
- Command: `PAGE=queue node tooling/checkout-one-screen/measure.mjs <label> <states> <viewports>`.
- It measures the document overflow, the `.customer-queue-page` container's own overflow, and whether the title, all 13 modules, all 9 KPIs and all 8 Quick Actions are painted (`elementFromPoint`).
- Datasets come from `fixtures-cq.mjs` and are stateful:
  - empty;
  - normal (10 guests across every stage);
  - **busy (§63):** 100 active records (50 waiting, 20 called = ready for assignment, 15 assigned, 10 ready for service, 5 in service), 5 VIP / urgent, 200 technicians with 100 on duty;
  - tech200;
  - q250 (§67: 250 records);
  - long names (§66).
- BEFORE is the unchanged screen with the old server answer (`SD_SERVER=old`: every technician, decorative 0 KPIs, no projection).

**BEFORE vs AFTER, at the 1920×945 page:**
- **empty:** before 0 · 885 / 885 · 0 hidden. After: 0 · 0.
- **normal:** before **436** · 1,321 / 885 · 14 hidden. After: **0 · 885 / 885 · 0**.
- **busy (§63):** before 433 · 1,318 / 885 · 14 hidden. After: **0 · 0**.
- **200-tech:** before 436 · 14 hidden. After: **0 · 0**.
- **250 records (§67):** before 439 · 14 hidden. After: **0 · 0**.
- **long names (§66):** before **1,042** · 1,927 / 885 · 17 hidden. After: **0 · 0**.

Before values are page scroll in px · content / page height · hidden items.

- **BEFORE:** 7 of 18 cells fit: empty at 1920×945 and 2560×1305, and four 2560×1305 cells. Every 1600×765 cell hid 8–17 items. The harness also counted "Live Customer Queue" as missing in every BEFORE cell, because its heading carried the count in the same element. That is a matching artifact and is not counted above.
- **AFTER:** **36 / 36** pass — 6 states × 1920×945, **1920×1080**, **1600×900**, **2560×1440**, 1600×765 and 2560×1305 (`results/queue-after/`).
  - 1366×633 (a 1366×768 screen with the bars) scrolls **145 px by design**, like Checkout, Service Done and Serving (§83: 1366 is a fallback; the panels keep a usable height rather than shrinking text).
  - No `transform: scale` and no `zoom` (the harness checks).
  - Quick Actions are 58 px at 1920, 50 px tight and 62 px roomy.
- **Regression after the shared CSS / overlay change:**
  - Checkout 12 / 12 + E2E 26 / 26;
  - Service Done 12 / 12 + E2E 29 / 29 (now typed key by key);
  - Serving 12 / 12 + E2E 36 / 36 (now typed key by key).

**Behaviour E2E:** `node tooling/checkout-one-screen/interact-queue.mjs` → **34 / 34** (`results/queue-interact/interact.json`):
- **Normal queue:** no page scroll and Quick Actions inside the viewport. A row tap fills the profile with no row, panel or page growth. Rows are 41 px. Manage = an overlay (the row stays 41 px).
- **Priority:** a raise without a reason is refused; with one, it is sent.
- **Start Service:** off for a guest with no technician (it says why); on an assigned guest, one server-validated start.
- **Other Quick Actions:**
  - Assign Tech opens the sheet for the selected guest.
  - Send Wait Alert posts the app notification and reports the result.
  - Add Note: typed key by key, it keeps all 57 characters. It is saved with PATCH, and `<img onerror>` renders as text (no injection).
  - Add Upsell adds a catalog add-on through update-services.
  - Add to Queue = the canonical walk-in check-in. A double tap makes one request and one visit, and the count goes 8 → 9.
- **Navigation:** View Customer opens `/customers?q=…&customerId=…`, and Back keeps the search and the selected guest. Open Queue Report → `/reports`; New Walk-In → `/booking/walk-in`.
- **Live / refresh / conflicts:** Live = the realtime state; Auto Refresh toggles and persists. A stale assign (another device moved the guest first) is refused with 409 and explained. No page errors.
- **Busy:**
  - The board shows the server counts 50 · 20 · 15 · 10 · 0.
  - Priority = the server order (Urgent before VIP), with "5 urgent · 5 VIP · 8 high · 77 normal".
  - 95 rows stay inside the panel (internal scroll 1,880 px); View Full Queue shows 95, and View Full Board shows 95 cards.
  - 200 technicians → 8 rows + "100 on duty".
  - Insights: top 4. Open selects that guest and changes nothing.
  - Auto Balance previews and assigns only on Apply, with the expected versions.
  - Still one screen.
- **Empty:** a compact empty state; 5 contextual actions off; "Not enough data" for Avg Wait and Return Rate; a contextual action with no guest says "Select a guest in the queue first."
- **Long names:** rows stay 41 px.
- **Touch:** Quick Actions 58 px, profile actions 40 px, filters 38 px.

---

## D. Final layout (1920×945 page; COMPACT density)

| Row | Height |
|---|---|
| POS header (shell) | 60 (unchanged) |
| Title + search / service / source / status filters + Live + Auto Refresh + Refresh | 42 (one row, §43) |
| KPI row (9) | 68 (§11: 64–74) |
| Primary: Live Customer Queue · Queue Flow Board · AI Queue Insights | ~1.12 fr (~287) |
| Secondary: Waiting Guests by Priority · Customer Profile Preview · Available Technicians for Queue | ~1 fr (~255) |
| Analytics: Queue Trend · Customer Type Mix · Visit Source Mix · Top Waiting Services · Queue Conversion · Potential Revenue by Queue | 124 (§11: 115–135) |
| Quick Actions (8) | 58 (§11: 54–62) |
| Gaps / padding | 7 / 8–12 |

- **Structure (§109).** The existing modules and their names are kept; the page is the same structure made smaller and wired. It is on the shared shell: `.customer-queue-page` was added to the Checkout / Service Done / Serving selectors, and the columns are 1.5 / 1.3 / 0.92 fr.
- **Live Customer Queue.** 41 px two-line rows:
  - `Q-###` · guest over service · type · requested technician · wait · priority · status · row action + Manage;
  - narrower screens: below 1700 px the type and requested-technician columns move to the guest's second line, and below 1500 px the status column steps aside (the board and the profile carry it);
  - the panel holds 50 rows; View Full Queue pages the rest (100 at a time).
- **Density modes** use the shared `co-*` variables:
  - COMFORTABLE ≥ 2200×1200;
  - COMPACT at 1920;
  - TIGHT ≤ 820 px high;
  - FALLBACK ≤ 660 px high, where the page scrolls by design.
- **Overlays** (the page never grows): Manage (assign / priority + reason / unassign / guest declined / cancel + reason / Move up-down / history / lock / per-service plan / iPad view), View Full Queue, View Full Board, View All Waiting Guests, View All insights, the Auto Balance preview, Add to Queue (canonical check-in), Add Note, Add Upsell, and the visit / party plan editors. The assign sheets keep their own sheet.
- **Loading and errors.** Loading shows the board's own skeleton (the same modules). A load error stays in the queue panel with Retry; a refresh error is a floating note (§80).

---

## E. Guest flow, assignment, eligibility, priority

**Canonical flow (§4, `QUEUE_ITEM` machine, unchanged):**
1. waiting
2. called
3. assigned
4. ready_for_tech
5. moved_to_tech_queue (Tech Queue) or in_service (Serving)

Cancel and remove need a reason; both keep the history. The board shows the first five as columns, with the server's counts. Invalid jumps are refused by the machine, and `setStatus` is a compare-and-set.

**Assignment flow (§30–§35):**
1. The front desk picks a technician (the sheet / Manage), or the AI engine's Best Match / Auto Balance preview.
2. The request carries `expectedTechnicianId` + `expectedVersion` (what this board showed).
3. The server re-validates:
   - exact-service eligibility through the workforce authority, per service for a multi-service visit;
   - lock and Fair Turn: a non-recommended choice needs an override reason, unless MANUAL mode;
   - version.
4. One success; a stale board gets 409 `VERSION_CONFLICT` or `ASSIGNMENT_LOCKED`, explained in plain words with a refresh.
5. Then Send to Tech Queue or Start Service. Both are idempotent and backed by the durable keys.

A split visit is assigned as a whole plan (`plans/assign`). Appointment protection is the existing engine / eligibility check. It is unchanged and was not re-implemented in the browser.

**Priority (§22–§23):**
- The existing `rankQueue` policy is used, gated by `workflowSettings.vipPriorityEnabled`: urgent 3 > vip 2 > high 1 > normal 0, then the longest wait.
- Ties are broken by check-in time, then queue item id, so the order is deterministic.
- A raise above Normal needs `pos.queue.update_priority` and a reason, and is written to the history / audit.

**Technicians (§25–§29).** "Available for queue" means: not off shift, not blocked, and not on break (shown separately). It comes from the real signals. Available technicians are ordered by the Fair Turn rotation index the server computed (never re-derived in the browser).

**Decisions for Kevin:**
1. SMS wait alerts (template + consent).
2. Whether Auto Balance may ever apply without a person (today it recommends and a person taps Apply).
3. Whether a priority raise should also need a manager (today `pos.queue.update_priority` + reason).

---

## F. Concurrency, realtime, permissions, isolation, performance

| Action | Protection |
|---|---|
| Add to Queue | the canonical walk-in check-in: idempotency key (`uq_pos_queue_checkin_key`) + one active entry per guest (`uq_pos_queue_active_walk_in_customer` / `_appointment`); `queue.create()` answers the existing entry on a unique violation |
| Assign | `expectedTechnicianId` / `expectedVersion` → 409; locks; exact-skill eligibility |
| Start Service / Send to Tech Queue | status compare-and-set (`QUEUE_ITEM` machine) + the persisted move keys; repeat / loser → `duplicate: true` |
| Reorder | `expectedVersion` per row |
| Priority | permission + reason + history row |
| Note | `pos.queue.edit`, tenant-scoped update, audit row; rendered as text (React) |

**Verified on PostgreSQL 16 (`fst_conc`, scratch tenant, script `scratchpad/cq/proof.sh`):**
- **One active entry per walk-in customer.** A second active insert → `23505 uq_pos_queue_active_walk_in_customer`.
- **Concurrent Start Service compare-and-set.** Session A moves ready_for_tech → in_service and holds the row for 2 s. Session B, 0.5 s later, blocks, re-checks and gets **UPDATE 0**. The final state is in_service at version 2 (one start). The service then re-reads and answers duplicate.
- **Durable serving key.** It is set once; a repeat with the same key is a no-op; another key **never overwrites** it.
- **Tenant isolation.** The same id read under another tenant returns 0 rows.
- **`EXPLAIN ANALYZE` of the queue read, 250 active rows.**
  - Measured: Seq Scan 0.164 ms (6 buffers — a tiny table).
  - With seqscan off: a bitmap index scan on `idx_pos_queue_items_tenant_branch`, 0.377 ms.
  - Index audit (§70): tenant / branch / status / checked_in_at (`idx_pos_queue_items_tenant`, `_branch_active`), appointment, ticket, group, technician + started_at, and the three idempotency / active-entry unique indexes. Nothing was slow, so no index was added.

**Realtime.** `queue.*` / check-in events reach the `queue` screen. With Auto Refresh on, an event refetches the server snapshot; when it is off, nothing refetches until Refresh. No full-page polling (§102).

**Permissions (§73):**
- view: `pos.queue.view`;
- create: `pos.queue.create` (walk-in: the check-in permissions);
- note / services: `pos.queue.edit`;
- assign: `pos.queue.assign_technician`;
- priority / reorder: `pos.queue.update_priority`;
- Tech Queue: `pos.queue.move_to_tech_queue`;
- Start Service: `pos.queue.move_to_serving` + `pos.serving.view`;
- cancel / remove: `pos.queue.cancel` / `remove`;
- lock: `ai_queue_assignment.override`;
- guest declined: `turn_queue.assign`.

All state changes are audited. Tenant and branch come from the session, never from the body.

**Performance (counted from the code, not timed).**
- The state read = the batched `loadAll` + 9 batched signal queries (`techSignals`) + the existing locks / lines / conversion reads. The signal queries are a new cost, a fixed number per request that does not grow with guests or technicians.
- The staff payload is 8 rows (was every technician).
- The queue page is 50 rows; the full list is 100 a page.
- The projection is O(n log n). The unit test runs 200 technicians in under 50 ms.

**NOT_RUN:** API timing at 50 / 100 / 250 records, realtime latency and browser memory. These need the built API.

---

## G. Screenshots (`tooling/checkout-one-screen/results/`)

- 1920×1080 (1920×945 page): `queue-after/queue-{empty,normal,busy,tech200,q250,long}-1920x945.png` (also `-1920x1080`)
- 1600×900: `queue-after/queue-busy-1600x900.png` (and `-1600x765`) · 2560×1440: `queue-after/queue-busy-2560x1440.png` (and `-2560x1305`)
- BEFORE: `queue-before/queue-*-1920x945.png`

---

## H. Build matrix (executed evidence only)

| Validation | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS (stand-in)** | `build.mjs` (esbuild, 650 inputs). `vite build` NOT_RUN (no node_modules). |
| TYPECHECK | **PARTIAL** | Shimmed backend typecheck: identical to the Serving baseline (5,354 lines; no new error code in any file; only the known shim effects TS2709 / TS7006). pos-web `tsc` **NOT_RUN** — `@types/react` cannot be installed here (npm registry unreachable from this sandbox). |
| LINT | **NOT_RUN** | eslint not installed. |
| CUSTOMER QUEUE UNIT TESTS | **PASS** | `queue-floor.vitest.spec.ts` **23 / 23**. queue-core 74 / 74 and queue-transitions 18 / 18 were updated: a priority raise now passes a reason (§23). Queue stand-in sweep: **1034 passed / 94 failed** = the previous 1011 / 94 + the 23 new (the same 94 PG / builder-only failures). |
| INTEGRATION TESTS | **PARTIAL** | Queue SQL on PostgreSQL 16 (F). pgtests NOT_RUN (no PGlite). |
| E2E TESTS | **PASS** | `interact-queue.mjs` 34 / 34; `measure.mjs` 36 / 36. |
| VISIT DEDUPLICATION | **PASS** | E2E double-tap → one visit; walk-in key (existing check-in specs); `create()` unique-violation → existing entry. |
| QUEUE DEDUPLICATION | **PASS** | PostgreSQL 16 `uq_pos_queue_active_walk_in_customer` 23505; E2E. |
| ASSIGNMENT CONCURRENCY | **PASS** | PostgreSQL 16 two-session compare-and-set; unit `Promise.all` start → one; E2E stale assign → 409 explained. |
| EXACT SERVICE ELIGIBILITY | **PASS (existing)** | `queue-exact-eligibility.vitest.spec.ts` in the sweep (unchanged authority). |
| FAIR TURN INTEGRATION | **PASS (existing + order)** | Fair Turn specs in the sweep; the technician panel uses the server's rotation index (unit). |
| APPOINTMENT PROTECTION | **PASS (existing)** | engine / eligibility paths unchanged; specs in the sweep. Live pilot NOT_RUN. |
| PRIORITY LOGIC | **PASS** | unit (`rankQueue` order, settings off, deterministic ties, counts, reason required) + E2E. |
| WAIT TIME | **PASS** | server `actualWaitMinutes` + `waitLevel` (unit); E2E delayed marker. |
| TENANT ISOLATION | **PASS** | unit (another salon sees nothing / 404) + SQL 0 rows. |
| BRANCH ISOLATION | **PASS (code)** | `scoped()` on every read / write (unchanged). Live multi-branch pilot NOT_RUN. |
| REALTIME | **PASS (screen)** | Live = real state; Auto Refresh gates refetch (E2E). Cross-station latency NOT_RUN. |
| TECHNICIAN APP UPDATE | **NOT_RUN** | needs the built API + tech-web (unchanged paths). |
| 200-TECH PERFORMANCE | **PARTIAL** | payload capped (8 + summary), projection < 50 ms for 200 (unit). API timing NOT_RUN. |
| HIGH-VOLUME QUEUE | **PASS (screen)** | 95 / 100 / 250 records fit (C); internal scroll; full list overlay. API timing NOT_RUN. |
| 1920x1080 ONE-SCREEN | **PASS** | C. |
| NO VERTICAL PAGE OVERFLOW | **PASS** | C (1366×633 by design). |
| NO HORIZONTAL PAGE OVERFLOW | **PASS** | C. |
| BUSY-STATE FIT | **PASS** | C + E2E. |
| TOUCH TARGETS | **PASS** | E2E touch check. |
| EDGE | **NOT_TESTED** | |
| CHROME | **PASS (Chromium)** | branded Chrome NOT_TESTED. |
| PHYSICAL TOUCHSCREEN | **NOT_TESTED** | |
| Repo gates | **PASS for every gate this touches** | silent-catch, as-any (3227 ≤ 3251), mass-assignment, raw-sql-inputs, openapi `--check` (3,126 routes, no change), pos-i18n, vi-glossary, error-catalog sync; full `run-all-gates.sh`: see TEST_REPORT. |
| pos-web jsdom tests | **NOT_RUN** | not installed. `POSQueueScreen.test.tsx` updated for the Manage overlay (`[role="dialog"]` instead of the expanded `tr`) and the canonical board. |

## Permanent rules (§108)

The Customer Queue is a one-screen guest-flow workspace. The backend is the authority for queue state, KPIs, priority order,
wait time, technician availability and every transition. The browser never invents a stage, a priority rule or a KPI from
the rows it loaded. One guest = one visit = one active queue entry; Add to Queue, Start Service and Send to Tech Queue are
idempotent and concurrency-safe. Assignment re-validates eligibility, locks, Fair Turn and the version on the server. A
priority raise needs a permission and a reason, and is audited. AI insights are advisory; Auto Balance recommends and a
person applies. Potential revenue is projected, not earned. 200 technicians are a capped panel with a summary. High-volume
data stays inside fixed panels; a row tap never grows the page. Tenant and branch data never leak.
