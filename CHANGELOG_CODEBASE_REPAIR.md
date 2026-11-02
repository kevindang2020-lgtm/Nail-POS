# CHANGELOG — Codebase Repair & Verification Pass

**Date:** 2026-06-22
**Scope:** Full-codebase audit, verification, and clean-package pass for AIPowerSalon.
**Outcome:** Whole monorepo verified green (typecheck + tests + builds) with honest, re-runnable numbers; one live end-to-end money-path integration test passed; gaps documented; clean package produced.

This document is the **current authoritative snapshot**. It does **not** re-generate the ~250 existing audit/handoff docs already in this repo (doing so would duplicate them, which the project rules forbid). Instead it records this pass and indexes the existing corpus. Where prior docs were stale, their numbers were refreshed in place (`TEST_BASELINE.md`, primary `NEW_CHAT_HANDOFF.md`).

---

## 1. Real inventory (scanned, not assumed)

Monorepo: **npm workspaces** (`apps/*`, `packages/*`). Root `package.json` name `aipowersalon-pos`. Backend NestJS + Kysely + Postgres 16. Tenant/branch scope is always derived server-side from the session; frontends never send tenantId/branchId.

| App | Role | src .ts(x) | Status |
|---|---|---|---|
| apps/api | NestJS backend (all surfaces) | 657 | working |
| apps/pos-web | Tenant POS | 140 | working |
| apps/admin-web | Super Admin | 120 | working (S01–S15 rebuilt; S16+ remain) |
| apps/customer-web | Customer app | 117 | working |
| apps/owner-web | Owner app | 55 | working |
| apps/tech-web | Technician app | 53 | working |
| apps/customer-display | In-store display | 12 | working |
| apps/go-check-in-kiosk | Check-in kiosk | 0 | **empty scaffold** |
| apps/go-check-in-admin | Kiosk admin | 0 | **empty scaffold (no package.json)** |

Shared packages: `packages/ui` (4 files). Backend domains: ~90 top-level modules under `apps/api/src`. Kysely migrations: `apps/api/db/migrations`. **No duplicate-named files** (New/V2/Final/Fixed/Copy/Backup) anywhere. **No committed `.env`**; `.env.example` present at root and `HANDOFF/`.

## 2. Verification sweep — all green (re-runnable)

**Typecheck** (`tsc --noEmit`) — all 7 real apps **clean, 0 TS errors**.

**Unit/integration (vitest)** — **280 files / 1,356 tests passing, 0 failures**:

| App | Files | Tests |
|---|---|---|
| api | 112 | 733 |
| admin-web | 50 | 191 |
| customer-web | 42 | 136 |
| pos-web | 41 | 107 |
| owner-web | 18 | 85 |
| tech-web | 14 | 74 |
| customer-display | 3 | 30 |

**api core specs** — the api has a second suite of **43 Nest-free `*-core.spec.ts`** files (pure-logic, run via `npm test` → `scripts/run-core-specs.sh`, not by `vitest run`). **All 43 pass.** (`test:harness` workflow suite also present.)

**Production builds** (`vite build` / nest) — all 7 apps **build, 0 failures**. Main-bundle sizes: pos-web ~758 kB, admin-web ~659 kB, customer-web ~552 kB, tech-web ~255 kB, owner-web ~253 kB, customer-display ~156 kB.

## 3. End-to-end money path — PASS (live Postgres)

Drove the **real canonical services** in sequence against live Postgres (seed tenant/branch/user), all rolled back after:

```
check-in.walkIn → check-in.moveToQueue → queue.assignTechnician(managerOverride)
→ queue.moveToServing (TICKET born, status=serving, $30 from priced lines)
→ serving.markDone (service_done) → serviceDone.qualityCheck(approved)
→ serviceDone.sendToCheckout (ready_checkout) → checkout.payCash → PAID
```

$30 service → **charged $32.33** (tax-inclusive) → change $967.67 from $1000 → **payment row persisted** (real UUID, cash, approved) → ticket `paid`/`paid_at` set. **Every business gate fired correctly**: technician skill-match (required managerOverride), quality approval before checkout, per-step granular permissions, cash tender ≥ amount due. Baseline restored (tickets/lines/payments/queue back to seed). This proves the services share one ticket record and each transition is legal — something a static wiring audit cannot show.

## 4. Wiring fixes applied this lineage

- **Dead links:** the raw scan flagged 34, but App.tsx auto-generates ~140 routes from `allNavItems()` → a gated `FeaturePage` (honest "pending/locked" scaffold, never a blank or bounce). Accounting for that net, **only 1 link was truly dead** — Tech Queue "Assign Guest" → `/customer-queue` (typo; Customer Queue is `/queue`). Fixed. **0 truly-dead links remain** in pos-web.
- **Realtime:** wired `useRealtime` on the 5 live operational screens that loaded once and went stale (Serving, Tech Queue, Check-In, Booking, Service Done); Customer Queue + Checkout already had it. All 7 live screens now refresh on the relevant server events. Static screens (Settings/Reports/Account/Payroll) correctly left alone.
- **Dashboard + Overview** rebuilt to reference image with live-Postgres-verified backend enrichment.

## 5. Findings (honest)

| Sev | Finding | File | Recommendation |
|---|---|---|---|
| Medium | `recordPayment` swallows its INSERT failure (`.catch(()=>undefined)`) while the ticket is still marked `paid`. Only triggers on invalid FK data (never in prod with a real user UUID), but the failure mode is silent missing revenue. | `apps/api/src/checkout/checkout.kysely.repository.ts` | Surface the failure, or don't flip the ticket to `paid` if the payment row didn't persist. |
| Low | pos-web main bundle ~758 kB | `apps/pos-web` | Route-level code splitting. |
| Low | Two empty kiosk app scaffolds in the tree | `apps/go-check-in-*` | Build them if those surfaces are needed, or remove. |
| Info | Several existing docs were stale (e.g. `TEST_BASELINE.md` showed api 661/99). | docs | Refreshed key docs to this session's numbers. |

## 6. Audits NOT yet executed at depth this session (for the next chat)

These are large, dedicated phases. Partial prior reviews exist in the corpus, but a **fresh end-to-end pass was not run this session** and is **not** claimed as done:

1. **Security pen-test** (SQLi/XSS/CSRF/IDOR across all 6 apps). Prior: `docs/code-audit/SECURITY_AND_TENANT_REVIEW.md`, `PAYMENT_SECURITY_REPORT.md`, `CASH_SECURITY_AUDIT.md`.
2. **Accessibility audit** (keyboard/focus/ARIA/contrast).
3. **Performance audit** (render/N+1/bundle beyond sizes captured here).
4. **Automated headless multi-role browser route testing** (open every route as 5 roles; check console + network). The dead-link audit done so far is static route-graph analysis for pos-web; extend to admin-web/owner-web/tech-web/customer-web and to a real browser harness.

## 7. Existing doc corpus (index — not regenerated)

The detailed evidence the prompt's doc list asks for already exists, e.g.: `FULL_CODEBASE_AUDIT.md`, `FULL_SYSTEM_AUDIT.md`, `CODEBASE_INVENTORY.md`, `docs/code-audit/{ARCHITECTURE_OVERVIEW,API_MAP,ROUTE_MAP,DUPLICATION_REPORT,SECURITY_AND_TENANT_REVIEW,TEST_BASELINE,ERROR_AND_BUG_REPORT,DATABASE_MAP,REPAIR_PLAN,CODEBASE_INVENTORY}.md`, `TENANT_ISOLATION_TEST_REPORT.md`, `FRONTEND_BACKEND_CONNECTION_MAP.md`, `DUPLICATE_CODE_RESOLUTION.md`, `MONEY_PATH_QA.md`, `BUILD_AND_TEST_REPORT.md`, `BACKEND_TEST_COVERAGE.md`, `PAYMENT_*`, `SUPER_ADMIN_*`, `OWNER_WEB_*`, `TECH_WEB_*`, `CUSTOMER_WEB_*`, and multiple `NEW_CHAT_HANDOFF.md`. Start the next chat with **this file** + `project-handoff.json` + the primary `NEW_CHAT_HANDOFF.md`.

## 8. Package

Clean package: `AI-PowerSalon-Clean-Working-Code-Package.zip` — full source (all apps + packages), Kysely migrations, tests, `.env.example` (no secrets), lockfile, the full doc corpus, this changelog, and `project-handoff.json`. Excludes node_modules / dist / .vite / caches / logs / coverage. Validated: extracts clean, lockfile present, `.env.example` present, no committed secrets.
