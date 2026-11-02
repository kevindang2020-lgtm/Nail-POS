# Customer Intelligence (POS) — Nov 2 2026

Guide: *Customer Intelligence* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile` (unchanged).

## The "15 scanned / 1 active / 0 inactive" question — answered

The old aggregate classified every customer into **six** states:
- active;
- rebooking soon;
- due for return;
- inactive;
- long-term inactive;
- insufficient history (no completed visit, or fewer than 3 visits with nothing booked).

The screen showed only two of them. A salon where 13 profiles were never served and 1 has fewer than 3 visits therefore shows 15 scanned, 1 active and 0 inactive. That is correct; it just wasn't explained. "Why these numbers?" now shows every state with its definition, and the total equals the scanned count. The check also spells out the same breakdown.

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Six cards | Partial | Came from a cached aggregate built by **two API calls per customer**, capped at **300 customers**. Four of the six states were never shown. |
| Duplicate card | Broken | Counted the old positional in-memory detector, not Duplicate Review's groups. |
| Freshness | Partial | The "updated" time was the cache time, with no scan record and no failure state. |
| Search, list, dates, pages, overlay, history, check | Missing | — |

## What was built

- **Scan** (Refresh, `POST /pos/customer-intelligence/scan`). Two set-based reads per salon: completed-visit times, and future appointments.
  - It classifies with the **same pure functions** as the per-customer assistant (`summarizeVisits` → `classifyInactivity` → `rebookingOpportunity`) and the salon's own tunables.
  - There is no cap, and archived profiles are excluded.
  - Results are stored in `customer_intelligence_scans` (counts per state, rule version, tunables, duration, failure) and `customer_intelligence_snapshots` (the latest classification per customer: derived and rebuildable, never a second customer master).
  - Rate limit: a scan within 60 s with the same rule and tunables is reused. The page scans once on open when the data is stale (>60 min) or has never been scanned.
- **Six cards** keep their labels, now from the latest scan:
  - Duplicate groups = Duplicate Review's open groups, or "—" if it has never scanned.
  - Inactive = inactive + long-term inactive, the same definition as before.
  - Each card filters the list or opens its module.
- **Customer list** (`GET customers`):
  - search: name (accents optional), phone in any format, email, customer id, appointment id, and technician or service from completed visits;
  - status, including inactive-all, never served and not scanned yet;
  - signals: churn watch, rebooking, upcoming, possible duplicate;
  - date field (last visit, created, next appointment, profile updated) with presets and a calendar;
  - sort, and pages of 10/25/50/100;
  - last technician and recorded preference are labelled distinctly;
  - masked contact unless the user has `pos.customers.export`.
- **Customer overlay** (`GET customers/:id`, audited fail-closed): classification and evidence, open duplicate groups, and Customer Search's profile (contact, recorded preference, ledger points, membership). Links go to Customer, Timeline, New booking and Duplicate Review.
- **Scan history** (`GET scans`), newest first.
- **Check Customer Intelligence System** (`POST check`), read-only. It covers:
  - assistant enabled;
  - scan freshness and failures;
  - counts reconcile;
  - who is counted where;
  - the list matches the cards;
  - coverage (added or archived since the scan);
  - tenant isolation;
  - completed visits have a time;
  - bookings point at live profiles;
  - Duplicate Review state;
  - phone normalizer;
  - indexes.
- **Retired routes:** `GET /pos/ai-customer-profile/tenant-overview` and `POST …/tenant-overview/refresh` no longer have a caller. Their service methods stay for the scheduler.

## Proof

- **pgtest: 9/9.** CI-02 recomputes the old per-customer aggregate over the same data and gets **identical** counts (one definition).
- **One deliberate break is caught:** counting archived customers as live fails 3 tests.
- **POS screen: 6/6.**
- **Checks:** typecheck, builds and `check:boot` are green.
- **`ci:gates`:** only the five gates that were already failing still fail, with their counts unchanged.

## Open

- **Background refresh.** The opt-in scan scheduler still refreshes the old cached aggregate. Pointing it at the new scan is a small follow-up.
