# DATABASE_MAP

_Measured this pass._

- **112 migrations** (`apps/api/db/migrations/*.sql`), idempotent plain SQL, applied in sorted-filename order (no tracking table; safe to re-run). Highest: `111_drop_duplicate_indexes.sql`.
- **180 `CREATE TABLE`** statements.
- **Money invariant**: integer cents throughout. No floats for money.
- **Tenant isolation**: every domain table is tenant-scoped; queries go through the `scoped()` helper (248 sites).
- **Idempotency / concurrency primitives in place**:
  - `payments` partial unique index `payments_tenant_idem_uq (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (claim-first card capture).
  - `payment_attempts` table with `UNIQUE(tenant_id, idempotency_key)` (split-card reservation lock).
  - `customer_wallet_ledger` with signed `amount_cents` + `CHECK (entry_type IN …)`; debits guarded by `pg_advisory_xact_lock` (no overdraft).
  - `gift_cards` decremented by an atomic conditional `UPDATE … WHERE balance_cents >= by` (no negative balance, no concurrent double-spend).
  - `payment_refunds` cumulative cap enforced atomically via advisory-locked reserve (this session).
- Duplicate indexes already removed (migrations 110–111). Live Postgres on port 5433, DB `aipowersalon`, used for verification this session.
- Reference: root `WALLET_LEDGER_AUDIT.md`, `MONEY_PATH_QA.md`, `PAYMENT_PATH_AUDIT.md`.
