# SUNMI batch 9 — Reports & management guides (20 PDFs, Nov 10 2026)

Kevin's instruction: "read all this file for fully understand build exactly on it". 20 PDFs, ~660 pages. Same SUNMI
template as batches 1–8 (preserve every module, 27-inch fit at 100% zoom, presets + Custom From/To month calendar,
permission-scoped search, server-paged newest-first records, read-only health check, scoped CSV, tenant isolation,
acceptance A/B/C, final evidence). Each page: read the guide → audit the live page → build/fix → test → record here.

| # | Guide | Route / screen | Status |
|---|---|---|---|
| 1 | Daily Reports 9 (Daily Summary) | /reports · POSReportsScreen | in progress |
| 2 | Revenue by Service Daily Summary | | |
| 3 | Revenue Trend | | |
| 4 | Sales Report | /tenant/reports/sales | |
| 5 | Appointments Report | /tenant/reports/appointments | |
| 6 | Technicians Report | /tenant/reports/technicians | |
| 7 | Customers Report | /tenant/reports/customers | |
| 8 | Payroll | /tenant/team/payroll | |
| 9 | Commission Report | /tenant/reports/commission | |
| 10 | Services Report | /tenant/reports/services | |
| 11 | Inventory Reports | /tenant/reports/inventory | |
| 12 | Marketing Report | /tenant/reports/marketing | |
| 13 | Payments Report | /tenant/reports/payments | |
| 14 | AI Analytics | /tenant/reports/ai | |
| 15 | Tax Reports | /tenant/reports/tax | |
| 16 | Multi-Location Reports | /tenant/reports/multi-location | |
| 17 | Management | | |
| 18 | Branch Performance Snapshot | | |
| 19 | Settings | /settings | |
| 20 | Business Branch 9 | | |

## 1 · Daily Summary (Daily Reports 9)

Findings in the live code (photo is Nov 2, before batches 1–8):
- **§12 $96 vs $104.99 — real defect.** "Revenue by service" and "Top technician" summed the CHARGED amount (incl. tax +
  surcharge) while the Sales cards sum service + retail lines. Fixed at the source (reports.repository): both now use the
  sales basis; the payment mix stays the charged amount and is labelled so.
- **Invented zeros.** Customer Retention was a constant 0, No-Show Rate a constant 0, Average Rating 0, and every report row
  was marked "returning" (New customers always 0). Now computed from their own sources (overlayPeople): new vs returning
  (paid ticket before the period), retention (previous equal-length period cohort, numerator / denominator returned),
  no-show (no_show ÷ scheduled, cancelled excluded), rating (Reputation definition). Undefined → null → N/A.
- **No period choice** (always the default last 7 days), transactions list unpaged and unsearchable.
  New GET /pos/reports/transactions/page (newest first by recorded time, search over customer / service / technician /
  method / status / ticket or payment reference, 10/25/50/100).
- Tests: reports-daily-summary.pgtest 6/6 (sales basis, cohort, no-show, rating, N/A, paging, search).
- Screen (POSReportsScreen): PeriodBar (presets + Custom From–To calendar, salon-day basis), "How calculated?" panel
  (one line per figure), N/A for unknown metrics, retention shows its basis ("n of d returned"), insights relabelled
  with their basis + links to the source report, **Charged reconcile** line (net + tax + tips + surcharge vs collected;
  a difference is flagged, not hidden), paged / searched transactions, Export CSV scoped to the chosen period.
- **Check Reports System** (shared read-only health check, domain `reports`): `charged_vs_collected` (WARNING — a
  gift-card / deposit edge case can differ legitimately) and `surcharge_not_card` (FAILED — the DB does not forbid it).
  Dropped on review: lines-vs-subtotal and parts-vs-total (subtotal is already net of discount; the checkout writes
  those columns from one computeTotals call, so they cannot disagree).
- Customers Report now shows N/A for an undefined retention instead of "null%".
- Verified this session: reports module 69/69; POSReportsScreen 6/6 (+N/A, reconcile flag, how-calculated, paged
  search); system-checks.pgtest 5/5 incl. planted report problems + other-salon isolation + branch scope; every
  check and the reports query (people overlay) run on real Postgres 16.15 with pilot data.
- Not built (needs Kevin): Email Report / Schedule Report stay labelled "not connected" (no delivery pipeline approved).

## 2 · Revenue by Service (Daily Summary card + Services Report)

Findings:
- **Multi-service tickets were mis-filed (real defect, guide §11).** The card took ONE representative line per ticket, so a
  manicure + pedicure ticket put both services' sales under the manicure's category, and "· 2" counted tickets, not services.
- Services Report: period tabs only (no custom dates), no search, no line detail, no paging, no URL state.

Built (one shared calculation — `modules/reports/src/reports/service-revenue.ts`, used by both screens):
- Line level: each non-removed, non-retail line at its RECORDED amount, historical name / category snapshot, quantity =
  units. A line whose service left the catalog → "Unmapped / historical"; a paid ticket with no lines keeps its sales
  under "No service lines recorded", so the categories always add up to the Service Sales card (asserted in tests and on
  PG16). Discounts / refunds are recorded per ticket → shown beside the lines, never spread over services.
- GET /pos/reports/service-revenue: categories (revenue desc, stable), totals over EVERY match, line history newest
  first (paid time, then line id), 25/50/100, search over service / category / id / technician / customer / formatted
  phone / ticket # (customer + phone only with the financial permission; the phone is never sent to the screen).
- Export CSV `service_lines` = the whole filtered set (not the page), formula-injection safe, no phone.
- Daily Summary card: top 6 + "View all services (n)", rows are 44px buttons with an accessible tooltip, a click opens the
  Services Report filtered to that category with the same period; empty state names the dates.
- Services Report = the expanded workspace: Back to Daily Summary, PeriodBar (custom calendar), search + chips + Clear
  all, KPIs (sales before discounts, units, average per service — N/A at 0 units, discounts / refunds on these tickets),
  bars + breakdown, paged line table, Full View kept, all state in the URL.
- Check Reports System +2: `unmapped_service_lines`, `paid_without_service_lines`.
- **On the local pilot data the new check finds 8 paid tickets with no service lines** (seeded cash tickets) — so the card
  shows them under "No service lines recorded" instead of the old made-up "General".
- Verified: service-revenue.pgtest 6/6, reports module, system-checks.pgtest 5/5, POS report tests, PG16 runs.
- Left for its own guide: Top Technicians still ranks by the ticket's primary technician (guide 6, Technicians Report).

## 3 · Revenue & Appointments Trend (Daily Summary)

Findings:
- **The appointments series never drew (real defect).** The screen read `bookingsOverview.trend`, which the server never
  sends; the counts were in `appointmentsTrend`. Only the revenue bars ever showed.
- Days with no sales were dropped, so one busy day filled the whole chart; daily buckets only (a year = 365 bars);
  no drill-down, no table view, no comparison, no statement of what the bars count.

Built (`modules/reports/src/reports/trend.ts`, pure; `state.trend`):
- Every bucket of the period, oldest → newest; a successful query with no sales is a real 0. Groupings the server keeps
  sensible: a single day → salon HOURS (DST-correct), ≤ 62 days → day / week, ≤ 190 → + month, longer → week / month.
- Revenue = sales before discounts (the Total Revenue card); appointments = paid tickets, once each (the Appointments
  Completed card). The bucket sums are asserted equal to those cards; the screen says so, or flags the difference.
- Compare with the previous period of the same length (server-side); a 0 baseline reads "insufficient data", never 0% / ∞.
- TrendPanel: gold bars on the left scale + blue line / dots on the right scale, legend not by colour alone, ≤ 14 axis
  labels, a 44px button per bucket with an accessible tooltip; a click opens that bucket's transactions below (chip +
  Clear); "Show as table" lists every bucket; `dateRange.timezone` now comes from the branch.
- Verified: trend.spec 5/5 (fill, sales basis, split ticket once, DST hours, month / partial-week / leap-day buckets,
  compare), pgtest bucket sums = KPI cards, POS 21/21 report-screen tests.
- Kept for its own guide: Yesterday / Last week / Last month quick ranges live in the shared PeriodBar (unchanged here).

## 4 · Sales Report (/tenant/reports/sales)

Findings (the guide's checks A–C answered from the code):
- **Check A ($104.99 Nails vs $96 Service Sales)** — the same defect as guide 1: Top Services used the charged amount.
  Fixed in guide 1 (sales basis) and guide 2 (line level); the two now reconcile by construction.
- **Check B (a lone Oct 27 bar under "This Month")** — the old chart drew only days with sales and the Sales Report
  had no custom dates; now the shared trend draws every bucket of the selected period, oldest → newest.
- **Export CSV exported the wrong report (real defect).** The screen sent `kind: 'sales'`, the API reads `type`, so it
  exported the transactions list — and swallowed any error. Now `type: 'sales'` for the chosen period; failures are shown.
- **Customers counted walk-ins (real defect).** The distinct-customer count included the empty id of every walk-in and
  refund rows; now known customers of paid tickets only.
- Avg Ticket showed $0.00 with no ticket → N/A.

Built: PeriodBar (custom calendar, in the URL), refreshed-at time, "How calculated?" for all nine cards (one shared
dictionary with Daily Summary; card tooltips), the Charged reconcile line, the shared Trend (grouping / compare /
drill-down), Top Services = shared Revenue by Service (labels, click → Services Report with the same period),
Check Reports System, and a **Ticket Explorer**: GET /pos/reports/tickets/page — one row per paid ticket, newest first,
search over customer / formatted phone / technician / service / ticket # / method, 10/25/50/100, columns net / tax /
tips / charged / paid by / status (+ refunded amount), a row opens its sales → charged breakdown. Financial permission.
- Verified: service-revenue.pgtest 8/8 (incl. explorer money parts, both technicians, phone search, no phone in the
  response, staff refused, customers = 2), POSSalesReportScreen 6/6, Vietnamese screen test updated (presets are buttons).

## 5 · Appointments Report (/tenant/reports/appointments)

Findings:
- **The period tabs did nothing (real defect).** The screen sent `period`; the API reads `preset` — the same bug the Sales
  Report had until Nov 3. Every tab showed the default last 7 days.
- **The outcomes were not appointments (real defect).** Total Bookings was the number of PAYMENT rows (refunds included),
  Completed the number of paid tickets (so always ~100%), Cancelled and No-Show a constant 0; my guide-1 overlay had then
  filled Cancelled / No-Show from appointments — a mixed basis. The guide's "2 / 2 / 0 / 0" was exactly that artefact.

Built:
- `bookingsOverview` = the salon's appointments (pos_tech_appointments) by SCHEDULED salon day, every status, each
  appointment once: Completed / Cancelled / No-Show only as recorded (a past time is never assumed completed or a no-show),
  plus Still open and Other so the partition adds up to Total; every share of the same Total; N/A when nothing was booked.
  `basis` says which: if the appointment read fails the screen states the figures are paid tickets, not appointments.
- Screen: PeriodBar (custom calendar, URL), basis line, four cards with shares, an accessible outcomes chart (44px rows,
  count · share, not colour alone) whose bars filter the list, the Breakdown with Total row.
- The appointment list REUSES Appointment History (`/pos/appointment-history/appointments` — the one appointments
  workspace; scheduled date, newest booked first, search, 10/25/50/100, masked phone) with an "Open in Appointment
  History" link carrying the period and outcome; without the customers permission the list is withheld, the counts stay.
- Verified: reports-daily-summary.pgtest +1 (4 appointments → 2 / 1 / 1, 50 / 25 / 25 %, N/A when none), POS 4/4.
- Note for Kevin: the list's "Open / upcoming" filter is Appointment History's "upcoming" (today or later); an open
  appointment left on a past day is in the Still-open count but not that list — it is what Check Appointment History flags.

## 6 · Technicians Report (/tenant/reports/technicians)

Findings:
- **The period tabs did nothing (real defect)** — `period` sent, `preset` read (third report with this bug).
- **Attribution by the ticket's primary technician (real defect, guide §17).** A manicure (Lisa) + pedicure (Mai) ticket
  credited Lisa with both — and with any retail on the ticket — while Mai got nothing; "Done" counted tickets.

Built:
- `rankTechnicians` (service-revenue.ts): each technician owns ONLY their own service lines (recorded amount, units,
  distinct tickets); lines with no technician and paid tickets with no lines stay visible as their own unranked rows, so the
  board adds up to Service Sales (asserted). Daily Summary's Top Technicians card uses the same rows (labels for the
  buckets; a bucket is never called the top technician; a row opens the Technicians Report on that technician).
- GET /pos/reports/service-revenue `technician=` → one technician's lines (the drill-down), same keys as the board.
- Screen: PeriodBar (URL, via the new shared `useUrlPeriod`), cards over named technicians only + a note with the
  unattributed amount, ranked horizontal bars (scroll for any team size, 44px, tooltip), leaderboard with Tickets column,
  "Ranked by service revenue", accent-free name filter, a read-only detail of the chosen technician's lines (newest first,
  paged) with links to the Commission and Services reports. No commission / tip / payroll figure is recomputed here.
- Verified: service-revenue.pgtest 9/9 (Lisa 14,000 / 4 / 2 · Mai 4,000 / 1 / 1 · no-lines bucket 3,000; drill-down),
  POS technicians 2/2, Daily Summary 10/10.

## 7 · Customers Report (/tenant/reports/customers)

Findings:
- **The period tabs did nothing (real defect)** — `period` sent, `preset` read (fourth report; the old test even asserted it).
- **The change arrows were invented.** All three "% change" values were a constant 0 → "▲ 0%" on every card.
- New / Returning counted `tickets.paid_at`, which some paths never set (the local pilot data has none), while every money
  figure counts the payment day — so the cards could disagree with the Customers count beside them.

Built:
- New / Returning / Retention on the payment-day population (a ticket with a collected, non-refund payment that salon day);
  the change against the previous equal-length period for New and Returning; no base → "No earlier period to compare";
  retention's change is not computed (needs the cohort before that) → not shown. Retention shows "n of d returned".
- GET /pos/reports/customers/page — the period's known customers with a paid visit, New / Returning by the same rule,
  latest visit first, search over name / ticket # / formatted phone (only the last 4 digits returned), 10/25/50/100;
  net sales only with the financial permission; needs financial or customer_view like the cards.
- Screen: PeriodBar (URL), "How calculated?", the Mix chart as accessible bars with count · share that filter the list,
  the list with All / New / Returning, the cards hidden on an error instead of showing the last period's.
- Verified: reports-daily-summary.pgtest +1 (1 new / 1 returning; −50% / N/A; list order, type filter, money hidden
  without financial, refused without customer_view), POS customers 3/3.

## 8 · Payroll (/tenant/team/payroll) — screen-fit addendum

The Payroll module (Oct 12 build: five cards, six tabs, period workspace, approvals, payouts, exports) is the authority
and was not re-engineered. The addendum's gaps on this screen:
- The Pay periods list was a fixed 300px column, unsorted, unpaged, with no search or date filter, beside a mostly empty
  workspace.
Built: 35 / 65 list / workspace split; the list is newest first (start date, then id), searchable (name, dates, status
words, accent-free), filterable by status and by a From–To month calendar (a period shows when it overlaps), 10 per page
with numbered pages, "Clear all" and a count; each row now shows its dates. Pure `filterPeriods` with tests (3/3); the
Payroll screen tests still pass (14 total).
Not done here (needs a decision / a server change): searching periods by TECHNICIAN name or phone — the period list
does not carry its technicians; the per-technician search lives in the period workspace and Weekly paychecks tabs.

## 9 · Commission Report (/tenant/reports/commission)

Audited against the Oct 30 rebuild: every item of the update already exists — five cards, custom From–To calendars,
one server search (technician name / phone / id, ticket, service, customer), sortable paged table, Technician Commission
Details (captured rates, tip shares, adjustments, payouts — newest first, paged), commission + tips = payout obligation,
Paid only from recorded payouts, the payroll cross-check, the persisted Discrepancy Review (the guide's "health checker")
and the audited server CSV.
- **The guide's tip concern is already resolved:** the photographed note ("tips attributed to the primary technician")
  is an old string no longer shown; the live calculation and note use each technician's share as allocated at checkout
  (`ticket_tip_allocations`). No historical tip was or should be redistributed.
- Fixed: the screen now opens on a period passed in the URL (the new Technicians → Commission link), test added; the
  permission test now renders inside a router. Commission tests 11/11.

## 10 · Services Report (/tenant/reports/services)

The page was rebuilt in guide 2 (the expanded Revenue by Service workspace). Gaps found against this guide:
- **"Unique Services" counted categories, not services.** Now the distinct services of the filtered lines (a service
  renamed in the period is still one service — its historical id).
- No per-service view. Added `services` (the same lines ranked by historical service id, else recorded name; a renamed
  service is one row, shown under the name it sold under most) and a Category / Service toggle; a service bar filters
  the lines (`service=`), chip + Clear all; the full-scope CSV honours it.
- Verified: service-revenue.pgtest 10/10 (unique 3; renamed manicure one row 3 units / 12,500; service filter),
  POS services 6/6.

## 11 · Inventory Reports (/tenant/reports/inventory)

Findings:
- **"Expiring Soon" counted expired bottles (real defect).** The report read the older `/tenant/inventory/summary`, whose
  expiring count is bottles dated within 30 days with no lower bound — already-expired bottles included. The guide's
  "11 products vs 128 expiring" is mostly a unit difference (products vs bottles) the screen never explained.
- Reorder Attention: unsearched, unpaged, no status choice; no stock history.

Built (reusing the Inventory screen backend — metrics, product list, movement ledger; no new inventory engine):
- Cards from `/tenant/inventory/screen/metrics`: each card's written definition as its tooltip, Inventory Value basis
  (cost × usable unexpired bottles), Low Stock with its Critical count, Expiring Soon = bottles in the next 30 days.
- Data health: expired bottles on hand, stock drift (cached stock ≠ bottle records), products without a cost — and a
  line stating products and bottles are different units. Read-only; every fix links to Inventory.
- Reorder Attention via `/screen/products` (needs reorder / out / critical / low, search over product, SKU, barcode,
  colour #, sorted most critical first, 25 per page, expiring / expired bottles per product).
- Stock movements via `/screen/movements` for a PeriodBar period (URL), newest first, searched, paged.
- Verified: POS inventory report 4/4 (+ the 403 test).

## 12 · Marketing Report (/tenant/reports/marketing)

Findings:
- **The screen crashed with no reviews (real defect).** The server already sends `averageRating: null` / `campaignRoi:
  null` for "none / not measurable", but the screen called `.toFixed(1)` on it and printed `null` + "x ROI".
- **The guide's "$100 cost, 0 sent, 0x ROI" question:** the campaign cost is the amount the owner ENTERED on the
  campaign (create / edit form), not provider charges. With nothing sent there is no return to measure → ROI is now N/A
  (server rule + test), and the cost is labelled "entered on the campaign, not provider charges".
- The figures are all-time (the three source services take no period); the subtitle now says so instead of implying a
  period. Adding a period means changing Campaigns / Promotions / Reviews services — left for Kevin's decision.
- Verified: marketing-report.vitest 5/5 (+ ROI rule), POS marketing 3/3 (+ null / entered-cost / scope).

## 13 · Payments Report (/tenant/reports/payments)

Findings:
- **The period tabs did nothing (real defect)** — `period` sent (Tax Report has the same; fixed in guide 15).
- **Total Collected dropped methods (real defect).** Only card + cash + gift card were summed; cash-to-technician,
  rewards, deposits … vanished from the total (and from the Daily Summary / Sales charged-vs-collected line).
- **Split Payments was a constant 0 (invented).**

Built: `payments.byMethod` / `otherCents` / `collectedCents` (every non-refund method) and a real `splitCount`
(tickets with two or more collected payment rows); the reconcile lines use the full collected total. Screen: PeriodBar
(URL), eight cards incl. Other methods, every method in the chart with its share, a basis line, a note that processor
status is the connection (not a check of the amounts), and the period's payment rows (the Daily Summary list).
- Verified: payments-summary.vitest 1/1, POS payments 1/1.
- **Correction to guide 3:** `trend.spec.ts` did not match the module's test pattern, so it had NOT run when I first
  reported it; renamed to `trend.vitest.spec.ts` — it now runs and passes 5/5.

## 15 · Tax Reports (/tenant/reports/tax) — done before 14 (same `period` bug as Payments)

Findings:
- **The period tabs did nothing (real defect)** — `period` sent, `preset` read. (Sweep: no report screen sends `period`
  any more.)
- **Taxable Sales was all net sales and Exempt Sales a constant 0 (invented)**, although every line records `is_taxable`.
- **"Tax by category" put each ticket's whole tax under its first line's category.** Tax is recorded per ticket, so a
  per-category tax figure cannot be stated truthfully.
- Adjustments was a constant 0.

Built: taxable / exempt from each line's own flag (sales before discounts), per category (retail its own row), the
period's tax shown once with a note that it is per ticket; configured rate and effective rate (tax ÷ taxable) both
labelled; Adjustments "not tracked separately" instead of 0; the CSV gives taxable / exempt per category + the period's
tax; PeriodBar (URL); the period's tickets with their tax (the Sales Ticket Explorer).
- Verified: service-revenue.pgtest 11/11 (taxable 17,200 / exempt 1,500, retail row, effective rate), POS tax 1/1.

## 14 · AI Analytics (/tenant/reports/ai)

Findings:
- **An invented metric (real defect):** "Appointment fill rate" (AI Center booking panel) was `bookings ÷ (bookings + 2)` —
  two bookings always read 50% — presented as "appointment duration / scheduled capacity". No capacity model exists → now
  "Not tracked yet: capacity model unavailable".
- The page was "today" only, and its "7-Day Performance" figures were a rolling `now() − 7 days` (not salon days, and no
  way to read a past period); Campaign Performance is all sent campaigns (not dated).

Built: the AI Center overview takes `?preset=today|week|month|year` or `?from&to` (salon days; clamped to today and a
year; absent = today exactly as before, so the AI Center screen is unchanged). Every "in the period" figure uses that
window; the 7-day figures use the 7 salon days ENDING on its last day; the response carries `window` so the screen states
what it covers. POS: PeriodBar (URL, default today), caption names the range, the 7-day panel names its days, Campaign
Performance says it is all campaigns. The eight cards keep "Not tracked yet" exactly as before — nothing filled in.
- Verified: ai-center-window.vitest 2/2, ai-center module 188 passed (9 skipped as before), POS AI Analytics 4/4,
  loader on real PG16 for today / this month / a past month.
- Not built: per-metric detail histories behind each card — those live in AI Calls / AI Follow-ups / Campaigns, which
  already have searched, paged lists; the cards link nowhere new.

## 16 · Multi-Location Reports (/tenant/reports/multi-location)

Findings:
- The period chips work here (the owner endpoint reads `period`).
- **Growth was invented when there was no base (real defect).** The shared `pct()` returns +100% when the previous period
  had nothing, so a branch that just started always "grew 100%" and could win Best Growth; Top Branch / Highest Average
  Ticket / Most Bookings were also picked among all-zero rows.
Built (owner `getBranchPerformance`, which also feeds the Owner web Branch Performance screen): trend = null with no prior
revenue (contract `number | null`), Best Growth only among branches with a base, Top Branch only with revenue, Highest
Average Ticket only with paid tickets, Most Bookings only with bookings; POS and Owner web show N/A. `pct()` itself is
unchanged for the other Owner views.
- **Found and fixed while doing this:** my guide-5 / guide-7 changes made appointment shares and customer trends nullable;
  the AI Business assistant (analytics module) still typed them as numbers — a no-booking period could have printed
  "null% no-shows" or fired a "below" alert on N/A. Now: briefs, tips, branch insights and the alert evaluator skip a null
  (an alert with no value is "not evaluated"; the events column is nullable). Every module and app typechecks clean.
- Verified: owner-financial-kpis 13/13 (+ no-base test), analytics 343/343, owner-web Branch Performance 8/8, POS 3/3.
- Not built: custom From–To and paging on this screen — the owner comparison endpoint takes presets only; with three
  branches a list needs no paging. Decision for Kevin if more branches are coming.

## 17 · Management Overview (/tenant/management/overview) and 18 · Branch Performance Snapshot

Findings:
- Pending Approvals showed "— workflow pending" although the Approvals service (pos/approvals) now exists.
- The Branch Performance Snapshot listed name / city / status only — no performance at all; status was the raw code.
- Open Tasks and Compliance have no source system yet — they correctly stay "— workflow pending" (not invented).

Built:
- Pending Approvals = the Approvals service's pending total with an Open button; without approvals.view it says "No
  access to approvals", on failure "Approvals unavailable" — never 0.
- Snapshot: the same branch list, plus Revenue / Bookings / Avg Ticket / Trend for Today / This Week / This Month from
  the owner branch comparison — the SAME numbers as Multi-Location (guide 16's honest growth: N/A with no prior revenue);
  without owner.branches.view the figures are withheld with a note and the list still shows every branch; translated
  status labels; a search once there are more than four branches.
- Verified: POS Management 2/2 (+ approvals count, per-branch figures, N/A trend).
- Not changed: "On Shift Now" reads the Team screen's available-now count (Time Clock attendance would be a new source —
  decision for Kevin).

## 19 · Settings (/settings?section=business-branch)

Finding (the guide's main question — "is 100% Complete from authoritative checks?"): **no.** Every section was hard-coded
`completionPercent: 100, status: 'Complete'` — the BUILD status (each section is code-complete) — and the screen showed it
to the salon as Go-Live Readiness "100% Complete" even with live card processing not connected. The real external items
were already computed (`goLivePending`) but shown only as a small line.
Built: the settings state now returns `goLiveReady / goLiveTotal` (live card processing, Google Reserve, A2P approval, a
paired customer display) and each section's own pending reasons. The banner shows "3 of 4 ready" + "Waiting on outside
setup" / "Ready to go live"; each card shows Saved, or Waiting with its reason, instead of a 100% bar. Every edit control
and the 20 cards are unchanged. Nothing about live payments is claimed — the payments item stays waiting until a live MID.
- Verified: tenants settings 53/53, POS Settings 5/5 (+ go-live counts / waiting pill / no "100% complete").

## 20 · Business & Branch (Settings → business-branch)

Finding: every settings save is audited (`settings_audit_logs`: who, role, area, changed keys), but the screen showed
none of it, and the only read (`/pos/settings/audit-logs`) returned the last 50 rows unsearched and swallowed errors.
Built: GET /pos/settings/audit-logs/page — newest first (time, then id), search over area / action / record / who / role,
a From–To of salon days in the branch zone, 10/25/50/100, this salon only (branch rows + tenant-wide rows), errors
surface; and a "Settings change history" panel on the Settings screen (search, month-calendar range, pager, who + role,
what changed). The business & branch fields, cards and edit workflows are unchanged.
- Verified: settings-audit-page.pgtest 2/2 (order, actor, changed keys, search, salon-day range incl. a late-evening UTC
  row, other salon hidden), runs on PG16, POS Settings 7/7.

## Follow-ups built after "Continue finishing all my not done now" (Nov 10 2026, late)

Kevin asked to finish the not-done list. Four of the open decisions were built on the obvious reading; the rest stay his.

- **On Shift Now (decision 4) — built.** The Management KPI reads `GET /pos/time-clock/state` → `kpis.clockedInCount`
  (Time Clock attendance). If the time clock cannot be read it falls back to the Team screen's available-now count and
  says so under the number (`mgmt.shift.fallback`). POS Management 2/2.
- **Multi-Location custom range (decision 5) — built.** `GET /owner/branches/comparison?from=&to=` (salon days,
  inclusive; comparison = the same number of days just before). `customRange()` in owner.dto refuses from > to and ranges
  over 366 days (`DATE_RANGE_INVALID`); the list-query spec declares `dateRange: { maxDays: 'analytics' }` (366). POS:
  a "Custom dates" button opens the shared RangeCalendar; the window line reads "Oct 1, 2026 – Oct 31, 2026, compared
  with …" (the server's end instant is exclusive, shown as the last day). Paging for 3 branches: not added (no need yet).
  Tests: analytics owner 14/14 (customRange), POS Multi-Location 4/4.
- **Payroll period search by technician (decision 3) — built.** `GET /pos/payroll/state?technician=` (declared filter,
  applied by the repository): periods with a payroll line whose technician name — line name or the technicians row,
  Vietnamese accents folded both cases — or phone digits (3+) match. LIKE wildcards are literal (`escapeLike`). The POS
  search box asks the server after 300 ms and shows those periods beside the label/date matches; status and date
  filters still apply. If the server search fails the box says so and label/date search keeps working. Tests: PGlite
  pgtest 4/4 (accent-free, upper-case Vietnamese, phone, other salon isolated, `100%` literal), POS payroll 16/16.
  The fold + exists SQL also ran on real Postgres 16.15 (fr_pilot): "TRẦN Ngọc Đức" → "tran ngoc duc".
- **Marketing Report period (decision 2) — built.** `GET /pos/marketing-report/state?preset=|from=&to=`. No preset =
  all time, exactly as before. With a period the pillars are rebuilt by each domain's OWN summary function over the rows
  inside the window (no new aggregation): campaigns by send day (scheduled, else created; every page of the list, not
  the first 50), reviews by the day left, promotions whose run overlaps the window. Salon days in the branch time zone.
  Promotion redemptions are a running total per promotion (no dated log) — so with a period the report says
  "redemptions are all-time" next to them instead of pretending. POS: the shared PeriodBar (All / Today / Week / Month /
  Year / Custom), All time by default. Tests: reports marketing 7/7, POS marketing 9/9.
- **AI Analytics (guide 14 gap) — built.** Each section links to the list behind its numbers: Call intelligence → AI
  Calls, Booking assistant → AI Follow-ups, Campaign performance → Campaign Results. POS AI Analytics 5/5.
- **Harness registration — done.** The 13 batch-9 pages not already registered are in `module-registry.json` (guide =
  the PDF name) and in the harness as `MODULE_SET=batch9` (and in `all`). Baseline and preservation matrix regenerated.

**Found, not changed (Kevin):** the Campaigns screen's header KPIs (and the all-time Marketing Report, which reuses
them) are computed over the first page of campaigns only — `repo.list(tenant, {})` uses the list default of 50. Under 50
campaigns nothing is wrong; above it the totals undercount. The fix is to page in `CampaignsService.getState`; it changes
the Campaigns screen too, so it is listed rather than done silently.

**Still Kevin's:** Email / Schedule Report delivery (decision 1 — needs a consented delivery pipeline), Open Tasks /
Compliance (decision 6 — no source system), seed clean-up (7), Vietnamese draft review (8), density switch, and "push".

## Decisions for Kevin (batch 9)

1. **Email Report / Schedule Report** (Daily Summary) stay labelled "not connected" — wiring them needs a delivery
   pipeline (consent, permissions, delivery log). Build it, or keep the label?
2. **Marketing Report period** — the figures are all-time because Campaigns / Promotions / Reviews take no date range.
   Add a period to those three services?
3. **Payroll period search by technician** — the period list does not carry its technicians; searching periods by a
   technician's name / phone needs a server change. Wanted?
4. **"On Shift Now"** (Management) reads the Team screen's available-now count, not Time Clock attendance. Switch to
   Time Clock?
5. **Multi-Location** — presets only (the owner comparison endpoint takes no custom range); no paging for 3 branches.
   Add a custom range / paging if more branches are coming?
6. **Open Tasks / Compliance** (Management) have no source system — they stay "workflow pending". Build them or leave?
7. **Local pilot data**: Check Reports System finds 8 paid tickets with no service lines (seeded cash tickets); they show
   as "No service lines recorded" in Revenue by Service. Clean the seed, or leave as a realistic test case?
8. **Vietnamese drafts** — ~240 new `// DRAFT — Kevin reviews` lines from batch 9 (all `rpt.*`, `syschk.reports.*`,
   `pay.list.*`, `mgmt.*`, `set.*`). They are in docs/handoff/VI_DRAFT_REVIEW.md.

## Verification (run this session, Nov 10 2026)

- Gates: `run-gates.mjs` exit 0 — 83 passed (57 gates + 26 audits), after fixing four this-session findings in code
  (free-text refusal, a swallowed catch, as-any, a list handler without a spec) rather than raising any baseline.
- Typecheck: every module and app `tsc --noEmit` clean (it was not — analytics had broken on nullable shares; fixed).
- POS: 401 files / 2206 tests passed.
- Modules: reports 89/89 · analytics 344/344 · tenants 188/188 · ai 2454 passed (37 skipped, as before) · owner-web 374/374.
- API: 3294 passed / 3 failed / 138 skipped. The 3 failures were one pre-existing date-bombed file
  (`ai-booking-center.pgtest`: events fixed on Nov 3, the recovery view looks back 7 days from now) — fixture anchored to
  "a day ago"; that file now passes 10/10 alone. The full API suite was NOT re-run after that one-file fix.
- Real Postgres 16.15: every system check, the reports query (people overlay, service lines, tax), the AI Center loader
  and the settings history SQL ran against the local pilot data.
- **Not run this batch:** the 804-check Vietnamese one-screen harness (~45 min), and the batch-9 pages are not yet in
  its MODULE_SET.
