-- 993_branch_walkin_settings.sql — per-location walk-in settings (Kevin, Nov 13 2026: "Walk-in settings apply to the
-- whole salon, not per branch" — fix it). Additive only.
--
-- One optional row per (salon, branch). Each column is NULL = "same as the salon" (tenant_checkin_settings), or a
-- value that overrides the salon's switch for THAT location's displays and kiosks only. Covered: the six switches a
-- walk-in guest meets — choose services, pick a technician, services required, show prices, show durations, add-ons.
-- The master switch (`enabled`, Super Admin's) and every other check-in switch stay salon-wide.
--
-- Rollback: DROP TABLE branch_walkin_settings; (every location falls back to the salon's switches — nothing else reads it)
CREATE TABLE IF NOT EXISTS branch_walkin_settings (
  tenant_id                     UUID NOT NULL REFERENCES tenants (id),
  branch_id                     UUID NOT NULL REFERENCES branches (id),
  service_selection_enabled     BOOLEAN,
  technician_preference_enabled BOOLEAN,
  walkin_require_services       BOOLEAN,
  walkin_show_prices            BOOLEAN,
  walkin_show_durations         BOOLEAN,
  walkin_allow_add_ons          BOOLEAN,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                    UUID,
  PRIMARY KEY (tenant_id, branch_id)
);

DROP TRIGGER IF EXISTS trg_tc_branch_walkin_settings__branch_id ON branch_walkin_settings;
CREATE TRIGGER trg_tc_branch_walkin_settings__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON branch_walkin_settings
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');
