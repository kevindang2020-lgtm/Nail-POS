# MULTI_SALON_CODE_AUDIT.md — 2026-07-12

Audit of the Multi-Salon Owner Platform against the reference image, before any changes.

**Headline: it is ~85% built — and the All Salons dashboard, the centrepiece of the image, was returning a 500.**

---

## 1. The architecture question is already answered — correctly

You asked me to decide whether a salon is a branch, a tenant, or both. `owner-portfolio-core.ts` already states
the decision, and it matches your own business rules:

> **A salon is a TENANT.** It has its own Store Code (`tenants.tenant_code`), its own subscription, its own
> merchant account. **Branches sit beneath it.** One **Owner Portfolio spans many tenants.**

That is exactly "separate legal entities stay separate tenants; shared-business locations are branches."
**No new migration is required for the ownership model.**

There is **no `owner_portfolios` table, and none is needed** — the portfolio is *derived* from
`user_branch_access`, which is the honest model: the portfolio simply **is** the set of salons a user has access
to. Inventing a table to mirror that would create two sources of truth for the same fact.

---

## 2. What already exists (reused, not rebuilt)

| Image feature | Where it lives |
|---|---|
| One owner → many salons, no duplicate users | `user_branch_access` (tenant, branch, user) — `UNIQUE(tenant_id, user_id, branch_id)` |
| **Role per salon** | `access_level` ∈ owner / manager / viewer / report_only, + `is_primary_owner` |
| Never flattens permissions across salons | `canAt()` — resolves the level for **that** salon; explicitly refuses to fall back to a better level held elsewhere |
| Salon switcher + search + favorites + recently viewed | `SalonSwitcher.tsx`, `OwnerSalonContext.tsx` |
| Server-verified switch | `POST /owner/context/switch` — **re-mints the session token**, keeps `sid` so it stays revocable |
| Switch PIN | `hasSwitchPin` + `POST /owner/context/select` |
| Salon detail dashboard + revenue trend | `/owner/dashboard/state`, charts in `OwnerHomeScreen` |
| Store Code POS login | `findTenantUserForLogin(tenantCode, identifier)` + password — Store Code is **never** the sole credential |
| Invitations | `/super-admin/platform/invitations/*` |
| Super Admin owner↔salon assignment | `/owner-salons` → `SuperAdminOwnersScreen` |
| Audit on switch | `owner.salon_switched`, append-only |

**Money is already integer cents. Tenant/branch are already server-derived. RBAC is already active.** None of
the hard invariants needed repair.

---

## 3. Three real bugs found — all in the same file

`owner-portfolio.repository.ts → loadTotals()`. All three are now fixed.

### 3.1 The All Salons dashboard was returning a 500 (CRITICAL)

The query selected `customers_waiting` **from `queue_entries` — a table that does not exist.** The real one is
`pos_queue_items` (migration 026). Postgres therefore threw on the whole statement, `loadTotals()` rejected, and
**`GET /owner/portfolio/summary` 500'd.** The entire aggregated portfolio dashboard was dead.

Nothing caught it: the unit tests use `InMemoryOwnerPortfolioRepo`, which never touches SQL. A wrong table name
is invisible to every test that mocks the repository — which was all of them.

### 3.2 Five of the twelve KPI cards would have been NaN

`SalonTotals` requires `checkedIn`, `servicesInProgress`, `readyForCheckout`, `newClientsToday`,
`aiReceptionistLive`. The SQL selected **none** of them and the mapper set **none**. `summarize()` was doing
`checkedIn += t.checkedIn` on `undefined`.

So even had the query run, **Checked In, Services In Progress, Ready For Checkout, New Clients Today, and AI
Receptionist Status — 5 of the 12 cards in your image — would have rendered NaN.**

### 3.3 Revenue was overstated by every refund ever issued (MONEY)

`payment_refunds` is a **separate table**. `loadTotals()` summed `payments` and never subtracted it. So Revenue
Today, Revenue This Month — and now the salon ranking — were **inflated by the full value of every refund the
salon had issued.** Your spec explicitly requires refund handling.

**Revenue now nets refunds, in the same period they were issued.** A salon that refunded more than it took today
reports **negative** revenue — it is not clamped to zero, because a refund storm is exactly what an owner opens
this dashboard to notice.

---

## 4. What I built (the genuine gaps vs the image)

| | |
|---|---|
| **Top Performing Salons** | `topSalons()` — pure, ranked by refund-netted revenue, **permission-scoped** |
| **Revenue Overview chart** | `GET /owner/portfolio/revenue-series` — hourly, refund-netted, integer cents |

**On the ranking and the leak that isn't there.** The controller resolves the **reportable** salons *first* and
only queries totals for those — so a salon the owner may not report on is **never SELECTed at all**. Its money
therefore cannot leak through an aggregate, a ranking, or a chart line. This is the owner's portfolio, ranked;
it is **never** a platform-wide leaderboard.

`generate_series` fills every hour, so a quiet hour is a real `0` rather than a gap the chart would silently
interpolate through.

---

## 5. The change percentages: MODELLED, not typed in — DONE

`PortfolioOverviewScreen` deliberately did not render the ↑18.6% / ↑20.3% deltas in your image, because
period-over-period was not modelled and inventing one would be a fabricated dashboard value. **Whoever wrote
that was right**, so I modelled it rather than typing numbers into a component.

`loadTotals()` now also fetches YESTERDAY's figures — same salon, same refund-netting — and `summarize()`
computes the change with a pure `pctChange()`. The deltas in the image are now **derived from real money.**

The honesty is in the edge cases:

* **No baseline → `null`, and the chip is simply absent.** A salon that took nothing yesterday and $5,000 today
  did **not** grow by a percentage — the comparison is undefined. It is never "+100%", never "0%", never filler.
* **Baselines aggregate over exactly the same salon set as the current figures.** Comparing a total built from
  four salons against one built from three would manufacture a change nobody made. A test pins this: two salons
  that move ±$100k in opposite directions report **0%**, not the +20% you would get by reading one of them.
* **A negative baseline** (a refund-heavy yesterday) scales by magnitude, so a rise is reported as a rise.
* `pctChange()` can never return `Infinity` or `NaN`.

## 5b. Also delivered

| | |
|---|---|
| **Revenue Overview chart** | Real hourly SVG line in `PortfolioOverviewScreen` — one dependency-free polyline. An **empty** series says "no revenue recorded yet", never a flat zero line (which reads as a confident "you took nothing today"). A zero axis appears only when an hour actually went negative from a refund, so it means something. |
| **Top Performing Salons** | Ranked, permission-scoped, tappable — tapping performs the **same server-verified switch**, never a client-side jump. |

---

## 6. Also noticed, NOT yet fixed

**The POS sidebar badge counts may be permanently 0.** `tenant-navigation.service.ts` queries
`pos_queue_items`, `ticket_service_lines`, and `tickets` with `.catch(() => 0)` on each. That fail-soft is
correct in principle, but it means any *wrong table or column name* in those queries — the exact bug class just
found next door — would silently render every sidebar badge as `0` forever, and no test would fail. Worth a
deliberate check against the real schema.

---

## 7. Verification

| | |
|---|---|
| `owner-portfolio-dashboard.vitest.spec.ts` (new) | **17/17** |
| `owner-portfolio-core.vitest.spec.ts` (existing) | **25/25 — no regression** |
| `PortfolioOverviewScreen.test.tsx` | extended: chart, ranking, empty states, switch-on-tap |
| Route table | **2,190 routes, 0 collisions** |
| DI | **192/192 modules, 272/272 controllers** |

`npm install` does not complete in this sandbox, so `tsc --noEmit` and the real vitest runner did not execute.
**Run `npm run typecheck && npm test` locally.**

**And note this specifically:** the bugs above are *exactly* the class a syntax check and a mocked unit test
cannot see. A wrong table name only fails against a real database. The `pgtest` specs and a migration-from-empty
run are what actually prove this fixed — please run them.

---

## 8. Super Admin Owner Portfolio — DONE, and a semantic bug found

The three panels from the image's Super Admin row now exist (`OwnerPortfolioPanels.tsx`), grafted into the
existing `SuperAdminOwnersScreen` rather than replacing a working 281-line screen.

### 8.1 The semantic bug: "Add New Salon" was adding a BRANCH

`super-admin-owners.createSalon()` inserts a **branch under the owner's existing tenant** (`u.tenant_id`) and
calls it a salon. But **a salon IS a tenant** — that is this codebase's own rule, and your image proves it:
`LUXE001` and `LUXE002` are *separate Store Codes* for two Luxe locations.

So that route can only ever grow the owner's **one home tenant**. It structurally **cannot** create a salon that
is a separate legal entity with its own Store Code, subscription and merchant account — which is precisely the
headline requirement. It is a legitimate operation (add a second location to one business), just **misnamed**.

**`getOwner()` has the same blind spot:** it returns branches within the home tenant, so it can never list an
owner's salons across tenants — which is why the image's Store Code / Monthly Revenue columns could not be
rendered from it.

### 8.2 What it is wired to instead — all of it already existed

`POST /super-admin/tenants` **already** does the whole job in one transaction: creates the tenant, takes a
**unique Store Code** (`tenant_code`, uniqueness enforced server-side), creates the first branch, grants
`user_branch_access`, opens the subscription and payment config — and **looks the owner up by email first and
REUSES their account.** Its own comment says why: adding a second salon used to mint a *second owner user* for
the same person, with a different password. **One owner, many salons, one login.**

So Add New Salon posts to `/super-admin/tenants` with the selected owner's **existing** email. Nothing is
duplicated, and no second "create a salon" path was written.

### 8.3 New route (1)

`GET /super-admin/owners/:ownerId/portfolio` — the owner's salons **across tenants**, with Store Code, status,
branches and MTD revenue.

It deliberately reuses the **exact repository and pure functions the Owner App runs on**
(`KyselyOwnerPortfolioRepo` + `summarize` / `topSalons`). A separate Super-Admin-only query over the same tables
would drift, and then **Super Admin and the owner would disagree about what the owner owns** — the last bug you
want in the screen you use to diagnose the other screens.

### 8.4 Two deliberate refusals

* **The invitation endpoint returns a `temporaryPassword`. The panel does NOT display it.** It is temporary and
  must be changed at first sign-in, so it is within your "never permanent passwords" rule — but a plain-text
  credential rendered in a browser can still be shoulder-surfed, screenshotted and pasted into a chat. The user
  receives it through the invitation.
* **I did not build Billing / Settings tabs.** Those screens already exist elsewhere in Super Admin
  (Subscriptions & Plans, Settings). Cloning them into a portfolio tab would be the duplicate-module bug your
  brief explicitly forbids.

---

## 9. The POS sidebar badges — suspicion CONFIRMED

I checked §6, and it was real.

### 9.1 The Service Done badge read 0. Forever.

```sql
-- was:
SELECT count(*) FROM ticket_service_lines WHERE ... AND status = 'sent_to_service_done'
```

**Wrong table AND wrong value.**

* `sent_to_service_done` is a **serving-ticket** status, not a service-line status. `ticket_service_lines.status`
  only ever holds `assigned` / `in_progress` / `paused`.
* Worse: `sent_to_service_done` is **domain vocabulary**. `serving.kysely.repository` maps it down to
  `tickets.status = 'service_done'` *before writing*. **The literal string is stored nowhere in the database, in
  any table.**

So the predicate could not match a row under any circumstances — and because every badge count is wrapped in
`.catch(() => 0)` (correct in principle, so a missing count never breaks the sidebar), it failed **silently** and
looked exactly like *"nothing is ready for checkout."* No error. No failing test. **A dashboard confidently
reporting zero is worse than one that admits it is broken.**

Now counts `tickets.status = 'service_done'` — the same thing the service-done module itself reads, so the badge
and the screen it links to can no longer disagree.

### 9.2 Repo-wide sweep: the `queue_entries` bug was the only missing table

I parsed all **554 tables from 367 migrations** and checked every raw-SQL table reference in the API against
them. **Zero other missing tables.** That is a real negative result, and worth having.

### 9.3 New guard — and an honest limit

`common/schema-guard.vitest.spec.ts` (**5/5**): every table in raw SQL must exist; every status literal must be
permitted by its CHECK constraint; the Service Done badge is pinned to the table that actually holds that state.
**Proven** to fail on the old query and pass on the fixed one.

**But be clear about what it does not cover.** The generic status check only works where a **CHECK constraint
exists**. `ticket_service_lines.status` has none — so there is no allowed-value set to compare against, and that
test **did not** catch the original bug; only the explicit pin did. The guard refuses to guess a column's
vocabulary rather than invent a rule and produce confident nonsense — which is the same failure it exists to
prevent. **The durable fix is a CHECK on `ticket_service_lines.status`.**

### 9.4 Flagged, NOT changed — your call

The tech-queue badge filters `status NOT IN ('completed','cancelled','removed')`, but `pos_tech_queue_tickets`
has **no `completed` and no `removed` status** — its CHECK allows only
`assigned / waiting_for_acceptance / accepted / declined / ready_to_start / in_service / delayed / cancelled`.
Those two clauses are **dead predicates written against a schema that does not exist.**

The live consequence: **`declined` tickets currently count toward the badge.** That may well be *right* — a
declined ticket needs reassignment, so it arguably still demands attention. I did not silently change product
semantics on a guess. **Decide, then I will pin it.**

---

## 10. Remaining work

1. Add a **CHECK constraint on `ticket_service_lines.status`** so §9.3's guard actually covers it.
2. Decide the tech-queue badge semantics (§9.4).
3. Consider **renaming** `POST /super-admin/owners/:id/salons` to what it does (add a *branch*), so the next
   person does not reach for it expecting a new salon.
