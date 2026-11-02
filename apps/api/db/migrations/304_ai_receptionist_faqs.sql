-- 304_ai_receptionist_faqs.sql — customer-facing FAQs the AI receptionist may answer. This is genuinely new data
-- (approved Q&A), NOT a duplicate of services/policies/hours — those are read from their existing sources. FAQs are
-- tenant-owned and optionally branch-scoped, versioned only by updated_at, and gated by an active flag so staff
-- control exactly what the AI is allowed to say.

CREATE TABLE IF NOT EXISTS ai_receptionist_faqs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  branch_id          UUID,                              -- NULL = applies to all branches
  question           TEXT NOT NULL,
  answer             TEXT NOT NULL,
  category           TEXT,
  language           TEXT NOT NULL DEFAULT 'en',
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID,
  updated_by_user_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_air_faqs_tenant_active ON ai_receptionist_faqs (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_air_faqs_tenant_branch ON ai_receptionist_faqs (tenant_id, branch_id);
