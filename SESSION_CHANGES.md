# SESSION_CHANGES.md — complete verified-green tree (FINAL, current)

Full merged monorepo with EVERY change from this session applied and verified across the whole tree. node_modules and
build artifacts excluded — run `npm ci`.

## Features integrated
1. payCard signature capture (customer-display iPad, all card paths; migration 386; POS "View Signature").
2. Super Admin oversight consoles (3): AI Review Reputation, AI Scheduling Optimizer, AI OCR Receipt.
3. Technician Payroll — GET /tech/payroll (own finalized payroll) + TechPayrollScreen + nav.
4. Period-end subscription invoice generator (super-admin-billing) — the parked recurring biller. OFF by default
   (BILLING_CYCLE_WORKER_ENABLED); manual trigger POST /super-admin/billing/cycle/run. Policy: active→invoice+advance;
   trialing→invoice+convert; pending_cancellation/cancel_at→cancel; past_due/paused/terminal→skip. Idempotent,
   advisory-locked, full catch-up (all missed cycles at once, capped). See BILLING_CYCLE_POLICY.md (root) for the full policy + how to apply.

## All bugs found & fixed this session (7)
1. Payroll draft-exclusion (money-logic) — drafts no longer counted as "Unpaid".
2 & 3. Two TS2347 compile errors in the OCR + scheduling oversight services.
4. manager-pay-web dead-session → stuck shell (added the missing `aps:unauthorized` listener).
5. manager-pay-web "Sign out" not fully signing out / leaving the Keychain token behind.
6. admin-web "Consent Status" dead sidebar link — nested child route missing; catch-all silently bounced to /dashboard.
7. tech-queue transition resurrection race — accept / move-to-serving wrote status unconditionally after a JS gate;
   a declined/cancelled/in-service ticket could be resurrected. Now enforced atomically in the UPDATE WHERE clause.

## Audited clean, left untouched (correct code)
- Money math (compensation split, refunds, cash change, split-tender + surcharge, tax ordering, gift-card atomicity,
  double-pay guard).
- Auth (client 401 handling, AuthContext restore/revoke, Face ID server-revalidation across all 4 native apps, SSE hooks).
- Wiring: 2,034 backend routes, all controllers mounted (no orphans); every frontend API call resolves to a real
  backend route; every real screen routed; every nav target resolves. Login screens & Face ID design untouched.

## Verified (actually run in-sandbox)
- tsc --noEmit: 0 errors, all 8 TypeScript workspaces.
- ESLint: 0 errors. vite build: all 7 frontends build clean.
- All API invariant guards pass (di, sql, perms, tenant, nav, nav:deep, crosswire, dead-client, unreached, impossible).
- Tests: api vitest ~5,250 (4 shards) + core esbuild 118; tech-web 105; customer-display 40; admin-web 743;
  manager-pay-web 42; money-path 260; tech-payroll pgtest 3; payment-signature pgtest 5; billing-cycle 26. 0 failures.

## Build/run
npm ci → npm --workspace apps/api run typecheck → npm --workspace apps/api run db:migrate (through 386) → per-app dev/build.
Recurring billing worker is opt-in: set BILLING_CYCLE_WORKER_ENABLED=1 (review BILLING_CYCLE_POLICY.md first).
