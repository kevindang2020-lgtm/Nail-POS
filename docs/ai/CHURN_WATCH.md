# Churn Watch (POS) — Nov 2 2026

Guide: *Churn Watch* (Kevin, Nov 1 2026). Route: `/tenant/ai/customer-profile/churn` (unchanged).

## Audit findings (before the build)

| Area | Status | Finding |
|---|---|---|
| Screen | Partial | A look-up box, then one customer's risk chip. No queue, metrics, tabs, dates, pages or review workflow. The blank area was simply "nothing searched yet". |
| Rule | Verified (per customer only) | `evaluateChurnRisk`: minimum history, upcoming booking → low, recency against the customer's own cadence, repeated cancellations / no-shows, cancelled membership. Levels are insufficient · low · possible · elevated · high. It read the whole history one customer at a time. |
| Intelligence agreement | Different definitions | The Customer Intelligence card is the *coarse* watch (due, inactive or long-term inactive, nothing booked). Churn Watch is the scored rule. Both are now computed by **one** evaluation and the check explains the difference. |

## What was built

- **One evaluation, no second engine.** The Customer Intelligence scan (Refresh on either screen) now also runs `evaluateChurnRisk` for every live customer. Its inputs come from set-based reads: the cadence it already computes, plus cancellation and no-show counts and cancelled memberships.
  - Results are stored on `customer_intelligence_snapshots` as level, confidence, evidence and inputs (rule version `ci-2026-11-02b`).
  - `churn_since` is the first scan that saw the current signal, kept across rescans.
- **Signal taxonomy.** Persisted levels keep their names and are shown as the guide's states:

  | Level | State |
  |---|---|
  | possible | Needs Review |
  | elevated / high | Higher-Priority Review |
  | low | No Current Signal |
  | insufficient | Insufficient History |
  | no evaluation, or a failed one | Data Unavailable (never "no risk") |

- **Six metrics:** evaluated, needs review, higher priority, insufficient history, upcoming booking, reviewed.
- **Review workflow (internal only):** Mark reviewed, Defer (optional date), Reopen and Note. The current state lives in `churn_watch_reviews`; the history in `churn_watch_review_events`, which is append-only via a trigger.
  - A review stands until the signal **rises** above the level it was reviewed at, or a deferral date passes. Then the customer is back in Needs Review.
  - Version-checked; requires the existing manage permission `pos.ai_customer_profile.churn`.
- **Queue:**
  - tabs: Needs Review, Reviewed, All signals, Insufficient, No signal, History;
  - priority;
  - search: the shared customer search, so name, phone, email, id, technician and service;
  - date field: signal generated, last visit, appointment, created, reviewed, evaluated, with presets and a calendar;
  - sort, and pages of 10/25/50/100.
- **Retention Evidence overlay** (audited fail-closed):
  - the rule's evidence lines and the caution note;
  - every input (visits, interval, days since, upcoming, cancellations / no-shows, membership);
  - signal-since date, rule version and evaluation time;
  - review state and history;
  - links to Profile, Appointment history (Timeline), Rebooking and Recommendations.
- **Check Churn Watch System:**
  - assistant enabled;
  - evaluation freshness;
  - levels reconcile;
  - agreement with Customer Intelligence (explained);
  - rule applied to everyone;
  - bookings made since the evaluation;
  - reviews point at live customers;
  - tenant isolation;
  - deferrals due;
  - no customer side effects;
  - indexes.
- **No autonomous action:** Churn Watch has no path that texts, books, edits a customer or changes points. RV-01 proves the customer and appointment rows are unchanged by a review.

## Database (migration 764, additive)

- New snapshot columns: `churn_level`, `churn_confidence`, `churn_evidence`, `canceled_count`, `no_show_count`, `membership_canceled`, `churn_since`.
- New tables: `churn_watch_reviews`, `churn_watch_review_events` (append-only), `churn_watch_health_runs`.

## Proof

- **pgtest: 10/10.**
  - Data Unavailable with no evaluation.
  - Exact level per fixture (possible / elevated / high / low / insufficient).
  - Metrics.
  - Signal date kept across rescans.
  - Review does not touch customer data.
  - A rising signal reopens a review; a passed deferral reopens too.
  - Refusals; history order; search, dates and pages; cross-tenant; health check.
- **One deliberate break is caught:** a review that ignores a rising signal fails 2 tests.
- **Customer Intelligence pgtest:** still 9/9.
- **POS screen:** 6/6.
- **Checks:** builds and `check:boot` are green.
- **`ci:gates`:** only the five gates that were already failing still fail, with their counts unchanged.
