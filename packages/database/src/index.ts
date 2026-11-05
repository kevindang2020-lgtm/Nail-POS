// @aipowersalon/database — the one database layer (Constitution 13 §72): the typed schema, the connection handles and
// the pool factory (the Nest module is behind './nest'). Migrations still run from apps/api/db/migrations (moving them is a separate step; the runner,
// the PGlite test harness and the Dockerfile all reference that path).
export type { DB } from './kysely.types';
export * from './kysely.types';
export { DATABASE, DATABASE_READ, DATABASE_WORKER, createDatabase, createReadDatabase, createWorkerDatabase, workerPoolSettings, poolOptions, keepPoolAlive, ROLE_TIMEOUTS, type PoolRole, type AppDatabase, type DatabaseOptions, type PoolHook } from './kysely.provider';
export { ActorStampPlugin, actorStampPlugins, stampableActor, type ActorStampOptions } from './actor-stamp.plugin';   // Phase 10: created_by / updated_by / deleted_by
export { ACTOR_COLUMNS } from './actor-columns.generated';
// DatabaseModule (NestJS) lives behind './nest' (§113) — see ./nest/index.ts.

/** Where the migrations live — stated by the database package, not assumed from the working directory. (A test that
 *  read `process.cwd()/db/migrations` silently SKIPPED its whole file when run from a module; see Constitution 13.)
 *  Same depth from src/ and dist/, so it resolves correctly in tests (source) and at runtime (compiled). */
export const MIGRATIONS_DIR: string = require('node:path').resolve(__dirname, '..', '..', '..', 'apps', 'api', 'db', 'migrations');
export * from './inet';   // moved from apps/api/src/common/inet.ts (Constitution 13 §219)
// Query scoping: the optional one-tenant narrowing Super Admin platform reads thread through their SQL (andTenant /
// tenantPred). A database-query concern, like inet — not a control-plane domain (§270 keeps the super-admin surfaces
// themselves out of packages).
export * from './overview-scope';   // moved from apps/api/src/common/overview-scope.ts (Constitution 13 §219)
export * from './scheduler-lock';   // moved from apps/api/src/common/scheduler-lock.ts (Constitution 13 §219)
export { leaseTickCoordinator, claimTick, renewTick, finishTick, type LeaseOptions } from './scheduler-runs';   // Phase 2: migration 518 leases
export * from './job-queue';   // Phase 2: the one durable job queue (migration 519)
export * from './tenant-session';   // row-level security: the request's tenant on every pooled connection (DB_TENANT_RLS)
export * from './branch-timezone';   // Oct 2 2026 — the one branch time-zone lookup (branches.timezone → America/New_York)
export { runBackfill, type BackfillOptions, type BackfillResult } from './backfill';   // Phase 10: batched, resumable backfills (schema_backfills, migration 534)
export * from './list-query';   // BUILD_PLAN Phase 12 (Constitution 5 §47–§52): the one list filter / sort / search / range parser + Kysely applier
export * from './state-machine';   // BUILD_PLAN Phase 12 (Constitution 5 §74–§78): the one state-transition primitive (defineStateMachine / assertTransition / transitionStatus)
export { API_IDEMPOTENCY } from './idempotency-lifecycle';   // BUILD_PLAN Phase 12: one machine for api_idempotency.state
