# Tips & Gratuity + Split Payments — one-screen rebuild (Oct 29 2026)

Built from `AI_PowerSalon_Tips_Claude_Build_Guide.pdf` and `Split_Payments_Claude_Build_Guide.pdf`, plus the owner's ask that
every split ticket shows its payment breakdown without opening another page.
Branch `merge-github-main`, **not pushed** (K-12 steps 1–5 still open — SECURITY_REMAINING_ACTIONS.md §A).

## The $9.60 / $19.20 — root cause (traced, fixed at the source, flagged in reporting)

The Tips page summed **ticket_compensation_snapshots** (the frozen payroll rows, one per service line per technician) for
"Tips by Technician", while "Total Tips" came from the ticket's own `tip_cents`. The snapshot writer credits a technician's
tip to their **first** row only — but `loadServiceLines` read lines with **no ORDER BY**, and `persistSnapshot` was a per-row
`ON CONFLICT DO NOTHING`. A re-run of the snapshot (checkout retry, the compensation recovery worker, the payroll retrier —
all real callers) that saw a different first line (a line added after the first attempt, or an unordered read) inserted a
**second tip-bearing row** while the first kept its own: Σ snapshot tips = 2 × the collected tip. One $9.60 tip, two line rows
→ $19.20. `persistSnapshot` also swallowed a failed insert as success.

- **Source fix** (`modules/workforce/src/compensation/compensation-snapshot.repository.ts`, `compensation.kysely.ports.ts`):
  lines are read in a deterministic order; the ticket's snapshot is written in one transaction under its existing rows —
  only missing (line, technician) rows are inserted and their tip / retail credit is the engine amount **minus** what the
  ticket's rows already credit, so Σ rows per (ticket, technician) always equals the collected tip, whatever the order or
  retry count. A failed persist now reports 0 rows. Regression test in `compensation-snapshot.vitest.spec.ts` (7/7).
- **Reporting**: the new Tips read model never sums snapshot rows. Allocated tips come from `ticket_tip_allocations` (one row
  per ticket and technician, upserted). The snapshot is still read per ticket and a ticket whose frozen rows disagree with
  its collected tip is **flagged** ("Snapshot mismatch" — on the row, in the detail, in the reconciliation strip, and as a
  status filter). Historical doubled rows are **not** rewritten (the guide forbids altering accounting records); the detail
  shows the collected, allocated and snapshot figures side by side so payroll can be corrected through the existing audited
  tip-adjustment path.
- **Also found**: every single-tender payment row carries the whole ticket tip in `payments.tip_cents` (Checkout writes it
  that way; a split's tenders carry 0). Any report that sums `payments.tip_cents` across tenders would double. The read model
  takes the tip from the ticket and only uses payment rows for the card/cash split under the compensation engine's own rule.

## What was built

**Tips & Gratuity** (`/tenant/payments/tips`) — header (Refresh · Export Tips) · one filter row (universal search · date presets +
Custom Range month calendar · date field: Tip collected (default) / Checkout / Allocation / Adjustment / Payout · technician ·
method · status) · five equal KPIs from the server over the whole scope (Total Tips, Card Tips, Cash Tips, Average Tip — the
rate = tips ÷ pre-tip sales with the per-ticket average beside it — No-Tip Count) · a reconciliation strip (collected ·
allocated · unallocated · paid out · pending · mismatches) · four views: Overview (labelled horizontal bars + distribution
table + recent tips), Tip Transactions (paged, newest first), Technician Distribution (card / cash / allocated / share /
corrections / paid out / pending / tickets), Adjustments & Reports (reconciliation figures, corrections and reversals by
their own date, CSV export of all matching records). Detail overlay: payments with their tip parts, each technician's
allocation against the frozen snapshot and corrections, split rule, payout state, adjustment history, audit trail.
**Adjust allocation** is the existing `POST /pos/tickets/:id/tip-allocation` (tips.adjust, step-up): Σ must equal the tip, a
reason is required; on a paid ticket it posts signed correction entries and never rewrites the snapshot or the card charge.

**Split Payments** (`/tenant/payments/split-payments`) — header (Refresh · Export) · five KPIs (Split Tickets · Split Total ·
Avg Tenders · Completed · Outstanding Balance) · universal search · status / method combination / register / sort · period
bar with Completed / Created / Tender / Refund / Last-activity date field · ONE ROW PER TICKET, newest first, server paged.
Each row opens its **payment breakdown in place** — Total ticket · Cash · Credit Card · Gift Card · (Refunded) · Remaining
balance — and the detail overlay lists every tender attempt with method vs channel, state (confirmed / pending / failed /
reversal), processor reference, gift-card ledger link (never a code), cash-drawer link, refunded and still-refundable amounts,
the refunds, the ticket's financial summary and audit trail. Definitions: a qualifying split has **two or more confirmed
tenders**; a declined attempt is listed as a failed attempt and never counted; a partially paid ticket is shown with its due
balance and a "Finish at Checkout" action; the tip is the ticket's one tip.

Why the photo showed 0: the old route grouped only the newest 2,000 payment rows in memory and turned a read error into an
empty list (`emptyOnReadError`), which the page rendered as a verified-looking 0. It now throws, and the old route is retired
(410 ENDPOINT_RETIRED); the screen reads the new ticket-grain routes and shows an honest error state.

## Files changed

Server: `modules/payments/src/finance-screens/{tips,split-payments}-screen.{repository,controller}.ts` (new read models) and
their `*.pgtest.vitest.spec.ts`; `payments/payment-reconciliation.module.ts`, `payments/src/index.ts`;
`split-payments/split-payments.{controller,kysely.repository}.ts` (retired / no silent empty);
`modules/workforce/src/compensation/compensation-snapshot.repository.ts`, `compensation.kysely.ports.ts`,
`compensation-snapshot.vitest.spec.ts` (the source fix); `apps/api/scripts/unreached-routes.baseline.json`; openapi manifest;
attack surface.
POS: `screens/POSTipsScreen.tsx`, `screens/POSSplitPaymentsScreen.tsx` (rebuilt), `POSTipsScreen.test.tsx` (new),
`POSSplitPaymentsScreen(.403).test.tsx`, `POSPaymentsScreens.test.tsx`; `api/posTipsScreenApi.ts` (new),
`api/posSplitPaymentsApi.ts`; `i18n/ns/{tips,splitpay}.{en,vi}.ts` (new, 301 keys), `ns/index.ts`; `styles.css`.
Tooling/docs: `tooling/tips-split-one-screen/*` (seed, live server, measure, E2E, results), this file,
`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` **A39**.

No database migration: both read models work on the existing tables (`tickets`, `payments`, `payment_refunds`,
`ticket_tip_allocations`, `ticket_compensation_snapshots`, `compensation_adjustments`, `payroll_periods`,
`gift_card_transactions`, `cash_drawer_movements`).

## Tests

| Check | Result |
|---|---|
| `tips-screen.pgtest` (real schema: the photo, cash, 3-way split, split tender, refund reversal, paid period, search forms, isolation, paging) | 9/9 |
| `split-payments-screen.pgtest` (the four canonical tickets, the refund, filters, every search form, detail, isolation, paging) | 5/5 |
| `compensation-snapshot.vitest` incl. the $9.60 → $19.20 regression | 7/7 |
| `split-payments.vitest` (the retired builder's own tests) | 4/4 |
| Chromium E2E against the real read models (`interact.mjs`): KPIs, the photo, reconciliation invariant, search, calendar, pagination, detail, adjustment, both views, 403, split KPIs, in-place breakdown, partial ticket, refund attribution, gift ledger, filters, export, error state, empty salon, Vietnamese | 22/22, no page errors |
| One-screen fit: 5 views × EN / VI / empty × 1920×945 · 1536×729 · 1440×900 · 1366×768 (`measure.mjs`) | 60/60 — no page scroll, every module painted, no touch target under 44 px, text ≥ 12 px (primary 13–14 px) |
| Gates (`run-gates.mjs`) | the same 12 environment failures as before; sql:select and as-any fixed; no new ones |
| POS unit tests (`POSTipsScreen.test.tsx`, `POSSplitPaymentsScreen*.test.tsx`) | **written but not run** — no vitest in this workspace; please run `npm test -w apps/pos-web` |

## Not verified / open

- The **tip re-allocation write** runs through `TipAllocationService` (query builder), which the sandbox cannot execute; in
  the harness it is simulated with the product's own validation (`validateTipAllocation`) and delta rule
  (`tipCorrectionDeltas`) and the same row changes. The real route is unchanged and untested here.
- **Payout state** is derived from the payroll period that contains the ticket's collection day (`payroll_periods`
  status / payout_status); there is no per-tip payout record in the schema, so "Paid out" means "its period was paid".
- **Card / cash split** of a tip follows the compensation engine's rule (payment rows by method; remainder to the dominant
  rail; the ticket's chosen method when rows carry no tip). It is a derivation, labelled as such on the screen.
- **Average Tip** is defined as total tips ÷ pre-tip sales (subtotal − discounts, tax excluded) over every eligible ticket,
  with the per-tipped-ticket average shown beside it. The old 6.7% was the same ratio over a different, undocumented set;
  both numbers are now stated with their definitions.
- The Tips screen reads `pos.reports.view` (owner / manager); technicians keep their own earnings view in the Technician
  App. Exports need `pos.reports.export`.
- Split Payments: a ticket's expected total for an unpaid ticket is its locked checkout total, else total + tip — the
  harness covers the partial case; a live partial ticket paid later should be re-checked once the screen is in use.
- No processor, terminal or payroll run was touched; no money moved; no live charge or refund was made.
