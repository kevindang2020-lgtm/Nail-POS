# Session Changes — Live Verify · Overview Fix · Build A · Deploy Wiring

This session ran the package against a **real PostgreSQL 16** (not the markdown's claimed-green status), fixed a real
bug that live verification surfaced, implemented the split-payment surcharge ("Build A") end-to-end, and made the
frontend API base deploy-configurable. Every result below is from an actual run on this tree.

## 1. Live verification (real Postgres) — and a real bug it caught

Stood up Postgres 16, applied all **75 migrations** (clean, idempotent), seeded, and ran the suites:

- `e2e:live` gate suites: **flow 14 · customer 13 · tech 19 · owner 12 · rbac 14 · receipts 7 · skill 5 · cardpointe 7 — all 0 failed**; RLS **112 policies** fail-closed confirmed.
- Authenticated **browser click-through** (real login → session cookie → authenticated data, real Chromium): initially **FAILED** with an uncaught JS error `Cannot read properties of undefined (reading 'averageWaitMinutes')`.

**Root cause (real frontend/backend contract mismatch):** `GET /pos/overview/state` returns the raw nested aggregate
(`PosOverviewResponse`) by default; the flat `POSOverviewState` the screen consumes (top-level `queue`/`serving`/
`checkout`) is only served at `?shape=summary` (the sibling Dashboard screen already uses that param). pos-web's
Overview screen omitted it, so it received an object with no top-level `queue` and crashed.

**Fix:** `apps/pos-web/src/api/posOverviewApi.ts` now calls `/pos/overview/state?shape=summary`; corrected the stale
comment in `overview.service.ts` that wrongly said the screen consumes the raw aggregate. **Re-verified: browser
click-through passes, 0 JS errors.**

## 2. Build A — split-payment card-portion surcharge (the documented loophole, now closed)

Previously a split tender carried **no** surcharge, so a customer could avoid the card surcharge by splitting. Now the
**card portion of a split is surcharged** (same rate as a straight card payment), captured on the gateway, recorded, and
disclosed before payment. Cash/gift dollars are never surcharged.

| Area | Change | File |
|---|---|---|
| Money math | New pure helper `splitCardSurchargeCents(cardBaseCents, enabled, percent)`; replaced the "deliberate limitation" comment with the implemented behavior | `apps/api/src/checkout/checkout-display.dto.ts` |
| Service | `paySplit` computes the card-portion surcharge, **captures `cardBase + surcharge`**, logs a disclosure audit line, returns `cardSurchargeCents` | `apps/api/src/checkout/checkout.service.ts` |
| Settlement | `recordSplitAtomic` (both Kysely + in-memory repos) records the card segment at `base + surcharge`; Kysely persists `tickets.surcharge_cents` in the same transaction for reporting | `checkout.kysely.repository.ts`, `checkout.repository.ts` |
| UI disclosure | Split screen shows "Card surcharge (X% on $Y card portion)", a "Total to charge", and a disclosure line; pay button reflects the grand total | `apps/pos-web/src/screens/POSCheckoutScreen.tsx` |
| Tests | New `checkout-split-surcharge.vitest.spec.ts` (6 tests: helper math/rounding/disabled + paySplit captures base+surcharge, disabled=base-only, fully-cash=0). Existing split compensation spec still green (capture/void counts unchanged). | new spec |

Verified: backend harness **52 suites / 323 tests PASS**; pos-web build + **54 tests PASS**; `e2e:live` gate suites +
RLS still **PASS** against the live DB.

**Note (pre-existing, out of scope):** the `cardSurchargeCollectedCents` KPI is hardcoded to 0 in both repos
(`checkout.kysely.repository.ts` ~L109, `checkout.repository.ts` ~L155) — it under-reported surcharge before this change
too. Build A persists `tickets.surcharge_cents`, but that KPI's own summation should be fixed separately.

## 3. Deploy URL wiring — frontends are now build-time configurable

All frontends resolved their API base from `window.APS_API_BASE || ""` (same-origin only). Added a **build-time
`VITE_API_BASE`** fallback so a separate-origin deploy is a one-liner, keeping the runtime `window` override and the
same-origin default:

```
VITE_API_BASE=https://your-api-host npm run build   # bakes the API origin into the bundle
# unset → "" (same-origin, served behind the API) — unchanged default
```

Applied to all six SPA clients (`pos-web`, `admin-web`, `customer-web`, `tech-web`, `owner-web`, `customer-display`).
Verified the URL bakes into the bundle when set and is absent (same-origin) when unset.

**Still your input:** the actual hosted API URL. Set `VITE_API_BASE` at build time per app. The marketing-site POS
deep-links are **not in this package** (only a DB migration references marketing); that wiring lives with the separate
marketing deliverable.

## Net state

Builds (all 7) ✅ · API typecheck ✅ · backend 323 tests ✅ · pos-web 54 tests ✅ · live e2e + RLS + card ✅ ·
**browser click-through now passes (was failing)** ✅. One real bug fixed, one loophole closed, deploy made one-liner.

## 4. Surcharge + tax "collected today" KPIs — were hardcoded to 0, now report real money

Follow-on to Build A. The checkout dashboard's **Surcharge Collected** and tax-collected KPIs were effectively
hardcoded to 0 in both repos (`cardSurchargeCollectedCents: 0` in Kysely; a no-op `reduce((a)=>a,0)` in-memory), so even
straight card surcharges never showed up — and Build A's split surcharge wouldn't have either.

**Fix (method-agnostic, both repos):** for each ticket paid today, `surcharge = max(0, chargedToday − (subtotal + tip +
tax))`. A straight card payment's recorded amount already includes its surcharge; cash/gift include none; and Build A
makes a split's card segment include the card-portion surcharge — so this one rule is correct for every method without
per-method branching. Tax collected is summed per paid ticket (`round(subtotal × taxRate)`), method-independent.

Files: `apps/api/src/checkout/checkout.kysely.repository.ts`, `apps/api/src/checkout/checkout.repository.ts`.

Tests (added to `checkout-split-surcharge.vitest.spec.ts`): KPI reflects a straight card payment's surcharge + tax;
KPI includes the card-portion surcharge from a split; fully-cash payment reports 0 surcharge but still counts tax.
Verified: backend harness **52 suites / 326 tests PASS**; `e2e:live` gate suites + RLS still **PASS** against the live DB.

With this, the surcharge money-path is correct end-to-end: a straight card payment, a split's card portion, and the
dashboard KPI all agree.
