# DEPENDENCY_REPORT

- npm **workspaces** (`apps/*`); root `package-lock.json`. Node + TypeScript throughout (Go for the kiosk).
- Backend: NestJS, Kysely, `pg`, vitest. Frontends: React 18, Vite, vitest, testing-library.
- **Install convention (critical)**: always a full root `npm install --no-audit --no-fund`. Workspace-scoped installs break sibling workspaces. Packaging strips all `node_modules`, so a reinstall is required before each validation pass.
- vitest binaries: the api has its own at `apps/api/node_modules/.bin/vitest`; frontends use `../../node_modules/.bin/vitest`; root `node_modules/.bin/tsc` for typecheck.
- No suspicious/abandoned duplicate dependency trees found.
