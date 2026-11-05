-- 480_developer_schema_scripts.sql — three schema changes the developer's tree applied by ad-hoc scripts
-- (scripts/add-start-source-col.mjs, scripts/fix-queue-constraint.mjs, scripts/add-tenant-comm-column.mjs), never by a
-- migration. Folded in here so every environment gets them the same way. All idempotent.

-- who started the service: 'tech' (Tech App) or NULL (POS) — written by the tech-queue start path
ALTER TABLE pos_tech_appointments  ADD COLUMN IF NOT EXISTS start_source TEXT;
ALTER TABLE pos_tech_queue_tickets ADD COLUMN IF NOT EXISTS start_source TEXT;

-- the queue item's status vocabulary gains 'completed' and 'done' (the serving/tech paths now advance the queue item)
ALTER TABLE pos_queue_items DROP CONSTRAINT IF EXISTS pos_queue_items_status_check;
ALTER TABLE pos_queue_items ADD CONSTRAINT pos_queue_items_status_check
  CHECK (status IN ('waiting','called','assigned','ready_for_tech','moved_to_tech_queue','in_service','completed','done','cancelled','removed'));

-- tenants.default_commission_percent is created by 472_tenant_default_commission_percent.sql (same statement, idempotent)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_commission_percent NUMERIC DEFAULT 50;
