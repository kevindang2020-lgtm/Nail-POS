-- 308_audit_events_module_occurred_index.sql — scale index for cross-tenant, module-scoped audit rollups (e.g. the
-- Super Admin Reception Copilot usage aggregate: WHERE module = 'reception_copilot' AND occurred_at >= <window>
-- GROUP BY action, tenant_id). The existing audit_events indexes are all tenant_id-leading, so a cross-tenant query
-- filtering only by module could not use them and would scan the whole table. At 10k+ tenants and millions of events
-- that scan is the bottleneck; a module-leading index makes the query index-supported and time-bounded.
CREATE INDEX IF NOT EXISTS idx_audit_events_module_occurred ON audit_events (module, occurred_at DESC);
