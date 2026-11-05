-- 116_branch_switch_pin.sql — per-branch 6-digit "switch PIN" for multi-salon owners. In the POS, a manager or
-- receptionist must enter a salon's PIN to switch into it. Stored as a scrypt hash (same self-describing format as
-- users.password_hash); NULL = no PIN configured (single-salon owners never set one, and a NULL PIN never blocks a
-- switch). Tenant scope is inherited from branches.tenant_id, so PINs can never leak across tenants or salons.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS switch_pin_hash text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS switch_pin_updated_at timestamptz;
