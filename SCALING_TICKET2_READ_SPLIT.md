# Scaling Roadmap — Ticket 2 implemented: read/write split seam (2026-07-03)

_Read the roadmap in full; verified its central claims against the codebase; then implemented the safest, highest-
leverage code ticket it recommends — the `DATABASE_READ` seam. It is additive, reversible, and ships with no replica
configured (falls back to the primary), so it's a no-risk merge exactly as the roadmap describes._

## What I verified first (the plan hinges on these)
- **The `DATABASE` seam is real and clean.** `DATABASE` is a Symbol token (`kysely.provider.ts`) provided by the
  global `DatabaseModule` and consumed by feature modules through a uniform factory:
  `useFactory: (db) => db ? new KyselyXRepo(db) : new InMemoryXRepo(), inject: [DATABASE]`.
- **Correction to the roadmap's file count:** it says the `DATABASE` token is injected in ~138 files. The real shape
  is **127 module factories** that `inject: [DATABASE]` plus **9** direct `@Inject(DATABASE)` constructors. Same
  conclusion (one clean seam), just the precise number — worth knowing when we route more modules later.
- **`PG_POOL_MAX` defaults to 10**, and the pool is built in `createDatabase()` — matches the roadmap.
- No read/replica seam existed yet (`DATABASE_REPLICA_URL` / `DATABASE_READ` were absent).

## What I built
1. **`DATABASE_READ` token + `createReadDatabase(primary)` factory** (`kysely.provider.ts`):
   - `REPO_DRIVER !== 'postgres'` → `null` (in-memory mode, unchanged).
   - `DATABASE_REPLICA_URL` **unset** → returns the **exact same primary handle** (identity), so no second pool is
     opened and single-node/dev/tests are unaffected.
   - `DATABASE_REPLICA_URL` **set** → builds a distinct replica pool (`PG_READ_POOL_MAX` ?? `PG_POOL_MAX`).
2. **Registered `DATABASE_READ` in the global `DatabaseModule`**, injecting the primary for the fallback path, and
   exported it.
3. **Routed 5 read-only, latency-tolerant surfaces to `DATABASE_READ`** — each verified to contain **zero**
   `insertInto/updateTable/deleteFrom` before routing, so there's no read-after-write risk:
   - `overview` (POS overview + live board)
   - `dashboard` (POS dashboard)
   - `reports` (POS reports)
   - `super-admin-overview` (oversight aggregates)
   - `super-admin-dashboard` (oversight dashboard)
4. **Documented the env vars** in `.env.example` (`DATABASE_REPLICA_URL`, `PG_READ_POOL_MAX`), with the explicit note
   that leaving the replica unset runs single-node.

All writes and read-after-write flows (checkout, booking create/reschedule, check-in, queue mutations, etc.) remain
on the primary `DATABASE` — untouched.

## Why this is safe
- With no `DATABASE_REPLICA_URL`, behaviour is **byte-for-byte identical** to before: `DATABASE_READ` *is* the
  primary handle. The 5 routed modules read from the same place they always did.
- Only pure-read repos were routed; each was grepped for write ops first.
- Tenant isolation is unchanged — routing changes *which physical node* serves a read, never *what* it can see;
  tenant identity is still server-derived and every query stays tenant-scoped.

## Verification (fresh runs, this tree)
- **Typecheck:** api `tsc` **0 errors**.
- **New unit test:** `kysely.provider.vitest.spec.ts` **3/3** — asserts null-driver, primary-handle **identity**
  fallback, and a distinct replica handle when the URL is set.
- **Affected module suites:** dashboard / reports / overview / super-admin-overview / super-admin-dashboard / database
  → **38/38**.
- **Full api suite:** **2531/2531 across 401 files** (the global `DatabaseModule` change touches everything, so this
  is the real safety check).
- **Build:** api production build **clean** (`tsc -p tsconfig.build.json`).

## How to actually turn on a replica (ops, no code change)
1. Stand up a Postgres read replica of the primary.
2. Set `DATABASE_REPLICA_URL=postgres://…/aps?sslmode=require` (and optionally `PG_READ_POOL_MAX`) on the API.
3. Deploy. The 5 surfaces above immediately read from the replica; everything else stays on the primary. Roll back by
   unsetting the variable — no code change, no redeploy of logic.

## Roadmap status after this ticket
- **Ticket 1 (PgBouncer):** pure infra, no code — point `DATABASE_URL` at PgBouncer. Ready whenever ops is.
- **Ticket 2 (read/write split seam):** ✅ done here (additive, reversible).
- **Ticket 3 (profile 4 hot read paths + index tune):** needs a large synthetic tenant + live `EXPLAIN (ANALYZE,
  BUFFERS)`; can't be done offline. The four paths to profile: booking day-grid, queue state, dashboard/overview
  aggregates, super-admin oversight.

## Next code tickets that are safe to do now (in roadmap order)
- **Route more read-only surfaces to `DATABASE_READ`** as they're confirmed write-free (e.g. catalog/technician list
  reads, other oversight aggregates). Each is a one-line `inject` swap after a write-op grep.
- **Phase 1.4 — server-side pagination/query caps:** enforce a max page size and reject unbounded range queries so no
  single large salon can pull an unbounded set. This is app-code and testable offline; a good next unit of work.
- **Phase 2 — Redis read-through cache** for dashboard/catalog aggregates, with `tenant_id` mandatory in every cache
  key (the roadmap's security invariant) and short TTLs + write invalidation.
