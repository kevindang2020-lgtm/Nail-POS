-- 133_bundles.sql — Bundles / Packages / Membership Add-ons for the tenant Services & Products module.
-- A bundle groups N service/product components at a fixed price; the SAVINGS shown to staff/customers is derived from
-- the per-item regular-price SNAPSHOTS captured in bundle_items (never a live cross-table join), keeping savings
-- deterministic and auditable. branch_id NULL = tenant-wide bundle; otherwise the bundle is scoped to that branch
-- (location-specific). Money is integer cents. starts_at/ends_at bound limited-time / seasonal bundles.

CREATE TABLE IF NOT EXISTS bundles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  branch_id               UUID,                              -- NULL = tenant-wide
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL DEFAULT 'bundle',    -- 'bundle' | 'package' | 'membership' | 'promo'
  label                   TEXT,                              -- display badge: 'Best Seller' | 'Popular' | 'Seasonal' | …
  price_cents             INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'inactive' | 'archived'
  online_booking_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at               TIMESTAMPTZ,
  ends_at                 TIMESTAMPTZ,
  usage_limit             INTEGER,
  metric_note             TEXT,
  created_by_user_id      UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at             TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  bundle_id         UUID NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  item_type         TEXT NOT NULL,                           -- 'service' | 'product'
  ref_id            UUID,                                    -- service_id or product_id; NULL for a free-text component
  label             TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price_cents  INTEGER NOT NULL DEFAULT 0,              -- regular-price snapshot at configuration time
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundles_scope ON bundles (tenant_id, branch_id, status);
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items (tenant_id, bundle_id, sort_order);
