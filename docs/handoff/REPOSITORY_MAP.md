# REPOSITORY_MAP.md

Monorepo root: npm workspaces (`apps/*`, `packages/*`). Below: important folders, purpose, and **canonical files that must not be duplicated**.

## Top level
| Path | Purpose |
|---|---|
| `apps/` | All applications (see below) |
| `packages/ui/` | Shared UI / design tokens (cream/gold, Playfair + Hanken) |
| `apps/api/db/migrations/` | **130 ordered SQL migrations** — canonical schema source of truth |
| `scripts/` | `run-core-specs.sh` (test runner), `setup-local.sh`, local helpers |
| `deploy/terraform/` | Infra-as-code |
| `.github/workflows/` | CI |
| `docs/` | Architecture/feature docs; `docs/handoff/` = this consolidated handoff set |
| ~~`HANDOFF/`~~ | Removed Oct 10 2026 (Constitution 13 §388) — superseded by `START-HERE.md`, `NEW_CHAT_HANDOFF_2026-10-05.md`, `apps/api/openapi/manifest.txt` (routes) and `apps/api/db/ownership/registry.generated.json` (tables); in git history at `62a1875d` |
| Root `*.md` | Extensive per-feature audit/build/test reports (canonical history) |
| `.env*.example` | Sanitized env templates (root) |
| `Dockerfile`, `docker-compose.yml` | Container + local Postgres |

## apps/api  (NestJS + Kysely + Postgres, ~757 ts)
| Path | Purpose / canonical |
|---|---|
| `src/super-admin-platform/super-admin-platform.repository.ts` | **CANONICAL** Super Admin data layer: Kysely repo + `InMemorySuperAdminPlatformRepo` stub. Keep interface + stub + impl in sync. Pure exported helpers: `usersRoleDistribution`, `topServicesByRevenue`, `groupCategoryDuplicates`, `branchStatusGrouping`. Aggregates incl. `usersDashboard`, `branchesDashboard`. |
| `src/super-admin-platform/super-admin-platform.service.ts` | **CANONICAL** service: `PlatformError`, `audit(...)`, session-gating via `supportSessions(true)`, `AdminCtx`. |
| `src/super-admin-platform/super-admin-platform.controller.ts` | **CANONICAL** `@Controller('super-admin/platform')` under `SuperAdminGuard`; `run()`/`ctxFrom()` helpers. |
| `src/super-admin-platform/*.spec.ts` | DB-free harness specs (57 suites) run by `scripts/run-core-specs.sh`. |
| `db/migrations/*.sql` | Schema (130). New schema = new migration; never edit shipped ones. |
| `scripts/migrate.mjs`, `seed.ts`, `seed-demo.ts`, `e2e-workflow-run.mjs` | DB lifecycle + e2e. |

## apps/admin-web  (Super Admin console, React/Vite, ~125 tsx)
| Path | Purpose / canonical |
|---|---|
| `src/api/superAdminApi.ts` | **CANONICAL** typed client bindings (`api.get/post`, `enc()`); keep in sync with controller. |
| `src/screens/PlatformDashboardScreen.tsx` | **CANONICAL Overview** ("Super Admin Dashboard"), backed by `/super-admin/dashboard` + system-health + tenant-performance. Do NOT build a second Overview. The live `Dashboard` item is the one to rename → Live Operations. |
| `src/screens/BranchesScreen.tsx` | **CANONICAL Branches** screen; wired to real `branchesDashboard` aggregate this session. |
| `src/screens/UsersRolesScreen.tsx`, `AuditLogsScreen.tsx` | Users & Roles (gated mutation tier) + audit log surface. |
| `src/screens/*.test.tsx` | Vitest screen tests (51 files / 211 tests). |

## Other apps
| App | Purpose |
|---|---|
| `apps/pos-web` (~157 tsx) | Tenant reception POS — Check-In, Queues, Serving, Service Done, Checkout (money path). |
| `apps/owner-web` (~58) | Owner / multi-salon (`owner_branch_access`). |
| `apps/tech-web` (~58) | Technician app (queue, earnings, tickets). |
| `apps/customer-web` (~120) | Customer app (booking, social, profile). |
| `apps/customer-display` (~15) | Customer-facing display. |
| `apps/go-check-in-kiosk` / `-admin` | Check-in kiosk + admin. |

## Do-not-duplicate list
- The Super Admin repository/service/controller trio (extend in place).
- `superAdminApi.ts` client bindings.
- `PlatformDashboardScreen` (Overview) and `BranchesScreen`.
- Any shipped migration in `db/migrations/` (add a new numbered file instead).
- Pure helpers in the repository (reuse `branchStatusGrouping` etc.).
