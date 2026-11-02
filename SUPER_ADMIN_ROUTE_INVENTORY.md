# Super Admin Route Inventory

## Frontend (apps/admin-web)

- **126** `<Route>` entries in `App.tsx`, **7** of them redirects (e.g. `/billing`→`/subscriptions`,
  `/products`→`/product-catalog`, `/memberships`→`/membership-programs`, `/appointments`→`/appointment-oversight`,
  `/customers`→`/customer-data-oversight`, index→`/dashboard`, `*`→`/dashboard`).
- **71** top-level sidebar paths, **all** resolving to a declared route (**0 dead links**).
- Sidebar → route mapping for the official 40 items: see `SUPER_ADMIN_SIDEBAR_AUDIT.md`.

## Backend (apps/api, controllers matching `@Controller('super-admin…')`)

- **92** Super Admin controllers.
- **Guard coverage: 92/92 behind `SuperAdminGuard`** (100%).
- Route decorators: **369 GET · 351 POST · 50 PATCH/PUT · 8 DELETE** ( ≈ 778 routes).

## Frontend ↔ controller contract (verified against real registered routes)

Every API call the admin-web frontend makes was reconciled against the running app's actual route table (enumerated
from the Express router — 2,135 registered routes), not static regex:

- **486 distinct `/super-admin/*` frontend API calls → 486 wired to a registered controller route. 0 orphans.**
- No screen calls a missing or wrong controller (the prompt's Phase 4 invariant), confirmed authoritatively.
- (A first static-regex pass flagged 168 false "orphans" — controller prefixes it couldn't reconstruct, e.g.
  `@Controller('super-admin')` + `@Get('audit-logs/overview')`; the live router check cleared all of them.)

## Live verification (this session)

- **313** param-free Super Admin GET routes were enumerated from the running Express router and hit live against a
  real Postgres (PGlite-over-socket) as an authenticated SUPER_ADMIN. **303 returned 200 with real data; the other 10
  were correct 400s** for genuinely-missing required query params. **0 server errors.**
- The gap between 369 GET decorators and 313 probed is the param routes (`:id`, `:tenantId`, …), which the param-free
  probe intentionally skipped.

## Notes

- This is a summary inventory (counts + mapping + live-verification result), not a line-by-line dump of all 778 backend
  routes. The end-to-end module wiring per sidebar item is in `SUPER_ADMIN_SIDEBAR_AUDIT.md` and, for the Live
  Operations page specifically, in `LIVE_OPERATIONS_BOX_WIRING_MATRIX.md`.
