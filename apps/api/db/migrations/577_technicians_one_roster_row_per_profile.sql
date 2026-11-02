-- 577_technicians_one_roster_row_per_profile.sql — ONE salon roster row per (tenant, global technician).
-- Technician Profile package (their 459), merged Oct 12 2026.
--
-- == WHY ===================================================================================================
-- `technicians` had no uniqueness on (tenant_id, global_tech_profile_id). The POS create path, the membership
-- approval path and `materializeMembership` could each produce a SECOND roster row for one human at one salon —
-- two schedules, two commission settings, split payroll. From here on the database refuses it.
--
-- == BACKFILL (idempotent) ================================================================================
-- Where duplicates already exist, the OLDEST non-archived row is kept (it is the one payroll/tickets have been
-- keying on the longest). The others are ARCHIVED, never deleted — ticket_service_lines, payroll and audit rows
-- point at them — and every membership that pointed at an archived duplicate is repointed at the keeper.

-- 1. Repoint memberships from duplicate roster rows to the keeper.
WITH ranked AS (
  SELECT id, tenant_id, global_tech_profile_id,
         row_number() OVER (PARTITION BY tenant_id, global_tech_profile_id ORDER BY created_at ASC, id ASC) AS rn,
         first_value(id) OVER (PARTITION BY tenant_id, global_tech_profile_id ORDER BY created_at ASC, id ASC) AS keeper_id
    FROM technicians
   WHERE global_tech_profile_id IS NOT NULL AND archived_at IS NULL
)
UPDATE tech_salon_memberships m
   SET technician_id = r.keeper_id, updated_at = now()
  FROM ranked r
 WHERE r.rn > 1 AND m.technician_id = r.id AND m.tenant_id = r.tenant_id;

-- 2. Archive the duplicates (keep the row; it is referenced by the salon's books).
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tenant_id, global_tech_profile_id ORDER BY created_at ASC, id ASC) AS rn
    FROM technicians
   WHERE global_tech_profile_id IS NOT NULL AND archived_at IS NULL
)
UPDATE technicians t
   SET archived_at = now(), is_active = false, status = 'archived', updated_at = now()
  FROM ranked r
 WHERE r.rn > 1 AND t.id = r.id;

-- 3. The constraint. Partial: archived rows and never-linked rows are outside it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technicians_tenant_gtp_live
  ON technicians (tenant_id, global_tech_profile_id)
  WHERE global_tech_profile_id IS NOT NULL AND archived_at IS NULL;

-- 4. Why a roster row ended (transfer / archive / disconnect). Memberships already carry ended_reason (376).
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS ended_reason TEXT;
