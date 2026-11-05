-- 818_platform_advertising_policy.sql — Global Advertising + Tenant Control guide (Nov 5 2026, G7).
--
-- ONE master switch, Super Admin only: Allow Tenant Advertising.
--   ON  (allow_tenant_advertising = true)  → TENANT_ONLY   — each salon's own published ads (509), exactly as today
--   OFF (allow_tenant_advertising = false) → PLATFORM_ONLY — every idle customer display plays AI PowerSalon's campaigns
-- Never mixed. The row starts ON so nothing changes for any salon until Super Admin switches it. Tenant campaigns are never
-- deleted, unpublished or rewritten by the switch — they are simply not played (and not editable) while it is OFF.
--
-- platform_ad_media / platform_display_ads mirror display_ad_media / display_ads (509) WITHOUT a tenant: the same
-- validation, the same playlist builder and the same display DTO serve both owners. Branch targeting does not apply to
-- platform campaigns (they play on every eligible display); schedules are evaluated in each display's branch time zone.
--
-- customer_display_devices gains what the display last APPLIED (policy version + mode + when) — the Super Admin fleet
-- status counts a display as "policy applied" only from this acknowledgment, never from a sent message.

CREATE TABLE IF NOT EXISTS advertising_global_policy (
  id                        smallint PRIMARY KEY DEFAULT 1,
  allow_tenant_advertising  boolean NOT NULL DEFAULT true,
  version                   integer NOT NULL DEFAULT 1,
  effective_at              timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid,
  reason                    text,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_agp_singleton CHECK (id = 1),
  CONSTRAINT chk_agp_reason CHECK (reason IS NULL OR length(reason) <= 500)
);
INSERT INTO advertising_global_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS advertising_policy_events (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                   integer NOT NULL,
  from_mode                 text NOT NULL,
  to_mode                   text NOT NULL,
  reason                    text NOT NULL,
  actor_user_id             uuid,
  preview                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ape_modes CHECK (from_mode IN ('PLATFORM_ONLY', 'TENANT_ONLY') AND to_mode IN ('PLATFORM_ONLY', 'TENANT_ONLY'))
);
CREATE OR REPLACE FUNCTION ape_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'advertising_policy_events is append-only' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_ape_append_only ON advertising_policy_events;
CREATE TRIGGER trg_ape_append_only BEFORE UPDATE OR DELETE ON advertising_policy_events FOR EACH ROW EXECUTE FUNCTION ape_append_only();

CREATE TABLE IF NOT EXISTS platform_ad_media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime_type          text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width              integer NOT NULL CHECK (width > 0),
  height             integer NOT NULL CHECK (height > 0),
  byte_size          integer NOT NULL CHECK (byte_size > 0),
  total_bytes        bigint NOT NULL CHECK (total_bytes >= byte_size),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key        text NOT NULL,
  variants           jsonb NOT NULL,
  suggested_focal_x  numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (suggested_focal_x BETWEEN 0 AND 1),
  suggested_focal_y  numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (suggested_focal_y BETWEEN 0 AND 1),
  original_filename  text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid
);

CREATE TABLE IF NOT EXISTS platform_display_ads (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  media_id                  uuid REFERENCES platform_ad_media (id),
  headline                  text CHECK (headline IS NULL OR length(headline) <= 60),
  subheadline               text CHECK (subheadline IS NULL OR length(subheadline) <= 80),
  description               text CHECK (description IS NULL OR length(description) <= 200),
  cta_text                  text CHECK (cta_text IS NULL OR length(cta_text) <= 40),
  qr_kind                   text CHECK (qr_kind IS NULL OR qr_kind IN ('book_online', 'customer_app', 'gift_cards', 'instagram', 'membership')),
  qr_url                    text CHECK (qr_url IS NULL OR (length(qr_url) <= 300 AND qr_url LIKE 'https://%')),
  fit_mode                  text NOT NULL DEFAULT 'contain' CHECK (fit_mode IN ('cover', 'contain', 'smart_crop')),
  focal_x                   numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_x BETWEEN 0 AND 1),
  focal_y                   numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_y BETWEEN 0 AND 1),
  start_date                date,
  end_date                  date,
  days_of_week              smallint[] CHECK (days_of_week IS NULL OR days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  daily_start_time          text CHECK (daily_start_time IS NULL OR daily_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  daily_end_time            text CHECK (daily_end_time IS NULL OR daily_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  display_duration_seconds  integer CHECK (display_duration_seconds IS NULL OR display_duration_seconds BETWEEN 5 AND 120),
  priority                  integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  published_at              timestamptz,
  paused_at                 timestamptz,
  archived_at               timestamptz,
  version                   integer NOT NULL DEFAULT 1,
  created_by                uuid,
  updated_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pda_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_pda_published_media CHECK (status <> 'published' OR media_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_pda_status ON platform_display_ads (status, priority DESC, published_at);

CREATE TABLE IF NOT EXISTS platform_ad_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id              uuid,
  action             text NOT NULL,
  actor_user_id      uuid,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS applied_ad_policy_version integer;
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS applied_ad_mode text;
ALTER TABLE customer_display_devices ADD COLUMN IF NOT EXISTS applied_ad_at timestamptz;
ALTER TABLE customer_display_devices DROP CONSTRAINT IF EXISTS chk_cdd_applied_mode;
ALTER TABLE customer_display_devices ADD CONSTRAINT chk_cdd_applied_mode CHECK (applied_ad_mode IS NULL OR applied_ad_mode IN ('PLATFORM_ONLY', 'TENANT_ONLY'));
