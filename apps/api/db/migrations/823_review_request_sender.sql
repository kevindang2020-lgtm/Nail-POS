-- 823_review_request_sender.sql — G8 (Nov 6 2026): the post-visit review-request sender.
-- Until now checkout scheduled review_requests rows but nothing ever sent them. The sender job (ai module,
-- ReviewRequestSenderJob) claims each due row before sending (scheduled -> sending -> sent|failed), so a crash between the
-- send and the status write can never text a customer twice. A row that waited past the freshness window is expired, not
-- sent: a "thanks for visiting" days later is noise (and every row scheduled before this job existed would otherwise fire
-- at once on the first tick). The one controlled reminder (policy.oneReminder) is recorded on reminder_sent_at.
-- New status values: sending | expired | cancelled (status is free text; the comment in 343 listed the original set).
ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS review_requests_due_all ON review_requests (scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS review_requests_reminder ON review_requests (sent_at) WHERE status = 'sent' AND reminder_sent_at IS NULL;
