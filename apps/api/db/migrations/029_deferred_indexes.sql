-- 029_deferred_indexes.sql — cross-feature indexes relocated here so they run AFTER every referenced table exists.
-- (The per-feature bundles each declared indexes on other bundles' tables, which broke a single-sequence apply.)

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_technician_start
  ON appointments (tenant_id, branch_id, technician_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_tech_start
  ON appointments (tenant_id, branch_id, technician_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_customer_start
  ON appointments (tenant_id, branch_id, customer_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointment_lines_tenant_branch_service
  ON appointment_service_lines (tenant_id, branch_id, service_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_start_status
  ON appointments (tenant_id, branch_id, start_time, status);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_branch_created
  ON reviews (tenant_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch_created
  ON payments (tenant_id, branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_date_status
  ON appointments (tenant_id, branch_id, start_time, status);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch_created_method
  ON payments (tenant_id, branch_id, created_at, method);

-- Service-done indexes relocated from 025 and remapped to the canonical `tickets` table
-- (025 mistakenly targeted a non-existent `pos_tickets`; `completed_at` is `service_done_at` on tickets).
CREATE INDEX IF NOT EXISTS idx_tickets_service_done
  ON tickets (tenant_id, branch_id, service_done_checkout_status, service_done_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_send_key
  ON tickets (tenant_id, service_done_send_idempotency_key)
  WHERE service_done_send_idempotency_key IS NOT NULL;
