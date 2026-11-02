-- 750_birthday_campaigns.sql — Birthday Campaigns guide (Oct 31 2026).
--
--   customers.birthday_year_known   false = only the month/day is known; the DATE is stored on the leap year 2000 (so
--                                   02-29 fits) and the year is never shown or used for an age. Existing rows: true, except
--                                   the CSV import's old 1900 sentinel rows, which are marked false (dates kept as stored).
--   customers.birthday_source       who recorded it: staff | customer_app | import | created; NULL = recorded before 750
--                                   (shown as "Not recorded", never guessed). Set by the staff birthday edit, the customer
--                                   app profile edit and the CSV import.
--   customers.birthday_updated_at / _by   the last change (the edit itself is also in the audit log).
--   tenant_birthday_settings        the salon's Feb 29 policy for non-leap years (feb28 | mar1), versioned.
--   campaigns.occasion              'birthday' when the campaign's audience came from the Birthday Campaign Assistant —
--                                   the send worker then enforces one birthday message per customer per occasion year.
--   birthday_message_claims         that rule: claimed in the database BEFORE the provider call (unique per salon +
--                                   customer + occasion year + channel); a send that fails is released so a later
--                                   campaign may try again; a sent claim blocks every other birthday campaign that year.
--
-- Additive only. Rollback:
--   DROP TABLE birthday_message_claims; DROP TABLE tenant_birthday_settings; ALTER TABLE campaigns DROP COLUMN occasion;
--   ALTER TABLE customers DROP COLUMN birthday_year_known, DROP COLUMN birthday_source, DROP COLUMN birthday_updated_at,
--   DROP COLUMN birthday_updated_by; DROP INDEX ix_customers_birthday_md;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_year_known boolean NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_source text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_updated_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday_updated_by uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_customers_birthday_source') THEN
    ALTER TABLE customers ADD CONSTRAINT ck_customers_birthday_source CHECK (birthday_source IS NULL OR birthday_source IN ('staff', 'customer_app', 'import', 'created'));
  END IF;
END $$;
-- the CSV import used to store a month/day-only birthday on the sentinel year 1900: mark those year-unknown (the stored
-- date is kept — never rewritten); from 750 on a month/day-only birthday is stored on 2000 (a leap year, so 02-29 fits).
UPDATE customers SET birthday_year_known = false WHERE birthday IS NOT NULL AND EXTRACT(YEAR FROM birthday) = 1900 AND birthday_year_known;
CREATE INDEX IF NOT EXISTS ix_customers_birthday_md ON customers (tenant_id, (EXTRACT(MONTH FROM birthday)), (EXTRACT(DAY FROM birthday))) WHERE birthday IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_birthday_settings (
  tenant_id      uuid PRIMARY KEY REFERENCES tenants(id),
  feb29_policy   text NOT NULL DEFAULT 'feb28' CHECK (feb29_policy IN ('feb28', 'mar1')),
  version        integer NOT NULL DEFAULT 1,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS occasion text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_campaigns_occasion') THEN
    ALTER TABLE campaigns ADD CONSTRAINT ck_campaigns_occasion CHECK (occasion IS NULL OR occasion IN ('birthday'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS birthday_message_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  customer_id     uuid NOT NULL,
  occasion_year   integer NOT NULL CHECK (occasion_year BETWEEN 2000 AND 2200),
  channel         text NOT NULL CHECK (channel IN ('sms', 'email')),
  campaign_id     uuid NOT NULL,
  status          text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'released')),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_birthday_message_claims UNIQUE (tenant_id, customer_id, occasion_year, channel)
);
CREATE INDEX IF NOT EXISTS ix_birthday_message_claims_campaign ON birthday_message_claims (tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS ix_birthday_message_claims_year ON birthday_message_claims (tenant_id, occasion_year, status);
