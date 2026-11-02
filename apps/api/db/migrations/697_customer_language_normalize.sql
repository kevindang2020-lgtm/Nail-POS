-- 697_customer_language_normalize.sql — English + Vietnamese POS mandate, WP-I (§54–§55, §118–§119): a customer's
-- communication language is 'en' or 'vi' (or NULL = no preference → English), so reminders and receipts can be written
-- in the CUSTOMER's language — never the language of the employee at the desk.
--
-- customers.preferred_language (490) was free text (≤ 40 characters, copied from the notes form). Safe mapping, using
-- vi_fold (694) so "Tiếng Việt" / "tieng viet" / "Vietnamese" / "vi-VN" all fold the same way (the TypeScript twin is
-- normalizeCustomerLanguage in packages/api-contracts/src/language.ts — same lists):
--   Vietnamese spellings → 'vi'   English spellings → 'en'   blank → NULL
--   anything else (e.g. "Spanish", "Vietnamese / English") → NULL, and the ORIGINAL text is kept in the customer's notes
--   (notes_json.preferredLanguage, where it was typed before 490) when that note is empty — staff still see it; nothing is lost.
-- Then CHECK (preferred_language IS NULL OR IN ('en','vi')), added NOT VALID and validated (no long lock).

-- 1. keep what will not map, in the notes (only where the note has no language of its own)
UPDATE customers
   SET notes_json = coalesce(notes_json, '{}'::jsonb) || jsonb_build_object('preferredLanguage', btrim(preferred_language))
 WHERE preferred_language IS NOT NULL AND btrim(preferred_language) <> ''
   AND vi_fold(preferred_language) NOT IN ('vi', 'vi-vn', 'vi_vn', 'vn', 'viet', 'vietnamese', 'vietnam', 'viet nam', 'tieng viet',
                                           'en', 'en-us', 'en_us', 'en-gb', 'en_gb', 'en-ca', 'en-au', 'eng', 'english', 'tieng anh')
   AND btrim(coalesce(notes_json ->> 'preferredLanguage', '')) = '';

-- 2. map
UPDATE customers
   SET preferred_language = CASE
         WHEN vi_fold(preferred_language) IN ('vi', 'vi-vn', 'vi_vn', 'vn', 'viet', 'vietnamese', 'vietnam', 'viet nam', 'tieng viet') THEN 'vi'
         WHEN vi_fold(preferred_language) IN ('en', 'en-us', 'en_us', 'en-gb', 'en_gb', 'en-ca', 'en-au', 'eng', 'english', 'tieng anh') THEN 'en'
         ELSE NULL END
 WHERE preferred_language IS NOT NULL AND preferred_language NOT IN ('en', 'vi');

-- 3. constrain
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_preferred_language_chk') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_preferred_language_chk CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'vi')) NOT VALID;
  END IF;
END $$;
ALTER TABLE customers VALIDATE CONSTRAINT customers_preferred_language_chk;
