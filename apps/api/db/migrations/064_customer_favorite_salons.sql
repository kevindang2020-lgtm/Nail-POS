-- 064_customer_favorite_salons.sql — salon-level favorites (build doc §17/§21).
-- Keyed by the customer's USER id (per-tenant identity today); salon_id is the public directory id (branch UUID).
CREATE TABLE IF NOT EXISTS customer_favorite_salons (
  user_id UUID NOT NULL,
  salon_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, salon_id)
);
CREATE INDEX IF NOT EXISTS idx_cfs_user ON customer_favorite_salons (user_id);
