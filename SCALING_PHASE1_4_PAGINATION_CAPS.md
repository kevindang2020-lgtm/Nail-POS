# Scaling Roadmap — Phase 1.4 implemented: server-side pagination caps (2026-07-03)

_Continuing the roadmap in order. Phase 1.4 says: "Ensure no endpoint can return an unbounded set for a large salon.
Enforce a max page size server-side." This ticket does exactly that, app-side and testable offline._

## The real problem (found by auditing, not assumed)
The codebase clamped page size with the pattern `pageSize = Math.max(1, Number(f.pageSize) || N)` in **29 read
repositories**. That enforces a *floor* of 1 but **no ceiling** — a client sending `pageSize=1000000` would pull a
million rows and hammer the primary, which is precisely the unbounded-read failure mode the roadmap warns about. A
handful of endpoints (communications, super-admin-queue, merchant-accounts) already capped correctly, but the caps
were ad-hoc (100 / 200 / 1000) and `clampInt` had been **copy-pasted into 8+ files**.

## What I built
1. **One shared pagination utility** — `apps/api/src/common/pagination.ts`:
   - `MAX_PAGE_SIZE = 100` — the absolute ceiling; a caller may request less, never more.
   - `clampPageSize(value, def, max?)` — clamps into `[1, min(max, MAX_PAGE_SIZE)]`; falls back to `def` for
     missing/invalid input.
   - `clampPage(value)` — floors the page number at 1 (and caps it sanely).
   - `clampLimit(value, def, max?)` — for bare "top N" list limits.
2. **Replaced the unbounded pattern in all 29 repos** with `clampPageSize(f.pageSize, <original default>)`, preserving
   each endpoint's existing default page size (20 or 50) while adding the missing ceiling. Also converted the paired
   `page = Math.max(1, …)` to `clampPage(f.page)`.
   - Covered surfaces: booking, queue, tech-queue, serving, service-done, check-in, checkout, customers, services,
     technicians, payroll, audit, campaigns, communications, owner.
   - Repos that were already ceiling-capped (e.g. communications' `Math.min(200, …)`) were left as-is where the regex
     didn't match; only the `page` floor was upgraded where present.

Nothing about tenant isolation, permissions, or the query shapes changed — this only bounds how many rows a single
request can pull.

## Why this is safe
- **Behaviour is identical for every legitimate request.** Real clients ask for 10–50 rows; those pass through
  unchanged. Only abusive/oversized `pageSize` values are now clamped down to 100 instead of being honored.
- **Defaults preserved.** Each repo keeps the exact default it had (no page-size regressions in the UI, which requests
  explicit sizes anyway).
- **One implementation.** Future endpoints call the shared helper instead of re-deriving a clamp.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New unit test:** `common/pagination.vitest.spec.ts` **6/6** — asserts the ceiling caps a million-row request at
  100, honors in-range sizes, falls back on garbage, floors at 1, respects a per-endpoint cap without exceeding the
  global ceiling, and clamps bare limits.
- **Affected module suites:** customers / booking / queue / checkout / serving / check-in / tech-queue / service-done /
  communications / audit / campaigns / payroll / services / technicians / common → **445/445**.
- **Full api suite:** **2537/2537 across 402 files** (was 2531; +6 pagination tests).
- **Build:** api production build **clean**; new files lint **0/0**.
- **Audit:** zero remaining `Math.max(1, Number(f.pageSize)…)` unbounded patterns in the tree.

## Roadmap status
- **Phase 1.1 (PgBouncer):** infra, no code — ready when ops is.
- **Phase 1.2 (read/write split seam):** ✅ done (prior ticket — `DATABASE_READ`).
- **Phase 1.3 (hot-path index audit):** needs live `EXPLAIN (ANALYZE, BUFFERS)` on a large synthetic tenant — can't
  be done offline.
- **Phase 1.4 (pagination/query caps):** ✅ done here.

## Next safe offline ticket
**Phase 2 — Redis read-through cache** for the heaviest staleness-tolerant reads (dashboard/overview aggregates,
service catalogs, technician lists, plan/feature limits). You already run Redis. The non-negotiable invariant the
roadmap calls out: **`tenant_id` (and branch where relevant) MUST be in every cache key** — a cross-tenant cache hit
is a data-isolation breach, so it gets treated with the same seriousness as server-derived tenant identity. Short TTLs
(30–120s) on aggregates + bust-on-write. That's the recommended next unit of work.
