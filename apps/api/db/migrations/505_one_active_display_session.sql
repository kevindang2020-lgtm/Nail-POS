-- 505_one_active_display_session.sql — Check-In & Display spec §85–§86, §180: a customer display shows ONE checkout.
-- Before this, starting checkout on a display always inserted a new session and the display rendered the newest, so a
-- second station sharing the display silently replaced the first customer's ticket — even mid-payment
-- (display-reservation.postgres-race, 3/3 before the fix). The service now reserves the display under a row lock;
-- this partial unique index is the backstop every connection shares.
--
-- Scope: sessions created from Oct 5 2026 (a literal keeps the predicate immutable) — legacy rows are not judged.
-- Active = not closed (closed_at null) and not in a terminal state ('closed' / 'disconnected').
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_display_one_active_session
  ON customer_display_sessions (display_device_id)
  WHERE display_device_id IS NOT NULL AND closed_at IS NULL
    AND state NOT IN ('closed', 'disconnected')
    AND created_at >= TIMESTAMPTZ '2026-10-05 00:00:00+00';
