-- 421_customer_global_identity.sql — global customer identity layer (Kevin's sync spec, Jul 26 2026).
--
-- ARCHITECTURE: `customers` stays exactly what it is — the TENANT RELATIONSHIP (notes, opt-ins, preferences,
-- history all live there and in satellite tables, and are NEVER copied between salons). This migration adds the
-- identity layer ABOVE it: one global_customers row per real person, a link row per (tenant, customer), plus the
-- reconciliation run history and the conflict queue. Additive only; nothing existing changes.

CREATE TABLE IF NOT EXISTS global_customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name         TEXT,
  last_name          TEXT,
  full_name          TEXT,
  normalized_phone   TEXT,                    -- E.164 via the ONE shared normalizer
  phone_display      TEXT,
  phone_verified_at  TIMESTAMPTZ,
  email              TEXT,                    -- canonical (lowercased) for matching
  email_verified_at  TIMESTAMPTZ,
  avatar_url         TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','archived')),
  merged_into_id     UUID REFERENCES global_customers(id),   -- reversible-merge pointer; originals never destroyed
  version            INTEGER NOT NULL DEFAULT 1,             -- §30 optimistic concurrency
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- §8: the race collapses at the database. Two salons creating the same VERIFIED identity concurrently — one
-- insert wins, the other gets a unique violation, re-looks-up, and LINKS. Partial: unverified values may coexist
-- (they become review candidates, never hard failures).
CREATE UNIQUE INDEX IF NOT EXISTS ux_global_customers_verified_phone
  ON global_customers (normalized_phone) WHERE phone_verified_at IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_global_customers_verified_email
  ON global_customers (email) WHERE email_verified_at IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS ix_global_customers_phone ON global_customers (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_global_customers_email ON global_customers (email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_global_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  customer_id         UUID NOT NULL UNIQUE REFERENCES customers(id),   -- one link per tenant customer
  global_customer_id  UUID NOT NULL REFERENCES global_customers(id),
  confidence          TEXT NOT NULL CHECK (confidence IN ('very_strong','strong','medium','manual')),
  source              TEXT NOT NULL CHECK (source IN ('realtime','reconciliation','manual','activation','import')),
  linked_run_id       UUID,
  linked_by_user_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cgl_global ON customer_global_links (global_customer_id);
CREATE INDEX IF NOT EXISTS ix_cgl_tenant ON customer_global_links (tenant_id);

CREATE TABLE IF NOT EXISTS customer_recon_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger       TEXT NOT NULL CHECK (trigger IN ('scheduled','manual')),
  scope         TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','tenant','customer')),
  scope_id      UUID,                                       -- tenant_id or customer_id when scoped
  status        TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','COMPLETED_WITH_ISSUES','PARTIAL','FAILED')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  cursor_from   TIMESTAMPTZ,                                -- §29 incremental window start (records changed since)
  tenants_scanned INTEGER NOT NULL DEFAULT 0,
  customers_scanned INTEGER NOT NULL DEFAULT 0,
  new_globals   INTEGER NOT NULL DEFAULT 0,
  linked_existing INTEGER NOT NULL DEFAULT 0,
  profiles_synced INTEGER NOT NULL DEFAULT 0,
  duplicates_prevented INTEGER NOT NULL DEFAULT 0,
  duplicate_suspects INTEGER NOT NULL DEFAULT 0,
  conflicts     INTEGER NOT NULL DEFAULT 0,
  links_repaired INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  error_detail  TEXT,
  triggered_by_user_id UUID
);
CREATE INDEX IF NOT EXISTS ix_crr_started ON customer_recon_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS customer_recon_tenant_stats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL REFERENCES customer_recon_runs(id),
  tenant_id    UUID NOT NULL,
  customers_scanned INTEGER NOT NULL DEFAULT 0,
  new_globals  INTEGER NOT NULL DEFAULT 0,
  linked_existing INTEGER NOT NULL DEFAULT 0,
  profiles_synced INTEGER NOT NULL DEFAULT 0,
  duplicate_suspects INTEGER NOT NULL DEFAULT 0,
  conflicts    INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','skipped')),
  error_detail TEXT,
  UNIQUE (run_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS customer_identity_conflicts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint         TEXT NOT NULL UNIQUE,                 -- dedupe across nights (same conflict = one row)
  kind                TEXT NOT NULL,                        -- §13 codes: DUPLICATE_SUSPECTED, CONFLICT, VERIFICATION_MISMATCH, …
  tenant_id           UUID,
  customer_id         UUID,
  global_customer_id  UUID,
  other_global_customer_id UUID,
  field               TEXT,
  main_value_masked   TEXT,                                 -- §23: stored masked; raw values live on the source rows
  tenant_value_masked TEXT,
  confidence          TEXT,
  recommended_action  TEXT,
  status              TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWING','RESOLVED','MERGED','KEEP_SEPARATE','IGNORED','FALSE_POSITIVE')),
  occurrences         INTEGER NOT NULL DEFAULT 1,
  first_seen_run      UUID,
  last_seen_run       UUID,
  resolved_by_user_id UUID,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cic_status ON customer_identity_conflicts (status);

-- §29/§32: the incremental cursor needs a fast "changed since" path per tenant.
CREATE INDEX IF NOT EXISTS ix_customers_tenant_updated ON customers (tenant_id, updated_at DESC);
