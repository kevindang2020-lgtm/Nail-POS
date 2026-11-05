# Scaling Roadmap — Phase 2.3 implemented: HTTP caching headers on public GETs (2026-07-03)

_A distinct layer from the Redis read-through cache: `Cache-Control` on the truly-public, static-ish GETs so browsers
and a future CDN serve them directly and the API never sees the repeat request at all. The roadmap: "HTTP caching
headers on cacheable GETs (catalogs, static config) so browsers and the CDN cooperate."_

## What I added and why these routes
Applied `Cache-Control` (via NestJS `@Header`) to the public, no-session, high-volume GETs — the ones already excluded
from tenant middleware, i.e. they carry no per-user/tenant data:

| Route | Cache-Control | Rationale |
|---|---|---|
| `GET /platform/branding` | `public, max-age=300, stale-while-revalidate=600` | Every app + login screens fetch this before auth; changes rarely. Highest-volume offload. |
| `GET /customer/salons/:salonId` | `public, max-age=300, swr=600` | Public salon detail; changes rarely. |
| `GET /customer/salons/:salonId/services` | `public, max-age=300, swr=600` | Public service catalog; changes rarely. |
| `GET /customer/salons/nearby` | `public, max-age=60, swr=120` | Public search; more dynamic, so shorter TTL. |
| `GET /customer/techs/nearby` | `public, max-age=60, swr=120` | Public discovery; more dynamic. |
| `GET /customer/techs/:publicSlug` | `public, max-age=60, swr=120` | Public tech profile. |
| `GET /customer/salons/:salonId/technicians` | `public, max-age=60, swr=120` | Public roster. |
| `GET /customer/salons/:salonId/services/:serviceId/technicians` | `public, max-age=60, swr=120` | Public roster. |

`stale-while-revalidate` lets a CDN/browser serve the cached copy instantly while revalidating in the background, so
users never wait on a refresh.

## The safety property is negative as much as positive
The real risk with HTTP caching on an API is caching **per-user or per-tenant** data in a shared/browser cache. I
guarded against that by only decorating routes that are (a) already public (no session, excluded from tenant
middleware) and (b) return listing/config data, never a specific user's records. Authenticated tenant routes were left
completely untouched — they emit no `Cache-Control`, so nothing downstream will cache them. A test asserts this
explicitly: the authed `bookingTechs` route has **no** public Cache-Control, while the public discovery routes do.

## Why this is safe
- **Additive and surgical.** Only eight specific public handlers changed; `@Header` applies per-route, so there's zero
  chance of blanket-caching authenticated endpoints.
- **No behavior change to responses' bodies** — only a response header is added.
- **These routes are already IP-rate-limited** at the app (the salon/tech discovery controllers), so the header layers
  on top of existing protection.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New tests:** `common/http-cache-headers.vitest.spec.ts` **4/4** — branding is publicly cacheable; public salon
  reads are cacheable; public tech reads are cacheable; and the **authed** route is NOT publicly cacheable (the
  negative safety assertion).
- **Full api suite:** **2568/2568 across 408 files** (was 2564; +4 tests).
- **Build:** api production build **clean**; changed files lint **0/0**.

## How this pays off in production
Point a CDN at the API (or at least let browsers honor these headers). The branding call — made by every app instance
on every load, pre-auth — stops hitting the API for 5-minute windows; public salon/tech discovery (the customer-facing
marketing surface, the highest raw request volume) is served from the edge. This is the "offload the largest volume of
requests entirely" step from the roadmap's Phase 2.

## Roadmap status
- Phase 1.2 (read/write split) ✅ · 1.4 (pagination caps) ✅ · 2 (Redis read-through cache: dashboard + categories +
  overview) ✅ · **2.3 (HTTP caching headers) ✅ (this ticket)** · 3 (per-tenant rate limiting) ✅
- Remaining are infrastructure (PgBouncer, replica, Redis, **CDN** — now that cache headers exist, standing up a CDN
  is pure ops) and Phase 1.3 live index profiling; Phases 4–5 remain correctly deferred.
