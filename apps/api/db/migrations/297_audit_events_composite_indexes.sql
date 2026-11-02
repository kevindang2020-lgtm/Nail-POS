-- 297_audit_events_composite_indexes.sql — Scaling Roadmap Phase 1.3 (audit_events).
-- Live EXPLAIN (ANALYZE, BUFFERS) on a 3M-row audit_events tenant showed that filtered-and-sorted audit views
-- (WHERE tenant_id=? AND module=? ORDER BY occurred_at DESC LIMIT n, and the same for severity) walked the
-- (tenant_id, occurred_at) index and discarded non-matching rows — up to ~23GB of buffer reads for a selective
-- filter over a deep time range. The fix is composite indexes that carry occurred_at as the trailing sort column so
-- the filter stays an index range AND the ORDER BY is satisfied by the index:
--   before (module filter):   ~394 buffers common / ~3,007,013 worst case
--   after:                    ~54 buffers common / ~375,737 worst case  (module-ranged)
--   severity filter:          ~268 -> ~53 buffers
-- The default recent-page view (no filter) is unchanged — it still uses idx_audit_events_tenant_occurred.
--
-- The pre-existing single-column idx_audit_events_tenant_module and idx_audit_events_tenant_severity become redundant:
-- the new composites share the same leading prefix (tenant_id, module) / (tenant_id, severity), so any query they
-- served is served by the composite. Dropping them reclaims ~51MB and keeps write amplification flat.
--
-- CONCURRENTLY is preferred in production to avoid write locks; run outside a transaction there. Written plainly here
-- to match the repo's straight-line migration style.

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_module_occurred
  ON audit_events (tenant_id, module, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_severity_occurred
  ON audit_events (tenant_id, severity, occurred_at DESC);

DROP INDEX IF EXISTS idx_audit_events_tenant_module;
DROP INDEX IF EXISTS idx_audit_events_tenant_severity;

ANALYZE audit_events;
