# Six-Snapshot Merge — 2026-06-26

## The single most important finding (corrected premise)

The six uploaded archives are **not six different backends from six chats.** They are
**six snapshots of one and the same monorepo** (`AI-PowerSalon`, npm workspaces:
NestJS/Kysely/Postgres 16 API + six React/Vite frontends), each exported at a slightly
different point in an active multi-branch development arc.

Hard evidence (computed from file hashes across all six):

| Metric | Value |
|---|---|
| Distinct source paths across all six | 1,837 |
| Present in all six snapshots | 1,446 |
| …byte-identical in all six | **1,346** |
| …differing in ≥1 snapshot | 100 |
| Present in only some snapshots | 391 (281 unique to exactly one) |

The `migrate.mjs` runner in the most-advanced snapshot already contained a
`// Monorepo merge (2026-06-26)` reconciliation block aliasing the colliding
pos-pipeline migrations (126→130, 127→131, 128→132). In other words a prior session had
already begun consolidating these branches. So this task is **not** "pick one of six
backends"; it is "reconcile a handful of parallel feature branches of one backend that
collide only on migration numbers."

## Branch topology

Common ancestor through migration `125_ai_plan_billing` + `129_*`. Then:

| Snapshot | Role | Net-new feature arc | Migrations |
|---|---|---|---|
| `files` | **canonical base** (furthest along) | bundles + API-keys/webhooks + deployments + event-logs + webhook-deliveries; already-reconciled pos-pipeline | 130–137 |
| `files__1_` | admin-arc | marketing-sources / retention (campaigns edits) | (subset of base) |
| `files__2_` | pos-pipeline (older numbering) | communications edits | 126–132 (renumbered, aliased) |
| `files__3_` | admin-arc | checkout + payment-reconciliation edits | (subset of base) |
| `files__4_` | **help-center / support arc** | self-contained `help/` module | 130–136 (collide) |
| `files__5_` | **user-prefs / account arc** | profile prefs superset | 133–136 (collide) |

The migration-number **content** never collides — every migration creates disjoint
tables — so the collisions are resolved purely by **linear renumbering**.

## What was merged (and verified) in this session

Base = `files`. Folded in, with a clean linear migration sequence and `migrate.mjs`
rename aliases for every renumbered file:

**files__5_ — user-prefs / account arc**
- `profile.service.ts` (130→458 lines, purely additive superset) + `profile.controller.ts`
- 5 new `profile-*.vitest.spec.ts`
- migrations `133–136` → **138–141** (`user_login_alert_prefs`, `user_notification_prefs`, `tenant_backup_requests`, `user_ui_prefs`)
- admin-web `AppointmentsScreen` + `ProductsScreen` (+ tests)

**files__4_ — help-center / support arc**
- entire self-contained `help/` module (21 files: help articles/videos/engagement, AI help assistant, support tickets, support sessions, status & updates, SLA-breach sweep + scheduler) — depends only on `ai-gateway`, `database`, `notifications` (all present in base)
- `tenant-navigation.service.ts` + controller `helpDashboard` (purely additive, +44/+1 lines)
- migrations `130–136` → **142–148** (`help_knowledge_base`, `video_tutorials`, `help_article_engagement`, `support_tickets`, `ai_support_conversations`, `status_and_updates`, `support_sessions`)

`kysely.types.ts` union added 0 entries: the help/prefs arcs query via raw SQL, not the
typed DB registry, so no type-surface merge was required (confirmed empirically).

## Verification actually run (this environment)

| Check | Command | Result |
|---|---|---|
| Workspace install | `npm install --ignore-scripts` | 486 packages, OK |
| API typecheck (base) | `npm run typecheck -w @aipowersalon/api` | **0 errors** |
| API tests (base) | `npm test -w @aipowersalon/api` | 138 files / **873** tests pass |
| API typecheck (merged) | `npm run typecheck -w @aipowersalon/api` | **0 errors** |
| API tests (merged) | `npm test -w @aipowersalon/api` | 143 files / **909** tests pass; harness **74/74** |
| admin-web | `npm run typecheck -w aipowersalon-admin-web` (tsc + vite build) | **0 errors**, built |
| Migration structure | dup-number / dup-table scan | clean (017a split is intentional & aliased) |

Net new vs. base after merge: **+5 test files, +36 tests**, all green.

## Deferred (NOT merged — needs per-file 3-way merge + live Postgres smoke)

These remaining branch deltas edit **shared services** and are entangled, so they were
left out to preserve the verified-green state rather than risk a silent regression:

- `files__1_` marketing-sources arc: `campaigns.sources.ts`, `common/retention.ts`, `scripts/marketing-sources-smoke.ts` + edits to `campaigns.{service,dto,module}.ts`, `auth/rbac.ts`, `dashboard.kysely.repository.ts`
- `files__2_` communications edits: `communications.{controller,service,repository,kysely.repository,dto}.ts`, `common/app-version.ts`
- `files__3_` checkout + reconciliation edits: `checkout.{service,repository,kysely.repository,dto}.ts`, `checkout-settings.resolver.ts`, `payment-reconciliation.{controller,service}.ts`

Each is a small additive arc; fold them in one at a time, re-running
`npm run typecheck && npm test` after each, then the live Postgres migration smoke.

## Standing verification caveat (unchanged)

New/renumbered SQL is verified here by **tsc + DB-free harness + mocked tests only.**
Full migration apply could not be completed in this sandbox: the bundled PGlite build
lacks the `pg_trgm` extension required by the pre-existing `107_pos_search_indexes.sql`
(fails at 107, far below the merged 130–148; identical on the base — not a merge defect).
Before relying on transactional behavior of migrations 138–148, run the real Postgres 16
smoke: `npm run db:up && npm run db:setup`.
