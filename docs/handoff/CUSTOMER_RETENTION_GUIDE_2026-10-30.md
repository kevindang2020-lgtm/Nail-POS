# Customer Retention — Complete Build Guide handoff (Oct 30 2026)

Source: *AI PowerSalon Customer Retention — Claude Complete Build Guide* (PDF + original screenshot). Route kept:
`/tenant/customers/retention` (POS → Customers → Customer Retention). Built on top of the Oct 29 Retention mandate
(`/pos/retention/*`, consent-checked win-back SMS). Local commit only — **not pushed**, not deployed, migration not run in
production, no real SMS sent (the harness messenger records texts; nothing leaves the machine).

## 1. Root cause of "13 At Risk vs Never Visited" and proof

* **Original defect (Oct 28 photo):** the old list was built from account age, so 13 customers with no visit appeared
  as "60+ days at risk". The Oct 29 mandate moved cohorts to settled tickets; this build hardens that:
  * the hard gate is now in **three** places — the cohort SQL (`visits = 0 → never_visited`, never `at_risk`), the
    priority score (only computed when `visits > 0 and days ≥ risk`), and the SMS verdict (`never_visited` is an
    exclusion reason at preview, at confirm and in the worker);
  * a visit is now `coalesce(paid_at, created_at)` of a **settled, not-removed** ticket (`removed_at is null`) — a
    removed or canceled ticket no longer counts, and one ticket with several services is one visit.
* **Proof (tests run):** `retention-guide.pgtest` "Never Visited is its own segment: not At Risk, not scored, not a
  win-back recipient" (preview of a never-visited customer → `eligible 0, never_visited 1`); "one ticket with three
  services is ONE visit; a removed ticket is not a visit"; harness E2E steps "Never Visited is its own segment" and
  "Never Visited rows cannot be picked … carry no priority" (37 never-visited, 0 selectable, 0 scored).

## 2. Definitions (analytics formula documentation)

All thresholds are the salon's (`tenant_retention_settings`; defaults **60 / 45 / 30**); every response carries
`period.{riskDays, approachingDays, observationWindowDays, settingsVersion, segmentationVersion ('retention-v2'),
priorityFormulaVersion ('winback-v1'), timeZone, from, to, today}`. Days are **salon-local calendar days**.

| Term | Rule |
|---|---|
| Completed visit | ticket `status ∈ {closed, paid}`, `removed_at is null`, time = `coalesce(paid_at, created_at)`; one ticket = one visit |
| Never Visited | no completed visit (canceled / removed / open tickets and bookings are not visits) |
| Active | ≥ 1 visit, days away < risk (Approaching is the late part of Active) |
| Approaching Risk | ≥ 1 visit, approaching ≤ days away < risk |
| At Risk | ≥ 1 visit, days away ≥ risk — the only win-back audience |
| New (first visit) | first completed visit inside the period |
| Returning | a completed visit inside the period that had an earlier completed visit |
| Recovered | a completed visit inside the period whose **previous** completed visit was ≥ risk days earlier |
| Returning Rate | returning ÷ unique visitors in the period; `null` (shown **N/A**) when nobody visited |
| Lapsed Value | net (refunds subtracted) historical spend of At Risk customers — "historical spend at risk", not a forecast |
| Smart Priority | At Risk only: `round(100 × (0.45·min(days,365)/365 + 0.30·min(visits,12)/12 + 0.25·min(net spend,$500)/$500))`; High ≥ 60, Medium ≥ 35, Low < 35; components + top driver returned → "Why this priority?" |
| Campaign-observed return | a recovery within the observation window after a **sent** retention text, last text before the visit (last-touch), and after the previous visit; each return visit credited to at most one campaign — revenue never counted twice. Labelled "observed, not proven cause". |
| Return revenue | ticket total − refunds of that ticket (net), once per ticket |

Suppression (SMS status order): no phone → invalid phone (E.164) → no marketing consent → opted out (STOP list) →
texted by a retention campaign in the last 7 days → **upcoming booking** (booked/confirmed/arrived/checked-in/waiting
from today) → eligible. The worker re-checks consent, opt-out, phone **and upcoming booking** at send time.

## 3. What was built — guide §22 checklist

| Item | Status | Evidence / note |
|---|---|---|
| Original screenshot + current features inspected | Done | audit of `POSRetentionScreen.tsx`, `retention.repository.ts`, migration 709 |
| Five original KPIs kept, definitions corrected | Done | Returning Rate (N/A when no visitors), Returning, New (first visit), At Risk, Lapsed Value — now for the selected period |
| Original six columns kept | Done | Customer · Phone · Last Visit · Days · Visits · Lifetime + select · Segment · Priority · SMS · Last contact · actions |
| 13 At Risk vs Never Visited fixed by tests | Done | §1 |
| Never Visited separate | Done | own tab + KPI; excluded from priority and win-back SMS |
| Threshold tenant-configurable; as-of behaviour | Done / Partial | Settings dialog + `GET/PUT /pos/retention/settings` (14–730 / 7–risk / 1–180, optimistic version, audited in the same transaction). Cohorts are "as of today"; historical as-of snapshots (guide §05 "Period-as-of") are **not** stored — the Recovery trend recomputes from ticket history with the current threshold |
| Fits the POS shell at 100 % | Done | measure: 12/12 PASS (1920×945, 1536×729, 1440×765, 1366×633 · EN / VI / empty) — no page scroll, no clipped module, no target < 44 px |
| Search: name, phone, ID, appointment, service across the salon | Done | server-side: name · phone digits · exact customer id · appointment id · ticket id / ticket number · service name on a settled ticket |
| Today / Week / Month / Year / Custom month calendar, salon time zone | Done | FinanceKit `PeriodBar` + "Date field" basis (any / last visit / first visit / profile created / campaign text / recovery visit); From > To refused (`RETENTION_INVALID_PERIOD`) |
| Numbered pages; per-view default sort documented | Done | All & Never Visited = newest profile first; At Risk / 90+ / 180+ / SMS-Eligible = Priority; Approaching = longest absence; Returning / Recovered = newest visit |
| New customers first under Newest Created | Partial | the sort is the All default; this screen has no "create customer" action, so "return to page 1 and highlight the new record" is not applicable here |
| Smart Priority explainable; verified visits mandatory | Done | score + band + "Why this priority?" (tooltip, overlay with component points and formula version); reproducible (`priorityOf` = SQL; pgtest) |
| Customer Details overlay with Close + visit evidence | Done | segment reason, priority why, first/last visit, settled tickets with services, upcoming bookings, last booking, consent, outreach; Close returns to the same page/filters (E2E) |
| Bulk SMS: multi-select, select page, all matching eligible with snapshot | Done | "Select all eligible (n)" sends the **filters** (segment, period, basis, band, SMS, visits, search) — the server resolves ids at preview and snapshots them in the 20-minute draft |
| Consent, opt-out, quiet hours, tenant routing, permissions | Done (existing, re-verified) | preview → confirm → worker re-check; `pos.marketing.manage` to send; sender = tenant account → shared env → simulated (dev) / not configured (prod) |
| Confirmation + status tracking queued / sent / delivered / failed | Done (existing) | delivered only from the carrier callback (E2E: `delivered 0` without a report) |
| No lapsed-customer text to never-visited | Done | hard gate §1. A separate "first-visit invitation" audience is **not built** (guide says "may", with different wording) |
| Recovery uses completed returns + recorded revenue | Done | `GET /pos/retention/recovery`: recovered customers, return visits, net revenue, campaign-observed returns, avg days to return, unmessaged recoveries, per-campaign (sent, delivered, failed, booked after contact, returned, revenue), return-visit list, 6-month trend |
| No false causality; no double counting | Done | last-touch credit (pgtest: two campaigns before one return → one credit), one ticket once, refund netted |
| Tenant isolation, audit, exports, data protection | Done | every statement `tenant_id = ${T}`; other-salon ids → not found; settings + export audited fail-closed (`retention.settings.updated`, `retention.export.requested/succeeded/failed/denied`); CSV phones masked, formula cells escaped |
| Booking / Checkout / Communications / Marketing integration | Partial | reads tickets, appointments, opt-outs, tenant messaging credentials, notifications ledger; "Book Appointment" opens `/booking?customerId=` (the booking screen does not pre-fill from that parameter yet) |
| Automated tests, staging, visual checks | Partial | pgtests + harness E2E + fit matrix run here (below); **no staging run** (no staging access) |
| No unrelated features damaged | Done (as far as tested) | existing retention pgtest 10/10, harness E2E 42/42 including Loyalty and Memberships steps |
| Production rollout separately authorized | Required | nothing deployed or migrated |

Not built (documented): `retention_segment_snapshot` (historical as-of cohorts), Branch filter (customers are
salon-level; the screen is tenant-scoped), tenant SMS price (cost stays "not estimated"), first-visit invitation audience.

## 4. Files

Backend — `modules/customers/src/retention/retention.repository.ts` (definitions, settings, period window, priority,
search, recovery, export), `retention.controller.ts` (summary/recovery/settings/export routes, ListQuery specs with
`dateRange.maxDays 1830`), `retention-sms.service.ts` (filter-based selection snapshot), `retention-sms.worker.ts`
(upcoming-booking re-check at send time), `modules/customers/src/request-schemas.ts` (`RETENTION_SETTINGS_BODY`,
wider selection). Migration `apps/api/db/migrations/720_retention_settings_recovery.sql`.
Frontend — `apps/pos-web/src/screens/POSRetentionScreen.tsx`, `apps/pos-web/src/api/posRetentionApi.ts`,
`apps/pos-web/src/i18n/ns/retention2.{en,vi}.ts` (129 keys), `apps/pos-web/src/styles.css` (`.rt2` block).
Tests — `retention-guide.pgtest.vitest.spec.ts` (new, 12), `retention.pgtest.vitest.spec.ts` (updated default sort),
`POSRetentionScreen.test.tsx` / `.403.test.tsx` (rewritten against `posRetentionApi`; the old ones mocked a retired API).
Harness — `tooling/customers-one-screen/{live-server,interact,measure}.mjs`; evidence in `results/e2e/` and
`results/final/retention-*.png` (incl. the customer / recovery / settings dialogs at 1920×945 and 1366×633).

## 5. API contracts (all `TenantAuthGuard + RolePermissionGuard`; tenant from the session)

| Route | Permission | Notes |
|---|---|---|
| `GET /pos/retention/summary?preset&from&to` | pos.customers.view | KPIs, segment counts, priority bands, `period` (versions) |
| `GET /pos/retention/customers?segment&q&sort&preset&from&to&basis&band&sms&minVisits&page&pageSize` | pos.customers.view | + `eligibleMatching`, `filters`, `period` |
| `GET /pos/retention/customers/export` (async export contract) | view + **pos.customers.export** | CSV ≤ 5000 rows, masked phones; denied attempts audited |
| `GET /pos/retention/customers/:id` | pos.customers.view | segment reason, priority, visit evidence, upcoming bookings, outreach |
| `GET /pos/retention/recovery?preset&from&to&page&pageSize` | pos.customers.view | §2 |
| `GET /pos/retention/settings` · `PUT` `{riskDays, approachingDays, observationWindowDays, expectedVersion}` | view · **pos.settings.edit** | 409 `SETTINGS_VERSION_CONFLICT`; 400 `RETENTION_INVALID_SETTINGS` |
| `POST /pos/retention/sms/preview` | pos.marketing.manage | `selection` now takes the full filter set |
| existing: readiness, confirm, campaigns, campaign detail | unchanged | |

## 6. Migration 720 + recovery plan

Expand-only, idempotent (applied twice to the test template without error): new `tenant_retention_settings`; the
recipients eligibility CHECK widened with `upcoming_booking` (drop + re-add only if the value is missing; every old
value still accepted); three indexes (`tickets (tenant_id, customer_id, status) where customer_id is not null and
removed_at is null`, `pos_tech_appointments (tenant_id, customer_id, appt_date)`, `retention_sms_recipients
(tenant_id, customer_id, created_at)`). **Rollback:** revert the code — the table is simply unread and the wider
CHECK is harmless; nothing must be dropped (dropping the settings table loses salons' thresholds). Production run
needs approval; build the indexes `CONCURRENTLY` by hand on a large database if lock time matters.

## 7. Tests actually run (this machine, Oct 30 2026)

* `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD modules/customers/src/retention/retention-guide.pgtest.vitest.spec.ts` → **12 passed, 0 failed**
* same runner, `retention.pgtest.vitest.spec.ts` → **10 passed, 0 failed**
* `FST_PG_TEMPLATE=aps node tooling/customers-one-screen/interact.mjs` (label rt2 → `results/e2e`) → **42/42 passed, 0 page errors** (14 retention steps incl. 9 new: priority + why, eight KPIs = server, Never Visited not selectable, period/basis reach the server, whole-salon search, overlay + Close, Recovery & Trend, Settings 60→90→60 with a 409 on a stale version and 2 audit rows, audited masked CSV export; plus the SMS flow: 3 individual texts through the recorder, idempotent confirm)
* `node tooling/customers-one-screen/measure.mjs rt2m retention` → **12/12 PASS**
* esbuild syntax check of the screen + both screen tests; `tsc` undefined-name check clean. **pos-web vitest cannot run here** — the two screen tests are written but not executed.
* Gates: list-queries (0 failures), tenant-isolation, as-any (no file above baseline), role-checks, validated-bodies, async-exports, select-columns, impossible-predicate, unreached-routes, silent-catch, audit-writers, pos-i18n, vi-glossary, inert-controls, dead-client-methods — all OK; openapi manifest + attack surface regenerated.

## 8. SMS consent / routing evidence

pgtests: consent, opt-out, invalid/missing phone, duplicate destination, other-salon id, **never_visited**, **upcoming_booking**
exclusions at preview; revalidation at confirm; send-time re-check (opt-out after confirm → blocked; interrupted
hand-off → unknown, never re-sent). Routing is the existing `sender()` (tenant credential row, never another salon's).
Harness: every text starts with the salon name and ends with "Reply STOP to opt out.", one per destination.

## 9. Performance / indexing

Every read is one set-based CTE over the salon's tickets (window `lag` for recoveries) — no per-row round trips, never
the whole table to the browser. New indexes above. Search by service / ticket number uses correlated `exists` on
indexed `(tenant_id, ticket_id)` / `(tenant_id, customer_id)`. Not load-tested at 100k customers here; the harness salon
has 260 customers / 1188 tickets. Recommend an `EXPLAIN ANALYZE` on the largest pilot salon before rollout.

## 10. Owner actions / production checklist

1. Review the Vietnamese strings (`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`, section A46).
2. Approve migration 720 for staging, then production.
3. Run the pos-web vitest suite in CI (cannot run here).
4. Decide whether a separate first-visit invitation audience is wanted (different wording + its own consent check).
5. Bulk SMS stays behind the existing sender / A2P readiness — a salon without its own approved sender cannot send in production.
