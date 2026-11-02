# CHECKOUT_ONE_SCREEN_STATUS.md — Checkout 27-inch One-Screen, Payment Safety, Split Tender & Module Completion (Oct 28 2026)

Mandate: `checkout.pdf` ("AI PowerSalon Checkout – 27-Inch Touchscreen One-Screen Fit, Payment Safety, Split Tender & Module
Completion Mandate"). Base `6b4bb046`; commits `2904f087` (server), `c878413b` (board), `2cd8f482` (harness + docs), branch
`merge-github-main`. **Nothing pushed** (K-12 first).

Environment (same as the Oct 28 Full System Test): sandbox, Node 22.23.4, PostgreSQL 16.15, **no `node_modules`**.
TypeScript 6.0.2. Chromium + Playwright from `/opt/npm-tools`. Fonts: Inter stands in for Hanken Grotesk, DejaVu Serif for
Playfair Display. Both are **wider** than the real fonts, so the fit measurements are conservative.

**Verdicts for this mandate:**
- CODE_READY_FOR_DEVELOPER_HANDOFF = **YES**.
- PRODUCTION_READY = **NO**. This adds to the Full System Test reasons: the pos-web jsdom tests and pgtests could not run here,
  nothing has been piloted on a physical 27-inch touchscreen, and K-12 / real MID UAT are still open.

---

## A. Existing architecture (inspected first — kept, fixed, wired; nothing rewritten blindly)

| Layer | Path | What it is |
|---|---|---|
| Screen | `apps/pos-web/src/screens/POSCheckoutScreen.tsx` | The one Checkout board. **Kept**: every handler (`takePayment`, `run`, `changeMethod`, tips, discounts, rewards, verify, display, hold/move) and every child panel (CheckoutDealsPanel, MembershipCoveragePanel, CustomerDisplayCard, MobilePaymentsCard, AICheckoutUpsellPanel, AiAssistantPanel, TipKeypad, SkipLineDrawer). **Changed**: layout, KPI definitions, dead buttons, overlays. |
| Styles | `apps/pos-web/src/styles.css` (end: "Checkout one-screen") | The grid, density modes and panel classes. |
| API client | `apps/pos-web/src/api/posCheckoutApi.ts` | Unchanged. |
| Realtime | `apps/pos-web/src/realtime/realtime-client.ts`, `useRealtime.ts` | Unchanged. The board now reads `realtime.status()` / `REALTIME_STATUS`. |
| Service | `modules/checkout/src/checkout/checkout.service.ts` | Payment, tip and discount writers, the unsettled guard, `paying()` lock, verify. |
| Repositories | `checkout.kysely.repository.ts` (Postgres) · `checkout.repository.ts` (in-memory) | Board `query()`, `paidTotalCents`, payments. |
| Unsettled reads | `modules/checkout/src/checkout/unsettled-tenders.ts` | Ticket-level (existing) + **branch-level (new)**. |
| Board signals | `modules/checkout/src/checkout/checkout-board-signals.ts` (**new**) | One pure function: Pending Payments, attention rows, receipt delivery rate. |
| DTO | `modules/checkout/src/checkout/checkout.dto.ts` | KPI fields, staff cap, detail tenders. |
| Error registry | `packages/api-contracts/src/errors.ts` + `apps/pos-web/src/i18n/ns/errors.{en,vi}.ts` | One new code. |
| Harness (new, tooling only) | `tooling/checkout-one-screen/` | Bundles the **real** POS (`build.mjs`), fixture API (`server.mjs`, `fixtures.mjs`), fit measurement (`measure.mjs`), behaviour E2E (`interact.mjs`). |

---

## B. Problems found, by severity

| Sev | Problem | Where | Status |
|---|---|---|---|
| **P0 money** | `paidTotalCents` turned a read error into **0**. With $50 of $100 already paid, a DB blip let the next tender charge the full $100 again. | `checkout.kysely.repository.ts` | **FIXED**: the error is thrown (fail closed). Spec `checkout-paid-read-fails-closed` 5/5. |
| **P0 money** | `applyDiscount` had **no guard**: the bill could change while a card answer was in the air, after a partial payment, or on a paid ticket. Tip had no unsettled check. Deals and reward codes checked "paid" only. | `checkout.service.ts` | **FIXED**: one `assertTotalsEditable` guard on discount / tip / deal / coupon / reward apply + remove; method change refused while a tender is unsettled. Spec `checkout-totals-locked` 8/8, mutation-checked. |
| P1 | KPI **Pending Payments** fell back to `failedPaymentsToday`, a different thing. | screen + repo | **FIXED**: server-defined, the real unresolved payment-domain states; `null` (read failed) shows "—". |
| P1 | **Receipt Delivery Rate** read the receipts table, not delivery outcomes. 0 eligible showed "0 %". | repo | **FIXED**: delivered ÷ eligible from the receipt audit outcomes; 0 eligible shows "—". |
| P1 | Attention never showed **Payment Unknown / Processing / Refund Uncertain**. | repo | **FIXED** (board signals, danger first). |
| P1 | Page scroll at 1920×1080: 344 px (normal) up to 5,888 px (busy); analytics and every Quick Action hidden. | screen | **FIXED**: 0 / 0 in every state (C). |
| P2 | Dead or fake buttons: "Send Receipt Alert" (a note only); insights "Auto Assist Checkout" (= refresh); "View Full Checkout Queue" / "View all" (= refresh); View Summary (`/checkout`); Rebook (`/booking`, no guest); Open Customer (`/customers`, no context). "Live" was static text; Auto Refresh was a refresh button. | screen | **FIXED** (D3). |
| P2 | "Split Ticket" Quick Action actually started **split payment**. | screen | **RELABELLED** "Split Payment". Split *ticket* is not built — see the decision for Kevin (E). |
| P2 | Staff panel rendered every technician (200 rows). | repo/dto | **FIXED**: 8 rows + counts. |
| P2 | Insight "n receipts failed" was worded from `failedPaymentsToday`. | screen | **FIXED**: from the real failed-receipt rows. |
| P3 | "Send to Display" button 24 px tall. | `CustomerDisplayCard.tsx` | **FIXED**: ≥ 38/40 px. |
| Note | `findPaymentByIdempotencyKey` / `lockTotal` still swallow errors. | repo | **Left**: the claim-first insert decides, so a swallowed lookup can't double-charge. Recorded for review. |

---

## C. Before / after measurements (real POS bundle in Chromium, fixture API)

Method: `tooling/checkout-one-screen/measure.mjs`. This measures:
- document overflow and the Checkout container's own overflow;
- whether every one of the 10 modules, 9 KPIs and 9 Quick Actions is **painted** in the viewport (using `elementFromPoint`);
- any scale or zoom hacks.

The primary target is a **1920×945 page**, which is 1920×1080 minus about 87 px of Chrome chrome and the 48 px taskbar (the repo's `pos-vi-one-screen.mjs` standard).

| State (1920×945) | BEFORE page scroll · content / page | hidden | AFTER |
|---|---|---|---|
| empty | 288 px · 1173 / 885 | 14 | **0 · 885 / 885 · 0 hidden** |
| normal (8) | 344 · 1229 / 885 | 14 | **0 · 0** |
| busy (40 ready, 10 attempts, 3 UNKNOWN, 200 techs) | **5,888** · 6773 / 885 | 14 | **0 · 0** |
| unknown | 414 | 14 | **0 · 0** |
| split | 344 | 14 | **0 · 0** |
| 200-tech | 5,854 | 14 | **0 · 0** |
| big ticket (24 lines) | 852 | 14 | **0 · 0** |

- **All viewports.** BEFORE: 4 of 35 state × viewport cells passed (only 2560×1440 in the small states). AFTER: **35 / 35**. The viewports were 1920×945, 1920×1080, 1600×900, 2560×1440 and 1366×768.
- **Browser chrome counted.** I also measured with the browser chrome taken off the page height: 1600×765, 1366×633 and 2560×1305. 1600×765 and 2560×1305 pass **14 / 14**. **1366×633 scrolls 145 px by design** (changed with the Service Done mandate, §117): a 1366×768 screen is a fallback, so below 660 px of height the operations area keeps a usable 470 px and the page scrolls a little, rather than shrinking the workspace to a sliver. An earlier run here squeezed it to fit, which left the workspace body about 140 px tall.
- **Quick Actions row.** It went from 69 px (not visible at 1920) to **58 px** at 1920. It is 50 px at 1600 and 46 px at 1366, and 62 px at 2560.
- **No scaling.** There is no `transform: scale` and no `zoom` anywhere.
- **Results on disk:** `tooling/checkout-one-screen/results/{before,after,after-chrome}/measurements.json`, plus screenshots.

Behaviour E2E: `interact.mjs` passes **26 / 26** (`results/interact/interact.json`). Each check clicks the board like a cashier and asserts on the screen, the URL or the request log:
- The overlays work: the full queue shows 40 rows, attention shows everything, and a big ticket shows 6 lines on the board with all 24 in the overlay.
- Staff shows 8 of 200 plus the counts, and there are 3 insights.
- Live shows CONNECTED. Auto Refresh toggles.
- "Send Receipt Alert" is gone, and a note does not move the layout.
- Touch targets: Quick Actions are 58 px, workspace actions 44 px, and no visible button is under 30 px.
- Every Quick Action does its job: New Checkout, Apply Discount (focuses the field, page scroll stays 0), Split Payment (POST recalculate), Send Receipt, View Signature, View Summary, Rebook (`/booking/new?customerId=…`), Open Customer (`/customers?q=…&customerId=…`) and Take Payment (exactly one charge).
- UNKNOWN: the banner sits inside the workspace and never says "declined". Verify is offered. Complete Checkout is blocked, and Take Payment sends **no** request.
- Split shows "Paid $20.00 · Balance $44.90" from the server's tenders.

---

## D. Implementation reports

**D1. Fail-closed paid read.** `checkout.kysely.repository.ts` `paidTotalCents`: the `.catch(() => 0)` is removed. The spec `checkout-paid-read-fails-closed.vitest.spec.ts` covers four cases:
- card refuses without calling the processor and records nothing;
- cash refuses;
- split refuses;
- a control case where the read works.

It also checks the source to make sure no `.catch` comes back.

**D2. Totals lock** (`checkout.service.ts` `assertTotalsEditable`). A bill change is refused in these cases:

| Condition | Error code |
|---|---|
| Ticket is paid | `TICKET_ALREADY_PAID` |
| Money already captured — tip | `TIP_LOCKED_AFTER_CAPTURE` |
| Money already captured — discount, deal or reward | **new** `TOTALS_LOCKED_AFTER_CAPTURE` (409, EN/VI) |
| A tender is unsettled (card, split attempt, Tap to Pay or app intent; read through `unsettledTendersForTicket`) | `PAYMENT_STATUS_UNKNOWN`, plus the audit row `pos_checkout_totals_change_blocked_unsettled` |
| A POS or customer-display payment holds the ticket lock | `PAYMENT_IN_PROGRESS` |

A **mobile** claim keeps editing through its own claim and checkout version, because `mobile-checkout.service` calls `applyDiscount` while it holds the claim. `recalculate(method)` is refused on a paid ticket or while a tender is unsettled. After a partial payment the method may still change, which split payment needs.

**D3. Board** (`POSCheckoutScreen.tsx` + `styles.css`):

*Layout and density*
- The grid rows are title · KPI · main · analytics · QA.
- The main area is queue | workspace | right, over attention | workspace | staff, with the workspace spanning both rows.
- The page is `height: min(100%, calc(100dvh - var(--pos-header-height)))` with `overflow: hidden`, and `min-height: 0` / `min-width: 0` on the children.
- Density modes switch by height: roomier at 2560, compact at 1920, tight at 820 px or less, fallback at 660 px or less.
- Below 1280 px wide the board stacks and scrolls, as before.

*Workspace*
- A fixed header holds the guest, ticket number and Apply Discount.
- The UNKNOWN banner sits inside the workspace.
- The body scrolls. It holds 6 lines (more open an overlay), deals, method, split, receipt, tip, commission, membership, manual discount, reward, and the AI upsell, which moved here from below the board.
- A fixed footer shows the totals strip with Paid · Balance from the server, plus the actions.

*Panels and messages*
- Notes are a floating toast.
- The queue, attention, staff and the right stack scroll inside their panels.
- Overlays: full queue, all attention, all lines, and View Summary (read-only from the server: lines, discounts, totals, tenders, paid, balance).

*KPIs*
- Pending Payments: `pendingPaymentsToday`, shown as "—" when it is `null`.
- Receipt Delivery Rate: "—" when nothing is eligible.

*Live and Auto Refresh*
- Live shows `realtime.status`.
- Auto Refresh is a real switch (per-viewer `localStorage`). When it is off, realtime ticks don't refetch. There is also a separate Refresh button. Nothing calls `location.reload`.

*Insights*
- 3–5 items, built from real signals: payments to verify, failed receipts, guests ready.
- Each action opens something. Auto Assist (AiAssistantPanel) only recommends: its prompt requires human confirmation.

*Quick Actions*
- New Checkout opens the next waiting guest. It creates no ticket, so there is no second ticket per visit.
- Apply Discount scrolls inside the workspace body (not `scrollIntoView`).
- Split Payment.
- Rebook sends `customerId / customerName / customerPhone` to `POSNewBookingScreen`, which now preselects the guest.
- Open Customer sends `q` + `customerId` to `POSCustomersScreen`, which now filters and opens the profile.
- View Summary opens the summary overlay.

*Attention and tests*
- Attention shows the new types with tones and translated issue text.
- `data-testid="checkout-note"` moved to the note's text span, so the existing tests' exact-text asserts still hold.
- `POSCheckoutScreen.test.tsx` was updated: the insight test now feeds a real failed-receipt row.

**D4. Server board definitions** (`checkout-board-signals.ts`, `unsettled-tenders.ts`).

*Pending Payments* is the length of `unsettledTendersForBranch`, which counts:
- card payments in `processing`;
- `payment_attempts` in processing, timed_out or in-flight;
- app `payment_intents` in processing that have a `charge_started_at`.

All of these are scoped by tenant and by branch (or branch NULL).

*Attention* rows, in this order:
- Payment Unknown (danger) after 90 s or in an unknown, timed_out, reconciliation_required or confirmation_pending state;
- Payment Processing (warn);
- Refund Uncertain (stranded = danger);
- Failed Receipt (the payment stands);
- then the existing failed, partial and split rows.

Rows are de-duplicated per ticket and type, sorted danger → warn → info, and capped at 25.

*Receipt Delivery Rate* counts sent or saved as delivered. Simulated and not_configured sends are not failures.

*Read failure:* if any signal read fails, a danger row "Payment status could not be read" leads the list, and Pending Payments is `null`.

The four SQL queries were verified on real Postgres earlier in this session: branch B is excluded, settled attempts are excluded, and an intent without `charge_started_at` is excluded. `receiptOutcomesToday` EXPLAIN: 22.7 ms over 72k audit rows. Specs: `checkout-board-signals` 14/14, including the staff cap.

**D5. Staff cap** (`checkout.dto.ts` `capStaffRows`, `STAFF_BOARD_LIMIT = 8`). Both repositories return `staff` (Ready first, at most 8) plus `staffSummary {total, ready, busy, onBreak, shown}`.

**D6. Detail tenders** (`checkout.service.ts` `withTenders`). `detail()` adds:
- `tenders[]` with safe fields only (no token, no processor reference, no idempotency key);
- `paidCents`, the canonical paid read;
- `balanceCents = max(0, totalDue − paid)`.

If the read fails, these fields are left **out**, which shows as unknown, never 0.

**Migrations:** none. **APIs:** response fields added (additive): `kpisFull.pendingPaymentsToday` (number|null), `kpisFull.receiptDeliveryEligible`, `staffSummary`, detail `tenders / paidCents / balanceCents`. `staff` is now capped at 8. **Events:** none new. **Payment-state changes:** none (read side + refusal guards). **Permissions:** none changed. **Security:** fail-closed paid read; tender fields exclude secrets.

---

## E. Build matrix (executed evidence only)

| Item | Result | Evidence |
|---|---|---|
| POS BUILD | **PASS (stand-in)** | `node tooling/checkout-one-screen/build.mjs`: esbuild bundles `apps/pos-web/src/main.tsx` (650 inputs) + Tailwind 4. The repo's `vite build` NOT_RUN (no node_modules). |
| TYPECHECK | **PARTIAL** | Backend shimmed typecheck: 0 errors in the changed backend files. `packages/api-contracts` `tsc --ignoreDeprecations 6.0` exit 0. pos-web `tsc` **NOT_RUN** (no `@types/react`). |
| LINT | **NOT_RUN** | eslint not installed (`check:lint`: "eslint produced no JSON report"). |
| Repo gates | **PASS for every gate this change touches** | `run-all-gates.sh`: error-text, as-any (POSCheckoutScreen 2, baseline 4), silent-catch, raw-sql-inputs, money, i18n, pos-i18n, vi-glossary, inert controls, zoom, sql, types-drift, db-ownership, openapi all PASS. `run-gates.mjs` shows 12 FAILED: the 6 BLOCKED_DEPENDENCY gates recorded in `PRODUCTION_READINESS.md` (lint, api-contract, strict-bodies-types, architecture = TS 6 deprecation line, frontend builds, app types) + the 6 DB gates that pass on real Postgres in the same run (`RESULT sql 0` … `unique-tenant-review 0`). |
| CHECKOUT/PAYMENT UNIT | **PASS (no regression)** | 880 passed / 75 failed = baseline 853 / 75 + 27 new; the 75 are pre-existing stand-in limits (below). |
| INTEGRATION (pgtest) | **NOT_RUN** | PGlite is not installed; the stand-in cannot run Kysely's query builder. |
| E2E | **PASS** | `interact.mjs` 26/26; `measure.mjs` 35/35 + 14/14 (1366×633 scrolls by design, §117 fallback). |
| SERVICE DONE HANDOFF | NOT_RUN on this commit | unchanged code; Full System Test evidence stands. |
| CHECKOUT DEDUP | **PASS (board)** | New Checkout creates no ticket (E2E); server dedup unchanged. |
| TICKET TOTALS | **PASS** | totals-locked 8/8, discount-guard 3/3, final-totals spec in sweep. |
| DISCOUNT AUTH | **PASS** | discount-guard + totals-locked (>50 % needs override, unchanged). |
| SPLIT TICKET | **NOT BUILT — decision** | One ticket per visit is assumed across the platform (`visit-ticket.ts`, tech queue, customer history, owner analytics). The button is relabelled Split Payment. **Kevin decides** whether a true split ticket is wanted. |
| SPLIT PAYMENT | **PASS** | sweep (split specs) + E2E paid/balance. |
| IDEMPOTENCY | **PASS** | card-idempotency spec (sweep); POS keys unchanged (`createIntentKeys`, no `Date.now`). |
| UNKNOWN RECOVERY / VERIFY | **PASS** | card-verify 7/7; E2E UNKNOWN 2 checks. |
| UNSETTLED GUARD | **PASS** | payment-guard, concurrent-payment, totals-locked. |
| CONCURRENT PAYMENT | **PASS (unit)** · pg race NOT_RUN | concurrent-payment 3/3. |
| CASH / GIFT / LOYALTY / TIPS / RECEIPT | **PASS (unit)** | cash-tender, giftcard-*, loyalty-reward-code 12/12, tip-guard 4/4, tip-matrix 5/5, receipt specs in sweep. |
| CARD / TTP | **BLOCKED_EXTERNAL** | no real MID / processor sandbox (P0-2). |
| SIGNATURE | **PASS (board)** | View Signature reads the ticket signature (E2E); tenant scoping unchanged. |
| CUSTOMER DISPLAY / 3-SEC CLEAR | NOT_RUN on this commit | unchanged; display-session-events 7/7 in sweep. |
| TENANT/BRANCH ISOLATION | **PASS (SQL)** | branch queries verified on Postgres (branch B excluded). |
| REALTIME | **PASS (board)** | Live = CONNECTED from the real SSE client; Auto Refresh switch. |
| 200-TECH PERF | **PARTIAL** | Board payload capped at 8 staff rows (spec). API timing NOT_RUN (no built API). |
| 1920 ONE-SCREEN / NO V/H OVERFLOW / BUSY FIT | **PASS** | C. |
| TOUCH TARGETS | **PASS** | QA 58, actions 44, nothing visible under 30 px; queue row buttons 32 px (compact, rows 40 px). |
| EDGE | **NOT_TESTED** | |
| CHROME | **PASS (Chromium)** | Playwright Chromium; branded Chrome NOT_TESTED. |
| PHYSICAL TOUCHSCREEN | **NOT_TESTED** | |
| pos-web jsdom tests (POSCheckoutScreen*.test.tsx) | **NOT_RUN** | jsdom / testing-library not installed. They were updated for the changed insight; the note's test id was kept. |

Unit sweep (stand-in, all 123 non-PG spec files of `modules/checkout`): **880 passed, 75 failed**. That is the Full System Test baseline exactly (853 passed / 75 failed in the same 120 files, `docs/full-system-test/2026-10-28/unit-sweep.tsv`) plus the 27 new tests. The 75 are the same 10 files with the same counts: stand-in limits such as Nest `Reflect` metadata, fake timers, `mockRejectedValue` and route schemas. None of them is new.

---

## F. Permanent rules carried forward (§84)

1. UNKNOWN is never a decline. While a tender is unsettled, no new tender and **no bill change** can be made.
2. "What is already paid" fails **closed**.
3. The board never scrolls at 1920×1080. Long lists go in an overlay or an internal scroll, and messages float.
4. KPI and attention definitions belong to the server (`checkout-board-signals.ts`). The screen never derives them.
5. No dead buttons. A Quick Action either acts or explains why not.

## G. Next actions

- **Internal:**
  - run `POSCheckoutScreen*.test.tsx` with real node_modules;
  - run the pgtests;
  - run `vite build` + `tsc`;
  - re-run `measure.mjs` / `interact.mjs` against the dev server with the real fonts.
- **External (Kevin):**
  - Split Ticket decision;
  - pilot on the physical 27-inch touchscreen (Chrome and Edge);
  - K-12, then push.
