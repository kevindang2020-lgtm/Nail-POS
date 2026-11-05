# AIPowerSalon — Project Package Audit

Date: 2026-06-16. Folder-by-folder scan of the `aipowersalon-pos` monorepo for the new-chat handoff package.

| Folder | Contains | Needed in new chat? | Important files | Missing config | Build | Notes |
|---|---|---|---|---|---|---|
| `apps/api` | NestJS backend — 373 TS files, 75 controllers, services, repositories, DTOs | **Yes** | `src/main.ts`, `src/**/*.controller.ts`, `tsconfig.json`, `scripts/migrate.mjs`, `scripts/seed*.ts` | none | ✓ clean | Single backend; tenant scope server-side |
| `apps/api/db/migrations` | 86 raw-SQL migrations (`001..085`) | **Yes** | all `*.sql` | none | ✓ apply clean | Idempotent, tracked via `schema_migrations`; no Prisma |
| `apps/pos-web` | Front-desk POS (React+Vite, react-router) | **Yes** | `src/`, `vite.config.ts` (:5173), `tsconfig.json`, `package.json` | none | ✓ | WEB (Safari on Mac); no native shell |
| `apps/admin-web` | Super Admin console (React+Vite) | **Yes** | `src/`, `vite.config.ts` (:5174), `tsconfig.json` | none | ✓ | WEB (Safari iPad Pro 13in); no native shell |
| `apps/customer-web` | Customer app (React+Vite) | **Yes** | `src/`, `vite.config.ts` (:5176), `ios/`, `android/`, `capacitor.config.ts` | none | ✓ | Native iOS+Android |
| `apps/owner-web` | Owner app (React+Vite, state-machine nav) | **Yes** | `src/`, `vite.config.ts` (:5177), `ios/`, `android/` | none | ✓ | Native iOS+Android |
| `apps/tech-web` | Technician app (React+Vite) | **Yes** | `src/`, `vite.config.ts` (:5175), `ios/`, `android/` | none | ✓ | Native iOS+Android |
| `apps/customer-display` | Check-in / customer display (React+Vite) | **Yes** | `src/`, `vite.config.ts` (:5180), `ios/`, `android/` | none | ✓ | Native iOS+Android |
| `apps/go-check-in-kiosk` | iPad check-in kiosk (static HTML + Capacitor) | **Yes** | `index.html`, `capacitor.config.ts`, `ios/`, `android/` | none | static | Reads `window.APS_API_BASE` |
| `apps/go-check-in-admin` | Kiosk config page (static HTML) | **Yes** | `index.html` | none | static | WEB |
| `scripts` | `setup-local.sh`, `run-core-specs.sh`, etc. | **Yes** | `setup-local.sh` | none | n/a | One-command local bring-up |
| (root) | Workspace + tooling config | **Yes** | `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `Dockerfile`, `docker-compose.yml` | none | n/a | npm workspaces |
| `*.md` (root) | Reports + runbooks | **Yes** | this handoff set + audit/connection-map/money-path + iOS/Android submission runbooks | none | n/a | 50+ docs |
| `shared` / `packages` | — | n/a | — | — | — | **Not present** — this repo is a flat `apps/*` monorepo; shared types live within each app |
| `prisma` | — | n/a | — | — | — | **Not used** — migrations are raw SQL, not Prisma |
| `nest-cli.json` | — | n/a | — | — | — | **Not used** — API builds via `tsc`, not the Nest CLI |

## Config-file check (root + per app)
Present: `package.json`, `package-lock.json`, root `tsconfig.json`, per-app `tsconfig.json` + `vite.config.ts`,
`eslint.config.mjs`, `.env.example` (+ `.env.local/development/production.example`), `README.md`, `README-FIRST.md`.
Not applicable: `prisma/schema.prisma`, `nest-cli.json`, `tailwind.config.js` (styling is plain CSS tokens, no Tailwind).

Conclusion: **everything needed to continue is present and builds.** No missing config blocks a new chat.
