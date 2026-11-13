-- 911_approval_escalation.sql — Approvals Management Authorization Center 01, points 2–3 (round 10, Nov 13 2026).
-- Point 2 "urgent escalation without auto-approving": a pending request can be marked URGENT (who, when, why). It stays
-- pending — the same approver key, separation and limit rules decide it; nothing is approved or executed by escalating.
-- The approvers hear about it in the salon's existing alert feed (owner_alerts, category 'approval_escalated').
-- Point 3 (platform guardrails) needs no schema: it reads platform_settings 'approvals.tenant_guardrails'.
-- Additive, nullable, no backfill. Idempotent.
ALTER TABLE tenant_approval_requests ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ NULL;
ALTER TABLE tenant_approval_requests ADD COLUMN IF NOT EXISTS escalated_by_user_id UUID NULL;
ALTER TABLE tenant_approval_requests ADD COLUMN IF NOT EXISTS escalation_reason TEXT NULL;
CREATE INDEX IF NOT EXISTS ix_tenant_approval_requests_escalated ON tenant_approval_requests (tenant_id, escalated_at DESC) WHERE status = 'pending' AND escalated_at IS NOT NULL;
