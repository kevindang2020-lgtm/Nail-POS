# SECURITY_AND_TENANT_REVIEW

## Tenant isolation
- Tenant + branch context comes from authenticated **server-side** `TenantContextMiddleware`; clients cannot supply an unrestricted `tenantId`.
- Row-level scoping via the `scoped()` Kysely helper at **248 call sites** across 44 repositories.
- Negative tenant-isolation tests already exist (root `TENANT_ISOLATION_TEST_REPORT.md`): Tenant A cannot read/update/delete/export Tenant B's data; tenant users cannot reach Super-Admin routes.

## Roles & permissions
- RBAC enforced on the backend via permission guards (`need(ctx, '…')`), not just hidden UI. Sensitive actions (refunds, voids, discounts, payouts, security/billing settings, exports) require explicit permissions and emit audit-log events.

## Payments / financial safety
- Processors: **Fiserv CardPointe/Bolt + Clover only**. No raw PAN/CVV stored (tokenized). Webhooks signature-verified + idempotent.
- The only `stripe` strings are the AI-billing **webhook signature scheme** ("stripe-style" HMAC `t=,v1=`) — not a processor; must remain.
- **Money-movement concurrency is race-safe at the app level** (verified this session, in-memory + live Postgres):
  - Card capture → claim-first via `payments` partial unique index.
  - Split-card capture → `payment_attempts` reservation lock.
  - Wallet debit → `pg_advisory_xact_lock` (no overdraft).
  - Gift-card redeem → atomic conditional `UPDATE` (no negative / double-spend).
  - Refund cumulative cap → advisory-locked reserve (no over-refund / double-refund).
  - Input validation: split segments, cash tender, tips, and **discounts** all enforced as non-negative whole cents before any gateway call.
- Reference: root `PAYMENT_SECURITY_REPORT.md`, `PAYMENT_GATEWAY_SECURITY_REPORT.md`, `CASH_SECURITY_AUDIT.md`, `WALLET_LEDGER_AUDIT.md`, `FIXES_APPLIED_VERIFIED.md`.

## Verdict
Tenant isolation, RBAC, and financial-integrity controls are present and tested. No tenant leak, permission bypass, or pooled-funds pattern found in this pass.
