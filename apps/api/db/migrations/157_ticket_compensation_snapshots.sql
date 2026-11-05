-- 157_ticket_compensation_snapshots.sql — the IMMUTABLE per-(ticket, service-line, technician) compensation snapshot
-- (spec §14). When a ticket is paid, the canonical engine's result is frozen here so historical tickets are NEVER
-- recomputed when a future commission/supply/guarantee rule changes (§5/§14). One row per technician share of a line —
-- the atomic, reconcilable unit. Idempotent on (tenant, ticket, line, technician): a retried checkout never duplicates.
-- Money is integer cents (§25). Adjustments are NEVER applied in place — they go to a separate adjustment ledger (P7),
-- preserving the original row. Tenant/branch scoped; no rows seeded.

CREATE TABLE IF NOT EXISTS ticket_compensation_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  branch_id                   UUID,
  ticket_id                   UUID NOT NULL,
  service_line_id             UUID NOT NULL,
  technician_id               UUID,
  service_id                  UUID,
  -- provenance (§4/§14)
  engine_version              TEXT NOT NULL,
  policy_id                   TEXT,
  policy_version              INTEGER,
  commission_source           TEXT,
  -- line money (integer cents)
  gross_price_cents           BIGINT NOT NULL DEFAULT 0,
  discount_cents              BIGINT NOT NULL DEFAULT 0,
  discount_funding            TEXT,
  tax_cents                   BIGINT NOT NULL DEFAULT 0,
  supply_cents                BIGINT NOT NULL DEFAULT 0,
  commissionable_cents        BIGINT NOT NULL DEFAULT 0,
  -- split (this technician's share of the line)
  commission_type             TEXT,
  commission_value            NUMERIC(12,4),
  tech_service_earnings_cents BIGINT NOT NULL DEFAULT 0,
  salon_service_share_cents   BIGINT NOT NULL DEFAULT 0,
  -- tips kept whole, salon 0 (§12)
  card_tip_cents              BIGINT NOT NULL DEFAULT 0,
  cash_tip_cents              BIGINT NOT NULL DEFAULT 0,
  retail_commission_cents     BIGINT NOT NULL DEFAULT 0,
  -- when the compensation applied (service/payment date — used for as-of period reads)
  snapshot_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ticket_id, service_line_id, technician_id)
);
CREATE INDEX IF NOT EXISTS idx_comp_snap_ticket    ON ticket_compensation_snapshots (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_comp_snap_tech_time ON ticket_compensation_snapshots (tenant_id, technician_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_snap_branch    ON ticket_compensation_snapshots (tenant_id, branch_id, snapshot_at DESC);
