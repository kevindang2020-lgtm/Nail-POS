# Front-Desk Cash Drawer (Register) Reconciliation — Build Report

## What it does
At end of day the front desk counts the physical register drawer and reconciles it against what the system expects:
**expected = opening float + register cash sales − cash refunds**. Exact count = reconciled, otherwise a flagged
discrepancy. One drawer record per branch per business date; the drawer's branch is derived from the session.

## The key distinction (and why it's correct)
Register cash is **not** the same pool as technician cash. Skip-the-Line "cash to technician" payments are physically
held by techs and reconciled in End-of-Day Cash. The `payments` table has no source column, but every cash-to-tech
payment has a matching confirmed `cash_payment_confirmations` row while a POS-checkout cash sale does not. So register
cash sales are computed as approved cash payments for the branch/date **whose ticket has no confirmed cash-to-tech
record**; refunds are cash payments with status `refunded`. Live-verified: seeded $65.00 of register sales + a $10.00
refund registered exactly, while the technician's $133.00 cash-to-tech stayed out of the register total.

## Backend (`apps/api/src/cash-drawer/`, migration `082`)
- **`cash_drawer_sessions`** — one row per (tenant, branch, business_date): opening_float_cents, snapshot
  expected_sales/refunds/expected_cash, counted_cents, variance_cents, status (`open|reconciled|discrepancy|cancelled`),
  opened/reconciled by-user + timestamps, notes. `UNIQUE (tenant_id, branch_id, business_date)`.
- **Endpoints** (`@Controller('pos')`, branch from session):
  - `GET /pos/cash-drawer?date=` — float, live cash sales, refunds, expected, count, variance, status.
  - `POST /pos/cash-drawer/open` `{ openingFloatCents, date? }` — set/adjust the opening float (never downgrades a
    reconciled drawer).
  - `POST /pos/cash-drawer/reconcile` `{ countedCents, date?, notes? }` — count and reconcile.
- **Auth:** viewing is open to any signed-in POS user; opening/reconciling requires `pos.checkout.take_payment` (or
  OWNER). A session with no branch is rejected (`no_branch`).
- **Surfacing:** audit rows (`cash_drawer_opened` / `_reconciled`), a discrepancy raises one `owner_alerts` row
  ("Register drawer is short $5.00 — counted … vs … expected (float … + sales … − refunds …)"), realtime events to the
  branch.

### Backend live verification (vs Postgres)
Register sales delta = $65.00 and refunds delta = $10.00 with the technician's $133.00 cash-to-tech correctly excluded;
opening float $100.00; expected = float + sales − refunds; reconcile exact → reconciled (variance 0); short →
discrepancy (−$5.00) with exactly one alert and a readable body; STAFF cannot reconcile (403) but can view (200);
a no-branch session is rejected. API build clean; full backend suite **442/442**.

## POS front end (`apps/pos-web`)
New **Cash Drawer** screen (sidebar, next to End-of-Day Cash): KPIs (opening float, cash sales, refunds, expected,
variance), a date picker + status chip, an **Opening float** setter, and a **Count & reconcile** panel showing the
expected-cash breakdown. Mac-fit cream/gold shell. Tests: 2 added. pos-web suite **62/62**.

## Test status
API **442/442** · pos-web **62/62**. All six frontends + API build clean.

## Owner visibility (added)
The front-desk drawer now also has **read-only owner oversight**, mirroring the End-of-Day Cash (tech cash) summary:
- **Backend:** `GET /owner/cash-drawer?date=` — per-branch register drawer state across the tenant (salon-wide,
  tenant-scoped server-side). Reuses `CashDrawerService` via a new `ownerList` that enumerates active branches and
  computes each branch's expected/counted/variance. `OwnerModule` imports `CashDrawerModule`. Live-verified: returns the
  branches array with per-branch float/sales/refunds/expected/counted/variance/status; auth-gated (401 without session).
- **owner-web:** new **Cash Drawer** screen (More → Cash Drawer) — KPIs (expected, counted, reconciled/discrepancy) plus
  a per-branch card list with the float + sales − refunds breakdown. Owner reviews; the front desk reconciles in the POS.
  Discrepancy alerts already reach the owner's Business Alerts automatically (category-agnostic feed). owner-web 19/19.

## Mid-shift cash movements (added)
The drawer now models real register behavior: cash added or removed mid-shift adjusts the expected total —
**expected = opening float + cash sales − cash refunds + paid-in − paid-out**.
- **Backend** (migration `084_cash_drawer_movements`): `POST /pos/cash-drawer/movement` `{ direction:'in'|'out', amountCents, reason?, note?, date? }` and `GET /pos/cash-drawer/movements?date=`. Recording requires `pos.checkout.take_payment`; viewing is open to any POS user. `computeMovements` nets in/out via SQL `FILTER`, and both the live state and reconcile fold it into expected. Audit + realtime per movement. Live-verified (10/10): paid-in raises expected, paid-out lowers it, reconcile matches with movements included, staff blocked from recording (403) but can view, invalid direction/amount rejected.
- **pos-web:** a **Cash in / out** panel on the Cash Drawer screen (direction toggle + amount + reason) with a movements list; the expected breakdown shows `+ in − out`. pos-web 63/63.
- **owner-web:** the owner Cash Drawer summary breakdown now includes `+ in − out` per branch.

## Daily cash close-out (owner) — added
A single end-of-day **total cash position** that combines both pools for the owner:
- **Backend:** `GET /owner/cash-summary?date=` — a pure aggregation (`combineCashSummary`) over the existing
  register-drawer (`ownerList`) and technician hand-off (`posList`) summaries; no new storage. Returns `register`,
  `techCash`, and `total` (expected / counted / variance), each pool with reconciled / discrepancy / awaiting counts.
  Live-verified: register $246.50 + tech $133.00 = total expected $379.50, counted $376.50, net −$3.00 (totals equal
  the sum of pools); auth-gated. Unit test covers the aggregation + empty pools.
- **owner-web:** new **Daily Cash** screen (More → Daily Cash) — a headline total cash position (counted / expected with
  a balanced-or-over/short callout) plus per-pool cards for the register drawer and technician cash. Refreshes on either
  pool's realtime events. owner-web 19/19.

## Exportable close-out (CSV) — added
The owner's **Daily Cash** screen can now **Download CSV** — an end-of-day close-out for record-keeping / accounting.
- Pure builder `buildCashReportCsv(summary, branches, techs)` (unit-tested) renders: total cash position, a per-branch
  register section (branch · float · sales · refunds · cash in · cash out · expected · counted · variance · status), and
  a per-technician cash section. Amounts are plain dollars so it imports cleanly into Excel / QuickBooks; names with
  commas are quoted, uncounted values left blank.
- Client-side: the button fetches the existing register (`/owner/cash-drawer`) and tech (`/owner/cash-handoffs`) detail
  for the date and Blob-downloads `cash-close-out-YYYY-MM-DD.csv`. No new backend. owner-web 21/21.
