-- 848_ai_branch_comparison_snapshots.sql — AI BRANCH COMPARISON 14 (extras, Nov 12 2026): Manager Sign-Off Notes.
--
-- AI Branch Comparison is read live from the Sales / Booking reports, so a figure a manager looked at can change later
-- (a refund, a late ticket). To sign off on a comparison the figures must stay as they were: "Save comparison" freezes the
-- server's own compareBranches() answer for the chosen period (never figures sent by the browser) in
-- ai_branch_comparison_snapshots — IMMUTABLE (no UPDATE / DELETE). A reviewer then adds sign-off notes in
-- ai_branch_comparison_signoffs — APPEND-ONLY (decision approved | needs_follow_up | noted, a required note, who, when).
-- A note never changes the snapshot, and nothing here edits a sale, a booking or a schedule.
CREATE TABLE IF NOT EXISTS ai_branch_comparison_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  branch_id            UUID,                                   -- the session branch it was saved from (NULL = salon-wide)
  created_by_user_id   UUID,
  title                TEXT CHECK (title IS NULL OR length(title) <= 120),
  preset               TEXT NOT NULL CHECK (length(preset) <= 20),
  range_from           DATE,
  range_to             DATE,
  financials_included  BOOLEAN NOT NULL,
  as_of                TIMESTAMPTZ NOT NULL,
  snapshot_json        JSONB NOT NULL,                         -- { totals, branches[] } exactly as compareBranches() returned them
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_branch_comparison_snapshots_tenant ON ai_branch_comparison_snapshots (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_branch_comparison_signoffs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  snapshot_id       UUID NOT NULL REFERENCES ai_branch_comparison_snapshots(id),
  reviewer_user_id  UUID,
  decision          TEXT NOT NULL CHECK (decision IN ('approved', 'needs_follow_up', 'noted')),
  note              TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 1000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ai_branch_comparison_signoffs_snapshot ON ai_branch_comparison_signoffs (tenant_id, snapshot_id, created_at DESC);

CREATE OR REPLACE FUNCTION ai_branch_comparison_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS trg_ai_branch_comparison_snapshots_immutable ON ai_branch_comparison_snapshots;
CREATE TRIGGER trg_ai_branch_comparison_snapshots_immutable BEFORE UPDATE OR DELETE ON ai_branch_comparison_snapshots
  FOR EACH ROW EXECUTE FUNCTION ai_branch_comparison_immutable();
DROP TRIGGER IF EXISTS trg_ai_branch_comparison_signoffs_append_only ON ai_branch_comparison_signoffs;
CREATE TRIGGER trg_ai_branch_comparison_signoffs_append_only BEFORE UPDATE OR DELETE ON ai_branch_comparison_signoffs
  FOR EACH ROW EXECUTE FUNCTION ai_branch_comparison_immutable();
