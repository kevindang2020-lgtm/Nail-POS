# Backend & database static audit (§6–7) — evidence, and why no blind changes

This is a read-the-code audit of the highest-frequency POS query paths (queue, serving, service-done, overview/payments).
It reports verifiable structural facts — not latency numbers, which would need a real run. The honest headline: these
paths are already well-built, so I made **no** speculative changes (the spec explicitly warns against adding indexes
blindly).

## N+1 queries — none found in the hot paths
The high-frequency repositories use the correct batch-load pattern, not queries-in-loops:
- They collect a set of ids, issue **one** `where(<key>, 'in', ids)` query, then build an in-memory lookup map with a
  `for` loop over the returned rows.
- Examples: `queue.kysely.repository` (technician statuses, service→category), `serving` / `service-done`
  (technician names, tip lookups, category names), `tech-queue` (skills, statuses).

The `for` loops in these files iterate already-fetched rows to assemble maps — they do not issue queries. So there is no
N+1 to fix here.

## Indexes — the hot filter/sort columns are already covered
- **Queue state** filters by `tenant_id`, `branch_id`, `status` and sorts/bounds by `checked_in_at`. Covered by the
  composite `idx_pos_queue_items_tenant (tenant_id, branch_id, status, checked_in_at)` — a textbook match for that query
  shape.
- **Overview / payments** (revenue, mix, trend, and the paid-tickets/tips aggregation) filter by tenant/branch + a
  date derived from `created_at`, group by `method`, and count distinct `ticket_id`. Covered by
  `idx_payments_tenant_branch_created_method (tenant_id, branch_id, created_at, method)` and
  `idx_payments_tenant_branch_ticket (tenant_id, branch_id, ticket_id)`.

## What I deliberately did NOT do
- I did **not** add a `status` column to the payments composite. `status` is a small residual filter
  (`REVENUE_STATUSES`) applied after the highly-selective tenant/branch/date range; adding it would be a speculative
  micro-index the spec warns against, and I have no query plan showing it helps.
- I did **not** invent latency figures or "before/after" numbers for these paths.

## The honest next step
Confirming whether any of these are *actually* slow needs real query plans / timings from your environment. The
Phase 4 client tool (`__apsApiPerf.summary()`) surfaces slow endpoints; for the DB side, `EXPLAIN ANALYZE` on the
specific query a slow endpoint runs is the right instrument. Give me either and I'll optimize against evidence rather
than guesswork.
