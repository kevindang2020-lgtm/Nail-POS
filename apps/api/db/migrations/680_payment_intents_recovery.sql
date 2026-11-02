-- 680_payment_intents_recovery.sql — Remaining-work mandate P1-2 / B-80 (Oct 23 2026): a Skip-the-Line app payment whose
-- processor answer was lost or unknown stayed 'processing' with nobody to settle it. The intent now records WHEN the card
-- was actually sent to the processor (charge_started_at — before that, 'processing' only means the guest is looking at
-- the bill), the processor's reference once known, who settled it and the last inquiry, so staff Verify and the stranded
-- sweep can ask the processor (inquireByOrderid with the intent id as the order id) and settle it — never charge again.
-- EXPAND-ONLY, idempotent, nullable columns; older rows stay NULL (unknown, never back-filled with a guess).
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS charge_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processor_ref TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS settled_by TEXT,
  ADD COLUMN IF NOT EXISTS last_inquired_at TIMESTAMPTZ;
-- the sweep's population: app charges still 'processing' after the card was sent, oldest first
CREATE INDEX IF NOT EXISTS idx_payment_intents_charge_open ON payment_intents (charge_started_at) WHERE status = 'processing' AND charge_started_at IS NOT NULL;
