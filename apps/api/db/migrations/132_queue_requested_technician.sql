-- 128_queue_requested_technician.sql
-- Model the guest's *requested* technician as its own first-class column on the queue item, distinct from the
-- *assigned* technician. Until now "Requested Tech" derived to the assigned tech or "Any"; this lets the front desk
-- record and change a genuine preference (or clear it to Any Available) and feeds the recommendation engine's
-- requested-tech signal accurately. Nullable + IF NOT EXISTS so the migration is safe to re-run.
ALTER TABLE pos_queue_items
  ADD COLUMN IF NOT EXISTS requested_technician_id UUID REFERENCES technicians(id);
