-- 050_marketing_opt_in.sql — give the customer's "Marketing offers" preference a real home. It was being accepted by
-- the profile API but silently dropped (no column), making the toggle a no-op. Persist it like the other opt-ins.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;
