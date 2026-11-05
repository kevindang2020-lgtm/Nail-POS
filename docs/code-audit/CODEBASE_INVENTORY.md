# CODEBASE_INVENTORY

_Measured from `/home/claude/merged` this pass._

## Workspaces (npm `apps/*`)
| Workspace | Role | Source files |
|---|---|---|
| apps/api | NestJS/Kysely/PG backend (serves all clients) | 688 ts |
| apps/pos-web | Tenant POS (24" iMac fixed shell) | 119 ts/tsx (75 tsx) |
| apps/customer-web | Customer app (booking, social, find-techs) | 120 (100 tsx) |
| apps/admin-web | Super-Admin console (iPad-responsive) | 79 (65 tsx) |
| apps/owner-web | Owner multi-salon dashboards | 58 (45 tsx) |
| apps/tech-web | Technician app | 56 (41 tsx) |
| apps/customer-display | Customer-facing payment/rating display | 15 (4 tsx) |
| apps/go-check-in-kiosk | Go check-in kiosk | 1 |
| apps/go-check-in-admin | Check-in admin (static) | 0 ts |

## Backend (apps/api)
- Nest modules: **70** · controllers: **90** · services (non-spec): **73** · Kysely repositories: **44**
- HTTP routes (`@Get/@Post/@Put/@Patch/@Delete`): **834**
- SQL migrations: **112** (highest `111_drop_duplicate_indexes.sql`) · `CREATE TABLE`: **180**
- Tests: **99** `*.vitest.spec.ts` + **38** `*-core.spec.ts`

## Documentation already present
- **213** `.md` files at repo root + **32** under `docs/` — prior build/audit/test reports. Several of the Phase-0 filenames requested by the recovery prompt already exist at root (`CODEBASE_INVENTORY.md`, `DUPLICATE_CODE_RESOLUTION.md`, `FULL_CODEBASE_AUDIT.md`, `TENANT_ISOLATION_TEST_REPORT.md`, `BUG_FIX_REPORT.md`, `WALLET_LEDGER_AUDIT.md`, …). To honor the prompt's "no duplicate files" rule, this `docs/code-audit/` set is a consolidated, re-verified index that references those rather than re-creating their content.

## Verdict
Mature, single-application monorepo. No second/parallel app. No orphaned prototype trees (see DUPLICATION_REPORT).
