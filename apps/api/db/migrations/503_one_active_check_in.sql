-- 503_one_active_check_in.sql — Check-In & Display spec §20, §106, §178–§179: ONE active queue entry per appointment and
-- per walk-in customer, enforced by the database.
--
-- Why here: the check-in service's duplicate guards are in-process Maps (apptCheckInIndex, walkInIdemIndex). Each API
-- instance and each kiosk session has its own, so ten kiosks checking the same appointment in at the same instant
-- created ten queue entries, and one customer walking in on ten kiosks got ten (check-in-concurrency.postgres-race,
-- 10/10 before this migration). A partial unique index is the only guard every connection shares.
--
-- Scope: rows created from Oct 5 2026 (a literal, so the predicate is immutable). Legacy duplicates stay as they are —
-- a migration must not cancel operational history — and the service resolves "which one" for new rows by returning the
-- existing active entry.
--
-- Active = not finished. Finished: completed, done, cancelled, removed (the status CHECK's own vocabulary).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_active_appointment
  ON pos_queue_items (tenant_id, appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status NOT IN ('completed', 'done', 'cancelled', 'removed')
    AND created_at >= TIMESTAMPTZ '2026-10-05 00:00:00+00';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_queue_active_walk_in_customer
  ON pos_queue_items (tenant_id, customer_id)
  WHERE appointment_id IS NULL AND customer_id IS NOT NULL
    AND status NOT IN ('completed', 'done', 'cancelled', 'removed')
    AND created_at >= TIMESTAMPTZ '2026-10-05 00:00:00+00';
