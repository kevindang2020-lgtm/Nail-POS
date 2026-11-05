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

Whole salon (not the visible page), newest first, at most 8: each customer's latest visit, profiles added in the last
30 days, bookings made in the last 30 days (`pos_tech_appointments.created_at`) and loyalty adjustments
(`loyalty_ledger` entry_type `adjust`). No notes, reasons or amounts are included. Opening a row opens the customer's
profile drawer. If the bookings / loyalty read fails, the card says it is unavailable (`unavailable: ['recentActivity']`).

Not yet in the feed: check-ins and profile edits as separate events — PARTIAL.

## Spend, Customer Lifetime Value, Demographics and RFM (§33, §36, §38)

**Customer spend** (`load()` in the repository) = the sum of `tickets.total_cents` over the customer's settled tickets
(`closed` / `paid`) in scope. `total_cents` is the ticket total as charged, so it includes tax and tip and is in integer
cents, **less completed refunds** (`payment_refunds` with status `refunded`, joined through the ticket's payments; a
pending or failed refund does not count). Floor 0.
Merging two profiles moves the duplicate's tickets to the surviving profile, so a merged history is counted once.

**Customer Lifetime Value** (`buildCustomersAnalytics`, customers.dto.ts): total spend of all customers in scope ÷
number of customers in scope (all time). "Repeat rate" = 2+-visit customers ÷ all customers. Money fields are 0 for a
role without financial access.

**Demographics**: age groups only, from a birthday whose **year** the customer gave (`birthday_year_known`). No age,
gender or other attribute is inferred from names or photos. Customers without a birth year are not placed in any group,
and the card shows "No birthdays on file yet" when nobody has one.

**RFM** — inputs: Recency = days since the last settled visit; Frequency = settled visits (all time); Monetary = net
spend. "Top spender" = the top 20 % of visited customers by net spend (at least $1). Segments, first match wins:

| Segment | Rule |
|---|---|
| No Visits Yet | no settled visit (never Hibernating / At Risk) |
| Champions | last visit ≤ 30 days and (8+ visits, or 4+ visits and a top spender) |
| Loyal Customers | 4+ visits and last visit ≤ 90 days |
| Potential Loyalists | ≤ 3 visits and last visit ≤ 30 days |
| At Risk (RFM) | 4+ visits and last visit 61–120 days |
| Cannot Lose Them | last visit > 120 days and (6+ visits, or 3+ visits and a top spender) |
| Hibernating | everything else |

Segment names are shown in the POS language (EN / VI keys `cd.rfm.*`).

The RFM "At Risk" segment is a different rule from the directory's At Risk tab (salon threshold, any visit count); the
tab uses the Customer Retention definition so it matches that screen.

## Scale evidence (§58, §61, §62) — Nov 5 2026, PGlite (in-process Postgres), synthetic data

`CUSTOMER_SCALE=1 npx vitest run src/customers/customer-directory-scale.pgtest.vitest.spec.ts` (modules/customers):

| Customers | `GET /pos/customers/state` work (repository) | Payload to the browser | Rows sent |
|---|---|---|---|
| 1,000 | 79 ms | 26 KB | 25 (one page) |
| 10,000 | 359 ms (was 1,292 ms before this pass) | 26 KB | 25 (one page) |

The browser only ever receives one page plus fixed-size aggregates. Two fixes in this pass:

- One month formatter per request, not one per customer (≈0.9 s at 10,000).
- Whole-scope grouped reads instead of 10,000-id `IN` lists.

**Still open (PARTIAL):** the server still reads every customer in scope and filters in memory. It grows linearly: about 3–4 s
projected at 100,000 on this engine. Moving search, filters, counts and paging into SQL (keyset pages, a
normalized-phone index, a folded-name column) is the remaining §58 / §62 work. EXPLAIN ANALYZE on production-size
Postgres has not been run here.
