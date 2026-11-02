-- 736_coupon_assistant_drafts.sql — Coupons & Promotions Management Center guide (30 Oct 2026) §16 "AI Coupon & Promotion
-- Assistant with approval". ADDITIVE, insert-only.
--
--   coupon_assistant_drafts  one row per assistant suggestion an owner/manager turned into a DRAFT coupon: the goal, the
--                            salon data the suggestion was computed from (basis), the suggested terms, the terms the
--                            person actually saved (final) and which fields they changed. The coupon itself is an ordinary
--                            `deals` row (kind 'coupon', status 'draft'); activating it is the normal Publish lifecycle
--                            action (owner/manager permission, audited there). This table never sends, prices or
--                            activates anything. Rows are never updated: a later edit is a new deal version.

CREATE TABLE IF NOT EXISTS coupon_assistant_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  deal_id             UUID NOT NULL REFERENCES deals(id),
  goal                TEXT NOT NULL CHECK (goal IN ('slow_weekdays', 'promote_service', 'returning_visits', 'reconnect_inactive')),
  method              TEXT NOT NULL DEFAULT 'rules-v1',            -- how the suggestion was computed (no AI provider call)
  basis_json          JSONB NOT NULL DEFAULT '{}'::jsonb,           -- the salon facts it used (counts, ids — no PII)
  suggested_json      JSONB NOT NULL,
  final_json          JSONB NOT NULL,
  edited_fields       TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_assistant_drafts_tenant ON coupon_assistant_drafts (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_coupon_assistant_drafts_deal ON coupon_assistant_drafts (tenant_id, deal_id);
