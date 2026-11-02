-- 553_api_operations.sql — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the ONE asynchronous operation record.
--
-- A large export (any GET marked @AsyncExport) asked for with `Prefer: respond-async` — or larger than its route's
-- synchronous limit — answers 202 + a status URL instead of holding the connection. This row is what the status URL
-- reads: who asked (tenant, realm, actor), what (kind, route, the query + path parameters — never a request body), the
-- state of the work (queued → running → succeeded | failed; expired after 24 h; canceled), the job that does it (the ONE
-- job queue, migration 519, job type `api.export`), and where the finished file lives in the PRIVATE store (result_key;
-- never a public URL — the download route streams it to the same principal).
--
-- The worker re-runs the SAME handler as the SAME person, re-authorized from the CURRENT grants at run time, so a user
-- demoted while the export waited gets `failed` / PERMISSION_DENIED, not the file.
--
-- jobs.job_type has no list CHECK (519 checks only the dotted-name shape), so `api.export` / `api.operations.expire`
-- need no widening — the reserved 554 is not used.
--
-- Retention: the FILE is deleted after 24 h by the api.operations.expire sweep (status → expired); the ROW is operational
-- history, removed by the central retention executor after 30 days (retention-policy.json).
CREATE TABLE IF NOT EXISTS api_operations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE CASCADE,          -- NULL: a platform (Super Admin) or salon-less operation
  branch_id      uuid,
  realm          text NOT NULL CHECK (realm IN ('pos', 'owner', 'tech', 'super-admin', 'customer')),
  actor_user_id  text NOT NULL CHECK (length(actor_user_id) <= 120),       -- users.id (staff, platform) or the customer account id
  actor_role     text NOT NULL,
  kind           text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.-]*$' AND length(kind) <= 120),
  route          text NOT NULL CHECK (length(route) <= 300),              -- the route TEMPLATE, e.g. /pos/customers/export
  permission     text,                                                    -- the key the export is authorized under
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,                      -- { query, path } — never a body
  principal      jsonb NOT NULL DEFAULT '{}'::jsonb,                      -- { permissions } the request held: the worker NARROWS to it, never widens
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'expired', 'canceled')),
  progress       smallint CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  job_id         uuid,
  result_key     text,                                                    -- private-store key of the file
  result_meta    jsonb,                                                   -- { filename, contentType, bytes, rows }
  error          jsonb,                                                   -- { code, message }
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,                                                    -- the actor stamp (migration 543's rule); the worker writes as nobody
  CONSTRAINT api_operations_result_when_succeeded CHECK (status <> 'succeeded' OR (result_key IS NOT NULL AND result_meta IS NOT NULL AND expires_at IS NOT NULL)),
  CONSTRAINT api_operations_error_when_failed CHECK (status <> 'failed' OR error IS NOT NULL)
);
-- A realm's list ("my exports"): tenant first (RLS + the tenant-leading index rule), newest first.
CREATE INDEX IF NOT EXISTS ix_api_operations_tenant ON api_operations (tenant_id, realm, actor_user_id, created_at DESC);
-- The expiry sweep reads finished operations whose file is past its time.
CREATE INDEX IF NOT EXISTS ix_api_operations_expiry ON api_operations (expires_at) WHERE status = 'succeeded';
COMMENT ON TABLE api_operations IS 'Asynchronous API operations (Phase 12, Constitution 5 §32–33): 202 + status URL; the file lives in the private store for 24 h.';

-- Row-level security, the 544 policy: a salon's request sees its own rows; a platform row (tenant_id NULL) only to
-- unrestricted work (Super Admin, the worker, the sweep).
ALTER TABLE api_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_operations;
CREATE POLICY tenant_isolation ON api_operations USING (app_session_unrestricted() OR tenant_id = app_session_tenant())
  WITH CHECK (app_session_unrestricted() OR tenant_id = app_session_tenant());
