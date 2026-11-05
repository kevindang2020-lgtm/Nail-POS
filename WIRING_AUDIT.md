# SIDEBAR & MODULE WIRING — full audit

You asked whether the sidebars all work and every module is wired. **I traced it end to end.**

---

## Frontend — every nav item reaches a real screen

| app | routing | nav items | routes | |
|---|---|---|---|---|
| **pos-web** | react-router | **189** | 193 | OK |
| **admin-web** | react-router | **120** | 124 | OK |
| owner-web | tab router | 7 | 6 | OK |
| tech-web | tab router | 5 | 4 | OK |
| customer-web | react-router | 5 | 48 | OK |

**326 nav items. 0 dead links.**

A sidebar entry whose route nothing handles is a **blank page a user can click** — they conclude the feature is
broken and stop using it. `tsc` cannot see it (the route is a string) and unit tests cannot see it (the nav and the
router are tested separately, and both pass).

## Frontend → backend — every API call hits a real route

**1,561 calls. 0 orphans.**

## Backend — every module wired, every route unique

| | |
|---|---|
| Modules reachable from AppModule | **193 / 193** |
| Unreachable modules | **0** |
| Controllers | **282** |
| Routes | **2,218** |
| Route collisions (one shadowing another) | **0** |
| Injected tokens with no provider | **0** |
| POS sidebar ↔ route invariant | **holds** |

---

## The honest part: three of my own checkers were wrong before they were right

Every "OK" above is only worth something if the tool was actually looking. **Three were not**, and I caught them
only because I tried to break each one instead of trusting it.

### 1. The sidebar checker was reading the wrong files

It looked in `shell/*nav*`. Four of five apps keep their nav in a **Layout** component. So it found **0–6 nav items
across four apps** and cheerfully printed **OK**.

**A checker that is not looking, reporting green.** That is the same failure as a `.catch(() => 0)`.

### 2. Then it cried wolf twice on correct code

* It flagged `/tenant/inventory?tab=alerts` as dead. It is not — the **query string** is read by the screen, not the
  router.
* It flagged the **"More" tab** in owner-web and tech-web as dead. It is not — those routers end in
  `else screen = <MoreScreen />`, a **default branch**, which is a perfectly ordinary way to write a router.

### 3. `audit-crosswire` reported 9 frontend calls that would 404. All nine were fine.

```ts
api.patch('/super-admin/security/incidents/' + encodeURIComponent(id) + '/transition', b)
```

The extractor stopped at the **closing quote**, producing `/super-admin/security/incidents` — a path with no PATCH
route — and reported an orphan. **The real route exists.**

It now follows string concatenation, turning each interpolated segment into a path param. **9 orphans → 0.**

> **A checker that cries wolf on correct code is not a harmless annoyance. It is how the REAL findings get ignored
> along with the noise — which is the only reason the checker exists.**

---

## And each one is PROVEN, not assumed

I broke them on purpose and confirmed they scream:

* **Sidebar:** delete the `phone-management` route, leave the nav item → **exit 1, names the dead link.**
* **DI:** unwire the fraud engine → **exit 1, names the token.**
* **SQL:** reintroduce the reminders bug → **exit 1, names the column.**
* **Impossible predicate:** reintroduce the dead hardware alert → **exit 1, names the column.**

Restore each → all pass.

## In CI

```yaml
- npm run check:sql          # every SQL statement resolves against the real schema
- npm run check:di           # every @Inject token has a provider
- npm run check:impossible   # no literal that can never occur
```

`audit-sidebars.mjs` and `audit-crosswire.js` are in `apps/api/scripts/` — **worth adding to CI too**, since a dead
sidebar link and a 404-ing API call are both invisible to `tsc` and to every unit test.
