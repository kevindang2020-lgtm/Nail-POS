-- 086_tenant_warnings.sql
-- Tenant warnings raised from Super Admin → Tenants/Salons → Quick Actions → Send Warning.
-- Notification dispatch (email/SMS) is handled downstream; this table records the warning + its delivery status.

CREATE TABLE IF NOT EXISTS tenant_warnings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id              UUID REFERENCES users(id),
  warning_type               TEXT NOT NULL DEFAULT 'custom'
                               CHECK (warning_type IN ('payment_issue','policy_violation','overdue_balance','suspicious_activity','support_notice','custom')),
  severity                   TEXT NOT NULL DEFAULT 'medium'
                               CHECK (severity IN ('low','medium','high','critical')),
  subject                    TEXT NOT NULL,
  message                    TEXT NOT NULL,
  send_email                 BOOLEAN NOT NULL DEFAULT false,
  send_sms                   BOOLEAN NOT NULL DEFAULT false,
  show_in_tenant_dashboard   BOOLEAN NOT NULL DEFAULT true,
  internal_note              TEXT,
  delivery_status            TEXT NOT NULL DEFAULT 'pending'
                               CHECK (delivery_status IN ('pending','sent','skipped','failed','recorded')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_warnings_tenant ON tenant_warnings (tenant_id, created_at DESC);
