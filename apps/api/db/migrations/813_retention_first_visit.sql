-- 813_retention_first_visit.sql — C5 gap (Nov 5 2026): the First Visit Invitation audience. A customer who HAS visited is not
-- invited to a first visit: their recipient row is recorded with eligibility 'has_visited' (excluded, like any other reason).
ALTER TABLE retention_sms_recipients DROP CONSTRAINT IF EXISTS retention_sms_recipients_eligibility_check;
ALTER TABLE retention_sms_recipients ADD CONSTRAINT retention_sms_recipients_eligibility_check CHECK (eligibility = ANY (ARRAY[
  'eligible', 'no_phone', 'invalid_phone', 'no_consent', 'opted_out', 'recently_contacted', 'never_visited', 'not_found',
  'duplicate_destination', 'upcoming_booking', 'has_visited']::text[]));
