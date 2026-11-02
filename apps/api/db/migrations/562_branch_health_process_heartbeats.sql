-- 562_branch_health_process_heartbeats.sql — BUILD_PLAN Phase 14 B (Constitution 11 §345 branch health snapshot, §152–154
-- storage / mobile / deployment dashboards, §49 CPU / memory / storage metrics).
--
-- branch_health_snapshots — §345 "similarly branch": one row per BRANCH per 15-minute slot, written by the
--   `branch.health_snapshot.tenant` queue job (one job per active salon per slot — the Phase 11 tenant-partitioned
--   pattern). Facts, not a score: open tickets, queue length + longest wait, technicians on shift, payments in the last
--   hour (count / failed), devices online (displays, kiosks) and terminals paired, the last realtime event, SMS sent /
--   failed in the last hour. NULL means NOT MEASURED (no source, or the fact query failed — named in failed_queries),
--   never a zero. overall_status is derived from those facts by the same pure code the API tests; the unique
--   (branch_id, snapshot_slot) makes a second worker or a retry a no-op. Super Admin reads it worst first; an owner reads
--   only their own salon's branches.
CREATE TABLE IF NOT EXISTS branch_health_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id                   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  observed_at                 TIMESTAMPTZ NOT NULL,
  snapshot_slot               TIMESTAMPTZ NOT NULL,
  overall_status              TEXT NOT NULL CHECK (overall_status IN ('HEALTHY', 'DEGRADED', 'OUTAGE', 'UNKNOWN')),
  reasons                     TEXT[] NOT NULL DEFAULT '{}',
  open_tickets                INTEGER CHECK (open_tickets IS NULL OR open_tickets >= 0),
  queue_waiting               INTEGER CHECK (queue_waiting IS NULL OR queue_waiting >= 0),
  queue_longest_wait_seconds  INTEGER CHECK (queue_longest_wait_seconds IS NULL OR queue_longest_wait_seconds >= 0),
  technicians_on_shift        INTEGER CHECK (technicians_on_shift IS NULL OR technicians_on_shift >= 0),
  payments_last_hour          INTEGER CHECK (payments_last_hour IS NULL OR payments_last_hour >= 0),
  payments_failed_last_hour   INTEGER CHECK (payments_failed_last_hour IS NULL OR payments_failed_last_hour >= 0),
  displays_total              INTEGER CHECK (displays_total IS NULL OR displays_total >= 0),
  displays_online             INTEGER CHECK (displays_online IS NULL OR displays_online >= 0),
  kiosks_total                INTEGER CHECK (kiosks_total IS NULL OR kiosks_total >= 0),
  kiosks_online               INTEGER CHECK (kiosks_online IS NULL OR kiosks_online >= 0),
  terminals_paired            INTEGER CHECK (terminals_paired IS NULL OR terminals_paired >= 0),
  last_realtime_event_at      TIMESTAMPTZ,
  sms_sent_last_hour          INTEGER CHECK (sms_sent_last_hour IS NULL OR sms_sent_last_hour >= 0),
  sms_failed_last_hour        INTEGER CHECK (sms_failed_last_hour IS NULL OR sms_failed_last_hour >= 0),
  failed_queries              TEXT[] NOT NULL DEFAULT '{}',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_branch_health_snapshots_slot ON branch_health_snapshots (branch_id, snapshot_slot);
CREATE INDEX IF NOT EXISTS idx_branch_health_snapshots_tenant ON branch_health_snapshots (tenant_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_branch_health_snapshots_observed ON branch_health_snapshots (observed_at);

-- process_heartbeats — one row per PROCESS BOOT (API or worker), refreshed every minute by that process. It is the
--   deployment history (§154: version, commit, environment, started, last seen → uptime; a boot whose heartbeat stopped
--   is a process that ended) and the fleet-wide home of the per-process registry numbers the dashboards need (§49 RSS /
--   heap / CPU, §145 Redis per role, §152 storage ops, §149–150 provider latency + breaker, webhook counters, mobile
--   client counters): `metrics` is a compact digest of THIS process's counters since it started — labels are the
--   registry's (no tenant, no id, ever). Platform-global: no tenant column. Pruned after 30 days (retention-policy.json).
CREATE TABLE IF NOT EXISTS process_heartbeats (
  boot_id               UUID PRIMARY KEY,
  process_role          TEXT NOT NULL CHECK (process_role IN ('all', 'api', 'worker')),
  instance              TEXT NOT NULL CHECK (length(instance) <= 120),
  version               TEXT NOT NULL CHECK (length(version) <= 60),
  git_commit            TEXT NOT NULL CHECK (length(git_commit) <= 60),
  deployment            TEXT NOT NULL CHECK (length(deployment) <= 60),
  environment           TEXT NOT NULL CHECK (length(environment) <= 40),
  started_at            TIMESTAMPTZ NOT NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL,
  schema_latest         TEXT,
  schema_pending        INTEGER,
  rss_bytes             BIGINT,
  heap_used_bytes       BIGINT,
  cpu_user_seconds      DOUBLE PRECISION,
  cpu_system_seconds    DOUBLE PRECISION,
  event_loop_p99_seconds DOUBLE PRECISION,
  metrics               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_process_heartbeats_seen ON process_heartbeats (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_process_heartbeats_started ON process_heartbeats (started_at DESC);
