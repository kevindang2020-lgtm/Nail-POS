-- 375_check_constraint_drift.sql -- CHECK constraints that forbid values the code actually writes.
--
-- == FOUND BY `npm run check:impossible` ===================================================================
--
-- These are not "queries that return nothing". They are WRITES THAT THROW, and two of them are billing.
--
-- 1. notification_delivery_logs.channel had CHECK (channel IN ('sms','email')).
--
--    `push.kysely.repository.logDelivery()` inserts `channel: 'push'`. The insert therefore VIOLATED THE CHECK
--    and threw -- and the call is wrapped in `.catch(() => {})` ("logging is best-effort"), so it was swallowed
--    in silence.
--
--    Consequence: **push notification delivery has NEVER been logged.** Every push metric on the Communications
--    screen reads 0, forever, and reads exactly like "we sent no push notifications" rather than "we never
--    recorded any".
--
-- 2. tenant_subscriptions.status had CHECK (status IN ('active','trialing','past_due','expired','cancelled')).
--
--    billing.kysely.repository writes BOTH:
--        UPDATE tenant_subscriptions SET status='paused' ...                (pause a subscription)
--        UPDATE tenant_subscriptions SET status='pending_cancellation' ...  (cancel at period end)
--
--    Both violated the CHECK. Both threw. Inside a transaction, so the whole operation rolled back.
--
--    Consequence: **pausing a subscription and scheduling a cancellation were both broken** -- two billing
--    operations a Super Admin would reasonably believe worked.
--
-- 3. notification_delivery_logs.status: the Communications overview counts 'suppressed'/'blocked', which the
--    CHECK never allowed. That one is a READ, so it silently returned 0 -- a salon looking at deliverability saw
--    "0 suppressed", which reads as "nothing is being blocked" rather than "we do not track that".
--
-- 4. hardware_packages: the alert queried status = 'pending'; the real value is 'pending_approval'. That is a
--    CODE bug, not a schema one, and is fixed in the code -- an alert that never fires is worse than no alert,
--    because it reassures.
--
-- The CODE is right in every case here. It implements features the platform genuinely has. The SCHEMA is behind.

-- -- notification_delivery_logs: push is a real channel; suppression is a real outcome ---------------------
ALTER TABLE notification_delivery_logs DROP CONSTRAINT IF EXISTS notification_delivery_logs_channel_check;
ALTER TABLE notification_delivery_logs
  ADD CONSTRAINT notification_delivery_logs_channel_check
  CHECK (channel IN ('sms','email','push'));

ALTER TABLE notification_delivery_logs DROP CONSTRAINT IF EXISTS notification_delivery_logs_status_check;
ALTER TABLE notification_delivery_logs
  ADD CONSTRAINT notification_delivery_logs_status_check
  CHECK (status IN ('queued','sent','delivered','failed','suppressed','blocked'));

-- -- tenant_subscriptions: pause and scheduled cancellation are real states ------------------------------
ALTER TABLE tenant_subscriptions DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check;
ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_status_check
  CHECK (status IN ('active','trialing','past_due','expired','cancelled','paused','pending_cancellation'));
