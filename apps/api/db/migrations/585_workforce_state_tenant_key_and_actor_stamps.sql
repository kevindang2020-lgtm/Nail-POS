-- 585_workforce_state_tenant_key_and_actor_stamps.sql — WF merge follow-up (Oct 12 2026) for 576 / 579, from the gates:
--   • check:unique-tenant-review — technician_workforce_state's one-row-per-technician key becomes (tenant_id,
--     technician_id) (was UNIQUE (technician_id) alone). technicians.id is a global uuid, so no existing pair can
--     collide; the tenant-keyed index is created before the old constraint is dropped (never a window without the guard).
--     Writer: modules/workforce workforce-status.kysely.repository.ts create() — ON CONFLICT (tenant_id, technician_id).
--   • check:actor-stamp — technician_workforce_state (every CAS) and nail_showcase_tenant_policy (the owner's showcase
--     policy) are tenant tables that track updated_at, so they carry updated_by (the actor-stamp plugin fills it; a
--     system transition — a punch, a service start — has no actor and leaves it NULL).
-- EXPAND-ONLY, idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_workforce_state_tenant_tech
  ON technician_workforce_state (tenant_id, technician_id);
ALTER TABLE technician_workforce_state DROP CONSTRAINT IF EXISTS technician_workforce_state_technician_unique;

ALTER TABLE technician_workforce_state  ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE nail_showcase_tenant_policy ADD COLUMN IF NOT EXISTS updated_by UUID;
