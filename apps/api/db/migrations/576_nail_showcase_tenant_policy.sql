-- 576_nail_showcase_tenant_policy.sql — per-salon NailShowcase policy (Technician Profile package, their 458).
--
-- Manual (non-ticket) showcase posts used to auto-publish platform-wide with whatever salon/technician the client
-- named. Manual posts now default to PENDING review. A salon that wants its customers' manual posts live immediately
-- relaxes that here (auto_publish_manual = true) — the default is the safe one, and a platform-wide feed never
-- auto-publishes a post that names no salon at all.
CREATE TABLE IF NOT EXISTS nail_showcase_tenant_policy (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  auto_publish_manual  BOOLEAN NOT NULL DEFAULT false,
  updated_by_user_id   UUID,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
