# START_HERE_NEW_CHAT.md

You are picking up **AIPowerSalon** — a multi-tenant nail-salon POS SaaS (NestJS 10 + Kysely + Postgres 16 API,
React 18 + Vite frontends) — from the **four-package merged handoff** (2026-07-09).

## Read in this order
1. `PROJECT_STATUS.md` — what exists and the verified state.
2. `NEW_CLAUDE_INSTRUCTIONS.md` — the working rules (non-negotiable invariants).
3. `MERGE_DECISIONS.md` — what the merge changed and why (incl. defects fixed).
4. `REMAINING_ISSUES.md` — the open list.
5. `TEST_REPORT.md` — the fresh verification numbers for this exact tree.

## Environment quickstart
```bash
npm ci                                   # root workspaces
npm run build --workspace @aipowersalon/api
node apps/api/scripts/di-check.mjs       # expect DI_GRAPH_OK
node apps/api/scripts/verify-migrations-pglite.mjs   # 356/356 → schema verified
cd apps/api && npx vitest run            # 3,945 tests
```
Real DB: `npm run db:up && npm run db:migrate && npm run db:seed` (see `.env.example`; money is integer cents,
gateways are Fiserv/CardPointe/Bolt/Clover only).

## The one-paragraph state
Everything from all four divergent packages is merged, wired, and green: 16 tenant AI modules, D's finance/team
arcs, A+C super-admin consoles — 5,720 tests passing, 356-migration chain verified from scratch (537 tables),
DI graph clean, all apps typecheck (8 TS-configured) and all 10 build. The AI Scheduling Optimizer that Package C left unmounted is
now registered with real booking-read + forecast bindings, the queue-assignment duplicate has an executable
guard, and a pre-existing base-wide RBAC gap (coarse `marketing.*` capabilities missing) is fixed.

Migration numbering continues at **356**.
