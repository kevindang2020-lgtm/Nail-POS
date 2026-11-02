-- 532_access_governance_export_snapshots.sql — BUILD_PLAN Phase 9 (Constitution 2: access review, dormant accounts,
-- export accountability).
--
-- 1. ACCESS REVIEWS. The owner starts a review: a SNAPSHOT of every active team member with the high-risk permissions they
--    held at that moment (so the review says what was reviewed even after access changes). Each person gets a decision —
--    keep / change (another role template) / revoke (users.status 'inactive': the users trigger bumps the authorization
--    version and the session path revokes their sessions) — and the review is completed. One OPEN review per salon.
-- 2. DORMANT-ACCOUNT ALERTS. The daily job raises one owner alert per dormant account (active, no sign-in for > N days)
--    per dormancy episode (keyed on the last sign-in it saw), never one a day.
-- 3. EXPORT SNAPSHOTS. Every data export records who, under which permission, with which filters, how many rows and a
--    checksum of exactly what was handed over. Append-only: an export record is evidence.

-- ── 1. access reviews ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_reviews (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  started_by_user_id     UUID NOT NULL,
  due_at                 TIMESTAMPTZ,
  completed_by_user_id   UUID,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_access_reviews_completed CHECK ((status = 'open') = (completed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_access_reviews_tenant ON access_reviews (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_reviews_open ON access_reviews (tenant_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS access_review_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL,
  review_id              UUID NOT NULL REFERENCES access_reviews(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL,
  name                   TEXT NOT NULL,
  role                   TEXT NOT NULL,
  template_key           TEXT,
  high_risk_permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_login_at          TIMESTAMPTZ,
  decision               TEXT CHECK (decision IS NULL OR decision IN ('keep','revoke','change')),
  change_template_key    TEXT,
  note                   TEXT,
  decided_by_user_id     UUID,
  decided_at             TIMESTAMPTZ,
  CONSTRAINT chk_ari_decided CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CONSTRAINT chk_ari_change CHECK (decision IS DISTINCT FROM 'change' OR change_template_key IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_review_items_user ON access_review_items (review_id, user_id);
CREATE INDEX IF NOT EXISTS ix_access_review_items_tenant ON access_review_items (tenant_id, review_id);

-- ── 2. dormant-account alerts (one per account per dormancy episode) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dormant_account_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  user_id           UUID NOT NULL,
  episode_key       TEXT NOT NULL,                 -- the last_login_at the job saw ('never' when there is none)
  days_dormant      INT,
  owner_alert_id    UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dormant_account_alerts_episode ON dormant_account_alerts (tenant_id, user_id, episode_key);

-- ── 3. export snapshots (append-only) ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS export_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,                              -- NULL = a platform export
  branch_id     UUID,
  user_id       UUID,
  actor         TEXT,                              -- 'system:worker:<job>' for a job's export
  permission    TEXT NOT NULL,                     -- the key the export was authorized under
  export_kind   TEXT NOT NULL,                     -- e.g. customers.csv, reports.sales.csv
  route         TEXT,
  filters       JSONB NOT NULL DEFAULT '{}'::jsonb,
  format        TEXT NOT NULL DEFAULT 'csv',
  row_count     INT NOT NULL CHECK (row_count >= 0),
  byte_count    INT CHECK (byte_count IS NULL OR byte_count >= 0),
  checksum      TEXT NOT NULL,                     -- sha256 of exactly what was handed over
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_export_snapshots_tenant ON export_snapshots (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_export_snapshots_user ON export_snapshots (tenant_id, user_id, created_at DESC);
CREATE OR REPLACE FUNCTION export_snapshots_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'export_snapshots is append-only'; END $$;
DROP TRIGGER IF EXISTS export_snapshots_no_change ON export_snapshots;
CREATE TRIGGER export_snapshots_no_change BEFORE UPDATE OR DELETE ON export_snapshots FOR EACH ROW EXECUTE FUNCTION export_snapshots_append_only();

-- the denial report reads by time window
CREATE INDEX IF NOT EXISTS ix_authz_denials_window ON authorization_denials (tenant_id, first_at);
