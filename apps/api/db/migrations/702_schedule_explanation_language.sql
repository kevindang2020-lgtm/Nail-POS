-- 702_schedule_explanation_language.sql — English + Vietnamese POS mandate §120 (Oct 27 2026): the language a stored
-- scheduling explanation was written in.
--
-- The AI gateway now writes model prose in the reader's POS language (the user's choice, else the salon's default — see
-- modules/ai/src/ai/ai-response-language.ts). A recommendation's explanation is stored once and read by everyone on the
-- floor, so the row records WHICH language it holds: the POS shows it as is in that language, labels it in the other, and
-- "Explain again" re-asks in the reader's language. NULL = written before this column (English). Additive, nullable,
-- no default, no back-fill: a metadata-only change.
ALTER TABLE schedule_optimization_recommendations
  ADD COLUMN IF NOT EXISTS explanation_language text;

ALTER TABLE schedule_optimization_recommendations
  DROP CONSTRAINT IF EXISTS sched_opt_recs_explanation_language_check;
ALTER TABLE schedule_optimization_recommendations
  ADD CONSTRAINT sched_opt_recs_explanation_language_check
  CHECK (explanation_language IS NULL OR explanation_language IN ('en', 'vi')) NOT VALID;
ALTER TABLE schedule_optimization_recommendations
  VALIDATE CONSTRAINT sched_opt_recs_explanation_language_check;
