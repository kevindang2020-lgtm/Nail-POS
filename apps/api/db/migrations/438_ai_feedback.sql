-- 438_ai_feedback.sql — Constitution 10 §129–§130: human feedback on AI results.
--
-- §129 "this becomes evaluation data" is the reason the edited TEXT is not stored here. What makes a correction
-- useful for evaluation is WHAT CHANGED and WHY, not the customer's words — and a table of human-edited AI
-- output is a table of customer content under another name. So: the outcome, a reason code, an optional short
-- note the STAFF member wrote, and a similarity ratio. §130's isolation is then structural, because there is no
-- cross-tenant read path and nothing here is worth pooling.

CREATE TABLE IF NOT EXISTS ai_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  branch_id       UUID,
  -- What the feedback is about. request_id ties back to the AIResult and its audit row.
  request_id      TEXT NOT NULL,
  task_key        TEXT NOT NULL,
  prompt_key      TEXT NOT NULL,
  prompt_version  INTEGER NOT NULL,
  provider        TEXT,
  model           TEXT,
  -- §129 the three outcomes. 'edited' means used after changes — the most informative of the three.
  outcome         TEXT NOT NULL CHECK (outcome IN ('accepted','edited','rejected')),
  -- A closed vocabulary, so feedback is countable. Free text goes in `note`, which is optional and staff-written.
  reason_code     TEXT CHECK (reason_code IN ('wrong_facts','wrong_tone','too_long','too_short','missing_detail','unsafe','irrelevant','other')),
  note            TEXT CHECK (note IS NULL OR length(note) <= 500),
  -- 0..1: how much of the AI draft survived the edit. Computed client-side from lengths, never the text itself.
  retained_ratio  NUMERIC(4,3) CHECK (retained_ratio IS NULL OR (retained_ratio >= 0 AND retained_ratio <= 1)),
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_id)
);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_tenant_task ON ai_feedback (tenant_id, task_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_prompt ON ai_feedback (prompt_key, prompt_version, outcome);
