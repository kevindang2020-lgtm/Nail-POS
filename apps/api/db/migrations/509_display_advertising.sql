-- 509_display_advertising.sql — 23-inch dual-screen spec §47–§78, §108–§112: the salon's OWN advertising on its customer
-- display. While no checkout is active the display's right panel rotates the salon's published ads; the POS manages them
-- (Marketing & Growth → Customer Display Advertising). Owned by the marketing domain (modules/marketing), never checkout.
--
-- Isolation is enforced by the schema, not only by the service: every table carries tenant_id, and every reference
-- between them is a COMPOSITE foreign key (tenant_id, id) — an ad can only use its own salon's images, target its own
-- salon's branches and count displays from its own salon's devices, whatever a query forgets.
--
-- Images are NOT stored here: bytes live in object storage (packages/media), this table holds their keys and metadata.
-- Scheduling is evaluated in each branch's own time zone (start/end are salon calendar DATES, daily times are wall clock),
-- so there is no sweeper: SCHEDULED / ACTIVE / EXPIRED are derived from the stored status and the clock.

-- the referenced side of the composite keys ((tenant_id, id) is trivially unique: id is the primary key)
CREATE UNIQUE INDEX IF NOT EXISTS ux_branches_tenant_id ON branches (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_display_devices_tenant_id ON customer_display_devices (tenant_id, id);

-- One uploaded creative: the original plus its optimized derivatives (variants: large ≤1920 px, medium ≤1080 px,
-- thumb ≤320 px on the long edge). media_kind is the extension point for video (§50: architecture-ready, not offered).
CREATE TABLE IF NOT EXISTS display_ad_media (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  media_kind         TEXT NOT NULL DEFAULT 'image' CHECK (media_kind IN ('image')),
  mime_type          TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width              INTEGER NOT NULL CHECK (width > 0),
  height             INTEGER NOT NULL CHECK (height > 0),
  byte_size          INTEGER NOT NULL CHECK (byte_size > 0),
  total_bytes        BIGINT NOT NULL CHECK (total_bytes >= byte_size),
  sha256             TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key        TEXT NOT NULL,
  variants           JSONB NOT NULL,
  suggested_focal_x  NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (suggested_focal_x BETWEEN 0 AND 1),
  suggested_focal_y  NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (suggested_focal_y BETWEEN 0 AND 1),
  original_filename  TEXT,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT ux_display_ad_media_tenant_id UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_display_ad_media_tenant_live ON display_ad_media (tenant_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS display_ads (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name                      TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  media_id                  UUID,
  fullscreen_media_id       UUID,
  headline                  TEXT CHECK (headline IS NULL OR length(headline) <= 60),
  subheadline               TEXT CHECK (subheadline IS NULL OR length(subheadline) <= 80),
  description               TEXT CHECK (description IS NULL OR length(description) <= 200),
  cta_text                  TEXT CHECK (cta_text IS NULL OR length(cta_text) <= 40),
  qr_kind                   TEXT CHECK (qr_kind IS NULL OR qr_kind IN ('book_online', 'customer_app', 'gift_cards', 'instagram', 'membership')),
  qr_url                    TEXT CHECK (qr_url IS NULL OR (length(qr_url) <= 300 AND qr_url LIKE 'https://%')),
  fit_mode                  TEXT NOT NULL DEFAULT 'cover' CHECK (fit_mode IN ('cover', 'contain', 'smart_crop')),
  focal_x                   NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_x BETWEEN 0 AND 1),
  focal_y                   NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (focal_y BETWEEN 0 AND 1),
  start_date                DATE,
  end_date                  DATE,
  days_of_week              SMALLINT[] CHECK (days_of_week IS NULL OR days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  daily_start_time          TEXT CHECK (daily_start_time IS NULL OR daily_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  daily_end_time            TEXT CHECK (daily_end_time IS NULL OR daily_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  display_duration_seconds  INTEGER CHECK (display_duration_seconds IS NULL OR display_duration_seconds BETWEEN 5 AND 30),
  priority                  INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  all_branches              BOOLEAN NOT NULL DEFAULT true,
  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  published_at              TIMESTAMPTZ,
  paused_at                 TIMESTAMPTZ,
  archived_at               TIMESTAMPTZ,
  version                   INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by                UUID,
  updated_by                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_display_ads_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_display_ads_media FOREIGN KEY (tenant_id, media_id) REFERENCES display_ad_media (tenant_id, id),
  CONSTRAINT fk_display_ads_fullscreen_media FOREIGN KEY (tenant_id, fullscreen_media_id) REFERENCES display_ad_media (tenant_id, id),
  CONSTRAINT display_ads_date_order CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  CONSTRAINT display_ads_daily_window CHECK ((daily_start_time IS NULL) = (daily_end_time IS NULL) AND (daily_start_time IS NULL OR daily_start_time < daily_end_time)),
  -- §53 simple mode is "upload image → publish": a live ad always has its image
  CONSTRAINT display_ads_live_has_image CHECK (media_id IS NOT NULL OR status IN ('draft', 'archived'))
);
CREATE INDEX IF NOT EXISTS idx_display_ads_tenant_status ON display_ads (tenant_id, status);

-- §61/§67: SELECTED BRANCHES targeting (all_branches = false). The composite key keeps a target inside the ad's salon.
CREATE TABLE IF NOT EXISTS display_ad_branches (
  tenant_id  UUID NOT NULL,
  ad_id      UUID NOT NULL,
  branch_id  UUID NOT NULL,
  PRIMARY KEY (ad_id, branch_id),
  CONSTRAINT fk_display_ad_branches_ad FOREIGN KEY (tenant_id, ad_id) REFERENCES display_ads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_display_ad_branches_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_display_ad_branches_branch ON display_ad_branches (tenant_id, branch_id);

-- §111 "Device Configuration": a single display can be switched off for ads (default: on — no row).
CREATE TABLE IF NOT EXISTS display_ad_device_settings (
  tenant_id    UUID NOT NULL,
  device_id    UUID PRIMARY KEY,
  ads_enabled  BOOLEAN NOT NULL DEFAULT true,
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_display_ad_device_settings_device FOREIGN KEY (tenant_id, device_id) REFERENCES customer_display_devices (tenant_id, id) ON DELETE CASCADE
);

-- §108: how often each ad was DISPLAYED (never "viewed" — rendering is not attention), per device per hour. Hourly
-- roll-ups keep the table bounded (a display rotating every 10 s would otherwise write ~4,000 rows a day).
CREATE TABLE IF NOT EXISTS display_ad_display_stats (
  tenant_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  device_id       UUID NOT NULL,
  ad_id           UUID NOT NULL,
  hour_start      TIMESTAMPTZ NOT NULL,
  display_count   INTEGER NOT NULL DEFAULT 0 CHECK (display_count >= 0),
  display_ms      BIGINT NOT NULL DEFAULT 0 CHECK (display_ms >= 0),
  first_shown_at  TIMESTAMPTZ NOT NULL,
  last_shown_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ad_id, device_id, hour_start),
  CONSTRAINT fk_display_ad_stats_ad FOREIGN KEY (tenant_id, ad_id) REFERENCES display_ads (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_display_ad_stats_device FOREIGN KEY (tenant_id, device_id) REFERENCES customer_display_devices (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_display_ad_stats_tenant_hour ON display_ad_display_stats (tenant_id, hour_start);

-- A device re-sends a report batch it never got an answer for; the batch id makes the second delivery a no-op.
-- Rows are pruned per device (older than 3 days) on each report, so the table stays small without a background job.
CREATE TABLE IF NOT EXISTS display_ad_report_batches (
  tenant_id    UUID NOT NULL,
  device_id    UUID NOT NULL,
  batch_id     TEXT NOT NULL CHECK (length(batch_id) BETWEEN 8 AND 64),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, batch_id),
  CONSTRAINT fk_display_ad_batches_device FOREIGN KEY (tenant_id, device_id) REFERENCES customer_display_devices (tenant_id, id) ON DELETE CASCADE
);

-- §110/§111 platform layer: the feature exists in the registry (Super Admin → Feature Registry can disable it
-- platform-wide) and is part of every catalog plan (Super Admin can change a plan or override one salon). The numeric
-- platform limits are code defaults (packages/api-contracts DISPLAY_AD_PLATFORM_SETTINGS) until an administrator sets
-- them under Super Admin → General Settings — nothing is seeded into platform_settings (migration 202's model).
INSERT INTO platform_features (feature_key, name, description, category, status)
VALUES ('customer_display_ads', 'Customer Display Advertising', 'The salon''s own ads on the customer display while no checkout is active.', 'marketing', 'AVAILABLE')
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, state)
SELECT p.id, 'customer_display_ads', 'enabled'
FROM subscription_plans p
WHERE p.code IN ('starter', 'professional', 'premium', 'enterprise', 'unlimited')
ON CONFLICT (plan_id, feature_key) DO NOTHING;
