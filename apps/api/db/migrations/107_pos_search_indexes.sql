-- 107_pos_search_indexes.sql — performance indexes for the tenant POS global search (build doc §16).
-- Trigram GIN indexes accelerate the case-insensitive ILIKE lookups used by the search repo. All search
-- queries remain tenant-scoped (tenant_id is always in the WHERE clause); these only speed up matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customers_fullname_trgm   ON customers   USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm      ON customers   USING gin (normalized_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm      ON customers   USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch   ON customers   (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_technicians_fullname_trgm ON technicians USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_branch ON technicians (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_services_name_trgm        ON services    USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_services_tenant_branch    ON services    (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_tickets_number_trgm       ON tickets     USING gin (ticket_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant_branch     ON tickets     (tenant_id, branch_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='appointments') THEN
    CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch ON appointments (tenant_id, branch_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pos_queue_items_tenant_branch ON pos_queue_items (tenant_id, branch_id);
