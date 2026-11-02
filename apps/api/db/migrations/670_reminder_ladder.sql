-- 670_reminder_ladder.sql — Oct 14 build plan §54 ("reminder ladder 24 h / 2 h / 30 min"), rebuilt Oct 21 2026.
-- A salon reminds at several RUNGS before the appointment, each once. The old single lead_minutes stays the one rung of a
-- salon that never set a ladder (NULL); the sent log is per (appointment, rung).
ALTER TABLE reminder_settings ADD COLUMN IF NOT EXISTS ladder_minutes INT[];
-- expand: the rung joins the sent log's key. Existing rows were the single lead rung of their salon at the time — keep
-- them under their salon's lead_minutes so a ladder's first rung is not re-sent to guests already reminded.
ALTER TABLE appointment_reminders_sent ADD COLUMN IF NOT EXISTS lead_minutes INT NOT NULL DEFAULT 1440;
UPDATE appointment_reminders_sent s SET lead_minutes = COALESCE((SELECT r.lead_minutes FROM reminder_settings r WHERE r.tenant_id = s.tenant_id), 1440);
ALTER TABLE appointment_reminders_sent DROP CONSTRAINT IF EXISTS appointment_reminders_sent_pkey;
ALTER TABLE appointment_reminders_sent ADD CONSTRAINT appointment_reminders_sent_pkey PRIMARY KEY (tenant_id, appointment_id, lead_minutes);
