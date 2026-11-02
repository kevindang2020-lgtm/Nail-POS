-- 676_booking_drafts.sql — B-22 (Oct 22 2026, Kevin: "use the recommended"): POS "Save Draft" makes a REAL draft.
-- Until now the button booked a real appointment with "[DRAFT]" in the notes (it took the slot, reminded the guest,
-- counted in the KPIs). A draft is now a booking_holds row of kind 'draft': it carries the whole New Booking form
-- (draft_payload), never names a technician (so the no-overlap exclusion and the hold gate ignore it — it blocks nothing),
-- expires on its own (7 days, the hold sweep) and converts by being booked normally from the POS, which then discards it.
-- Expand only: every existing row is kind 'slot' and behaves exactly as before.
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'slot';
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS draft_payload JSONB;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS draft_title TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_kind_check') THEN
    ALTER TABLE booking_holds ADD CONSTRAINT booking_holds_kind_check CHECK (kind IN ('slot', 'draft'));
  END IF;
END $$;
-- a draft never carries a technician: the slot exclusion (372) and the live-hold gate stay about real holds
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_draft_no_technician') THEN
    ALTER TABLE booking_holds ADD CONSTRAINT booking_holds_draft_no_technician CHECK (kind <> 'draft' OR technician_id IS NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_booking_holds_live_drafts ON booking_holds (tenant_id, branch_id, created_at DESC)
  WHERE kind = 'draft' AND released_at IS NULL AND converted_appointment_id IS NULL;
