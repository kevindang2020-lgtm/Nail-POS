# Scaling Phase 2 — Cache & CDN Tier: audit + build (2026-07-03)

Inspected the repository against the full Phase 2 spec. **The large majority of Phase 2 was already implemented across
prior sessions** (the read-through cache, tenant-scoped keys, DB read-routing, S3 media with public/private split, and
HTTP cache headers). This ticket adds the two genuine code gaps that most improve "instant response" — **cache
stampede protection** and **CDN cache-header policy for built frontends** — and documents the deliverables the spec
requires, including honest reasons for what is deliberately NOT cached.

## 1. Existing architecture discovered (inspection)
- **Backend:** NestJS 10 + Kysely + Postgres 16, DI via module factories. **Frontends:** 8 Vite (React 18) apps + 1
  static. **Redis client:** ioredis, lazy-required, shared by realtime bus / login throttle / cache / rate limiter.
- **Cache layer (already built):** `common/tenant-cache.ts` — `TenantCache` iface, `RedisTenantCache` (fail-open),
  `NoopTenantCache` passthrough default; `getOrSet` keys are tenant-scoped by construction (`scopedKey` embeds
  `tenant_id` + optional `branch`); `invalidate` / `invalidateTenant` (SCAN, never `KEYS`); opt-in via
  `CACHE_STORE=redis`. Token `TENANT_CACHE` in `common/cache.module.ts`.
- **Tenant/branch identity:** server-derived from session `req.ctx` — never client-supplied (spec Part 2 satisfied).
- **DB read routing (already built):** `DATABASE_READ` seam, 7 read-only modules routed; `replica ?? primary` fallback.
- **Media (already built):** `MediaStorage` port with `LocalDiskMediaStorage` + `S3MediaStorage` + `makeMediaStorage`
  selector; public media (tech-profile, nail-showcase) is S3/CDN-capable, private support-attachments stay on a
  separate private root.

## 2. What THIS ticket built
### Stampede protection (spec Part 6) — the biggest "instant response under load" win
Added in-process **single-flight coalescing** to both `RedisTenantCache` and `NoopTenantCache`. When a hot key
(dashboard, catalog, entitlements) expires and N concurrent requests miss simultaneously, only ONE runs the loader; the
rest await the same promise and share its result. Properties:
- Bounded: the in-flight map entry is deleted the moment the promise settles.
- No poisoning: a rejected loader rejects all current waiters and caches nothing; the next call re-attempts.
- Double-checks the cache inside the single-flight window (an earlier coalesced caller may have just populated it).
- Needs no Redis round-trip or distributed lock — per-process coalescing + the short TTL keeps origin load low without
  a distributed lock's failure modes (which the spec lists as optional).

### CDN cache-header policy for frontends (spec Part 9)
`scripts/build-frontends.sh` now emits a `_headers` file per built app (read by Netlify / Cloudflare Pages / Render):
content-hashed `/assets/*`, `*.js`, `*.css` → `public, max-age=31536000, immutable`; `index.html` → `no-cache` so new
releases are discovered immediately. (Vite already fingerprints assets, e.g. `index-BIBRwzTG.css`.)

## 3. Cached endpoints + TTLs (current state)
| Namespace | Key | TTL | Invalidation |
|---|---|---|---|
| Dashboard aggregate | `t=<tenant>:dashboard:*` | 30s | short TTL self-heal |
| Overview aggregate | `t=<tenant>:overview:*` | 30s | short TTL self-heal |
| Service categories | `t=<tenant>:services:categories` | 300s | **bust-on-write** (4 category mutations) |
| Plan entitlements config | `t=<tenant>:plans:config:<plan>` | 60s | short TTL self-heal |

## 4. Non-cached endpoints (with honest reasons) — the important discipline
| Endpoint | Why NOT cached |
|---|---|
| **Technician list/state** | The query fuses static directory data with **live** working status, shift status, and today's sales. Caching it (even 30s) could show a tech "available" who just went on break — an operational routing error on the POS floor. The spec's own Part 3.3 warns about exactly this. Left uncached; only the truly-static slice would be cacheable, and that isn't separated in the current query. |
| **Service list/state** | Fuses the static catalog (names/prices/durations) with **live** `bookingsCount` / `revenueCents` per service. Caching would show stale metrics. Only the static slice (categories) is separated and IS cached. |
| Checkout / payment / refund / queue transitions / booking confirmations | Strict-consistency financial/booking flows (spec "do not cache" list). |

This reflects the spec's separation principle (Part 3): cache the stable metadata slice (categories, plan config,
aggregates that tolerate 30s), never the full response when it fuses live transactional state.

## 5. Invalidation matrix (real modules)
| Write operation | Tenant | Branch | Namespaces invalidated |
|---|---|---|---|
| Create/update/archive/reorder service **category** | Required | — | `services:categories` (explicit bust) |
| Plan limits change (super-admin) | Required | — | `plans:config:*` (60s TTL self-heal) |
| Dashboard-changing writes (checkin/checkout/appt/etc.) | Required | Required | dashboard/overview (30s TTL self-heal) |

## 6. HTTP caching policy (real resources)
| Resource | Visibility | Browser | CDN | Notes |
|---|---|---|---|---|
| Hashed JS/CSS (`/assets/*`) | Public | 1yr immutable | 1yr immutable | Vite content-hash; `_headers` |
| `index.html` | Public | no-cache | revalidate | discovers new releases; `_headers` |
| Public salon/branding/tech-profile GETs | Public | `Cache-Control` set | shareable | 3 controllers already emit headers |
| Tenant dashboard JSON | Private | not shared | Redis server-side only | never publicly cached |
| Private support attachments | Private | — | local/private root | not S3/CDN public |

## 7. Read primary vs replica (cache-miss loaders)
| Read | Miss loads from | Consistency |
|---|---|---|
| Dashboard / overview aggregates | `DATABASE_READ` (replica when set) | 30s staleness OK |
| Service categories | primary (services module) | bust-on-write keeps fresh |
| Plan entitlements config | primary | 60s TTL; live usage never cached |

## 8. Environment variables (cache/CDN)
Already documented in `.env.production.template`: `CACHE_STORE`, `CACHE_REDIS_URL`, `CACHE_PREFIX`, `REDIS_URL`;
`MEDIA_STORE`, `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ENDPOINT`, `MEDIA_CDN_BASE_URL`, `MEDIA_S3_PREFIX`. No new
variables required this ticket.

## 9. Verification (fresh runs)
- **Typecheck:** api `tsc` 0.  **Lint:** changed files 0.
- **New tests:** 4 stampede tests in `tenant-cache.vitest.spec.ts` — burst coalesces to ONE loader; no coalescing
  across keys/tenants; failed loader rejects all waiters + no poisoning + retryable; passthrough also coalesces.
  Cache suite **11/11**.
- **Full api suite:** **2598/2598 across 413 files** (was 2594).
- **Build:** api build clean; `build-frontends.sh` syntax-checked and `_headers` output verified.

## 10. Files changed
- `apps/api/src/common/tenant-cache.ts` — single-flight stampede protection on both cache implementations.
- `apps/api/src/common/tenant-cache.vitest.spec.ts` — 4 stampede tests.
- `scripts/build-frontends.sh` — per-app `_headers` (immutable hashed assets, no-cache index.html).

## 11. Known limitations / what remains (all infrastructure, not code)
- **Cross-process stampede:** single-flight is per-process; across many instances the short TTL bounds origin load. A
  distributed Redis lock is available as a future option but adds failure modes the spec marks optional — not built.
- **Provisioning:** standing up Redis, the CDN, the object-storage bucket, and wiring `_headers`/signed-URL delivery
  at the chosen provider are console/ops actions (per `SCALING_TURNON_RUNBOOK.md`), not code. Load-test numbers and
  live cache-hit ratios require a running deployment.
- **Observability wiring (spec Part 13/14):** cache metrics into System Status is a follow-up; the hooks (enabled flag,
  fail-open logging points) exist.

## 12. Rollback
- Disable all server-side caching: unset `CACHE_STORE` (or set ≠ `redis`) → transparent passthrough, no code deploy.
- Flush only the app cache namespace: delete keys matching `aps:cache:*` (never `FLUSHALL` — Redis also holds sessions,
  throttle, locks, realtime, rate limits).
- One tenant: delete `aps:cache:t=<tenantId>*`. One resource: delete the specific `:<namespace>` key.
- Frontend/media rollback: revert to serving `dist/` behind the API (same-origin) — no bucket goes public.
