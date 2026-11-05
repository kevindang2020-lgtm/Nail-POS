# NEXT CHAT — START HERE

## What this package is
ONE canonical AI PowerSalon monorepo (npm workspaces: NestJS/Kysely/Postgres 16 API +
six React/Vite frontends). It is the consolidation of six *snapshots of this same repo*
(not six separate backends — see `SIX_SNAPSHOT_MERGE_2026-06-26.md` for the evidence and
full branch map).

## Verified-green baseline (reproduce before changing anything)
```
npm install --ignore-scripts
npm run typecheck --workspace @aipowersalon/api        # 0 errors
npm test --workspace @aipowersalon/api                 # 143 files / 909 tests, harness 74/74
npm run typecheck --workspace aipowersalon-admin-web   # 0 errors + vite build
```

## What was just merged in
- **help-center / support arc** (from snapshot files__4_): self-contained `help/` module
  + `helpDashboard`; migrations 142–148.
- **user-prefs / account arc** (from snapshot files__5_): profile prefs superset +
  admin-web Appointments/Products screens; migrations 138–141.
- All renumbered migrations have `migrate.mjs` rename aliases (safe on already-migrated DBs).

## Highest-priority next tasks (in order)
1. **Live Postgres migration smoke** — `npm run db:up && npm run db:setup`. The sandbox
   PGlite lacks `pg_trgm` (pre-existing block at migration 107), so 130–148 still need a
   real PG16 apply before relying on transactional behavior.
2. **Fold the three deferred shared-service arcs** one at a time, re-running
   `npm run typecheck && npm test` after each (list in `SIX_SNAPSHOT_MERGE_2026-06-26.md`):
   files__1_ marketing-sources, files__2_ communications, files__3_ checkout/reconciliation.
3. Build the other five frontends (pos-web, owner-web, tech-web, customer-web,
   customer-display) to confirm parity.

## Hard rules (do not violate)
- This is ONE backend (`apps/api`). Do **not** recreate parallel/duplicate backends or
  `*-final` / `*-merged` folders.
- Honest verification only — never report a test/build as passing unless it actually ran.
- Audit-first: grep for existing aggregates/DDL and extend rather than duplicate.
- Money is integer cents. Payments are Fiserv (CardPointe/Bolt) + Clover only.
- New SQL: tsc + harness + mocked tests are NOT a substitute for live PG16 smoke.
