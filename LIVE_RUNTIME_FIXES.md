# Live-Runtime Fixes — Super Admin + Owner surface probe (2026-07-09)

## Method
Booted the **real** NestJS API in-process against a real Postgres engine (PGlite over the PG wire
protocol, backed by the migrated 356/356 + seeded pilot tenant), logged in over HTTP as **SUPER_ADMIN**
and as **OWNER**, and probed **every param-free GET route the app actually registers** (enumerated from
the live Express router, not guessed). This exercises real SQL execution, real auth/session plumbing, and
real RBAC/entitlement gates — the layer that mocked unit tests (which stub the DB and HTTP) cannot reach.

**Result:** 313 Super Admin GET routes + 357 Owner GET routes probed. After fixes: **0 server errors.**
All remaining non-200s are correct gating — 400 (missing required query param), 402 (entitlement / payment
required), 403 (entitlement or platform-scope), 422 (input validation).

## Bugs found and fixed (all verified live; each was a real 500/403 mocks never caught)

1. **Super Admin → Tenants directory 500 (`operator does not exist: text = uuid`).**
   `GET /super-admin/tenants/directory-overview` and `/super-admin/tenants/state`.
   `LIST_SQL` in `super-admin-tenants.kysely.repository.ts` counted POS devices with
   `pos_payment_terminals p WHERE p.tenant_id = t.id` — but `pos_payment_terminals.tenant_id` is `text`
   (composite PK) while `tenants.id` is `uuid`. Postgres has no `text = uuid` operator. **Fix:** cast
   `t.id::text`, matching the cast the merchant-accounts repo already uses. Guarded by a new PGlite-backed
   regression test (below).

2. **Super Admin → Voice endpoints 500 instead of 400 on missing `tenantId`.**
   5 routes under `/super-admin/voice/*`. The `run()` wrapper in `super-admin-voice.controller.ts` caught the
   400 `HttpException` thrown by its `need()` helper and re-wrapped **every** non-`LearningError` as 500.
   **Fix:** pass existing `HttpException`s through unchanged (`if (e instanceof HttpException) throw e;`).

3. **Owner → entire Dashboard 500 (`eb.case(...).when(...).and is not a function`).**
   All 14 `/pos/dashboard/*` routes (they share one state aggregate). `dashboard.kysely.repository.ts:148`
   chained an invalid `.and()` after `.when()` on Kysely's case builder. The code carried a comment noting
   these queries were "NOT executed this session (no live Postgres) — verify at deploy." **Fix:** express the
   compound condition as a single `sql<boolean>` inside `.when(...)`.

4. **Owner → AI busy-periods 500 (`relation "appointments" does not exist`).**
   `busy-period.kysely.source.ts` queried a table that does not exist. The real table is
   `pos_tech_appointments`, whose datetime is split into `appt_date` (date) + `start_time` (text time).
   **Fix:** repointed to `pos_tech_appointments`; DOW/date derived from `appt_date`, hour from `start_time::time`.

5. **Owner → AI no-show-risk 500 (same missing table + missing columns).**
   `noshow-risk.kysely.source.ts` also queried `appointments` and referenced columns that don't exist
   (`confirmed_at`, `confirmation_required`, `no_show_at`, timestamp `start_time`). **Fix:** repointed to
   `pos_tech_appointments` with the canonical `(appt_date + start_time::time)` timestamp and conservative,
   schema-accurate status mappings (`confirmed := status='confirmed'`, prior no-show := `status='no_show'`,
   `confirmation_required := false`). **See "Flagged for review" — the semantic mappings should be confirmed
   against intended product meaning.**

6. **Owner → Payroll / Campaigns / Communications 403 for every role (raw-`includes` permission bug).**
   `getState`/`getInbox` in `payroll`, `campaigns`, `communications` services called
   `ctx.permissions.includes('pos.payroll.view' | 'pos.marketing.view' | 'pos.communications.view')` — the
   **granular** key — directly, bypassing `hasPermission()`. Sessions carry the **coarse** capability
   (`payroll.view`, etc.); the guard passes via `hasPermission`'s coarse fallback, but the service's raw
   `includes` did not, so these three modules 403'd for everyone (OWNER included). **Fix:** the services'
   `need()` now uses `hasPermission(ctx, perm)`, identical to the guard. Verified: OWNER now 200 on all three.

## Regression guard added
`super-admin-tenants/super-admin-tenants-directory-pgtest.vitest.spec.ts` — runs the **real**
`KyselySuperAdminTenantsRepo.listTenantRecords()` / `getTenantRecord()` against a PGlite schema that
reproduces the exact `text` tenant_id vs `uuid` tenants.id split. **Proven teeth:** reverting the `::text`
cast makes it fail with `operator does not exist: text = uuid`; with the fix it passes (2 tests).

## Flagged for your decision (NOT changed — ambiguous / governed surfaces)

- **`ai-analytics-forecasting` no-show semantics (bug #5).** The forecasting DB layer was authored against a
  non-existent `appointments` table with a richer shape than the real `pos_tech_appointments`. The repoint is
  correct SQL, but the mappings for "confirmed" and "no-show" are my conservative interpretation. Confirm they
  match how you intend no-show risk to be scored.

- **Checkout elevated-action gates.** `checkout.service.ts` gates a >50% discount override
  (`pos.checkout.override_total`) and service reopen (`pos.checkout.reopen_service`) with a raw `includes` on
  granular keys that are granted to **no** role — so those actions are currently impossible for everyone,
  including OWNER. This may be intentional (hard cap) or the same class of bug as #6. Because these are
  payment-sensitive POST actions, I did not change them. Decide whether OWNER/MANAGER should be able to
  perform them (if so, switch to `hasPermission` and/or grant the capability).

- **AI Checkout Upsell module unreachable.** Its controller requires `pos.ai_checkout_upsell.view` →
  capability `ai_checkout_upsell.view`, which is absent from rbac entirely (every other AI module grants its
  `.view`), and it has no tenant nav item. So the module 403s for all roles. This looks like a grant gap but
  touches the governed permission model (and the reachability guard), so confirm whether the module should be
  surfaced/granted before adding the capability.

## Second pass — MANAGER-role probe (a role that holds only coarse capabilities)

The Owner/Super Admin probes structurally **cannot** catch role-specific gate bugs: OWNER holds every
non-super-admin permission, and several services special-case `ctx.role === 'OWNER'`. So a MANAGER account was
seeded into the pilot tenant and the tenant surface re-probed as MANAGER. **0 server errors**, and it surfaced a
third instance of the same permission-mapping class — invisible to the Owner probe:

7. **Skip-line checkout / Tech cash handoff / Cash drawer — 403 for MANAGER (and every non-owner role).**
   `skip-line-checkout`, `tech-cash-handoff`, and `cash-drawer` services each used a helper
   `has(ctx, perm) = ctx.permissions.includes(perm) || role==='OWNER' || role==='SUPER_ADMIN'`. The `includes`
   was a **raw** check of granular keys (`pos.checkout.view`, `pos.checkout.take_payment`, `pos.reports.view`);
   the `role==='OWNER'` shortcut masked the bug for OWNER, so only narrower roles (MANAGER/FRONT_DESK) hit it,
   even though managers are the intended users (e.g. the cash-override is commented "lets a manager confirm
   cash"). **Fix:** `has()` now uses `hasPermission(ctx, perm)` (coarse-capability mapping), keeping the
   OWNER/SUPER_ADMIN shortcut. Verified: MANAGER now 200 on skip-line state/settings; cash core specs green
   (19/19, 18/18, 19/19).

After this fix, every remaining MANAGER 403 is correct: owner-scoped settings/compensation, entitlement-disabled
AI modules (`AI_MONEY_PROTECTION_DISABLED`, `AI_VOICE_TRANSCRIPTION_DISABLED`), the already-flagged
`ai_checkout_upsell`, and `customer_display.manage` (a guard-level capability check — device management is
owner-tier by design).

## Test status
Affected modules + the permission-reachability guard + the new PGlite guard + the three cash-module core specs:
**all green** (0 failures). `tsc` clean. No module registration changed, so the DI graph is unaffected.
Live dual-role verification: **0 server errors** across 313 Super Admin + 357 Owner + 357 Manager GET routes.
