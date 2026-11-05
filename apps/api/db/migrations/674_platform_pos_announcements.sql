-- 674_platform_pos_announcements.sql — Platform Announcements on the POS top bar (Kevin's Super Admin POS Top-Bar
-- Announcement & Platform Broadcast mandate, Oct 22 2026).
--
-- Super Admin types a message, chooses All Tenants / Selected Tenants / Selected Branches, publishes it now or schedules
-- it, and every matching POS shows it between Global Search and the Date / Clock controls — without a refresh.
--
-- Why new tables and not `platform_announcements` (239 / 294): that table is the platform's OUTBOUND message send (email /
-- SMS / push / in-app, dispatched once by the messaging worker: queued → sending → sent, with delivery metrics). A top-bar
-- announcement is a persistent DISPLAY state (draft → published ⇄ paused → archived, shown while its window is open) —
-- writing it into the send table would let the dispatcher send it and mix two lifecycles in one status column. The
-- names keep the domain: platform_notice* = Platform Announcements shown on a surface.
--
-- What is stored vs derived (mandate §14–§20, §102): lifecycle_status is draft | published | paused | archived; SCHEDULED
-- (published, starts later), ACTIVE (published, inside its window) and EXPIRED (published, window over) are DERIVED from
-- starts_at / ends_at against the database clock — no scheduler job flips statuses, so nothing can be late or run twice.

CREATE TABLE IF NOT EXISTS platform_notices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
  message           TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000),
  type              TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'update', 'maintenance', 'warning', 'urgent')),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  audience          TEXT NOT NULL DEFAULT 'all_tenants' CHECK (audience IN ('all_tenants', 'selected_tenants', 'selected_branches')),
  surfaces          TEXT[] NOT NULL DEFAULT ARRAY['pos']::text[]
                      CHECK (surfaces <@ ARRAY['pos', 'owner_app', 'technician_app', 'customer_app', 'super_admin']::text[] AND cardinality(surfaces) >= 1),
  lifecycle_status  TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft', 'published', 'paused', 'archived')),
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  dismissible       BOOLEAN NOT NULL DEFAULT true,
  requires_ack      BOOLEAN NOT NULL DEFAULT false,
  content_version   INTEGER NOT NULL DEFAULT 1 CHECK (content_version >= 1),   -- bumped by a material edit: a dismissed message may reappear
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),           -- every write: stale writers get a conflict
  duplicated_from   UUID REFERENCES platform_notices(id),
  created_by        UUID,
  updated_by        UUID,
  published_by      UUID,
  published_at      TIMESTAMPTZ,
  paused_at         TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_notices_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT platform_notices_published_shape CHECK (lifecycle_status = 'draft' OR published_at IS NOT NULL OR lifecycle_status = 'archived')
);
-- the POS read: published, on the POS surface, inside the window
CREATE INDEX IF NOT EXISTS idx_platform_notices_live ON platform_notices (starts_at, ends_at) WHERE lifecycle_status = 'published';
CREATE INDEX IF NOT EXISTS idx_platform_notices_admin ON platform_notices (lifecycle_status, updated_at DESC);

-- normalized targets (§13): a selected TENANT, or a selected BRANCH (with its tenant). All-tenants has no rows.
CREATE TABLE IF NOT EXISTS platform_notice_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id    UUID NOT NULL REFERENCES platform_notices(id),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  branch_id    UUID REFERENCES branches(id),
  target_type  TEXT NOT NULL CHECK (target_type IN ('tenant', 'branch')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_notice_targets_shape CHECK ((target_type = 'tenant' AND branch_id IS NULL) OR (target_type = 'branch' AND branch_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_notice_targets_tenant ON platform_notice_targets (tenant_id, notice_id) WHERE target_type = 'tenant';
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_notice_targets_branch ON platform_notice_targets (tenant_id, notice_id, branch_id) WHERE target_type = 'branch';
CREATE INDEX IF NOT EXISTS idx_platform_notice_targets_notice ON platform_notice_targets (notice_id);
DROP TRIGGER IF EXISTS trg_tc_platform_notice_targets__branch_id ON platform_notice_targets;
CREATE TRIGGER trg_tc_platform_notice_targets__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON platform_notice_targets FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

-- per USER (not per device) dismissal / acknowledgement / first delivery, per content version (§38, §132–§136)
CREATE TABLE IF NOT EXISTS platform_notice_receipts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  notice_id        UUID NOT NULL REFERENCES platform_notices(id),
  user_id          UUID NOT NULL,
  branch_id        UUID REFERENCES branches(id),
  kind             TEXT NOT NULL CHECK (kind IN ('delivered', 'dismissed', 'acknowledged')),
  content_version  INTEGER NOT NULL CHECK (content_version >= 1),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_notice_receipts ON platform_notice_receipts (tenant_id, notice_id, user_id, kind, content_version);
CREATE INDEX IF NOT EXISTS idx_platform_notice_receipts_notice ON platform_notice_receipts (notice_id, kind);
DROP TRIGGER IF EXISTS trg_tc_platform_notice_receipts__branch_id ON platform_notice_receipts;
CREATE TRIGGER trg_tc_platform_notice_receipts__branch_id BEFORE INSERT OR UPDATE OF tenant_id, branch_id ON platform_notice_receipts FOR EACH ROW EXECUTE FUNCTION enforce_tenant_consistency('branches', 'branch_id');

-- version history (§63, §128): one row per write, the full state after it (who, what action, when)
CREATE TABLE IF NOT EXISTS platform_notice_revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id   UUID NOT NULL REFERENCES platform_notices(id),
  version     INTEGER NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('created', 'edited', 'published', 'paused', 'resumed', 'archived', 'duplicated')),
  actor_id    UUID,
  snapshot    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_notice_revisions ON platform_notice_revisions (notice_id, version);

-- tenant isolation on the tenant-keyed tables (inert until DB_TENANT_RLS=1 sets app.tenant_id); the notices themselves
-- are platform rows — a POS reaches one only through the server's targeting query, never by id
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_notice_targets', 'platform_notice_receipts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_session_unrestricted() OR tenant_id = app_session_tenant()) '
                   'WITH CHECK (app_session_unrestricted() OR tenant_id = app_session_tenant())', t);
  END LOOP;
END $$;
