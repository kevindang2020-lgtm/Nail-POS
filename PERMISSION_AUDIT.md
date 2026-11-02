# PERMISSION AUDIT — every `@RequirePermission` resolves

> **Re-verified Oct 10 2026 (BUILD_PLAN Phase 15) against the code:** `npm run -s check:perms` (in `apps/api`) → OK —
> **414 keys in the catalog, 388 distinct keys on routes, 221 keys checked in services; all resolve** (164 catalog keys
> are used by no route — reported as clutter, not a fault). The route manifest (`apps/api/openapi/manifest.txt`) has
> **1,615 routes with a handler-level key** and 938 `/super-admin` routes with a key derived from their path domain;
> **all 1,345 staff routes (`/pos`, `/owner`, `/tenant`, `/tech`) carry a key — 0 unkeyed**, and the unkeyed baseline
> file is empty. The Oct 8 figures below are kept as history.

> **Current state (Oct 8 2026, BUILD_PLAN Phase 9 / Constitution 2):** **1,537 permission-guarded routes, 407 keys in
> the catalog (`packages/permissions/src/rbac.ts`), 374 distinct keys on routes — all resolve, all reachable.** Every
> one of the 1,316 staff routes (`/pos`, `/owner`, `/tenant`, `/tech`) now declares a key: the unkeyed baseline
> (`apps/api/openapi/api-contract.unkeyed.baseline.txt`) went 363 (Oct 4) → 324 (Oct 6) → **0**, and
> `check:api-contract` fails on any new unkeyed staff route. `check:perms` also checks the literal keys services pass
> to `hasPermission` / `need` / `require…` helpers. The keys each controller received, and the roles they reach, are
> locked by `apps/api/src/common/route-keys-phase9.vitest.spec.ts`. The figures below are the original Jul 2026 audit,
> kept as written.

*Original audit (Jul 2026):* **230 permission-guarded routes. 291 in the catalog. All resolve.**

Nobody had checked this class, and it has **two silent failure modes** — one of which is worse than anything else
found today, because it fails *only for the people with the least power to report it.*

---

## Failure mode 1 — a DOMAIN typo denies everyone

```ts
@RequirePermission('pos.custmers.edit')   // "customers" misspelled
```

`hasPermission()` resolves the key against `ROLE_PERMISSIONS`. A key that is not in the catalog matches **nothing —
for every role, including the owner.**

So it does not throw at boot. It does not fail a test. It produces a route that **denies everyone, permanently.**
The feature is built, tested, wired and reachable, and **no role on earth can open it.** The owner clicks the
sidebar item, gets *"Missing permission"*, and there is no grant that fixes it.

And it looks **exactly** like a tenant misconfiguration — so the first hour is spent checking the tenant.

## Failure mode 2 — an ACTION typo silently demands MANAGE

**This is the dangerous one.**

`requiredCapability()` **never fails.** Any action it does not recognise falls through to the manage branch:

```
pos.reports.view   →  reports.view      ← correct: a read-only screen
pos.reports.veiw   →  reports.MANAGE    ← a typo. And now the screen demands MANAGE.
```

It does not deny everyone. It does not error. It **silently upgrades the requirement from view to manage** — and
**every read-only user who is entitled to see that screen is locked out of it**, with a *"Missing permission"* they
cannot fix by any grant short of full manage.

> **It is worse than the domain typo, because the domain typo fails for everyone and gets noticed on the first
> click. This one fails only for the people with the least power to report it.**

**Both are invisible to `tsc`** (the key is a string) **and invisible to every unit test** (they mock the guard).

---

## Both are PROVEN

| break | result |
|---|---|
| `pos.custmers.edit` (domain typo) | **`UNKNOWN PERMISSIONS: 1 — these routes DENY EVERYONE`** → exit 1 |
| `pos.settings.reads` (action typo) | **`'pos.settings.reads' → resolves to settings.edit`** → exit 1 |

Restore either → exit 0.

---

## Three corrections to the checker, and the first would have been a disaster

**151 → 5 → 2 → 0.** Every reduction was **my checker being wrong.**

### 1. It reported 151 routes as "denying everyone"

It compared each key **literally** against the catalog. But `hasPermission` does not: a granular
`pos.<domain>.<action>` key is **mapped by `requiredCapability()` to a coarse capability** —
`pos.ai_analytics.view` → `ai_analytics.view` — and it is the *coarse* key that must exist.

**It would have sent somebody chasing 151 phantom bugs through the core of the product.**

### 2. Then it reported 5, because it mis-parsed the rulebook

`VIEW_ACTIONS = new Set(["view", "export", "notes_view"])` uses **double quotes**. My regex only matched single —
so `VIEW_ACTIONS` came out **empty**, every action fell to the manage branch, and five perfectly good routes were
reported as broken.

**A checker that mis-parses the rulebook produces confident nonsense about the code that follows it.** It now
**refuses to run** if it cannot read the rules, rather than reporting OK on rules it cannot see.

### 3. Then it flagged `no_show` as a read action

My pattern included `show`, which matched **`no_show`** — marking an appointment as a no-show, which is a **write**,
and `booking.manage` is exactly the right requirement for it.

*A checker that cannot tell `no_show` from `show` will produce confident nonsense, and the person reading it will
stop reading it.*

---

## Seven guards now in CI

> *Superseded Oct 10 2026:* CI now runs every gate in `tooling/ci/run-gates.mjs` (42 `check:*` gates plus 12 audits on
> Oct 10 — the seven below are among them); see `START-HERE.md` → "Gates". The Jul 2026 table is kept as written.

| | catches |
|---|---|
| `check:sql` | SQL hitting a table/column that does not exist |
| `check:di` | an `@Inject` with no provider — **built, tested, never wired** |
| `check:impossible` | SQL that runs but can **never be true** |
| `check:nav` | a sidebar item with no route |
| `check:nav:deep` | a sidebar item whose screen is a stub, or calls an endpoint that 404s |
| `check:crosswire` | any frontend call to a route that does not exist |
| **`check:perms`** | **a permission that denies everyone, or silently demands MANAGE** |

**All seven pass. All seven have been broken on purpose to confirm they scream.**

## Verification (Jul 2026 — historical; current figures in the note at the top)

| | |
|---|---|
| All seven guards | **exit 0** |
| `tsc --noEmit` (API + 5 apps) | **0 errors** |
| Permission-guarded routes | **230 · all resolve** |
| Sidebar items traced end to end | **309** |
| Frontend → backend calls | **1,561 · 0 orphans** |
| Modules reachable | **193 / 193** |
| Routes | **2,218 · 0 collisions** |
