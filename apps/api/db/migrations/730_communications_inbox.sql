-- 730_communications_inbox.sql — Communications / SMS Inbox guide (Oct 30 2026, + Claude Build Addendum §4.1–§4.3).
-- EXPAND-ONLY and idempotent: new nullable columns, one new table, one widened CHECK, indexes, and a bounded backfill of
-- the new derived columns from rows that already exist. Nothing is dropped or rewritten.
--
--   communication_threads    + contact_normalized   the thread's phone in E.164 (search + inbound matching; never put in a URL)
--                            + customer_match       how the customer link was made: exact_phone (one tenant customer had this
--                                                   number) · manual (staff linked it, audited) · ambiguous (several tenant
--                                                   customers share the number — left unlinked) · none (Unknown Contact) ·
--                                                   legacy (linked before this guide). A name alone never links a customer.
--                            + last_inbound_at / last_outbound_at
--                            + awaiting_reply_since the OLDEST customer message that has not had a qualifying STAFF reply yet
--                                                   (NULL = answered). An AI / automated reply does not clear it (§9.2).
--                            + follow_up_due_at     staff "follow up by" / snooze time (Follow-Up Due sort); nothing is sent
--                            + record_version       optimistic concurrency for read / assign / status / snooze / link
--                            + closed_at
--   communication_messages   + notification_id      the outbound text's row in the ONE SMS ledger (notifications) — delivery
--                                                   status is read from there (provider callbacks), never assumed
--                            + provider_message_sid inbound: Twilio MessageSid (unique per salon → a retried webhook is one message)
--                            + idempotency_key      outbound: one staff "Send" = one message, however often it is retried
--                            + author_kind          customer · staff · ai · system (AI / system replies are labelled apart)
--                            + media_count, error_code
--                            status CHECK widened with 'pending' (reserved before the provider call) and 'blocked'
--   communication_thread_events  read / unread / assigned / status / snoozed / customer linked — actor, before / after, time
--   notifications            + purpose              which kind of text a ledger row was (reminder, follow-up, receipt, campaign,
--                                                   conversation …) so the customer timeline labels it without a second store.
-- Recovery: revert the code; the new columns and table are then unread. Do NOT drop them (they hold message history).

ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS contact_normalized   text;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS customer_match       text;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS last_inbound_at      timestamptz;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS last_outbound_at     timestamptz;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS awaiting_reply_since timestamptz;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS follow_up_due_at     timestamptz;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS record_version       integer NOT NULL DEFAULT 1;
ALTER TABLE communication_threads ADD COLUMN IF NOT EXISTS closed_at            timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_comm_threads_customer_match') THEN
    ALTER TABLE communication_threads ADD CONSTRAINT ck_comm_threads_customer_match
      CHECK (customer_match IS NULL OR customer_match IN ('none', 'exact_phone', 'manual', 'ambiguous', 'legacy'));
  END IF;
END $$;

ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS notification_id      uuid;
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS provider_message_sid text;
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS idempotency_key      text;
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS author_kind          text;
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS media_count          integer;
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS error_code           text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_comm_messages_author_kind') THEN
    ALTER TABLE communication_messages ADD CONSTRAINT ck_comm_messages_author_kind
      CHECK (author_kind IS NULL OR author_kind IN ('customer', 'staff', 'ai', 'system'));
  END IF;
END $$;
-- widen (never narrow) the message status vocabulary: 'pending' = reserved before the provider call, 'blocked' = refused
-- before any provider call (opted out, sender not ready, no credits)
ALTER TABLE communication_messages DROP CONSTRAINT IF EXISTS chk_communication_messages_status_vocab;
ALTER TABLE communication_messages ADD CONSTRAINT chk_communication_messages_status_vocab
  CHECK (status IN ('delivered', 'failed', 'read', 'sent', 'pending', 'blocked'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_messages_inbound_sid ON communication_messages (tenant_id, provider_message_sid)
  WHERE provider_message_sid IS NOT NULL AND direction = 'inbound';
CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_messages_idempotency ON communication_messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_messages_notification ON communication_messages (tenant_id, notification_id) WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_messages_body_trgm ON communication_messages USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_activity ON communication_threads (tenant_id, last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_awaiting ON communication_threads (tenant_id, awaiting_reply_since, id) WHERE awaiting_reply_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_followup ON communication_threads (tenant_id, follow_up_due_at, id) WHERE follow_up_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_contact ON communication_threads (tenant_id, contact_normalized) WHERE contact_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_threads_tenant_customer ON communication_threads (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_threads_name_trgm ON communication_threads USING gin (customer_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS communication_thread_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  thread_id      uuid NOT NULL,
  event_type     text NOT NULL CHECK (event_type IN ('read', 'unread', 'assigned', 'status_changed', 'snoozed', 'customer_linked')),
  actor_user_id  uuid,
  actor_kind     text NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('staff', 'system')),
  previous_value text,
  new_value      text,
  reason         text,
  correlation_id text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comm_thread_events_thread ON communication_thread_events (tenant_id, thread_id, created_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS purpose text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notifications_purpose') THEN
    ALTER TABLE notifications ADD CONSTRAINT ck_notifications_purpose
      CHECK (purpose IS NULL OR purpose IN ('receipt', 'reminder', 'followup', 'marketing', 'account', 'notification', 'conversation'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_customer ON notifications (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

-- ── bounded backfill of the derived columns (existing rows only; message rows are not touched) ──
UPDATE communication_threads t SET contact_normalized = CASE
    WHEN length(regexp_replace(t.customer_contact, '\D', '', 'g')) = 10 THEN '+1' || regexp_replace(t.customer_contact, '\D', '', 'g')
    WHEN length(regexp_replace(t.customer_contact, '\D', '', 'g')) BETWEEN 11 AND 15 THEN '+' || regexp_replace(t.customer_contact, '\D', '', 'g')
    ELSE NULL END
  WHERE t.contact_normalized IS NULL AND t.channel IN ('sms', 'call') AND t.customer_contact IS NOT NULL;
UPDATE communication_threads t SET customer_match = CASE WHEN t.customer_id IS NULL THEN 'none' ELSE 'legacy' END WHERE t.customer_match IS NULL;
UPDATE communication_threads t SET
    last_inbound_at  = m.last_in,
    last_outbound_at = m.last_out,
    awaiting_reply_since = CASE WHEN m.last_in IS NOT NULL AND (m.last_out IS NULL OR m.last_out < m.last_in) THEN m.first_open_in ELSE NULL END
  FROM (
    SELECT x.thread_id, x.tenant_id,
      max(x.created_at) FILTER (WHERE x.direction = 'inbound')  AS last_in,
      max(x.created_at) FILTER (WHERE x.direction = 'outbound') AS last_out,
      min(x.created_at) FILTER (WHERE x.direction = 'inbound' AND x.created_at > COALESCE(
        (SELECT max(o.created_at) FROM communication_messages o WHERE o.thread_id = x.thread_id AND o.tenant_id = x.tenant_id AND o.direction = 'outbound'),
        '-infinity'::timestamptz)) AS first_open_in
    FROM communication_messages x GROUP BY x.thread_id, x.tenant_id
  ) m
  WHERE m.thread_id = t.id AND m.tenant_id = t.tenant_id AND t.last_inbound_at IS NULL AND t.last_outbound_at IS NULL;
