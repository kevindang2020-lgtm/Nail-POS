# End-of-Day Cash + Refunds & Voids — one-screen rebuild (Oct 29 2026)

Built from `End_of_Day_Cash_Claude_Build_Guide.pdf` and `Refunds_Voids_Claude_Build_Guide.pdf`.
Branch `merge-github-main`, **not pushed** (K-12 steps 1–5 still open — SECURITY_REMAINING_ACTIONS.md §A).

## Why the photos showed $0.00 / 0 (investigated, not assumed)

- **End-of-Day Cash** (`/cash-handoffs`): the page read one day only and summed the KPIs in the browser. The test salon had no
  confirmed cash-to-technician payment that day, so 0 was *correct* — but a read error showed the same "No technician
  collected cash on this date" text. The header date (Oct 28, 11:31 PM) vs the field (10/29): the field defaulted to the
  **UTC** date (`new Date().toISOString()`), which at 11:31 PM New York is already the next day. The server already used the
  branch's business date; the page now takes Today from the server (salon time zone), so both agree.
- **Refunds & Voids** (`/tenant/payments/refunds-voids`): the old `/pos/refunds-voids/state` read the newest 1,000 *payment
  rows* with a refund / void status — so a void counted its zero-amount record row, a pending or failed refund (which lives in
  `payment_refunds`) never appeared, KPIs had no period, and a read error was turned into an empty list (`emptyOnReadError`).
  The route now answers 410 ENDPOINT_RETIRED; the screen reads the new ledger routes and shows an honest error state.

## Definitions (documented on the screens, in the APIs and in the CSV headers)

**End-of-Day Cash** — one reconciliation unit = one technician × one salon-local business day.
- **Expected (Cash)**: Σ confirmed cash-to-technician collections (`cash_payment_confirmations`, status confirmed) that day.
  Not salon cash sales, drawer cash, commission or tips. A $100 split paid $40 cash to the technician + $60 card counts **$40**.
  (The Cash Drawer already excludes tickets with a technician cash confirmation, so the two never double count.)
- **Counted**: Σ accepted counts. A count / recount *replaces* the unit total; a **partial hand-off adds** to it. Never the expected amount.
- **Technicians**: distinct technicians with expected cash or a hand-off. **Reconciled**: balanced, or resolved after review (shown apart).
  **Awaiting**: open or handed-off units still to count. A technician who never owed cash is not listed.
- **Difference** = counted − expected (negative = short, positive = over). A resolution keeps the original figures.
- Business date = salon time zone; timestamps compared start-inclusive / next-day-exclusive; 11:30 PM belongs to that day.

**Refunds & Voids** — one row per reversal from the authoritative records:
- **Refund** = a `payment_refunds` row (Checkout's claim-first reservation against ONE tender): reserved / pending → Pending;
  processing → Processing, or **Needs review** once the sweep could not decide (review_reason / stranded); refunded → Completed;
  failed → Failed; cancelled / voided → Cancelled. A partial refund is one that returns less than its tender.
- **Void** = the original tender marked voided, at face value, with the void record and the audit reason; "not cash returned".
- **Total Reversed** = completed refunds + voided face values (operational). **Pending** and **Needs Review** are counted apart.
- **Still refundable** on a tender = captured − completed refunds − pending reservations ($100 − $30 − $20 = $50).

## What was built

**End-of-Day Cash** — header (Record Hand-Off · Refresh · Export Report · Cash Drawer closeout) · five KPIs · a difference
strip (net · short · over · balanced · not yet counted · into the drawer — each clickable as a filter) · universal search
(technician name / phone / id, hand-off id, ticket #, linked customer name / phone through ticket → cash confirmation,
amount, business date) · status / technician / sort · period bar (Today default + Week / Month / Year / Custom month calendar,
date field Business / Counted / Handed off / Created) · server-paged table newest first · detail overlay (eligible cash tickets
with the split part, every custody event, drawer transfers, audit) · **count overlay**: full count or *Add a partial hand-off*,
optional count sheet by denomination, live difference marked "estimate", reason required for a difference, optional
**transfer into the register drawer** (one `cash_drawer_movements` 'in' row — a custody move, never a sale), the version the
counter saw, one idempotency key per submission · **resolve overlay** (manager, reason required; figures kept).

**Refunds & Voids** — header (Find Original Payment · Refresh · Export Report) · five KPIs · universal search (name, phone in
any format, email, ticket #, payment / refund / void id, provider or original reference, amount) · type / status / method /
sort, processor and register when there is more than one · period bar (Requested / Completed / Original payment date) ·
server-paged ledger · detail overlay (the original tender with captured / refunded / pending / still refundable and why an
action is off, every tender on the ticket with its own refundable amount, the refund history on that tender, gift-card ledger
entry (last four, never the code), settlement link or "Not linked", ticket tip allocation and loyalty points, audit) ·
**Find Original Payment**: captured tenders with their refund position → **Refund ONE tender** (amount ≤ refundable, reason,
review step, step-up, one key per intent) · **Refund from ticket** (the existing split-across-tenders panel) · **Void** (card
only, unsettled, no refund row — Checkout's own rule; reason required). All through the existing Checkout routes.
A lost processor answer is shown as held/"do not refund again" and blocks a second refund on that tender.

## Writes, schema and permissions

- Migration **715** (expand-only): `tech_cash_handoff_events` (immutable custody ledger, unique idempotency key per salon) and
  on `tech_cash_handoffs`: `version`, `denominations_json`, `resolution_reason` / `resolved_by_user_id` / `resolved_at`,
  `drawer_transfer_cents`; two indexes. Nothing rewritten; ownership registry entry added (append-only, financial retention).
- `POST /pos/cash-handoffs/:technicianId/reconcile` (existing, now `@Idempotent`): `mode`, `denominations`, `expectedVersion`,
  `idempotencyKey`, `transferToDrawer`, `registerId`. A stale version → 409 HANDOFF_VERSION_CONFLICT (the first count stands).
- `POST /pos/cash-handoffs/:technicianId/resolve` (new, `checkout.manage_overrides`, `@Idempotent`): discrepancy → reconciled with
  the reason; the figures stay. Never deducts from earnings or tips.
- New reads: `/pos/payments/cash-handoffs/{list,summary,technicians,export,:technicianId/:businessDate/detail}` and
  `/pos/payments/refunds-voids/{list,summary,facets,find,export,:kind/:id/detail}` — `pos.checkout.view`; exports `pos.reports.export`.
- Roles (from the permission catalog): owner / manager count, resolve, refund, void, export; **front desk counts but cannot
  resolve, refund, void or export**; technicians are refused (their own cash stays in the Technician App).
- 7 error codes registered (HANDOFF_VERSION_CONFLICT, HANDOFF_NOT_COUNTABLE, HANDOFF_NOT_UNDER_REVIEW, HANDOFF_NOT_FOUND,
  HANDOFF_RESOLUTION_REASON_REQUIRED, COUNT_SHEET_MISMATCH, REVERSAL_NOT_FOUND), EN + VI, app catalogs regenerated.

## Files

Server: `modules/payments/src/finance-screens/{cash-handoffs,refunds-voids}-screen.{repository,controller}.ts` + pgtests;
`payments/payment-reconciliation.module.ts`, `payments/src/index.ts`; `refunds-voids/refunds-voids.{controller,kysely.repository}.ts`
(retired / no silent empty); `modules/workforce/src/tech-cash-handoff/tech-cash-handoff.{repository,service,pos.controller,dto}.ts`,
`tech-cash-handoff-core.spec.ts`, `tech-cash-handoff.pgtest.vitest.spec.ts` (new); `workforce/src/request-schemas.ts`;
`packages/api-contracts/src/{errors.ts,tenant/workforce.ts}`; migration 715; ownership registry; event catalog; openapi
manifest; attack surface; unreached-routes baseline.
POS: `screens/POSCashHandoffScreen.tsx`, `screens/POSRefundsVoidsScreen.tsx` (rebuilt) + tests; `api/posCashHandoffApi.ts`,
`api/posRefundsVoidsApi.ts`; `i18n/ns/{cashhandoff,refundsvoids}.{en,vi}.ts` (new), `ns/index.ts`, `ns/errors.{en,vi}.ts`;
glossary fixes in `ns/{tips,splitpay}.vi.ts`; `styles.css` (`.ch` / `.rv`).
Tooling/docs: `tooling/cash-refunds-one-screen/*` (seed, live server, measure, E2E, dialogs, results), this file,
`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` **A40** (313 strings).

## Tests

| Check | Result |
|---|---|
| `cash-handoffs-screen.pgtest` (real schema: custody vs split ticket, salon-local business date at 11:30 PM, five KPIs, difference, states, every search form, isolation, paging, detail, CSV) | 11/11 |
| `refunds-voids-screen.pgtest` (completed / partial / pending / lost-answer / failed / gift-card refunds, a void counted once, KPIs, filters, every search form, refundable position, split tenders, find + eligibility incl. cash not voidable, isolation, paging, CSV masking) | 12/12 |
| `tech-cash-handoff.pgtest` — the **real writer** on the real schema: $200 + $100 partials, idempotent retry, stale version refused, recount history, drawer transfer = one movement and no payment row, resolution keeps figures, cross-salon | 6/6 |
| `tech-cash-handoff-core.spec` (service rules incl. partials, count sheet, conflict, resolve permissions) | 26/26 |
| `refunds-voids.vitest`, `split-payments-screen.pgtest`, `tips-screen.pgtest` (regression) | 5/5 · 5/5 · 9/9 |
| Chromium E2E (`interact.mjs`): KPIs, split custody, midnight business date, search, paging, count sheet, two partials + drawer, double submit, version conflict, resolve, no-cash technician, roles, export, error state; refund KPIs, search, filters, paging, refundable position, split tenders, gift ledger, refund one tender with cap, void, lost answer, front-desk limits, export, empty salon, Vietnamese | **26/26**, no page errors |
| One-screen fit: 3 views × EN / VI / empty × 1920×945 · 1536×729 · 1440×765 · 1366×633 (`measure.mjs`) | **36/36** — no page scroll, every module painted, no touch target under 44 px, text ≥ 13 px |
| Gates (`run-gates.mjs`) | the same 12 environment failures as before; tenant-builder, error-text, as-any, response-exposure, event-producers, architecture (mirrored type), vi-glossary all clean |
| POS unit tests (`POSCashHandoffScreen.test.tsx`, `POSRefundsVoidsScreen*.test.tsx`) | **written but not run** — no vitest in this workspace; please run `npm test -w apps/pos-web` |
| `workforce/request-schemas.vitest.spec` | 0/88 here **and at the previous commit** — the stand-in cannot read route decorators; please run in CI |

## Not verified / open

- **Refund / void writes** run through Checkout (`CheckoutService.refund` / `void`, query builder); the sandbox cannot execute
  them, so the E2E answers them with the same rules (cap incl. pending reservations, refund + reversal rows, lost-answer
  hold, void marks the original) — labelled SIMULATED. **No processor, sandbox or live, was called.** Provider sandbox
  verification of refund / void / status refresh is still required, as the guide says.
- **"Check provider status"** opens the existing unsettled-refund panel (manual settle with the processor record, step-up);
  there is no automatic provider status query in the connected adapter — reported, not faked.
- The **expected-cash read** in the hand-off service (`expectedCashForTech`) uses the query builder; the harness computes the
  same sum in SQL. The writer (`reconcile` / `resolve`) is the real code in both the pgtest and the E2E.
- Shifts are not modelled (no shift table); a unit is technician × business day. A business-day cutoff other than midnight is
  not configurable in settings today; the salon time zone is honoured.
- The count sheet uses US denominations (the salon's only currency); the counted total is what is saved.
- Settlement link = `payments.settlement_batch_id` of the reversal row when the processor reported it; otherwise "Not linked".
- Tips / loyalty effects are *shown* (allocation, earned / reversed points); the reversal rules stay in Checkout's existing
  `afterRefund` path — nothing new adjusts them.
- Not pushed; no secrets touched; no money moved.
