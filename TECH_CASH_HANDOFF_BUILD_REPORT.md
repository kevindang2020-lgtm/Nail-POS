# End-of-Day Tech Cash Hand-Off & Reconciliation — Build Report

## What it does
At the end of a shift, each technician hands the cash they collected during the day to the front desk, who counts
it and reconciles against what the system expects. The expected amount is not guessed — it is the sum of the
technician's **confirmed Skip-the-Line "cash to technician" payments** for that business date (every such payment is
already recorded with the collecting `technician_id`). One hand-off per technician per day; exact count = reconciled,
otherwise a flagged discrepancy.

## Audit finding (before building)
Not previously built. The data existed (cash payments were recorded and tech-attributed in
`cash_payment_confirmations`), and the tech app could confirm individual cash payments (`CashPendingScreen`), but there
was no per-technician end-of-day cash-out or reconciliation. `end-of-day-followups` is a customer re-booking feature and
`hardware_reconciliation_runs` is card/Fiserv residual reconciliation — neither touches tech cash. The reconciliation
was built on top of the existing cash data.

## Backend (`apps/api/src/tech-cash-handoff/`, migration `081`)
- **`tech_cash_handoffs`** — one row per (tenant, technician, business_date): expected_cents, counted_cents,
  variance_cents, payment_count, status (`open|submitted|reconciled|discrepancy|cancelled`), submitted/reconciled
  by-user + timestamps, notes. `UNIQUE (tenant_id, technician_id, business_date)`.
- **Expected cash** is derived live from `cash_payment_confirmations` (status `confirmed`, that technician, that date),
  joined to tickets + customers for a per-payment line list.
- **Technician endpoints** (`@Controller('tech')`): `GET /tech/me/cash-handoff?date=` (my cash + status),
  `POST /tech/cash-handoff/submit` (hand off — 400 if no cash; never downgrades an already-reconciled row).
- **POS / front-desk endpoints** (`@Controller('pos')`): `GET /pos/cash-handoffs?date=` (the board + day totals),
  `GET /pos/cash-handoffs/:technicianId?date=` (one tech's detail), `POST /pos/cash-handoffs/:technicianId/reconcile`
  (`{ countedCents, date?, notes? }` — computes variance, sets reconciled/discrepancy).
- **Auth:** the tech endpoints resolve the technician from the session (a non-technician gets `not_a_technician`).
  Viewing the board is open to any signed-in POS user; **reconciling requires `pos.checkout.take_payment`** (or OWNER).
- **Surfacing:** audit rows to `owner_audit_log` (`tech_cash_handoff_submitted` / `_reconciled`), a discrepancy raises
  one `owner_alerts` row, and realtime events (`cash_handoff_submitted` / `_reconciled` / `_discrepancy`) push to the
  tenant board and the technician.

### Backend live verification (vs Postgres, sandbox)
Generated real collected cash for a technician via the Skip-the-Line cash flow, then exercised the whole hand-off:
tech sees the correct expected total and line items → tech submits (status `submitted`) → POS board lists the tech with
the day total → reconcile **exact → reconciled, variance 0** → reconcile **short → discrepancy, variance −$5.00 with
exactly one alert** → audit trail present → a STAFF user **cannot** reconcile (403) but **can** view the board (200) →
an OWNER (non-technician) is blocked from the tech endpoint → full tenant isolation (a second tenant sees nothing).
API build clean; full backend suite **442/442** (no regressions).

## Technician app (`apps/tech-web`)
New **End-of-Day Cash** screen: the cash collected today + payment count, a **Hand off to front desk** button, and a
status-aware block that becomes "Handed off → waiting", "Reconciled ✓ (matched)", or an over/short discrepancy — plus a
per-payment list. Reached from More → **End-of-Day Cash**. Live-refreshes when the front desk reconciles. Tests: 4 added.

## POS (`apps/pos-web`)
New **End-of-Day Cash** board (sidebar, next to Checkout): a date picker, day-total KPIs, and a per-technician table
(expected, payments, counted, variance, status). **Count** opens an inline editor to enter the counted cash and
**Reconcile** — reconciled shows a matched confirmation, a mismatch shows over/short. Mac-fit cream/gold shell. Tests: 2 added.

## Test status
- API: **442/442**. tech-web: **33/33** (+4). pos-web: **60/60** (+2). All six frontends + API build clean.


## Owner app (`apps/owner-web`) — read-only oversight
A new **End-of-Day Cash** summary (More → End-of-Day Cash): for a chosen date, salon-wide totals (expected cash,
counted, net over/short, reconciled count, discrepancies, awaiting) and a per-technician breakdown (expected, counted,
variance, status). Read-only — the owner reviews; the front desk reconciles in the POS.
- Backend: `GET /owner/cash-handoffs?date=` on the existing owner controller, reusing `TechCashHandoffService.posList`
  (tenant-scoped from the session). Live-verified: returns the salon board (Ava expected $133.00 / counted $128.00 /
  −$5.00 discrepancy); a request with no session is 401; a different tenant's owner sees nothing.
- Tests: 2 added. owner-web suite **17/17**.

## Final test status (all surfaces)
API **442/442** · tech-web **33/33** · pos-web **60/60** · owner-web **17/17**. All six frontends + API build clean.


## Discrepancy alerts for the owner
When the front desk reconciles and the count doesn't match, the system writes a human-readable owner alert, e.g.
"Cash hand-off discrepancy — Ava Nguyen is short $3.00 — counted $130.00 vs $133.00 expected on 2026-06-16."
The owner's alerts feed (`listAlerts`) is category-agnostic (tenant-scoped), so these surface automatically in the
owner app's **Business Alerts** screen and count toward its unread badge — no extra wiring. Severity is `warning`.
Live-verified: the alert row's title/body render exactly as above.

## On branch filtering (intentionally not added)
A per-branch filter for the owner cash view was scoped but deliberately not shipped: the platform's
`tenant-context.middleware` strips `tenantId`/`branchId` from every request's query and body
(`stripClientTenantKeys`) so a client can never assert its own tenant/branch scope — scope is always derived
server-side from the session. Owner branch selection resolves from `ctx.selectedBranchId`, which is empty under this
control, so the owner views are salon-wide across the owner's authorized branches by design. The cash summary follows
the same model (salon-wide), consistent with the rest of the owner app. A true per-branch owner filter would require
changing the shared branch-scope plumbing — out of scope for this feature.


## Owner home dashboard glance
The owner home dashboard now shows a compact **End-of-Day Cash** card (below the revenue trend): today's total cash
collected, technician count, reconciled vs awaiting, and a red discrepancy flag when counts don't match. It taps through
to the full End-of-Day Cash screen. Self-contained (its own fetch) and hides quietly on days with no cash activity or on
any error, so it can never block the dashboard. Tests: 2 added. owner-web suite **19/19**.
