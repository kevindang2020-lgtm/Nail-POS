# Customer Search (POS) — Nov 2 2026

Guide: *AI Customer Search* (Kevin, Nov 1 2026). This is a read-only screen. Nothing here writes to customers,
bookings or the turn queue.

## What it does

- **One search box.** It accepts a name (accents optional, via `vi_fold`), a phone in any format, an email, a
  customer id, or an appointment or ticket id.
- **Relevance ranking:**
  - 0: exact customer id
  - 1: appointment or ticket id, or exact stored phone
  - 2: exact email
  - 3: exact folded name
  - 4: name prefix
  - 5: partial match
- **LIKE input is escaped.** A `%` or `_` someone types is matched literally.
- **Filters:**
  - status: all, active, inactive, new, returning, never visited, duplicate, archived
  - booking: any, upcoming, completed, canceled, no-show
  - technician, service, branch
  - date field (created, updated, last visit, first visit, appointment, booking created, service completed), with a
    preset (today, week, month, year) or a custom range
- **Sorting:** relevance, newest, oldest, name, last visit, visits.
- **Paging:** server-side, with page sizes 10/25/50/100. Never "load everything".
- **Each row shows:** the next appointment, the last technician, the branch, a shared-contact count and a member flag.
- **Profile (360°)** has six tabs: identity, appointments, services, benefits, duplicates, AI. Each section reports `ok`
  or `unavailable`, so one broken source never blanks the whole profile.
  - Opening a profile writes the audit entry `customer_search.profile_viewed`. The audit is fail-closed: if the audit
    can't be written, the profile isn't shown.
  - Phone and email are masked unless the user has `pos.customers.export`.
- **Links out:** Open in Booking (`/booking?date=`), New Booking (`/booking/new?customerId=`), Open Customer and
  Duplicate Review.
- **Health check:** 10 checks, stored in `customer_search_health_runs`, rate-limited to one run per 30 s per tenant
  through an advisory lock.
- **Stale responses are dropped.** A sequence guard ignores a slower, older response. A "newer results" banner appears
  when the data changed after the page loaded.

## API (`pos/customer-search`)

Every route needs `pos.customers.view`.

| Route | Notes |
|---|---|
| `GET summary` | KPI counts (allowlisted as not-a-list) |
| `GET customers` | the list (`@ListQuery`) |
| `GET options` | technicians, services and branches for the filters |
| `POST check` | health check; strict empty body |
| `GET customers/:id` | 360° profile; audited; full contact needs `pos.customers.export` |

## Files

- **Server:** `modules/customers/src/customer-search/` (center, controller, module, pgtest).
- **Migration:** `apps/api/db/migrations/760_customer_search_center.sql`. It adds the health-runs table and the indexes
  `ix_customers_tenant_created` and `ix_customers_tenant_email_lower`.
- **POS:**
  - `apps/pos-web/src/screens/POSAICustomerSearchScreen.tsx`
  - `apps/pos-web/src/api/posCustomerSearchApi.ts`
  - the `csx.*` strings in `i18n/ns/csearch.{en,vi}.ts`

## Proof

- **pgtest: 20/20.** Removing the tenant filter on purpose breaks 7 of them, so the tests really guard tenant
  isolation.
- **POS screen test: 6/6.**
- **Typecheck, build and `check:boot`: green.**
- **`ci:gates`:** only the five gates that were already red before this work still fail.

## Open

- The health dialog shows the server's English `action` text, the same pattern other centers use. It adds one finding to
  `pos-i18n`.
- The VI strings are listed in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` for a native-speaker review.
