# Deposits & Settlements · AI Deposit Reconciliation · Invoices — build handoff (Oct 29 2026)

Three Payments & Money screens of the Front Desk POS rebuilt against the three Oct 29 specs
(`Settlements_Claude_Full_Build_Guide.pdf`, `Deposit_Reconciliation_Claude.pdf`, `Invoices_Claude.pdf`) inside the
existing codebase: the same shell, sidebar and top bar, the POS gold-and-cream design, English + Vietnamese through the
existing POS i18n (the customer-facing invoice PDF is English only).

| Route | Screen | One screen at 100 % zoom (no page scroll) |
|---|---|---|
| `/tenant/payments/settlements` | Deposits & Settlements | header (Refresh · Export Report · View Deposit Reconciliation) · toolbar (presets + Custom Range + date field · search · processor · status) · 6 KPIs · reconciliation strip · Settlements / Refunds tabs, numbered server pages |
| `/tenant/payments/deposit-reconciliation` | AI Deposit Reconciliation | header (Refresh · Record a Deposit) · tabs Overview · Fees · Exceptions · Reports + universal search · period / status / processor / bank account · 5 KPIs · the tab body |
| `/tenant/payments/invoices` | Invoices | header (Export CSV · New Invoice) · 4 KPIs with their scope · search · status · period (+ date field) · amount · sort · filter chips · the invoice table, numbered server pages |

Every list is paged **on the server**, newest created first; the page size is the number of rows that fit the panel
(`useFitRows`), so a list never grows the page. Every KPI is a server aggregate over the same filters as the list.
A failed load is an error with Retry, never a `$0.00`. Every mutation and every export is audited.

## Shared behaviour (all three pages)
- **Period**: Today · This Week (Mon–Sun) · This Month · This Year (+ All on Invoices) are resolved **by the server in
  the salon's time zone** (`branches.timezone`; the answer carries the dates, shown next to the presets). **Custom
  Range** opens a month-view calendar (From / To, previous / next month, month and year jump, weekday headings, Today
  marker, highlighted interval); nothing is applied before **Apply**; **Cancel** keeps the old period; **Clear** empties
  both; picking a day before From restarts From (To before From cannot be applied). Max range 3,700 days.
- **Date field** selector: Settlements (settlement date · expected payout · created), Reconciliation (settlement ·
  expected deposit · bank posted · payment · created), Invoices (issued · due · created · paid).
- **Search** is server-side, debounced 300 ms; a newer request makes an older answer stale (dropped, `useLoad`).
- **New record**: when a new record arrives it is first on Page 1 (highlighted) if it qualifies; if the filters hide
  it, a note says so with *View* / *Clear filters*.
- **Roles** (server-enforced; the UI hides what the role cannot do):
  - Settlements: read `pos.reports.view`, export `pos.reports.export` (owner / manager).
  - Reconciliation: `reconciliation.view` / `.manage` (owner, manager), `.approve` (owner: unmatch, resolve a case,
    a partial-on-both-sides match, bank accounts — bank-account routes also require step-up).
  - Invoices: create / send / record payment `pos.checkout.process_payment` (front desk too); edit, void, link a
    customer and export `pos.checkout.void` (owner / manager).
- 44 px touch targets (tabs raised from 40 px; presets min-width 44 px). Distinct loading / empty / no-match / error /
  no-permission states.

## Definitions (what each number is)

### Deposits & Settlements
- **Settlements**: processor batches in the period (by the chosen date field).
- **Gross Settled**: Σ batch gross as reported by the processor. **Processor Fees**: Σ fees deducted in the batches
  (monthly / separately billed fees are not in the feed — the card says so).
- **Net Processor Payout** = gross − fees − refunds/chargebacks netted **inside** the batch ± adjustments. It is the
  processor's figure, **not bank cash** (the old "Net Deposited"). Refunds are no longer subtracted a second time.
- **Refunds**: count excluding cancelled (completed · open · failed split). **Refunds Total**: completed refunds only,
  by refund date.
- **Reconciliation strip**: Gross → − Fees → − in-batch refunds → = Expected Processor Payout | Bank Confirmed (Σ active
  allocations to bank deposits) | Difference = bank confirmed − expected for the batches that have a match
  ("Not bank verified" when nothing is matched).

### AI Deposit Reconciliation
- **Status** of a settlement (derived, never stored): matched (allocations = expected) · partially_matched ·
  expected (not yet due) · pending (provider pending) · overdue (expected arrival + 2 grace days passed with no
  deposit) · exception (an open case) · under_review · no_payout (expected ≤ 0). Expected arrival = the processor's
  date when supplied, otherwise settled date + 3 days (marked *est.*).
- **Expected Deposits**: Σ expected net of the settlements in scope. **Matched**: Σ active allocations.
  **Missing Deposits**: overdue count. **Net Difference** = matched − expected for payouts already **due**; payouts not
  yet due are excluded (the card explains the calculation when tapped).
- **Matching is an allocation a person makes** (`reconciliation_allocations`): 1:1, split (one payout → several
  deposits), combined (several payouts → one deposit), partial. The person ticks "I reviewed the evidence"; the amount
  is ≤ what remains on both sides (checked under `FOR UPDATE` in one transaction); idempotent per request key.
  A partial on **both** sides needs the owner. **Unmatch** needs a reason and the owner; rows are never deleted or
  edited (DB trigger) — the unmatch is a stamp, the history stays.
- **Suggestions** are rule-based evidence, never applied by themselves: high = the bank reference contains the
  settlement id; medium = same amount within the date window; low = similar amount.
- **Record a Deposit** creates a record of a credit the person sees on the statement (source `manual`) — no money
  moves. No future date, max $1,000,000, the duplicate bank reference on the same account is caught first
  ("Record anyway" is explicit).
- **Bank accounts** are labels (nickname, bank, type, last 4 only — a full number is refused). One default per salon;
  deactivate keeps history. Never a payout destination.
- **Exceptions**: classes missing · amount mismatch · duplicate · unmatched credit · fee/reversal · integration;
  severity, reviewer, age. View evidence · Assign · Under Review · Resolve (owner, reason required) · Reopen; raising
  the same case twice returns the existing one.
- **Reports** (each paged, totals over every filtered record, CSV + PDF): settlement summary · matched deposits ·
  unmatched deposits · missing / overdue · processing fees · exceptions aging (0–7 / 8–30 / 31–60 / 61+ days) ·
  net-difference trend (by week) · bank accounts · processor comparison.

### Invoices
- **Display status**: draft · sent · overdue (sent / partially paid and past due) · partially_paid · paid · void.
- **Outstanding**: Σ balance of sent / overdue / partially paid. **Paid**: cash collected (Σ recorded payments).
  **Drafts**: count and Σ. **Total**: invoices in scope (voided shown separately). The scope (period + filters) is
  written under the KPIs.
- **New Invoice**: a customer **of this salon** is required (the old form never linked one — the "—" customer);
  the bill-to (name, phone, email) is kept as a snapshot; totals are computed by the server (client totals refused);
  numbering under an advisory lock; idempotent. Save draft · Save & preview · Send.
- **Record Payment** replaces "Mark Paid" (a status toggle that recorded no money): an immutable entry ≤ balance
  (cash · check · card taken elsewhere · bank transfer · other), partial → Partially Paid, the rest → Paid. It is not
  a card charge. **Void**: reason required; refused once money was received. **Link customer** repairs an unlinked
  invoice (manager; never guessed by name).
- Dates are `YYYY-MM-DD` from the server and formatted by one helper; a missing date shows "Not set" (the
  "Invalid Date" fix). **PDF**: preview in the page, "Open to print" opens the browser's viewer (no print dialog from
  the app — owner decision), download. English only.

## Changed files
- **Database**: `apps/api/db/migrations/711_finance_one_screen.sql` (allocations + immutability trigger, notes, bank
  account default / deactivation, deposit audit columns, legacy 1:1 links copied into allocations, invoice payments +
  immutability trigger, invoice bill-to snapshot / sent / paid / void columns), `712_finance_list_indexes.sql`
  (concurrent list indexes).
- **Server** (`modules/payments/src`): `finance-screens/` (finance-scope, settlements-screen repository + controller,
  recon-workspace repository + controller, finance-pdf), `invoices/invoices-ledger.repository.ts`,
  `invoices/invoice-pdf.ts`, `invoices/invoices.controller.ts` (new routes; legacy kept), `invoices.service.ts`
  (`setStatus` refuses paid / void; customer-web Pay now refuses — it marked invoices paid without taking money),
  `payments-lifecycles.ts` (INVOICE machine incl. partially_paid; new BANK_ACCOUNT machine), `request-schemas.ts`,
  module wiring, `deposit-reconciliation.controller.ts` (superseded routes removed — see below),
  `packages/api-contracts/src/errors.ts` (29 codes).
- **Removed legacy routes** (no caller left after the rebuild; superseded by `pos/deposit-reconciliation/workspace/*`):
  `GET state`, `GET|POST bank-accounts`, `GET|POST deposits`, `POST deposits/:id/link`, `GET fee-reconciliation`,
  `GET exceptions`, `POST exceptions/:id/assign|resolve`, `GET reports/daily|summary`, `GET reports/daily/export`
  (with their client methods, body schemas, role-matrix / strict-bodies entries; the critical step-up pattern now
  covers the workspace bank-account routes). Remaining legacy routes (fee schedules, adjustments, duplicates, periods,
  explain, rescan) are unchanged.
- **POS** (`apps/pos-web/src`): `components/FinanceKit.tsx`, `api/posSettlementsApi.ts` (new),
  `posDepositReconApi.ts`, `posInvoicesApi.ts`, the three screens rewritten, `POSCustomerProfileScreen.tsx`
  (`?customerId=` deep link), `i18n/ns/finance.{en,vi}.ts` (683 keys), errors.{en,vi}, `styles.css`;
  `POSDepositReconPanels.tsx` deleted; the six screen tests rewritten.
- **Generated**: OpenAPI manifest, attack surface, error catalogs of the other apps.
- **Harness** (`tooling/finance-one-screen/`): `seed.mjs`, `live-server.mjs`, `measure.mjs`, `interact.mjs`, results.

## Verification (what was actually run here)
| Check | Result |
|---|---|
| `finance-screens.pgtest.vitest.spec.ts` (real SQL, PGlite) | 21 / 21 |
| `invoices-ledger.pgtest.vitest.spec.ts` | 12 / 12 |
| `invoices.vitest.spec.ts` · `payments-lifecycles.vitest.spec.ts` · `deposit-reconciliation.vitest.spec.ts` | 8 / 8 · 5 / 5 · 14 / 14 |
| Fit matrix `measure.mjs fit`: 7 views × 4 viewports (1920×945, 1536×729, 1440×765, 1366×633) × pilot-en / pilot-vi / empty-en | 84 / 84 pass: no document or page scroll, every module and pager painted, 0 targets under 44 px, min font 10.5 px, no console errors |
| E2E `interact.mjs` (real bundle in Chromium, real controllers + SQL, DB + audit checked) | 38 / 38 |
| Shimmed type check (server + POS incl. tests) | no errors in the changed files (the remaining errors are the environment's untyped `kysely`) |
| `node tooling/ci/run-gates.mjs` | all pass except the 12 that fail in this environment before and after this change (no registry / build: sql, types-drift, sql-identifiers, lint, api-contract, strict-bodies-types, db-ownership, actor-stamp, unique-tenant-review, architecture — pre-existing `service-done` / `overview-floor` / api-contracts TS6 items —, frontend builds, app types) |

E2E steps: KPIs = server aggregates; reconciliation-strip arithmetic; presets; Custom Range (Cancel / Apply / To before
From); paging; search by settlement id, transaction, customer; settlement detail + detail export (audited); Export
Report = the filtered set; Refunds tab + status filter + view-only detail; a new batch first on Page 1 / a note when
filtered out; recon KPIs + Net Difference explanation; universal search finds the $1,000 Sep 16 credit; Record a
Deposit; duplicate reference caught; suggestion → review → match; split payout; unmatch with a reason (history kept);
bank account add / deactivate; Settlements → Deposits paging; exception Under Review → Resolve; Fees tab; all nine
reports + CSV + PDF (audited); server unavailable → error + Retry, no $0.00; invoice KPIs; search by number / phone /
email / name; Custom Range + amount + chips; New Invoice (customer required, first on Page 1, audited); Send → partial
payment → paid (void hidden after money); PDF preview + English PDF; void a draft with a reason; link INV-0002 to a
customer; export CSV; front desk (create + pay only, export API 403, settlements / recon show an access message);
manager (no unmatch, bank-account API 403); empty salon; no page errors.

Screenshots: `tooling/finance-one-screen/results/e2e/*.png` (one per step) and `results/fit/*.png`.

## Not verified here / blockers
- **Live processor feeds**: only the settlement rows the webhook already writes are used; no live CardPointe / Fiserv
  feed was exercised. **Fee components** (interchange / assessment / markup), **separately billed (monthly) fees**,
  **reserves** and the **expected payout date** are not in today's feed — shown as "not supplied", never invented.
- **No supporting-file upload** for a recorded deposit (stated in the dialog).
- **Invoice delivery** by email / SMS is not connected: Send marks the invoice sent and says nothing was delivered.
- **Step-up** on bank-account routes is enforced by the server guard; the harness calls the controllers directly, so
  the password prompt was not exercised.
- **Customer-web "Pay now"** on an invoice now refuses (`INVOICE_ONLINE_PAY_UNAVAILABLE`) instead of marking it paid
  without a charge — online invoice payment needs a real processor flow (a product decision).
- **Frontend unit tests** (the six screen tests) were rewritten but could not be run here (no vitest / jsdom in this
  environment); they type-check.
- `request-schemas.vitest.spec.ts` cannot run in the stand-in (no decorator metadata — it fails identically on the
  previous commit); its cases now cover the workspace and new invoice routes.
- `apps/api/security/role-matrix.snapshot.json` had the removed routes taken out by hand; the new routes need
  `node apps/api/scripts/role-matrix.mjs --write` on a machine with the built packages.
- Vietnamese strings: section A37 of `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` awaits a native review.
- Not pushed (K-12 steps 1–5 still open).
