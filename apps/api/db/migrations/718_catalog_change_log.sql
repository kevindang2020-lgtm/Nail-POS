-- 718_catalog_change_log.sql — Services & Products · Service Categories · Service Pricing · Add-Ons rebuilds (Oct 30 2026).
-- EXPAND-ONLY, idempotent: nothing existing is rewritten, renamed or dropped.
--
-- Before this migration a service's price / duration / category / status change, a category rename or archive and an add-on
-- edit left NO durable trace: ServicesService kept its audit trail in an in-memory array that vanished with the process.
-- catalog_change_log is that trail, append-only: one row per changed field (old → new, who, when, why). Completed tickets
-- keep their own snapshots (ticket_service_lines.*_snapshot); nothing here is ever used to re-price a ticket.
CREATE TABLE IF NOT EXISTS catalog_change_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid,
  entity_type   text NOT NULL,              -- service | category | add_on
  entity_id     text NOT NULL,              -- the service / category id, or an add-on key (legacy add-on keys are not uuids)
  service_id    uuid,                       -- the service the change concerns (a category reassignment, an add-on offering)
  field         text NOT NULL,              -- price_cents | duration_minutes | category_id | name | status | …
  old_value     text,
  new_value     text,
  reason        text,
  source        text NOT NULL DEFAULT 'pos',-- pos | import | pricing_editor | reassignment | add_ons
  actor_user_id uuid,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  effective_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_catalog_change_entity CHECK (entity_type IN ('service', 'category', 'add_on'))
);
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_scope ON catalog_change_log (tenant_id, changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_entity ON catalog_change_log (tenant_id, entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_change_log_service ON catalog_change_log (tenant_id, service_id, changed_at DESC) WHERE service_id IS NOT NULL;

-- append-only: an UPDATE or DELETE is refused (a correction is a new row)
CREATE OR REPLACE FUNCTION catalog_change_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catalog_change_log is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_catalog_change_log_append_only ON catalog_change_log;
CREATE TRIGGER trg_catalog_change_log_append_only BEFORE UPDATE OR DELETE ON catalog_change_log FOR EACH ROW EXECUTE FUNCTION catalog_change_log_append_only();

-- the directory / search sorts (newest first, ids as the tie-break) and the add-on key lookups
CREATE INDEX IF NOT EXISTS idx_services_scope_created ON services (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_service_categories_scope_created ON service_categories (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_service_add_ons_key ON service_add_ons (tenant_id, add_on_key);
