-- 833_tenant_indexes.sql — F5 §254 (Nov 6 2026): the database matrix found seven tables with tenant_id and no index leading with it.
-- Every read of them filters by tenant_id (check:tenant), so as a salon grows those reads would scan. Additive, idempotent.
CREATE INDEX IF NOT EXISTS ix_loyalty_fraud_alerts_tenant ON loyalty_fraud_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS ix_realtime_stream_tickets_tenant ON realtime_stream_tickets (tenant_id);
CREATE INDEX IF NOT EXISTS ix_rewards_journal_entries_tenant ON rewards_journal_entries (tenant_id);
CREATE INDEX IF NOT EXISTS ix_rewards_journal_lines_tenant ON rewards_journal_lines (tenant_id);
CREATE INDEX IF NOT EXISTS ix_rewards_recon_findings_tenant ON rewards_recon_findings (tenant_id);
CREATE INDEX IF NOT EXISTS ix_telemetry_spans_tenant ON telemetry_spans (tenant_id);
CREATE INDEX IF NOT EXISTS ix_token_purchase_events_tenant ON token_purchase_events (tenant_id);
