-- 128_service_category_merge_logs.sql
-- Lineage/recovery log for Global Services Management service-category merges (§25).
-- A merge reattributes a tenant's services from a duplicate (source) category onto a surviving (target) category
-- within the SAME tenant, then flags the source 'merged'. This table records enough to audit and recover the action:
-- the full source-category snapshot and the count of services that were reattributed. It never spans tenants.
CREATE TABLE IF NOT EXISTS service_category_merge_logs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID,
  source_category_id          UUID NOT NULL,
  target_category_id          UUID NOT NULL,
  reattributed_service_count  INTEGER NOT NULL DEFAULT 0,
  merged_by_user_id           UUID,
  merge_summary_json          JSONB,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_svc_cat_merge_logs_tenant ON service_category_merge_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_svc_cat_merge_logs_source ON service_category_merge_logs (source_category_id);
