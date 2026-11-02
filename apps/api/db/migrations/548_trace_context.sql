-- 548_trace_context.sql — BUILD_PLAN Phase 11 (Constitution 4 §101, Constitution 11 §16–19): distributed tracing.
--
-- A job and an outbox event run LATER, often in another process, than the request that caused them. To keep
-- request → job and request → event → consumer in ONE trace, the enqueuing/writing span's W3C `traceparent`
-- (00-<trace id>-<span id>-<flags>) is stored beside the work, and the job span / consumer span continues it
-- (@aipowersalon/observability runJob / runEventConsumer). It is an id, never data: no PII, no secret.
--
-- Nullable: rows written before this migration, or outside any request/job (a scheduler tick), carry none and start
-- their own trace, exactly as before. The CHECK keeps the column to the W3C shape so nothing else is smuggled in.
-- Idempotent; a fresh database defers nothing.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS traceparent text;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS traceparent text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_traceparent_w3c') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_traceparent_w3c CHECK (traceparent IS NULL OR traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outbox_events_traceparent_w3c') THEN
    ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_traceparent_w3c CHECK (traceparent IS NULL OR traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN jobs.traceparent IS 'W3C traceparent of the span that enqueued the job (Phase 11 tracing); the job span continues that trace.';
COMMENT ON COLUMN outbox_events.traceparent IS 'W3C traceparent of the span that wrote the event (Phase 11 tracing); consumers continue that trace.';
