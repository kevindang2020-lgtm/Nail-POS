-- 057: human-friendly per-branch daily ticket numbers.
-- tickets.ticket_number holds the displayed sequence (e.g. '014'); the counter table allocates it atomically per
-- (tenant, branch, business_date) so numbers are stable, collision-free, and reset each day per location.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;

CREATE TABLE IF NOT EXISTS ticket_number_counters (
  tenant_id     UUID        NOT NULL,
  branch_id     UUID        NOT NULL,
  business_date DATE        NOT NULL,
  last_seq      INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, business_date)
);
