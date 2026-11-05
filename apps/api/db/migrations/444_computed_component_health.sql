-- 444_computed_component_health.sql — Constitution 11 §295, §332–333, §340–343, §390: computed component health.
--
-- status_components (migration 147, enriched in 247) is what the public status page reads, and until now its status
-- was TYPED BY A HUMAN — "last checked" was when someone last saved. The health aggregator now writes the computed
-- status. A human keeps exactly one lever: MAINTENANCE, which the aggregator never overrides.

-- §332: the page must be able to say it does not know. The CHECK from 147 had no such value, so the only honest
-- answer was impossible to store.
ALTER TABLE status_components DROP CONSTRAINT IF EXISTS status_components_status_check;
ALTER TABLE status_components ADD CONSTRAINT status_components_status_check
  CHECK (status IN ('operational','degraded','partial_outage','major_outage','maintenance','unknown'));

-- §342 component metadata, and where the status came from.
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS criticality          TEXT CHECK (criticality IN ('critical','important','optional'));
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS runbook              TEXT;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS status_page_visible  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS status_source        TEXT NOT NULL DEFAULT 'manual' CHECK (status_source IN ('manual','computed'));
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS reason_code          TEXT;
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS computed_at          TIMESTAMPTZ;
-- §333: when the computed status stops being trustworthy. Read after this → UNKNOWN, whatever `status` says.
ALTER TABLE status_components ADD COLUMN IF NOT EXISTS expires_at           TIMESTAMPTZ;

-- §343 / §390 health HISTORY: one row per status CHANGE, not per evaluation — a component that stays healthy for a
-- month is one row, so this stays small at any scale (§246: summaries in PostgreSQL, never the raw stream).
CREATE TABLE IF NOT EXISTS system_health_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_key  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','OUTAGE','UNKNOWN','MAINTENANCE')),
  previous       TEXT CHECK (previous IN ('HEALTHY','DEGRADED','OUTAGE','UNKNOWN','MAINTENANCE')),
  reason_code    TEXT NOT NULL,
  summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_system_health_snapshots_component ON system_health_snapshots (component_key, observed_at DESC);
