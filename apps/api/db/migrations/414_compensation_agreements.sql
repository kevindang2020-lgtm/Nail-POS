-- 414_compensation_agreements.sql — a technician's compensation terms captured as a versioned, acknowledgeable agreement
-- (spec §19). The owner records the terms (commission split, classification, guarantee notes, etc.) as a snapshot; the
-- technician later acknowledges it (sign-off). Effective-dated + versioned + auditable: a new agreement for the same
-- technician supersedes the prior one, and acknowledged agreements are retained as history. terms_json is a free-form
-- snapshot of what was agreed. This records the parties' agreement — it does not itself change how pay is computed.

CREATE TABLE IF NOT EXISTS compensation_agreements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  technician_id   UUID NOT NULL,
  title           TEXT NOT NULL,
  terms_json      JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','acknowledged','superseded')),
  version         INTEGER NOT NULL DEFAULT 1,
  effective_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID
);
CREATE INDEX IF NOT EXISTS idx_comp_agreements_tech ON compensation_agreements (tenant_id, technician_id, status);
