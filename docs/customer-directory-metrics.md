# Customer Directory — metric definitions (F1 §9–12, §15, §28, §37, §39)

POS → Customers (`GET /pos/customers/state`). Every number is computed on the server in
`modules/customers/src/customers/customers.kysely.repository.ts` (`query()`); the screen shows it and never
substitutes a client-side estimate. The salon is the tenant; when the signed-in role is confined to a location
(`ctx.branchId`), customers are those of that location plus salon-wide profiles (`branch_id is null`).

**Visit** = a settled ticket (`closed` / `paid`, `customer-segments.ts` `VISIT_TICKET_STATUSES`).
**"This month"** = the salon's calendar month in the location's time zone (`branches.timezone`, UTC if unset).

## Eight top KPIs

| KPI | Numerator | Denominator / period | Notes |
|---|---|---|---|
| Total Customers | non-archived customer profiles in scope | — | Archived is a lifecycle status (§29): archived profiles keep their history, are listed under the Archived status filter, and are left out of every KPI, tab and All Customers (`kpisFull.archivedCustomers` counts them) |
| New Customers | profiles created today | today | "today" counter; the month figure is below |
| Returning Customers | 2+ visits **and** last visit today | today | 2+ = `RETURNING_MIN_VISITS` |
| VIP Customers | profiles flagged VIP | — | VIP is a classification, not a status |
| Inactive Customers | no visit for 60 days (`INACTIVE_DAYS`), incl. never visited | — | differs from At Risk on purpose |
| Retention Rate | 2+-visit customers | all customers in scope (incl. never visited) | same visit rule as Returning; the Retention Trend card below uses the snapshot definition (Active ÷ visited) and labels it per month |
| Avg. Spend per Customer | sum of each customer's settled spend | all customers in scope | hidden (0) without `pos.customers.financial.view` / `pos.reports.view` |
| Loyalty Members | points > 0 or a tier other than Regular | — | |

## Summary cards and tabs

| Card / tab | Definition |
|---|---|
| New This Month | profiles created in this calendar month (`kpisFull.newThisMonth`) |
| Returning This Month | 2+ visits and last visit in this calendar month (`returningThisMonth`) |
| At Risk | has visited, and no visit for the salon's risk threshold — Customer Retention settings `tenant_retention_settings.risk_days`, 60 when never set. Never-visited customers are **not** At Risk. Same rule as the Retention screen. |
| Top Spenders | top 5 % of customers by spend |
| Tab "New Customers" | exactly 1 visit (segments-v1) |
| Tab "Returning" | 2+ visits |
| Tab counts | `segmentCounts` — the same filter code as the list, with the other active filters (search, status, tag, source…) applied, so a tab's number is exactly what it lists |

Intentionally different windows: the KPI row's New / Returning are **today**; the summary cards are **this month**;
the tab "New Customers" is a visit-count segment (exactly 1 visit), not a date window.

## Search (§14)

Name (whole or part, accent-insensitive: "nguyen" finds "Nguyễn"), preferred name, email, tags, and phone. A
term made only of digits and phone punctuation with 3+ digits matches the phone in any format
("(215) 555-0101", "215.555.0101", "2155550101"); stored values are not changed. The search box is IME-safe
(`ImeSafeInput`) and debounced 250 ms.

## Pagination (§28)

Server-side; page sizes 10 / 25 / 50 (default 10); "Showing X–Y of Z" uses the filtered total.

## Retention Trend (§37)

Last 6 months, oldest first. Each month uses the last **completed** nightly retention snapshot day in that month
(`customer_retention_snapshot_runs`, coverage not `incomplete`): rate = Active ÷ (Active + Approaching + At Risk).
A month with no such day is a gap (`reason: missing`). For a location-confined view, a month computed before
snapshots recorded locations (migration 812, `has_branch = false`) is a gap (`reason: no_branch_data`), never the
salon-wide figure. The screen draws a bar per month with a value and "—" for gaps; with no month at all it says
the trend appears once the nightly snapshots have run.

## Recent Customer Activity (§39)

Whole salon (not the visible page), newest first, at most 8: each customer's latest visit, plus profiles added in
the last 30 days. No notes or money are included. Opening a row opens the customer's profile drawer.

Not yet in the feed: bookings, check-ins, loyalty adjustments and profile edits as separate events (the guide lists
them as examples) — PARTIAL.
