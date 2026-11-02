# SERVICE_DONE_ONE_SCREEN_STATUS.md — Service Done 27-Inch One-Screen Fit, Completion Handoff & Module Completion (Oct 28 2026)

Mandate: `ServiceDone.pdf` ("AI PowerSalon — Service Done 27-Inch Touchscreen One-Screen Fit, Completion Handoff & Module
Completion Mandate"). Commits `2984ab61` (server), `97b491e2` (board), plus the harness / docs commit; branch `merge-github-main`. **Nothing pushed** (K-12 first).

Environment (as for Checkout):
- sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**, TypeScript 6.0.2;
- Chromium + Playwright from `/opt/npm-tools`;
- Inter / DejaVu Serif stand in for Hanken Grotesk / Playfair Display. Both are wider than the real fonts, so the fit numbers are conservative.

**Verdicts for this mandate:**
- CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**.
- PRODUCTION_READY = **NO**. On top of the Full System Test reasons, these are still to do:
  - run migration 707 on a real environment;
  - run the pos-web jsdom tests and the pgtests;
  - test on the physical touchscreen, in Edge and in Chrome;
  - run the live Serving → Service Done → Checkout pilot on a built API.

---

## A. Existing architecture found (inspected first; one completion implementation kept)

| Piece | Path | Notes |
|---|---|---|
| Screen | `apps/pos-web/src/screens/POSServiceDoneScreen.tsx` | Kept: every module, the Membership badge / redeem panel, `floorInsight` / `floorLabel`, the quality gate on Ready. Rebuilt: layout, overlays, Quick Actions. |
| API client | `apps/pos-web/src/api/posServiceDoneApi.ts` | `+ updateNotes` (the route existed; the screen never called it). |
| Controller | `modules/queue/src/service-done/service-done.controller.ts` | 13 routes, permission per action. |
| Service | `service-done.service.ts` | Quality, notes, technician, mark-ready, send-to-checkout, notify, reopen. |
| Repositories | `service-done.kysely.repository.ts` (Postgres) · `service-done.repository.ts` (in-memory + port) | |
| Serving → Service Done | `service-done-transition.ts` | **THE one completion** (tech app, Serving mark-done, Serving send). It is transactional (`FOR UPDATE`), idempotent by key, stamps commission, uses an outbox, and runs Fair Turn. Kept; one addition (E). |
| Workflow columns | `apps/api/db/migrations/025_service_done.sql` (+ **707**) | quality status, checkout status, notes, customer-visible notes, notified-at, send key, helper. |
| Lifecycles | `modules/queue/src/queue-lifecycles.ts` | `+ SERVICE_DONE_CHECKOUT`, `+ SERVICE_DONE_QUALITY` (new machines). |
| Realtime | `packages/realtime-contracts/src/realtime-core.ts` | `service_done` and `ticket_ready_checkout` route to the `service-done` screen. |
| Customer notice on handoff | `apps/api/src/events/consumers/{push-notification,in-app-notification}.consumer.ts` | `ticket.ready_for_checkout` sends a de-duplicated "bill ready" push and in-app notice. |
| Tests | `modules/queue/src/service-done/*.spec.ts` (10 files) · `apps/pos-web/src/screens/POSServiceDoneScreen*.test.tsx` | |

---

## B. Problems found

| Class | Problem | Fix |
|---|---|---|
| **P1 SERVICE DONE STATE BUG** | The Postgres repository kept quality status, checklist, notes, customer-visible notes, helper technician, notified-at, checkout status and the send key in a `Map` **in the API process**, even though migration 025 created columns for all of them. As a result, two POS stations on two API instances disagreed, a restart forgot every approval and every "sent" key, and payroll / Serving never saw a helper set here. | All of these are now read from and written to the ticket columns. Migration **707** adds the one missing column, `service_done_checklist jsonb`. |
| **P1 CHECKOUT HANDOFF / CONCURRENCY** | Send-to-checkout was "read key, then write". Two stations could both pass the check and write the event twice. The DB write's error was **swallowed**, and the method still answered "sent". A retry after a restart was refused with `ALREADY_SENT` instead of idempotent success. | `transitionToCheckout` is **one compare-and-set UPDATE** whose WHERE clause *is* the readiness rule. The outbox fact is written only when the row actually moves. Errors propagate. "Already sent" returns idempotent success; a paid ticket returns `TICKET_PAID_USE_REFUND`. |
| P1 QUALITY / CONFIRMATION | A quality decision could overwrite a newer one, and could change a visit that was already handed off. A reopened-then-recompleted visit stayed `reopened` forever, so it could never be handed off. | `expectedVersion` optimistic check (`TICKET_CHANGED_RELOAD`). Quality and technician changes after the handoff answer `TICKET_LOCKED_AT_SERVICE_DONE` ("Reopen first"). A re-completion resets the workflow to `not_ready` and the quality to `pending` (reconfirm after rework). |
| P1 NOT_WIRED | **Add Upsell** and **View Receipt** were notes only. **Auto Balance Handoff** just refreshed. **Send Front Desk Alert** was a note. **View Full Queue** and **View Full Board** only refreshed. The insight "Review Now" routed to the page itself. **Add Note** was a note even though the notes API existed. **Open Customer** carried no context. **View Reports** and **View Full Performance** linked to `/tenant/reports`, **a path with no route**, so the POS bounced to Overview. The same dead link was also in Serving, Tech Queue and Queue. | All wired (D). The dead alert button is removed. The reports links now go to `/reports` and `/tenant/reports/technicians` in all four screens. |
| P1 VIEWPORT OVERFLOW | At 1920×1080 the page scrolled 404 px (normal) to 2,826 px (busy). The analytics row and all Quick Actions were below the fold. | 0 / 0 in every state (C). |
| P1 REALTIME | A quality decision, a note, a technician change or a reopen emitted nothing, so another station waited for the 15-second safety sync. "Live" was static text, and Auto Refresh was really a refresh button. | Each now emits `service_done` (ids only). Live shows the real `realtime.status`. Auto Refresh is a real switch. |
| P1 CONTROLLER | `run()` mapped only `e.code`, but `withCode()` sets `apiCode`. Every coded refusal therefore reached the POS as a bare 400 without its code (a 409 conflict looked like a bad request). | It now maps `code ?? apiCode`. |
| P2 KPI definitions | Completion Accuracy showed **100 %** when nothing was done. It also counted *all* issues against *today's* completions. Rebooking counted any future appointment, even one booked before the service. Satisfaction showed **0** when there were no ratings. | Accuracy and rebooking are `null` when there is no data, and satisfaction is `null` with no ratings; the screen shows "—" plus "Not enough data". Accuracy counts today's completions only. Rebooking requires an appointment created **after** the guest's `service_done_at`. Each definition is documented in `service-done.dto.ts`. |
| P2 200-TECH | The staff panel rendered every technician (100 on duty, 200 on the roster). | 8 rows, Available first, plus `staffSummary` (counts for everyone). |
| P2 QUERY PERFORMANCE (N+1) | The board ran 3 queries **per ticket** (lines, technician names, customer), plus one more for tips. | Now 1 + 3 for the whole board; tips are read with the tickets. Removed lines are no longer shown or counted (they inflated the subtotal and the send key). |
| P2 TIP / RECEIPT SEMANTICS | "View Receipt" had nothing behind it. | Now a **Service summary** marked "Not a paid receipt — the final receipt comes from Checkout after payment". Tips show as "entered (not yet captured)". |
| P3 VISUAL / TOUCH | The queue row needed horizontal scroll. Some text was faint (#B5821F / #8A7A66 on cream). | Two-line compact rows with a fixed table layout. Stronger tones (#8C5A00, #1F7A3F, #A8321F). Actions are ≥ 40 px; Quick Actions are 58 px at 1920 (46–62 across densities); queue-row buttons are 32 px. |
| Kept (decision) | Send Update → SMS answers `configured:false` (honest). | A real "your service is done" SMS needs a communications template plus a consent decision (E). The customer app is already notified on the handoff by the existing `bill_ready` consumer. |

---

## C. Before / after measurements (real POS bundle, Chromium, fixture API)

Method: `PAGE=service-done node tooling/checkout-one-screen/measure.mjs`. It reports document overflow, the page container's own overflow, and whether every module, all 9 KPIs and all 7 Quick Actions are painted (checked with `elementFromPoint`). The primary target is the 1920×945 page, which is what a 1920×1080 screen leaves after the Chrome bars and the taskbar. BEFORE was measured with the staff list the old server returned (`SD_SERVER=old`).

| State (1920×945) | BEFORE page scroll · content / page · hidden items | AFTER |
|---|---|---|
| empty | 90 px · 975 / 885 · 7 | **0 · 885 / 885 · 0** |
| normal (8) | 404 · 1289 / 885 · 12 | **0 · 0** |
| busy (§91: 200 techs / 100 on duty, 30 completed, 12 review, 8 ready, 5 sent) | **2,826** · 3711 / 885 · 12 | **0 · 0** |
| 200-tech | 2,704 · 3589 / 885 · 12 | **0 · 0** |
| 100 completion records (§93) | 526 · 1411 / 885 · 12 | **0 · 0** |
| long names (§94) | 1,109 · 1994 / 885 · 15 | **0 · 0** |

- **All viewports:** before, 3 of 36 state × viewport cells passed. After, **30 / 30** pass at 1920×945, 1920×1080, 1600×900, 2560×1440 and 1366×768.
- **Browser bars counted:** 1600×765 and 2560×1305 pass **12 / 12**.
- **1366×633** (a 1366×768 screen with the browser bars) scrolls **145 px by design**. §117 says not to make 1366×768 unusably tiny to force a fit, so below 660 px of height the operations area keeps a usable 470 px and the page scrolls a little. Checkout follows the same rule.
- **No `transform: scale`, no `zoom`.**
- **Files:** `tooling/checkout-one-screen/results/{sd-before,sd-after,sd-after-chrome}/`.

**Behaviour E2E:** `node tooling/checkout-one-screen/interact-sd.mjs` passes **29 / 29** (`results/sd-interact/interact.json`). The checks:
- **Board:** the board is a projection (5 / 12 / 8 / 5).
- **Busy fit:** the busy board has no page scroll.
- **Staff:** 8 rows of 100 on duty, plus the counts.
- **Live and Auto Refresh:** Live is CONNECTED; Auto Refresh toggles.
- **Dead button:** the dead alert button is gone.
- **Overlays:** the full queue shows 30 rows, the full board 30 cards.
- **Auto Balance:** it recommends 8 and moves nothing on its own. When confirmed, it moves exactly the 7 the manager kept.
- **Send Update:** it is honest, and its note does not move the layout.
- **Touch:** Quick Actions 58 px, guest actions 40 px, nothing visible under 30 px.
- **Board selection:** tapping a card selects it and highlights its stage.
- **Manage → Approve:** posts the result with the note.
- **Move to Checkout:**
  - an unapproved visit shows the server's refusal;
  - three taps on an approved one say "Already in Checkout".
- **Open Guest:** shows each line with its technician.
- **View Receipt:** says "Not a paid receipt".
- **Add Upsell:** refuses without a reason, then reopens with the reason and goes to `/serving`.
- **Open Customer:** opens `/customers?q=…&customerId=…`.
- **View Reports:** stays on `/reports`.
- **Quality filter:** sends the server query and shows only matching rows.
- **Empty board:** 6 contextual actions are off and View Reports stays on.
- **100 records:** they stay in the panel (internal scroll of 3,920 px, page height unchanged).

---

## D. Final layout (1920×945 page; COMPACT density)

**Rows**

| Row | Height |
|---|---|
| POS header (shell) | 60 (unchanged, shared by every screen) |
| Title / filter row | 42 |
| KPI row | 68 |
| Primary operations row | ~1.12 fr (~290) |
| Secondary operations row | ~1 fr (~258) |
| Analytics row | 124 |
| Quick Actions | 58 |
| Gaps | 7 |
| Padding | 8 / 12 |

**Columns**
- Columns are 1.2 / 1.5 / 1 fr: queue | board | AI, then tech performance | guest | ready techs.
- The analytics row has 5 equal cards, the KPI row 9, and the Quick Actions row 7.

**Queue**
- Rows are 40 px with two lines: guest over time · technician, services over add-ons, total over tip.
- The table layout is fixed and the actions column is 116 px. The status column steps aside below 1700 px wide.

**Density modes**

| Mode | Condition | KPI | Analytics | Quick Actions |
|---|---|---|---|---|
| COMFORTABLE | ≥ 2200 × 1200 | 84 | 170 | 62 |
| COMPACT | 1920 | 68 | 124 | 58 |
| TIGHT | ≤ 820 px high | 60 | 100 | 50 |
| FALLBACK | ≤ 660 px high | page scrolls (above) | | |

Below 1280 px wide the board stacks and the page scrolls.

**Shared CSS**
- The classes live in `apps/pos-web/src/styles.css`. Checkout and Service Done share the same `co-*` panel classes and density variables, and `sd-*` holds the Service Done extras.
- The container rule is `height: min(100%, calc(100dvh - var(--pos-header-height))); overflow: hidden`, with `min-height: 0` / `min-width: 0` on the children.

---

## E. State, handoff, multi-technician and quality

**Canonical states.** `tickets.status` is `service_done` or `ready_checkout` (set by the shared completion and the handoff; `paid` = Checkout). It is refined by `service_done_checkout_status` (machine `SERVICE_DONE_CHECKOUT`):
- `not_ready` → `ready_for_checkout` → `sent_to_checkout`, or `not_ready` → `sent_to_checkout` directly;
- any state can go to `reopened`;
- `reopened` → `not_ready`, and so do `ready_for_checkout` / `sent_to_checkout`, but only when the visit is completed again after a reopen.

Quality is `service_done_quality_status` (machine `SERVICE_DONE_QUALITY`: pending / approved / issue_found / needs_review). The board is a projection of these (§23): **sent** → **ready** → **review** (needs_review or issue_found) → **just** (pending, or approved but not yet ready).

**Readiness rule (§32).** A visit can enter Checkout only when:
- its status is `service_done` or `ready_checkout`;
- it is not paid;
- it is not reopened and not already at or past the target;
- quality is `approved` when the salon requires it (the default);
- notes are present when the salon requires them.

This rule is enforced **inside the UPDATE's WHERE**, so no gap between read and write can let a second station through.

**Ready ≠ Paid (§33).** No Service Done action writes `paid_at` or any money (§101).

**Sent to Front Desk (§34)** is still one visit, one ticket (`tickets.id`) and one Checkout entry. Checkout lists tickets in `ready_checkout`, so nothing is duplicated.

**Checkout handoff transaction (§36).** One transaction:
1. the compare-and-set UPDATE, including the send key;
2. the queue item and appointment are completed through their machines;
3. a `ticket.ready_for_checkout` outbox fact is written (it drives the Checkout board refetch and the customer's de-duplicated "bill ready" push / in-app notice).

Everything commits together. The legacy realtime emit happens only when no outbox publisher runs, and only for a real move.

**Concurrency (§37, §107, §110).**
- *Verified on PostgreSQL 16* with two sessions:
  - session A ran the UPDATE and held the row for 2 s; session B blocked, re-checked the row and matched **0 rows**;
  - the other refusals also matched 0 rows: unapproved, paid, reopened, and another tenant's id.
  - EXPLAIN ANALYZE: 0.12 ms.
- *Unit:* `service-done-handoff.vitest.spec.ts` checks two ways:
  - ×3 sequential → `[false, true, true]` and one fact;
  - `Promise.all` from two stations → exactly one `moved`.

**Guest confirmation (§108).** The detail carries `version`, and a quality decision sends it as `expectedVersion`. A stale decision answers `TICKET_CHANGED_RELOAD`.

**Correction / reopen (§29, §97–§98).** Reopen needs:
- `pos.service_done.reopen` (or `pos.serving.reopen`);
- a reason;
- the salon setting that allows reopening.

A paid visit answers `TICKET_PAID_USE_REFUND`. The lock is cleared with a `ticket_revisions` row (append-only). Completed history (who did it, when, the previous state) is never erased. A change after the handoff requires Reopen.

**Multi-technician / partial completion (§38–§42).**
- The board and Guest Detail show **each line's own technician**; the guest detail lists "Done by" per line.
- Ownership is not rewritten after the handoff (`assignTechnician` refuses).
- A visit enters Service Done only through the shared completion, which completes the whole visit. Partial handoff is not product policy, so one technician finishing does not complete the visit.
- Technician availability is service-line based in the workforce / Fair Turn path. That path is unchanged and runs inside the same completion.

**Quality issue (§30).** `issue_found` blocks Ready and Move to Checkout (when the salon requires an approved quality check). The decision is audited with before / after and the note. Rework goes through Reopen, then Serving, then completion again, which resets quality to pending; after that the issue must be re-approved.

**Late add-on (§49–§51).** Service Done never adds a line or a price. "Add Upsell" explains the path and asks for a reason:
1. **Reopen**, which is audited;
2. **Serving**, where `addService` checks permission, uses the catalog price and records the right technician, a revision and an audit entry;
3. completion again.

Add-on revenue counts only `is_add_on` lines, and removed lines are excluded.

**Tips (§53, §96).** Captured tips are tips on tickets **paid today**, through Checkout (the payment authority). A tip entered on an unpaid ticket is labelled an estimate. There is no new allocation logic.

**Rebooking (§57–§58).** The rate has a definition (B). "Rebook" is not a Service Done action here; Checkout's Rebook Guest opens the canonical `/booking/new` with the guest.

**Decisions for Kevin**
1. Should "Send Update" text the guest? That needs a communications template plus a consent rule. Today it is honest ("not configured"), and the app notice goes out on handoff.
2. Should partial handoff (one technician done, another still serving) ever be allowed? It is not allowed today.

---

## F. Concurrency, realtime, permissions, isolation, performance

**Protection by action**

| Action | Protection |
|---|---|
| Move to Checkout / Mark Ready | Compare-and-set UPDATE (E) |
| Quality decision | Optimistic `expectedVersion`, plus refusal after the handoff |
| State transitions | The two new machines, guarded with `canMoveToSql` |
| Re-completion | The shared completion's `FOR UPDATE` plus its completion key |
| Late add-on | Serving's revision / version (`assertVersion`) |

**Realtime events**

| Event | Publisher | Channel | Subscribers |
|---|---|---|---|
| `ticket.ready_for_checkout` | handoff | outbox → realtime | checkout, service-done, dashboard, overview |
| `service_done` | completion; quality / notes / technician / reopen | tenant | service-done, checkout, serving, tech-queue, queue, … |

Both are tenant-scoped, ids only. Reconnect works as: snapshot → subscribe → 15 s safety sync, with silent reconciliation. Auto Refresh off means events don't refetch.

**Permissions.** Unchanged and per action:
- `pos.service_done.view`, `quality_check`, `update_notes`, `assign_technician`, `send_to_checkout` (+ `pos.checkout.view`), `notify_customer`, `reopen`.
- Tenant comes from the session; branch is scoped by the repository's `scoped()` (branch or NULL).

**Isolation**
- *Unit:* another salon gets `TICKET_NOT_FOUND` and an empty board.
- *SQL:* another tenant's id updates 0 rows.

**Performance**
- *Measured:* the handoff UPDATE takes 0.12 ms (EXPLAIN ANALYZE).
- *Counted from the code, not timed:*
  - board query count for a 30-ticket board: **~16** (was ~105, i.e. 3 per row plus tips plus ~12 fixed);
  - staff payload: 8 rows (was 100);
  - board window: 300 newest unpaid completions, older ones reachable by search.
- **NOT_RUN:** API latency, realtime latency, browser memory. These need the built API.

---

## G. Screenshots (`tooling/checkout-one-screen/results/`)

1920×1080 (1920×945 page):
- `sd-after/service-done-empty-1920x945.png`
- `…-normal-…`
- `…-busy-…`
- `…-tech200-…`
- also `q100` and `long`

Other sizes:
- 1600×900: `sd-after/service-done-busy-1600x900.png` and `sd-after-chrome/service-done-busy-1600x765.png`
- 2560×1440: `sd-after/service-done-busy-2560x1440.png` and `sd-after-chrome/service-done-busy-2560x1305.png`

BEFORE: `sd-before/service-done-*-1920x945.png`.

---

## H. Build matrix (executed evidence only)

| Validation | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS (stand-in)** | `node tooling/checkout-one-screen/build.mjs` (esbuild bundles `main.tsx`, 650 inputs). `vite build` NOT_RUN (no node_modules). |
| TYPECHECK | **PARTIAL** | Shimmed backend typecheck: the only new message is a TS7006 shim effect (an untyped `trx` callback). pos-web `tsc` NOT_RUN (no `@types/react`). |
| LINT | **NOT_RUN** | eslint not installed. |
| SERVICE DONE UNIT TESTS | **PASS** | `service-done-handoff` 16/16 (mutation-checked: dropping the "already sent" rule fails 3); service-done-core 57/57; analytics, rebooking, reopen-lock, audit-bridge, addon, no-commission all pass. Queue module stand-in sweep: **986 passed / 94 failed**, which is the earlier baseline (970 / 94, same 5 files, stand-in limits) plus the 16 new tests. |
| INTEGRATION TESTS | **PARTIAL** | The handoff SQL was run on PostgreSQL 16: concurrent sessions plus refusals. pgtests NOT_RUN (no PGlite); the stand-in cannot run Kysely's builder. |
| E2E TESTS | **PASS** | `interact-sd.mjs` 29/29; `measure.mjs` 30/30 + 12/12. Checkout re-run after the shared CSS change: 35/35 + 14/14 (1366×633 scrolls by design) and 26/26. |
| SERVING HANDOFF | **PASS (unchanged + reset)** | One completion (`service-done-transition.ts`). The re-completion reset now carries machine guards. Live pilot NOT_RUN. |
| VISIT DEDUPLICATION | **PASS (design)** | Service Done creates no visit or ticket; the handoff updates the one ticket row. |
| SERVICE-LINE DEDUPLICATION | **PASS (design)** | Service Done creates no line. Add-ons go through Serving (its revision / version guards). |
| GUEST REVIEW / CONFIRM | **PASS (unit + E2E)** | expectedVersion conflict, audit before / after, Manage overlay posts the decision. |
| QUALITY WORKFLOW | **PASS (unit)** | An issue blocks the handoff; re-approval releases it; a change after the handoff is refused. |
| MULTI-TECH COMPLETION | **PASS (unit + E2E display)** | Line ownership shown per line; ownership change refused after the handoff. Live pilot NOT_RUN. |
| PARTIAL COMPLETION | **PASS (design)** | Completion is visit-level only (policy: no partial handoff). Live pilot NOT_RUN. |
| LATE ADD-ON | **PASS (path)** | Reopen (reason, audit) → Serving `addService` (catalog price, permission, revision). E2E checks the reopen + navigation. |
| REBOOKING | **PASS (definition)** | New definition plus unit tests. The canonical Booking flow is unchanged; the live pilot is NOT_RUN. |
| MOVE TO CHECKOUT | **PASS** | Unit ×3 plus E2E ×3. |
| CHECKOUT DEDUPLICATION | **PASS** | One row, compare-and-set, one outbox fact. |
| CONCURRENT HANDOFF | **PASS** | PostgreSQL 16 two-session test plus unit `Promise.all`. |
| TENANT ISOLATION | **PASS** | Unit plus SQL (0 rows for another tenant). |
| BRANCH ISOLATION | **PASS (code)** | `scoped()` applies the session branch to every read and write. A live multi-branch pilot is NOT_RUN. |
| REALTIME | **PASS (board)** | Live state, Auto Refresh, emits on every board change. Cross-station latency NOT_RUN. |
| 200-TECH PERFORMANCE | **PARTIAL** | Payload capped; N+1 removed (query count from code). API timing NOT_RUN. |
| 1920x1080 ONE-SCREEN | **PASS** | C. |
| NO VERTICAL PAGE OVERFLOW | **PASS** | C. 1366×633 scrolls by design (§117). |
| NO HORIZONTAL PAGE OVERFLOW | **PASS** | C. |
| BUSY-STATE FIT | **PASS** | C. |
| TOUCH TARGETS | **PASS** | E2E touch checks. |
| EDGE | **NOT_TESTED** | |
| CHROME | **PASS (Chromium)** | Branded Chrome NOT_TESTED. |
| PHYSICAL TOUCHSCREEN | **NOT_TESTED** | |
| Repo gates | **PASS for every gate this touches** | state-transitions 0 findings; as-any OK; mass-assignment OK; error-text, raw-sql, silent-catch, event-producers, realtime-catalog, money, i18n, pos-i18n, vi-glossary OK; types-drift / db-ownership / sql on real Postgres OK; attack-surface regenerated. The remaining failures are the BLOCKED_DEPENDENCY set (lint, api-contract, strict-bodies-types, architecture TS 6 line, frontend builds, app types). |
| pos-web jsdom tests | **NOT_RUN** | Not installed. The row keeps Ready + Manage so the existing `qc-gate` / Manage tests' selectors still hold. |

## Permanent rules (§132)

Service Done is a one-screen completion and handoff workspace. Serving, Service Done and Checkout are separate controlled stages, and Ready for Checkout does not mean paid.

**Handoff**
- Move to Checkout is one atomic transition.
- One visit, one ticket, one Checkout entry.

**History and ownership**
- No silent history rewrite; Reopen is the correction path.
- Line ownership is preserved.

**Quality and money**
- Quality blocks the handoff when the salon requires it.
- Late add-ons go through Serving at the catalog price.
- Final receipts come from Checkout.
- Potential revenue is not settled revenue.

**AI**
- AI insights are advisory.
- Auto Balance only recommends; a person confirms each move.

**Data and screen**
- High-volume data stays inside fixed panels.
- 200 technicians never means 200 cards.
- Tenant and branch data never leak.
- Realtime updates the board without a page refresh.
- Touch targets stay finger-friendly.
