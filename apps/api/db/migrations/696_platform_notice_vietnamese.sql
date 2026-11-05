-- 696_platform_notice_vietnamese.sql — English + Vietnamese POS mandate, WP-F (§56, §57): a Platform Announcement can
-- carry a Vietnamese version, written by a person (no runtime machine translation).
--
--   title_vi / message_vi   optional; same plain-text rules and limits as the English title / message (the service
--                           cleans both the same way). A POS whose language is Vietnamese shows them when present; any
--                           POS falls back to the English text otherwise.
--   vi_reviewed_by / _at    who confirmed the Vietnamese reads correctly, and when. Any change to the English or
--                           Vietnamese text clears it (a review is of one wording).
--   english_only            an explicit "this notice is English only" decision.
-- A CRITICAL notice (type maintenance / warning / urgent, or priority critical) cannot be published, or edited while
-- live, unless it has a REVIEWED Vietnamese version or is explicitly English only (enforced in platform-notice-core
-- `viProblem`; the CHECKs below keep the stored shape honest). Version / content-version / acknowledgement semantics
-- are unchanged: a change to the Vietnamese text is a material change like one to the English text.
-- The revision table needs no column: platform_notice_revisions.snapshot (JSONB) now carries the Vietnamese fields.

ALTER TABLE platform_notices ADD COLUMN IF NOT EXISTS title_vi TEXT;
ALTER TABLE platform_notices ADD COLUMN IF NOT EXISTS message_vi TEXT;
ALTER TABLE platform_notices ADD COLUMN IF NOT EXISTS vi_reviewed_by UUID;
ALTER TABLE platform_notices ADD COLUMN IF NOT EXISTS vi_reviewed_at TIMESTAMPTZ;
ALTER TABLE platform_notices ADD COLUMN IF NOT EXISTS english_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE platform_notices DROP CONSTRAINT IF EXISTS platform_notices_vi_shape;
ALTER TABLE platform_notices ADD CONSTRAINT platform_notices_vi_shape CHECK (
      (title_vi IS NULL OR char_length(title_vi) BETWEEN 1 AND 120)
  AND (message_vi IS NULL OR char_length(btrim(message_vi)) BETWEEN 1 AND 2000)
  AND (title_vi IS NULL OR message_vi IS NOT NULL)                                  -- a Vietnamese title needs its message
  AND (NOT english_only OR (title_vi IS NULL AND message_vi IS NULL))               -- English only means no Vietnamese text
  AND ((vi_reviewed_at IS NULL) = (vi_reviewed_by IS NULL))
  AND (vi_reviewed_at IS NULL OR message_vi IS NOT NULL)                            -- only a Vietnamese text can be reviewed
);
