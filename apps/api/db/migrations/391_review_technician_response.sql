-- 391_review_technician_response.sql — Technician Social Profile, Phase 3 (additive). A technician may post ONE public
-- response to a review on their global profile. The response is a separate field from the customer's own comment/rating
-- (which the technician can never edit); it rides the same is_hidden_by_manager moderation as the review it answers.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS technician_response TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS technician_response_at TIMESTAMPTZ;
