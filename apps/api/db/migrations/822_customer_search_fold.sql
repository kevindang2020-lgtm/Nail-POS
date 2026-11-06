-- 822_customer_search_fold.sql — Customer Directory mandate (F1) §79 (Nov 6 2026): the directory search at 100,000
-- customers. Folding every customer's searchable text with vi_fold() on every search cost ~6 s on a real PostgreSQL 16
-- (vi_fold is a long translate() + regexp; ~60 µs a row). The folded text is now kept on the row, so a search is a plain
-- LIKE over a short stored string.
--
-- search_fold   = vi_fold(the same fields, in the same order, the directory searched before): "first last", first, last,
--                 preferred name, the displayed phone, email — joined by chr(1) so a pattern never matches across two
--                 fields. Tags live in customer_tags and are folded at query time (few rows carry tags).
-- search_digits = the digits of the displayed phone, chr(1), the digits of the normalized phone (the phone search).
--
-- Maintained by a trigger, so every writer (POS, Owner, Customer App sign-up, imports, merges) keeps it without code
-- changes. Stored names are never changed (WP-E §42): this is only a search key. Nullable with no default, so adding the
-- columns does not rewrite the table; the backfill then updates each row once.
-- Equivalence with the query-time fold is tested (customers customer-directory-search-fold.pgtest).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS search_fold text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS search_digits text;

CREATE OR REPLACE FUNCTION customer_search_fold(first_name text, last_name text, preferred_name text, phone_display text, normalized_phone text, email text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT vi_fold(concat_ws(chr(1), coalesce(first_name, '') || ' ' || coalesce(last_name, ''), first_name, last_name, preferred_name,
    coalesce(nullif(phone_display, ''), nullif(normalized_phone, ''), ''), email))
$$;

CREATE OR REPLACE FUNCTION customer_search_digits(phone_display text, normalized_phone text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(nullif(phone_display, ''), nullif(normalized_phone, ''), ''), '\D', '', 'g') || chr(1)
    || regexp_replace(coalesce(normalized_phone, ''), '\D', '', 'g')
$$;

CREATE OR REPLACE FUNCTION trg_customers_search_fold() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_fold := customer_search_fold(NEW.first_name, NEW.last_name, NEW.preferred_name, NEW.phone_display, NEW.normalized_phone, NEW.email);
  NEW.search_digits := customer_search_digits(NEW.phone_display, NEW.normalized_phone);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_customers_search_fold ON customers;
CREATE TRIGGER trg_customers_search_fold BEFORE INSERT OR UPDATE OF first_name, last_name, preferred_name, phone_display, normalized_phone, email
  ON customers FOR EACH ROW EXECUTE FUNCTION trg_customers_search_fold();

UPDATE customers
   SET search_fold = customer_search_fold(first_name, last_name, preferred_name, phone_display, normalized_phone, email),
       search_digits = customer_search_digits(phone_display, normalized_phone)
 WHERE search_fold IS NULL OR search_digits IS NULL;
