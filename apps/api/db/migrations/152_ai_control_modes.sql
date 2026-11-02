-- 152_ai_control_modes.sql
-- Human-controlled AI operating model (spec §3–§4, §54): per-assistant control mode, stored and enforced on the
-- BACKEND (never a frontend-only toggle). One row per (tenant, assistant). Modes escalate from no autonomy to
-- pre-authorized low-risk automation; sensitive actions (§4) can never be fully autonomous regardless of mode.
-- Tenant-scoped; no rows seeded (absence => the conservative default 'recommendation_only').

CREATE TABLE IF NOT EXISTS ai_control_modes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  assistant_key       TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'recommendation_only'
                      CHECK (mode IN ('disabled','observe_only','recommendation_only','draft_only',
                                      'confirm_before_action','approval_required','approved_automation')),
  updated_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, assistant_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_control_modes_tenant ON ai_control_modes (tenant_id);
