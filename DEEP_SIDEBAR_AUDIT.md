# DEEP SIDEBAR AUDIT — nav label → route → component → API → backend

You asked whether every sidebar name actually works and is wired into a real module. **`check:nav` was not enough to
answer that**, so I built one that traces the whole chain.

---

## Why `check:nav` was not enough

It proves a nav item's route is **handled**. It does not prove the thing behind it is **real**.

A route can be handled by:

* a **placeholder** — `element={<div>Coming soon</div>}`
* a **stub screen** — a component that renders nothing
* a screen that **calls an API that does not exist**

**All three pass `check:nav`.** And all three are a sidebar item that does nothing when a salon owner clicks it —
at which point **they conclude the product is broken, not that one screen is.**

## The result

```
pos-web     OK — every sidebar item renders a real screen backed by real routes
admin-web   OK — every sidebar item renders a real screen backed by real routes
```

**Every backend sidebar item is wired end to end.** 189 pos-web items, 120 admin-web items — each one traced from
its **label**, to its **route**, to the **component file that defines it**, to **every API endpoint that file
calls**, checked against the **2,218 real backend routes**.

---

## The honest part: the checker was wrong four times before it was right

**83 → 20 → 11 → 0.** Every one of those reductions was **my checker being wrong**, not your code getting fixed.

### 1. It called 83 working screens "placeholders"

It matched the word `placeholder` anywhere in the file — and a real screen is **full** of
`placeholder="Search customers…"` on its input fields.

It declared **Checkout, Serving, Customer Directory, Tech Queue** — the core of the product — to be stubs. *That is
a checker crying wolf on the thing the salon uses all day, which is how a checker gets switched off.*

### 2. Then it flagged two 1,000-line screens

`POSBookingScreen` (1,149 lines) has `title="Week view is coming soon"` on a **disabled sub-feature button.** That
is a working screen being **honest about one view it does not have yet** — not a placeholder.

The fix is a size gate: a placeholder is a **small file that says so**, not a large one with a disabled button.

### 3. Then it reported 7 redirects as "COMPONENT NOT FOUND"

`<Route path="x" element={<Navigate to="/y" />} />` is how a sidebar item points at a screen that lives elsewhere.
Perfectly legitimate. It now follows them.

### 4. Then it reported ELEVEN working sidebar items as dead

`Salon Profile`, `Business Hours`, `Booking Rules`, `Tax & Tip Rules`, `Queue Rules`, `Checkout Rules`,
`Cancellation Policy`, `No-Show Policy`, …

They redirect to `/settings?section=business-branch`. **My resolver did not strip the query string**, so it looked
for a route literally called `settings?section=business-branch`, found none, and called them all dead.

> **A checker that cries wolf on correct code is not a harmless annoyance. It is how the REAL findings get ignored
> along with the noise — which is the only reason the checker exists.**

---

## And it is PROVEN, on both failure modes

**A screen calling a dead endpoint:**

```
POSCustomerPhoneSettingsScreen — API 404: GET /pos/settings/customer-phone-TYPO
exit 1
```

**A sidebar item pointing at a "Coming soon" stub:**

```
pos-web  1 PROBLEM(S)
exit 1
```

Restore either → passes. It names the **sidebar label**, the **route**, the **component**, and the **dead
endpoint** — enough to fix it without hunting.

---

## Six guards now in CI

| | catches |
|---|---|
| `check:sql` | SQL hitting a table/column that does not exist |
| `check:di` | an `@Inject` with no provider — **built, tested, never wired** |
| `check:impossible` | SQL that runs but can **never be true** |
| `check:nav` | a sidebar item with no route |
| **`check:nav:deep`** | **a sidebar item whose screen is a stub, or calls an endpoint that 404s** |
| `check:crosswire` | any frontend call to a route that does not exist |

**All six pass. All six have been broken on purpose to confirm they scream.**

## Verification

| | |
|---|---|
| All six guards | **exit 0** |
| `tsc --noEmit` | **0 errors** |
| pos-web build | **exit 0** |
| Sidebar invariant | **7/7** |
| Sidebar items traced end to end | **309** (189 pos + 120 admin) |
| Backend routes | **2,218 · 0 collisions** |
| Modules reachable | **193 / 193** |
