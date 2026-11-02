# SILENT-SQL-RISK.md
### A pattern that hides broken queries — found in my own code, then measured across your API

## What happened
Three bugs in the catalog queries I wrote this session were invisible: a status value that does not exist in
the table's CHECK constraint, and `tenants.name` where the column is `display_name` — written twice, fifteen
lines below a correct example. None of them threw. None failed a test. None looked like bugs.

The reason is a pattern that is everywhere in this codebase, and is usually *correct*:

```ts
try { const r = await sql`SELECT …`.execute(db); return r.rows.map(…); }
catch { return null; }          // or [] — an analytics panel must not take down the page
```

Good resilience. But it converts **wrong SQL into invisible SQL**: the panel renders "NotConnected" or empty,
which reads as *not built yet* rather than *broken*. Nobody investigates a feature that looks unfinished.

## Why TypeScript and your existing gates do not catch it
- The Kysely query **builder** is type-checked against `kysely.types.ts`.
- `check:types-drift` proves `kysely.types.ts` matches the migrated schema.
- **Raw `sql\`…\`` template queries bypass both.** The column names inside them are strings. Nothing verifies
  them except running them against a real Postgres.

That is the gap: the strongest schema guarantee in the project stops exactly where raw SQL begins.

## Measured across the API
`node apps/api/scripts/audit-silent-sql.mjs` (new, ships in patch 5):

| | Files |
| --- | ---: |
| Raw SQL behind an error-swallowing catch | **100** |
| …in a module that has a pgtest (queries executed somewhere) | 45 |
| …in a module with **no** pgtest — column names never executed | **55** |

Highest-exposure modules (swallowing catches × raw queries):

| Catches | Queries | Module |
| ---: | ---: | --- |
| 13 | 169 | `super-admin-revenue-residuals` — **money**; the split math is well tested at core/service level, but the SQL that feeds it is not executed in tests |
| 11 | 23 | `super-admin-system-status` |
| 7 | 23 | `super-admin-customer-data` |
| 5 | 27 | `super-admin-integrations` |
| 3 | 44 | `super-admin-appointment-oversight` |
| 6 | 18 | `overview/overview-board.service.ts` |
| 1 | 87 | `owner` |
| 1 | 80 | `super-admin-booking-checkin` |

**This is a risk list, not a bug list.** I have not found defects in these modules; I found that a defect there
would be silent. The residuals line is the one I would look at first, because invisible failure plus money is
the worst combination on the list.

## The fix, per module — one small test
Boot PGlite, create the tables **with the column names from `db/migrations`**, call the repository methods, and
assert the result is **not empty** — because empty is what the bug looks like. Two working examples ship in
these patches:

- `apps/api/src/super-admin-product-catalog/product-catalog-queries.pgtest.vitest.spec.ts`
- `apps/api/src/help/status-query.pgtest.vitest.spec.ts`

Each is ~100 lines, runs in seconds, and needs no database.

## Why this is not proposed as a gate
A swallowing catch is frequently the right call, so failing the build on the pattern would be noise. The script
prints a ranked report and always exits 0. If you later want enforcement, the honest form is narrower: *a
module that contains raw SQL must contain at least one pgtest* — which is checkable, but it is a policy
decision for you, not something to impose in a patch.


---

## Acted on: the top-ranked module is now covered

`super-admin-revenue-residuals` was first on the list — the money path. Patch 6 adds
`revenue-residuals-queries.pgtest.vitest.spec.ts`, which executes `overview()`, `listAgreements()`,
`agreementDetail()`, `listRecords()` and `listStatements()` for real.

**Result: all five queries execute correctly. No bugs found.** That is the honest outcome — the value is that
a future break in them will now fail a test instead of quietly showing "no agreements".

**A better pattern than the first two pgtests I wrote:** rather than hand-writing table DDL (which can drift
from the migrations, and whose drift would itself be invisible), this test applies **every real migration** to
PGlite and then inserts fixtures. Schema truth comes from `db/migrations`, not from my copy of it. Cost: ~6
seconds of setup for the whole file. I would use this form for the remaining modules.

Re-running the detector after patch 6: covered **45 → 46**, uncovered **55 → 54**. The list is a work queue,
and one item is done.


## Second module covered — and it taught the test two real constraints

`super-admin-system-status` (11 swallowing catches) now has
`system-status-queries.pgtest.vitest.spec.ts`: components, incidents, scheduled maintenance, public updates,
incident history, monthly counts, and a **createIncident → updateIncidentStatus round-trip**.

**No repository bug found** — but the test failed twice while being written, and both failures are worth
knowing, because they are the kind of thing a caller gets wrong:

`status_incidents` carries **two different vocabularies on the same row**:

| Column | Allowed values | Source |
| --- | --- | --- |
| `impact` | `none · minor · major · critical` | migration 147 |
| `severity` | `critical · high · medium · low · informational` | migration 247 |

`'minor'` is a valid **impact** but not a valid **severity**; `'partial'` is neither. `createIncident` does not
swallow errors, so a wrong word is a loud 500 rather than a silent no-op — but any UI or API caller still needs
the right vocabulary, and nothing in the type signatures says so (both are plain `string`).

Detector after patch 7: covered **47**, uncovered **53** (from 45 / 55 at the start).


## Third module covered — and the fixture itself taught three schema facts

`super-admin-customer-data` now has `customer-data-queries.pgtest.vitest.spec.ts`, covering the customer
projection, all three request-count queries, merges, merge history, recent activity and audit history — plus
the assertion that matters most on this surface:

> **Tenant isolation:** scoping to Tenant A returns only Tenant A's customers, and Tenant B's customer is
> absent. The platform's loudest rule, now executed rather than assumed.

**No repository bug found.** But writing the fixture failed three times, and each failure is a fact worth
having written down:

1. `customers.branch_id` is **NOT NULL** — a customer cannot exist without a branch, so branches must be
   seeded first.
2. `customers.first_name` and `last_name` are **NOT NULL** alongside `full_name`.
3. The repository maps rows to **camelCase** (`fullName`, `tenantName`, `tenantId`), not the raw snake_case —
   my first assertions were wrong, the code was right.

Detector after patch 8: covered **48**, uncovered **52** (from 45 / 55 at the start — three modules done).

### Remaining queue, highest exposure first
`super-admin-integrations` (5 catches · 27 queries) · `super-admin-appointment-oversight` (3 · 44) ·
`overview/overview-board.service.ts` (6 · 18) · `super-admin-ai-usage` (4 · 23) · `owner` (1 · 87) ·
`super-admin-booking-checkin` (1 · 80).


---

# A static checker beats the per-module grind

Covering modules one pgtest at a time was working but slow, and each test only proves the queries it calls.
**`scripts/audit-sql-identifiers.mjs`** (patch 9) covers all of them at once: it applies every migration to
PGlite, then checks that each table and each qualified column in every raw `sql\`…\`` template actually exists.

**Result across the whole API: 0 unknown columns.** Every qualified column reference in raw SQL resolves
against the migrated schema.

That a checker finds nothing means little unless it can find something, so it was **sabotage-tested**:
reinstating the real bug from earlier (`t.name` where `tenants` has `display_name`) makes it report the exact
file and line. It sees the class of bug that no test catches, because those queries sit behind a catch.

Precision took three passes — the first run produced 65 "unknown tables" that were mostly prose inside
comments, CTE names, `EXTRACT(DOW FROM col)`, `JOIN LATERAL` and `IS DISTINCT FROM false`. Now 4 remain, all
subquery aliases, and the script says so in its own output rather than leaving you to work it out.

## How the two tools divide the work
| Tool | Answers | Cost |
| --- | --- | --- |
| `audit-sql-identifiers.mjs` | "Do these names exist?" — every raw query, no fixtures | ~10s, whole API |
| a module pgtest | "Does this query return the right rows?" — behaviour, joins, tenant isolation | ~6s per module, fixtures needed |

The checker is the cheap broad net; pgtests are for the paths where being *right* matters — money, tenant
isolation, anything a human acts on. Three such modules are covered (patches 6-8); the queue in the section
above lists the rest.


---

# The ranking metric was wrong — and it was hiding the top risk

The first version of this report ranked modules by **swallowing catches × raw queries**. That is the wrong
weight: only a *swallowed* query can fail invisibly, so a module with 87 queries behind one catch is far safer
than one with six catches over eighteen. Volume inflates the score of modules that are mostly fine.

Re-ranked by **swallowing catches alone**, a module the old metric buried came first:

| Catches | Queries | Module |
| ---: | ---: | --- |
| **7** | 2 | `pos/pos-search.kysely.repository.ts` — the **global POS search bar**, on every screen |
| 6 | 18 | `overview/overview-board.service.ts` |
| 5 | 27 | `super-admin-integrations` |
| 4 | 23 | `super-admin-ai-usage` |

Old score put `pos-search` (7 × 2 = 14) below `owner` (1 × 87 = 87). It should have been first.

## Why pos-search is the worst place for a silent query
It catches **per category** — customers, appointments, services, technicians, tickets, receipts, queue — and
each returns `[]` on error. A broken customer query therefore does not error; that category simply reports
**nothing found**. A receptionist searching for an existing customer sees "no results" and creates a duplicate:
precisely the outcome the customer-identity and 7 PM reconciliation work exists to prevent. The failure looks
like *the customer isn't in the system*, which is the most believable wrong answer a POS can give.

**Now covered** (patch 5): all seven categories execute against the real migrated schema, asserting a seeded
customer **is found** by name, by email and by phone digits — plus tenant isolation. Empty is the failure mode,
so the tests are written to fail if empty.

Detector after this: covered **49**, uncovered **51**.


## #2 covered — the Overview board

`overview/overview-board.service.ts` (6 swallowing catches) feeds the panels on the POS Overview screen:
communications, retention, inventory alerts, arrivals, live tech queue, ready-for-assignment,
ready-for-checkout. Each fails soft, so a broken query renders an **empty panel** — which on a salon's main
screen reads as *quiet morning*, not *broken query*.

The sharp one is **arrivals / ready-for-assignment**: an empty list makes a **waiting guest invisible to the
front desk**. Someone is sitting in the salon and the screen says nobody is.

Now covered: a waiting guest is seeded and asserted to come back through both panels — including the jsonb
`requested_services->0->>'serviceName'` path and the `COALESCE(..., 'Any Available')` fallback — plus tenant
isolation. **No test in the file can pass on an empty result.**

**Progress: 50 covered / 50 uncovered** (from 45 / 55). The five modules covered this session are the five
highest by swallowing-catch count: pos-search (7), overview-board (6), residuals (13 — money),
system-status (11), customer-data (7).

### Remaining, correctly ranked
`super-admin-integrations` (5) · `super-admin-ai-usage` (4) · `ai-queue-assignment` (4) ·
`super-admin-appointment-oversight` (3) · `campaigns/platform-announcements` (3) ·
`campaigns/campaign-templates` (3) — then a long tail of 1-2 catch modules where the exposure is small.


## #3 covered — Integrations, where "zero" is the dangerous answer

`super-admin-integrations` (5 catches). The catches here are inline — `.catch(() => [])` and
`.catch(() => ({ tenants: 0 }))` on individual queries — so a broken query does not blank the page. It reports
**zero connected integrations**, or **no webhook errors**, or **no auth alerts**.

Those are the answers an operator most wants to see, which is exactly why they are the most dangerous to
fabricate. "No webhook signature failures in the last 24 hours" is reassuring; "the query that counts them is
broken" is not, and the screen cannot tell them apart.

Now covered: a **fiserv webhook event with an invalid signature** is seeded and the processor must surface in
`connectedIntegrations` — a silently-broken query would report nothing and pass a weaker test. Every other read
executes, and the tenant filter is exercised.

**Progress: 52 covered / 48 uncovered** — past halfway, and the six highest-exposure modules are all done:
residuals (13) · system-status (11) · pos-search (7) · customer-data (7) · overview-board (6) ·
integrations (5).

### Remaining
`super-admin-ai-usage` (4) · `ai-queue-assignment` (4) · `super-admin-appointment-oversight` (3) ·
`campaigns/platform-announcements` (3) · `campaigns/campaign-templates` (3) — then a tail of 1-2 catch modules
where a single broken query affects one small panel.


---

# Making the remaining coverage affordable

Covering a module cost ~6 seconds per test file, because each one replayed all 432 migrations into PGlite.
Fine for two tests; a real tax on the ~48 modules still uncovered — and that cost is precisely how good
coverage stops getting written.

**`apps/api/test-support/pgtest-schema.mjs`** builds the schema once, dumps it, and later runs load the dump.
Measured on the integrations test: **8.57s → 2.97s**, and it gets better as more tests use it.

Two properties that matter more than the speed:
- **The cache key is every migration's name and content**, so editing a migration rebuilds it. The schema can
  never drift from `db/migrations` — drift being the exact failure these tests exist to catch.
- **Each caller still gets its own instance.** No shared mutable state between test files.

The cache lives in `node_modules/.cache`, so it never ships and never needs cleaning up.

All seven pgtests were converted to it. Writing the eighth is now a five-line setup:

```ts
import { migratedPglite, kyselyFor } from '../../test-support/pgtest-schema.mjs';
const pg = await migratedPglite();
const repo = new KyselyWhateverRepo(kyselyFor(pg));
```


## Two more, cheaply — the helper paying off

With the cached schema in place, `ai-usage` and `appointment-oversight` each took **three lines of setup and
about three seconds**. That is the whole point: the cost of the ninth test should not be the cost of the first.

- **ai-usage** (4 catches) — a broken query reports **zero usage** and **no providers configured**: the billing
  surface goes blind quietly. Now covers the aggregate, the series, the provider list, and an
  upsert → get round-trip.
- **appointment-oversight** (3 catches over 44 queries) — a broken query reports **no duplicates, no
  overlaps, no failures**. For an oversight tool that is the most reassuring possible lie. Now covers
  daily-by-status, technician count, today's revenue, the search envelope and duplicate detection.

**54 covered / 46 uncovered.** The eight highest-exposure modules are done. What remains is the 3-catch and
below tail: `campaigns/platform-announcements`, `campaigns/campaign-templates`, `ai-queue-assignment`, then
modules where a single swallowed query affects one small panel.

## #9 covered — the Owner floor, where "empty" reads as a quiet Tuesday

`owner/owner.kysely.repository.ts` was the LARGEST uncovered surface in the report: 87 queries. Its
`ownerFloorCounts` is the most dangerous shape in the codebase — five independent counts, each ending
`.catch(() => 0)`. A wrong column name does not blank the Owner dashboard; it reports **an empty salon**.
Nobody investigates a quiet Tuesday.

Now covered: a waiting guest and an in-service ticket are seeded, and all five counts are asserted NOT zero,
plus a cross-tenant check and a type check (pg returns `count(*)` as text, so the coercion has to run).

**The real schema refused two shortcuts while writing it** — `pos_queue_items.customer_name` and
`tickets.customer_id` are both NOT NULL. That is the test earning its keep before it even ran: those
constraints are invisible to a unit test with a hand-built fake.

**A mutation-testing trap worth recording.** My first five mutations all SURVIVED, which looked like the test
was worthless. It was not: a whole-file string replace hit the FIRST occurrence of each column name, which
lives in `ownerLiveOperations`, not in the method under test — `service_done_at` appears 7 times in that file
and only 2 of them are in `ownerFloorCounts`. Scoping each replacement to the method body killed all five,
including a wrong *status value*, which is the exact bug class that started this whole audit.
When a mutation survives, check that it landed where you think before concluding anything about the test.

## #10 covered — Booking & Check-In Monitor, and a vacuous test caught in the act

`super-admin-booking-checkin` is #2 by size: 80 queries, **all** raw `sql` templates, every one routed through
two swallowing helpers at the top of the repository — `rows()` returns `[]` on any error, `one()` returns its
default (`'0'`, `null`). A wrong column name makes the monitor report no bookings, no check-ins and an empty
funnel: the same answer a genuinely quiet period gives.

**My first version of this test was worthless, and I proved it rather than assuming.** It asserted
`Array.isArray(result)` — which passes precisely when the query has failed, because a failed query returns
`[]`. Replacing the table name with `pos_tech_appointmentsXX` still gave 4/4 passing. Seeding real rows and
asserting they come BACK killed that mutation and five more, including a wrong CHECK status value and a
dropped tenant filter.

The rule this confirms: a test over a swallowing helper must assert **data returned**, never shape. Shape is
exactly what the failure mode also produces.

## #11 covered — Merchant Accounts, where a false zero is reassuring

41 queries behind the same two swallowing helpers. This module is money-adjacent, which inverts the usual
risk: **"0 pending underwriting" and "no open alerts" are the answers an operator is happiest to see**, so a
broken query here produces a reassuring screen rather than a visibly broken one.

Now covered: a configured merchant and an open critical alert are seeded and asserted to come back, including
the LEFT JOIN onto `tenants` resolving a display name, plus two cross-tenant checks. Seven mutations die,
including a wrong CHECK *value* (`'reviewing'` for `'under_review'`) and a dropped tenant scope on the alerts
query.

**A suspected bug that wasn't.** `kpiCounts` filters `status in ('disabled','paused')`, and the base table's
CHECK allows only `pending/active/error/disabled` — the exact shape of the original bug that started this
audit. Migrations **097** and **098** add `'paused'` and the whole `onboarding_status` column later. Checking
before reporting cost a minute; the seed now also proves those later migrations are present in the cached
schema rather than just the base table.

## #12 covered — Tech Queue, and a DEFAULT that hides its own failure

35 queries with inline `.catch(() => [])` on the catalog, skills and status lookups. An empty service catalog
reads as "this salon has not configured any services yet"; a technician with no skills reads as "not trained
on anything". Both look like setup the salon has not done, so nobody reports them.

**The finding worth keeping.** `_techMap` resolves a technician's working status and, when the lookup returns
nothing, falls back to `'available'`. My test asserted `'available'` — so breaking the `technician_statuses`
table name left all seven tests green. The fallback value and the success value were the same string.

Seeding `'on_break'` instead and asserting the NON-default kills the mutation. The general rule: **when code
has a fallback, a test must assert a value the fallback cannot produce.** Otherwise it measures the fallback,
not the query. That is a second species of vacuous test, distinct from the shape-vs-data one above — and this
one survives even when you do seed real data.

## #13 covered — the platform Overview, which states its own risk in its header

`super-admin-overview` opens with: *"every metric is its own resilient query: a missing column/table degrades
THAT metric to 0/empty (via `.catch`)"*. Correct resilience, and a perfect hiding place — this is the platform
operator's FRONT PAGE, where zero tenants, zero applications and zero card volume render as a quiet platform
rather than a broken one.

Now covered: a tenant, a branch, a pending application and a day of revenue are seeded, and each fact is
asserted non-zero, including the `::bigint` coercion.

**Two survivors, and each taught something different.**

1. Mutating the `branches` table left everything green. I checked why instead of calling the test weak:
   `activeSalons` is DERIVED from `tenantStatusCounts` and never reads `branches` at all — my test's comment
   was wrong, not its logic. The metric that does read it is `platformKpis.totalLocations`, nested one level
   down, and had no coverage. Adding it killed the mutant.
2. This file uses **two different scope helpers** — `andTenant()` for the money metrics and `tenantPred()` for
   the platform KPIs. My cross-tenant test only exercised the first, so replacing the second with `true` passed
   everything. Two scope mechanisms need two tests.

## #14 covered — Audit Logs, the worst failure mode in the codebase

19 queries behind the usual two swallowing helpers. The failure mode here is the most dangerous one we have
found: an audit surface reporting **no failed logins, no data exports, no role changes and no support access**
does not look broken — it looks CLEAN. Nobody escalates a clean audit log, and it is exactly the screen an
investigator would be relying on.

`counts()` is seven separate `count(*) filter (where …)` predicates in one query, each matching on a LIKE
pattern over `action`/`module`. Every one of those patterns is an independent chance to silently match nothing
— and a pattern that matches nothing is indistinguishable from an absence of the event.

So the seed is one event per KPI: a failed login, a report export, a role change, a support session, an AI
config change. A single row would have left most counts at 0 and proved nothing.

Seven mutations die, including three LIKE patterns quietly rewritten (`%login%` → `%signin%`, `%export%` →
`%download%`, the support OR-branch), wrong severity values, and a dropped tenant scope on the trail.

## #15 covered — legal holds, investigations, evidence packs

The three compliance repositories beside the audit log, and the highest-consequence reads in the report. A
LEGAL HOLD that silently returns nothing does not merely look clean: it tells an operator **no hold is in
force**, which is exactly the moment data gets deleted. Same shape for open investigations and evidence packs
— the empty answer is the reassuring one, and every read is wrapped in a try/catch returning `[]` or `0`.

Covered with one seeded row each, asserting the row comes back, the counts are non-zero, and — for evidence —
that the **checksum survives the read**, since integrity re-verification is the pack's whole purpose.

Two details the real schema forced, both invisible to a fake: every status and scope column here carries a
CHECK constraint, so an invented value is refused at insert; and `countOpen` matches against an `OPEN_STATES`
list of five values rather than `status = 'open'`, so the mutation had to target that constant.

Also asserted: filtering by `'released'` returns nothing. Without that, a "filter" that ignores its argument
passes every other test in the file.

## #16 covered — photo consent, where the failure DIRECTION is the finding

Consent is the one place in this report where which way a query fails matters as much as whether it fails.
Both reads degrade toward "no consent": `activeConsentExists` catches to null and returns **false**, and
`listConsentedPhotos` catches to **[]**. That is fail-CLOSED — a broken query hides a photo rather than
publishing one without permission. **That was worth confirming rather than assuming, and the tests now pin the
direction** so a refactor cannot quietly invert it.

It remains a real bug in the other direction: a customer whose consent list silently empties is told they
consented to nothing, which is the opposite of what the record says.

The two assertions that carry the weight are negatives — a REVOKED consent must be excluded from the list, and
must not count as active. Deleting either `revoked` filter is a mutation that would publish a photo after its
subject withdrew permission, and both now die.

The real schema also refused a dangling `customers.user_id`: there is an FK to `users`, so the seed needed a
real user row.

## #17 covered — the numbers AI reports are written from, and a design worth keeping

`snapshotMetrics` gathers revenue, booking and customer figures, and an AI narrative is generated on top of
them. A wrong column name does not fail the report — it produces a confident, well-written report about **$0 of
revenue**.

**This module already defends against that, and the defence is worth naming.** `hasData` is derived from the
ROW COUNTS, not from the sums, and `report-run-core` marks such a run `partial` rather than publishing zeros as
fact. So "we found no rows" and "the salon genuinely took nothing" stay distinguishable.

A mutation proved how load-bearing that distinction is. Rewriting `hasData` to come from the sums survived
every test I had written — because all my fixtures had either data-with-nonzero-sums or no data at all, where
both definitions agree. The seed that kills it is **a salon that opened and took $0**: row counts say
`hasData: true`, sums say `false`. A real quiet Tuesday must be reported as "$0", not as "we could not gather
your numbers".

Nine mutations die, including three wrong tables, refunds conflated with revenue, completed/cancelled
cross-wired, new/returning swapped, and both scope predicates.

## #18 covered — report schedules and deliveries

Two quiet failure modes that both look like nothing is wrong. A schedule list that silently empties reads as
"no reports are scheduled": nobody receives their report and nobody is told anything broke. Delivery counts
that silently zero read as "0 failed, 0 bounced" — the number an operator wants to see.

`countsByRun` is six `count(*) filter (where …)` predicates over a CHECK-constrained status column, so the
seed is one row per status rather than one row total.

Two assertions carry more than they look:
- **`total` must EXCLUDE excluded recipients.** Counting them would understate the delivery success rate, and
  `count(*)` instead of the filtered count passes every other test in the file.
- **`setNextRun` must actually advance the schedule.** A schedule that never advances re-fires forever; a
  mutation that updated only `updated_at` is caught by reading the value back.

The real schema also refused `ai_report_runs` without an `idempotency_key` — NOT NULL, and invisible to a fake.

## #19 covered — campaign compliance, plus a control that is configured and never consulted

A compliance surface that silently returns `[]` reports **no open flags** — no high opt-out rates, no spam
complaints, nothing awaiting review. The recurring shape of this whole audit: the reassuring answer is the
broken one.

Covered with one open flag and one cleared flag, a NEGATIVE case on the status filter (without it, a filter
that ignores its argument passes everything else), and the active platform limits including a quiet-hours
window that wraps midnight. Six mutations die, including `setLimits` failing to deactivate the previous row —
which would leave two `active` rows under a `LIMIT 1`, making which limits apply non-deterministic.

### FINDING FOR KEVIN — `campaign_limits` is written and read, but never enforced

`campaign_limits` holds max sends per day, max campaigns per day, quiet hours and minimum hours between sends.
Searching every reader of that table in `src/`: **the only code that touches it is the repository that writes
it and the screen that displays it.** Nothing consults it at send time.

So a Super Admin can set a 5,000/day cap and a 9pm–8am quiet window, see them saved, and campaigns will send
outside those limits regardless. This is a *fake control* in the same sense as the July screen audit — it
looks like a safety mechanism and is not one.

I have NOT built enforcement, because the behaviour is a product decision, not a gap to be filled quietly:
when a campaign exceeds the cap, should it be blocked, deferred to the next window, or only warned about? And
quiet hours need a timezone rule — the tenant's, or the recipient's. **Kevin's call.**

## #20 covered — platform announcements, and why fixture values must differ

Two distinct quiet failures. An empty oversight board reads as "nothing is in flight" — including anything
currently SENDING. And the per-announcement counters are read as `Number(x.col || 0)`, so a renamed column
silently becomes 0: a campaign that reached 4,000 salons reports zero engagement, which reads as a **bad
campaign** rather than a broken query.

**Every seeded counter is a different number** (4000 / 3900 / 1200 / 340 / 27 / 915000) — deliberately. Six
columns mapped side by side is six chances to cross-wire two of them, and identical fixture values would hide
every swap. The mutation that exchanges `open_count` and `click_count` only dies because the values differ.

That is a third species of the same lesson: shape-not-data, fallback-equals-success, and now
identical-fixtures. All three produce a green test that cannot distinguish right from wrong.

Also covered: a NEGATIVE status-filter case, and `setStatus` verified by re-reading rather than trusting the
call returned.

## #21 covered — AI auto-assignment config, and a fourth vacuous-test species

The densest catch-to-query ratio in the report. This config decides whether AI assigns customers to
technicians **without a human**, so both directions matter: a missing row must mean OFF (it does — verified,
not assumed), and a saved config must actually come back, or an operator who switched auto-assignment on sees
it enabled while nothing changes.

The upsert is `on conflict (tenant_id, branch_id)`. That works **only** because `branch_id` is NOT NULL in
migration 333 — the same shape that was a real latent bug in `tenant_settings` (fixed by migration 441), since
Postgres treats NULLs as distinct and the conflict would never match. Checked rather than assumed, and pinned
by saving twice and asserting one row's worth of state.

**A fourth way a test can be vacuous: fixtures that agree.** My cross-branch test saved nothing for the second
branch and asserted `false` — which was also what the first branch held, so deleting the branch predicate
entirely still passed. Two rows that DISAGREE is what makes a filter observable. (Alongside: shape-not-data,
fallback-equals-success, identical-counters.)

## #22 covered — platform settings, where the REFUSAL is the feature

A settings read that silently empties means the platform runs on **compiled-in defaults nobody chose**, while
the Super Admin screen shows the values they saved.

`upsertIfVersion` is optimistic concurrency, and the property worth pinning is negative: a stale
`expectedVersion` must be REFUSED **and must not write**. Asserting only that it returns null would pass an
implementation that refuses *and clobbers anyway*, so the test re-reads the stored value afterwards. Same for
`expectedVersion: 0` against an existing key — the concurrent-create race.

One more survivor caught a gap in my own assertions: an insert writing `version: 0` passed everything, because
the update path only compares "after > before" and `1 > 0` holds just as well as `2 > 1`. Asserting the
created version is **1 specifically** kills it.

## #23–24 covered — campaign templates and campaign delivery

**Templates.** An empty list reads as "no templates yet", so work gets rebuilt. The sharper risk is versioning:
`current_version` on the template and the rows in `campaign_template_versions` must stay in step, or the
published version and the version actually SENT diverge — and neither screen looks wrong. A mutation that
updates the status but not the version dies here. (Worth knowing before writing such a test: the version number
is DERIVED as `currentVersion + 1`, so a version passed in is ignored.)

**Delivery.** The recurring shape at its sharpest: a broken failure query reports **no bounces, no opt-outs,
no spam reports, no blocked destinations** — the healthiest-looking screen in the product, and exactly what a
renamed column produces. Seeded with two DIFFERENT failure categories at different counts, so neither a
collapsed grouping nor a cross-wire can hide, plus a negative case on the category filter.

Eleven mutations across the two, all caught.

## #25 covered — voice idempotency, where failure is a DUPLICATE, not an empty screen

Once the catch-count ranking flattened out I switched to ranking by consequence, and this is the one where
failure is not a misleading screen but a **duplicate side effect**. The voice agent retries calls; if the
boundary does not hold, a retried "book me for 3pm" books twice.

`begin()` relies on `ON CONFLICT (tenant_id, operation, idempotency_key)`, which works only if a unique index
with EXACTLY those columns exists. Migration 301 provides `uq_voice_gw_idem` — checked, not assumed — and
every test depends on it, which an in-memory fake cannot establish.

Pinned: an in-flight retry does not proceed; a committed retry replays rather than re-executing; a different
body under the same key is a conflict; `release` frees pending keys but never committed ones.

**The survivor was the interesting part.** Dropping the tenant predicate from the `SELECT` inside `begin()`
passed my cross-tenant test, because a different tenant's first `INSERT` never conflicts — it returns
`proceed` before reaching the `SELECT`. That lookup only runs on a same-tenant retry, and without its tenant
filter `LIMIT 1` can return **another tenant's committed row and replay their booking response**: a
cross-tenant leak through the retry path. The case that kills it seeds tenant A's committed answer, then has
tenant B retry its own in-flight key and asserts B sees `inflight`, never A's data.

Lesson: a cross-tenant test must reach the code path it claims to cover. "A different tenant got a different
answer" proved nothing about a branch that tenant never entered.

## #26 — Skip-the-Line settings: a FIX, not just coverage

**The bug.** `getSettings` used one fallback for two different facts: "this salon never configured
Skip-the-Line" and "the settings query threw". The product defaults have `featureEnabled` **and**
`allowCashToTechnician` set to TRUE. So a salon that had switched cash collection by technicians OFF had it
**silently re-enabled** whenever that read failed — fail-open on a cash-handling control.

**The fix is narrow.** No row → defaults, exactly as before, so unconfigured salons are unaffected. Query error
→ fail CLOSED: the feature and the cash method are off, and the customer simply pays at the front desk. That
matches how consent, support sessions and AI auto-assignment already fail in this codebase.

**My fix nearly introduced a worse bug.** `updateSettings` read via `getSettings` and MERGED the result into
its write. With fail-closed reads, a transient read error during an update would have **persisted** the
fail-closed values — permanently switching the feature off. The write path now uses a strict reader that throws,
so a read error aborts the update. A fail-closed *read* must never leak into a *write*.

**It took three attempts to build a test that could see that.** Attempt one used a database where everything
fails — so the write failed too and the update rejected regardless of which reader it used; the mutation
survived. Attempt two failed only reads of that table — but `updateSettings` reads it TWICE (current values,
then an existence check), so it still rejected regardless; survived again. Attempt three fails the first read
only and then recovers, which is what "transient" actually means. That one kills it.

### SECOND FINDING FOR KEVIN — `requireFrontDeskApproval` is configured and never enforced

Same class as `campaign_limits`: the skip-line setting is stored, displayed and editable, and the skip-line
service never reads it. (The `go-check-in` hit is that module's *own* separate setting.) Not built — whether
approval should block, queue, or notify is a product decision.

## #27 covered — Reception Copilot settings: checked for fail-open, found none

After Skip-the-Line I checked the next settings service for the same defect, and it is **not** there.
`readRow` has no catch — a query error propagates, which is correct. The only catches are on the cache layer,
where a miss falls through to the database. Recording a negative result matters as much as a positive one: it
would have been easy to pattern-match "settings + defaults all true" into a finding that does not exist.

What is covered is the hierarchy (defaults ← tenant-wide ← branch) and that turning copilot ACTIONS off is
honoured — every default is `true`, so an unread row would silently hand the copilot back the ability to
create, reschedule and cancel appointments.

It also exercises **migration 441** directly. Tenant-wide rows are read with `branch_id IS NULL` and `patch`
does select-then-insert. Three saves now leave exactly one row, and a test asserts the database itself refuses a
second tenant-wide row — the guarantee lives in the schema, not in the service. Four mutations die, including
the classic `branch_id = NULL`, which never matches anything in SQL.

## #28 — promotion redemption limits: a FIX, plus a suspected bug that the schema already prevents

**FIXED.** `countRedemptions` swallowed errors to `undefined`, and `n(undefined)` is 0 — so a failed count read
as "never redeemed" and `checkLimits` let the redemption through. A one-per-customer or first-100-only
promotion became **unlimited** whenever that query broke. These limits live ONLY in application code, so nothing
downstream catches it. The error now propagates and the redemption fails — the safe direction; staff can still
discount manually.

**NOT A BUG — and I was wrong about why.** `findRedemptionByIdem` also swallows, which looked like a
double-redemption risk on retry. It isn't: `insertRedemption` uses `ON CONFLICT (promotion_id, idempotency_key)
DO UPDATE … RETURNING *`, so a retry returns the EXISTING row. I first wrote the test expecting the database to
*refuse* the duplicate; it resolved instead, because the conflict is handled. The guarantee holds by a better
mechanism than I assumed, and the test now asserts what the code actually does: a retry returns the same
redemption id and the count is unchanged.

Two lessons in one module: a swallowed error is only dangerous when **nothing downstream enforces the same
property** (limits: nothing did; idempotency: the constraint did), and a test must assert the real mechanism,
not the one I expected.

**74 covered / 26 uncovered.**
