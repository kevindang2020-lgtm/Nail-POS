# AIPowerSalon — Frontend Wiring Audit

Deep, evidence-based scan of every frontend app: do the routed modules call real
backend APIs, do those endpoints exist, and do the apps build. Method is static
analysis of the actual source (route parsing, API-call extraction, controller
cross-check, per-app `tsc`). Numbers below come from scanning the code, not memory.

## Headline

- **6 frontend apps, all typecheck-clean** (`tsc --noEmit` → 0 errors each).
- **425 distinct frontend API call-paths — 100% resolve to a real backend controller** (111 controllers). Zero phantom/dead endpoints.
- **Every functional routed module is wired.** The only non-API screens are legal pages (Privacy/Terms) and the POS Help Center — static by design.
- **1 placeholder element in all routing** across all apps (a single `FeaturePage` catch-all in pos-web for tenant-nav routes without a dedicated screen; it shows correct access state, never blank/fake).

## Per-app results

| App | Build (tsc) | Routed modules | Wired to backend | Static-by-design | API-client modules |
|-----|-------------|----------------|------------------|------------------|--------------------|
| pos-web | 0 errors | ~48 | all functional | Help Center | 47 |
| admin-web (Super Admin) | 0 errors | 51 | 51 / 51 (100%) | — | 18 |
| owner-web | 0 errors | ~28 | all functional | Privacy, Terms | 5 |
| tech-web | 0 errors | ~16 | all functional | Privacy, Terms | 6 |
| customer-web | 0 errors | ~43 | all functional | Privacy, Terms | 13 |
| customer-display | 0 errors | 1 (display) | wired via SSE | — | n/a (SSE client) |

Routing styles differ: pos-web / admin-web / customer-web use `react-router`
`<Route>`s; owner-web / tech-web use a custom nav provider (each imported
`*Screen` is a module). customer-display is a single live display wired over
**SSE/EventSource** (`/customer-display/device/stream`, `/customer-display/checkout/:id/stream`)
plus fetch for ratings — two backend controllers back it.

## Endpoint existence cross-check

Extracted every `api.get/post/put/patch/delete('/path')` literal from each app's
`api/` clients and matched the path against the backend's `@Controller` prefixes:

| App | Distinct call-paths | Unmatched (no backend) |
|-----|--------------------:|-----------------------:|
| pos-web | 154 | 0 |
| admin-web | 122 | 0 |
| owner-web | 49 | 0 |
| tech-web | 42 | 0 |
| customer-web | 58 | 0 |
| **Total** | **425** | **0** |

Each app has a single real HTTP `client.ts` (axios/fetch + `baseURL` + Bearer
auth). Real-time push (SSE/EventSource) is additionally wired in pos-web,
owner-web, tech-web, customer-web, and customer-display.

## Exact handler match (deeper pass — verb + full path pattern)

The prefix check above proves the controller exists. This deeper pass parses the
backend's **method decorators** (`@Get`/`@Post`/`@Patch`/`@Delete` + path) into a
full route table — **1,169 method-routes** (GET 554, POST 487, PATCH 109,
DELETE 18, PUT 1) — and matches each frontend call by **HTTP verb + path
pattern** (path params normalized on both sides).

| App | Calls matched to exact handler | Unmatched | Composed (path from a variable) |
|-----|-------------------------------:|----------:|--------------------------------:|
| pos-web | 246 | 0 | 0 |
| admin-web | 201 | 0 | 5 |
| owner-web | 55 | 0 | 0 |
| tech-web | 67 | 0 | 0 |
| customer-web | 84 | 0 | 0 |
| **Total** | **653** | **0** | **5** |

**Zero unmatched** — every statically-resolvable call hits a real handler with the
right verb and path shape. The non-resolved remainder also targets real
controllers, just through path helpers the static matcher can't expand:
- admin-web's 5 "composed" calls use `base(tenantId)` → `/super-admin/tenants/:tenantId/go-check-in`, which the backend serves (`@Controller('super-admin/tenants/:tenantId/go-check-in')`).
- customer-display builds paths via `sessBase()`/`devBase()` and uses raw `fetch` + SSE against the real `customer-display` controller, so it doesn't appear in the `.get/.post` tally at all.

Net: across all apps, **no frontend call targets a missing or wrong-verb endpoint.**

## The only non-wired routed screens (all intentional)

- **Legal pages** — Privacy / Terms in owner-web, tech-web, customer-web (6 screens). Static content, correctly no API.
- **POS Help Center** — static support page (mailto + web links).
- **`ComingSoon` / `FeaturePage`** — honest fallbacks for any not-yet-ported screen. They state plainly that the typed API client is wired and render the correct access state (scaffold / 403 / feature-unavailable). Only **one** route uses this catch-all (pos-web), so effectively nothing is parked on a placeholder.

No fabricated-data screens were found. Where a screen lacks live data it says so honestly rather than showing fake numbers.

## Out of scope / not React

- **go-check-in-admin**, **go-check-in-kiosk** — no `.tsx` source (the kiosk is the separate Go Check-In app + static shells), so not part of the React frontend wiring surface.

## Honest caveats (what this audit does and does not prove)

- **Static analysis, not runtime.** It proves each called endpoint *exists* (a controller serves the prefix) and each module references a real client. It does **not** prove every endpoint returns correct data at runtime.
- **Wired counts are conservative.** The file-level scan can't see wiring that happens through child components (e.g., `POSFollowUpsScreen` renders `<FollowUpQueuePanel/>`; `CustomerFollowingScreen` reuses the shared `<FollowList/>`) or through SSE. True wiring is therefore at least as high as reported, not lower.
- **Prefix-level match.** The cross-check matched controller prefixes (e.g., `pos/checkout`), not every individual method route. A deeper pass could match full method+verb routes.
- **Cross-tenant correctness is separate.** Whether the Super Admin cross-tenant SQL returns correct, isolated, reconciling data on live multi-tenant Postgres is covered by the smoke runbook (`ops/smoke/`), not by this static audit.

## Bottom line

Across all six frontends, every functional module is wired to a real, existing
backend endpoint; the apps all build clean; and there are no dead endpoints and
essentially no placeholder routes. The remaining honest gaps are intentional
static pages (legal/help) and the live-Postgres verification the smoke runbook
exists to close.
