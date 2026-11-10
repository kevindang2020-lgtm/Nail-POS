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
