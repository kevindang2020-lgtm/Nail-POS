-- 168_service_done_lock.sql — formal, auditable Service Done lock (epic Req §5). Distinct from checkout's locked_total_cents
-- (a payment-time lock). When a ticket is sent to Service Done it is locked: who/when + the subtotal snapshot are recorded,
-- and ALL further edits are blocked until an audited reopen clears these. Nullable; cleared on reopen.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_done_locked_at          TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_done_locked_by_user_id  UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS service_done_locked_total_cents INTEGER;
