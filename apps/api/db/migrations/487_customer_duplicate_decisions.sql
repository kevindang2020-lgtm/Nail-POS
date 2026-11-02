-- 487_customer_duplicate_decisions.sql — Functional Decision 29: duplicate profiles go through a MANUAL review queue
-- with Merge / Keep Separate / Not Sure. Duplicates are re-detected on every read, so without a remembered decision a
-- pair the owner already judged to be two different people would come back forever. One row per PAIR (ids ordered).
CREATE TABLE IF NOT EXISTS customer_duplicate_decisions (
  tenant_id    UUID        NOT NULL,
  customer_a   UUID        NOT NULL,
  customer_b   UUID        NOT NULL,
  decision     TEXT        NOT NULL CHECK (decision IN ('keep_separate', 'not_sure')),
  decided_by   UUID,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_a, customer_b),
  CHECK (customer_a < customer_b)
);
