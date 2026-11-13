-- 967_staff_bulk_invite_runs.sql — extras 200-Technician Large Salon 08 (round 11, Nov 13 2026): bulk INVITE as a MECHANISM.
-- Kevin decides message volume and consent, so it is OFF by default and nothing is sent until he turns it on:
--   • the salon's switch: tenant_settings (category 'staff', settings_json.bulk_invites_enabled), absent = false;
--   • the platform kill switch: platform_settings 'staff.bulk_invites_disabled' (Super Admin → Kill switches), absent = not killed.
-- While either says no, the per-person invite is unchanged and the bulk action only explains why it is off.
-- When on, one RUN invites at most 200 selected team members through the existing invite sender (user_invitations +
-- InvitationDelivery), skipping who has no contact, is already active, or was invited in the last 24 hours. A run is keyed
-- by the caller's run key (a retry with the same key gets the first run's answer back, never a second send) and records
-- every person's outcome. A run row is claimed first ('running', so a concurrent retry with the same key is refused, never
-- sent twice) and finished ONCE ('done', counts + outcomes); after that it can never change, and no run is ever removed.
-- PG16, no pgcrypto.
-- Rollback: DROP TABLE staff_bulk_invite_runs;
CREATE TABLE IF NOT EXISTS staff_bulk_invite_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  branch_id            UUID,
  run_key              TEXT NOT NULL CHECK (length(run_key) BETWEEN 8 AND 200),
  request_hash         TEXT NOT NULL CHECK (length(request_hash) <= 128),   -- the selected ids, so a reused key with other people is refused
  requested_by_user_id UUID,
  selected_count       INTEGER NOT NULL CHECK (selected_count BETWEEN 0 AND 200),
  sent_count           INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  not_delivered_count  INTEGER NOT NULL DEFAULT 0 CHECK (not_delivered_count >= 0),
  skipped_count        INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  failed_count         INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  status               TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  outcomes             JSONB NOT NULL DEFAULT '[]'::jsonb,                  -- [{ memberId, outcome, reason, channel }] — never a token or a full contact
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_bulk_invite_run_key UNIQUE (tenant_id, run_key)
);
CREATE INDEX IF NOT EXISTS idx_staff_bulk_invite_runs_recent ON staff_bulk_invite_runs (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION staff_bulk_invite_runs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- the one allowed change: a running run is finished (its counts and outcomes written), keeping who / what / when
  IF TG_OP = 'UPDATE' AND OLD.status = 'running' AND NEW.status = 'done' AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id
     AND NEW.run_key = OLD.run_key AND NEW.request_hash = OLD.request_hash AND NEW.selected_count = OLD.selected_count
     AND NEW.requested_by_user_id IS NOT DISTINCT FROM OLD.requested_by_user_id AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only (a run is finished once, never edited or removed)', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_staff_bulk_invite_runs_append_only ON staff_bulk_invite_runs;
CREATE TRIGGER trg_staff_bulk_invite_runs_append_only BEFORE UPDATE OR DELETE ON staff_bulk_invite_runs
  FOR EACH ROW EXECUTE FUNCTION staff_bulk_invite_runs_append_only();
