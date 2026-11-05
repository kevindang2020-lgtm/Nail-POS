# Scaling Roadmap — Phase 2 (cont.): service-category cache with bust-on-write (2026-07-03)

_Follow-up to SCALING_PHASE2_CACHE.md. That ticket built the tenant-scoped read-through cache and wired the dashboard
aggregate (short-TTL self-heal). This ticket adds the second consumer the roadmap names — the **service catalog** —
and demonstrates the other half of the roadmap's Phase 2 guidance: **invalidate on write**, so an edit shows
immediately instead of waiting out the TTL._

## What I cached and why
The **service-category list** (`ServicesService.listCategories`) is read on every services and booking screen but
changes rarely — a textbook cache target with a high hit rate. Unlike the dashboard aggregate (a live point-in-time
summary that just uses a 30s TTL), categories have clear write paths, so they get a **longer TTL (5 min) plus explicit
bust-on-write**:
- Read: `listCategories` → `cache.getOrSet({tenantId}, 'services:categories', 300, () => repo.listCategories(ctx))`.
- Writes that bust the tenant's category cache: `createCategory`, `updateCategory`, `archiveCategory`,
  `reorderCategories` — each calls `invalidate({tenantId}, 'services:categories')` after its audit log, so the next
  read reloads fresh.

Scope note: categories are tenant-wide (not branch-specific), so the cache context is keyed on `tenantId` only — still
fully tenant-isolated by the same `scopedKey` guarantee.

## Why this is safe
- **Optional dependency, passthrough default.** `ServicesService` takes an optional `TenantCache`; with caching off
  (the default), `listCategories` calls the repo exactly as before and the bust helper is a no-op. Every existing
  `new ServicesService(repo)` in the suite keeps working unchanged.
- **Bust-on-write means no stale reads across an edit.** The moment a category is created/updated/archived/reordered,
  the cached list for that tenant is dropped; the next read recomputes. The 5-min TTL is only a backstop.
- **The services repo stays on the primary `DATABASE`** (not the read replica), because services is a read+write
  surface with read-after-write on edits — the cache sits in front without changing that.
- **Tenant isolation holds:** a write in tenant A never affects tenant B's cache; a dedicated test proves A's new
  category never appears in B's list.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New tests:** `services/services-cache.vitest.spec.ts` **4/4** — serves the list from cache on repeat; busts after
  `createCategory` so the next read reloads and includes the new category; two tenants keep independent caches (A's
  write never leaks into B); passthrough always reads through when no cache is configured.
- **Full api suite:** **2551/2551 across 405 files** (was 2547; +4 tests).
- **Build:** api production build **clean**; changed files lint **0/0**.

## Roadmap status
- Phase 1.2 (read/write split): ✅ · Phase 1.4 (pagination caps): ✅
- **Phase 2 (read-through cache):** ✅ infrastructure + **two consumers** now wired — dashboard aggregate (short-TTL
  self-heal) and service categories (longer-TTL + bust-on-write). The two patterns together cover both kinds of
  cacheable read the roadmap describes.
- Phase 1.1 (PgBouncer) / 1.3 (index profiling): infra / live-EXPLAIN, out of scope offline.

## Natural next consumers (same one-line pattern)
- **Technician roster** (`TechniciansService.list`) — longer TTL + bust on create/update/status-change.
- **Plan / feature limits** — rarely change; a good long-TTL cache with bust on plan change.
- **Overview aggregate** — like the dashboard, a short-TTL self-heal (no explicit bust needed).
Each is a `getOrSet` wrap (+ `invalidate` calls in the writers where the read isn't a pure aggregate), reusing the
exact `TenantCache` already in place.
