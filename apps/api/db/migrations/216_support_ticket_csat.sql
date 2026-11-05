-- 180_support_ticket_csat.sql — capture a customer satisfaction rating on resolved/closed support tickets. The rating
-- is submitted by the tenant that owns the ticket (never fabricated); the Support Center dashboard reads the average.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_score        SMALLINT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_comment      TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_csat_score_range') THEN
    ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_csat_score_range CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_support_tickets_csat ON support_tickets (tenant_id, csat_score) WHERE csat_score IS NOT NULL;
