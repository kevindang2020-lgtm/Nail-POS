# AIPowerSalon POS — Delivery Summary (consolidated, -82 → -91)

AIPowerSalon is a multi-tenant nail-salon POS. This package is the consolidated, current state of the
NestJS/Postgres backend monorepo, with the full operational money-path proven end-to-end on live Postgres for both owners
and staff. It supersedes the individual -82…-91 packages (each was a full snapshot; this is the latest).

## Capstone verification (run from scratch on a fresh database)
- **Core harness:** 18 Nest-free `*-core.spec.ts` suites **+ 139 vitest tests**, `RESULT: PASS`. TypeScript build: clean.
- **Fresh-DB bring-up:** the `migrate.mjs` runner applies **34 migrations** to an empty database (83+ tables), then the
  seed creates the super-admin + tenant + owner (+ a front-desk staff user).
- **End-to-end suites (61 checks, all green) over real HTTP on Postgres:**
  - `e2e-skill` 5/5 — skill-based technician assignment (skilled tech assigns with no override; unskilled rejected, then
    allowed with override).
  - `e2e-flow` 14/14 — the full money-path as OWNER: walk-in -> queue -> assign -> serve -> quality-check -> checkout -> cash.
  - `e2e-rbac` 14/14 — the same operational path as a FRONT_DESK user, plus a correct denial of a management action.
  - `e2e-payments` 7/7 — card (sandbox `sbx_` approval), refund, void, and a card+cash split.
  - `e2e-giftcard` 14/14 — gift-card issue / balance / full + partial redemption / split / reload / void.
  - `e2e-receipts` 7/7 — SMS / email / in-app receipts (Mock = `simulated` delivery) + send-all, all persisted.

## What works (verified)
- **Cross-module POS lifecycle materialized on Postgres** — check-in -> `pos_queue_items` -> central `tickets` + service
  lines -> serving -> service-done -> checkout -> `payments`, with consistent status mapping end-to-end.
- **Payments:** cash, card, split, gift-card, refund, void. Card/split run through an explicit sandbox mode
  (`PAYMENTS_SANDBOX=1`, clearly-marked `sbx_` test transactions); the honest default is `not_configured` (never a fake
  approval) until a real Fiserv MID is wired.
- **Gift cards:** real balances + a redemption ledger (`gift_cards` / `gift_card_transactions`) — issue, redeem
  (full/partial), reload, void, and split segments that debit a specific card.
- **RBAC for all roles:** a capability resolver bridges the granular `pos.<domain>.<action>` enforcement keys to the coarse
  catalog capabilities, so non-owner staff (FRONT_DESK/MANAGER/RECEPTION/TECHNICIAN) operate the POS within their
  permissions (OWNER implicitly holds all via its token).
- **Skill-based assignment:** technician skills derived from `technician_services` -> service categories.
- **Receipts:** SMS/email/in-app with real Twilio/SendGrid when configured, clearly-marked Mock simulation otherwise.
- **Tenant isolation:** every query is tenant-scoped server-side; the frontend never sends a tenantId for POS users.

## Honest non-hiding test harness
`scripts/run-core-specs.sh` runs both the `*-core.spec.ts` harnesses and vitest and exits non-zero if EITHER fails
(prints `RESULT: PASS|FAIL`). This was hardened after discovering an earlier OWNER-shortcut had silently broken
permission-isolation specs whose failures the old harness didn't surface; it has since caught a regression mid-development.

## Deploy
`DEPLOY.md` is the AWS runbook (App Runner + RDS PostgreSQL + S3/CloudFront): a multi-stage `Dockerfile`, the ledgered
`migrate.mjs` (runs on container start), `.env.example` (all env vars with prod-critical notes), and a TCP health check.
Verified locally end-to-end (migrate -> seed -> boot -> login 200); the Docker image build itself is not smoke-tested here
(no Docker daemon) — build it once in CI/locally before the first push.

## Not yet wired (honest)
- A real Fiserv/CardPointe client — card processing is sandbox-only today.
- Live Twilio/SendGrid credentials — receipts simulate until the env vars are set (no code change needed to go live).
- A CI pipeline (the harness + Docker build + Postgres-backed E2E suite on push).

## Where to look
- `MERGE_REPORT.md` — per-increment engineering log (-82 ... -91).
- `INTEGRATION_RUNBOOK.md` — how to run the API, the seeds, and every E2E locally.
- `DEPLOY.md` / `.env.example` — deployment and configuration.
- `apps/api/scripts/` — the seeds (`seed.ts`, `seed-frontdesk.ts`), the migration runner (`migrate.mjs`), and the six E2E
  smokes (`e2e-skill|flow|rbac|payments|giftcard|receipts.mjs`).
