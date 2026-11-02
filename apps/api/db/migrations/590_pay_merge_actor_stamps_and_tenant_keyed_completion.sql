-- 590_pay_merge_actor_stamps_and_tenant_keyed_completion.sql — PAY merge follow-up (Oct 12 2026) for 586/587, from the gates:
--   • check:actor-stamp — the two new tenant tables track updated_at, so they carry updated_by (the actor-stamp plugin
--     fills it on every update; allocation rows are replaced whole, sessions move STARTED → PAUSED → COMPLETED).
--   • check:unique-tenant-review — the Service Done completion key is unique PER TENANT: (tenant_id, idempotency_key)
--     replaces the global (idempotency_key) index. The key embeds the ticket id, so no existing pair can collide; the new
--     index is created before the old one is dropped (never a window without the guard).
-- EXPAND-ONLY, idempotent. Writers: modules/queue service-done-transition.ts (ON CONFLICT (tenant_id, idempotency_key)),
-- serving.kysely.repository.ts, modules/workforce compensation-line-allocations.ts.
ALTER TABLE ticket_service_sessions         ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE ticket_service_line_allocations ADD COLUMN IF NOT EXISTS updated_by UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_service_sessions_tenant_idem
  ON ticket_service_sessions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
DROP INDEX IF EXISTS uq_ticket_service_sessions_idem;
