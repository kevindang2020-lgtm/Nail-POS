-- 719_commission_reviews_shift_overrides_scores.sql — the five owner-approved features of 30 Oct 2026 (Finish the Five
-- Unfinished Features). EXPAND-ONLY and idempotent: only new tables, indexes and triggers. No existing row, column,
-- commission snapshot, adjustment, payout, rating, appointment or weekly schedule is read, rewritten or dropped.
--
--   F1/F2  commission_discrepancy_reviews        one persisted review per finding (stable fingerprint per tenant);
--          commission_discrepancy_review_events  its append-only history (every assign / investigate / note / resolve /
--                                                dismiss / reopen, with actor, old → new status, reason, request id);
--          commission_discrepancy_scan_runs      each Run Check (who, when, period, counts) — the last-run timestamp.
--          A review is WORKFLOW ONLY: nothing here pays, deducts, refunds, voids or edits a ledger row.
--   F3     no new table: export attempts are rows in the existing append-only audit_events (module 'reports',
--          action report.export.requested / succeeded / failed / denied).
--   F4     technician_shift_overrides         one date-specific override per technician / salon-local date / branch
--                                             (CUSTOM_SHIFT | DAY_OFF; RESTORE_BASELINE clears it); the weekly
--                                             technician_schedules template is never touched;
--          technician_shift_override_events   its append-only history (before → after of every save and restore).
--   F5     performance_score_snapshots        append-only saved composite scores (model version, components, samples,
--                                             missing-data flags, input checksum). A snapshot is never rewritten, so a
--                                             historic model version keeps its meaning.
--
-- Recovery: every table is new. Rolling back the code leaves these tables unread; nothing must be dropped, and dropping
-- them would destroy review decisions — the documented plan is forward-fix only (docs/handoff/FIVE_FEATURES_2026-10-30.md).

-- ── F1 / F2 ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_discrepancy_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  branch_id            uuid,
  finding_fingerprint  text NOT NULL,
  finding_type         text NOT NULL,
  verification_state   text NOT NULL DEFAULT 'CONFIRMED',
  status               text NOT NULL DEFAULT 'OPEN',
  severity             text NOT NULL DEFAULT 'medium',
  severity_reason      text,
  technician_id        uuid,
  service_line_id      uuid,
  transaction_id       uuid,                  -- the ticket (POS transaction) the finding concerns
  refund_id            uuid,
  period_ref           text,                  -- payroll period id for a payout finding
  expected_cents       bigint,
  recorded_cents       bigint,
  difference_cents     bigint,
  summary              text NOT NULL,
  evidence_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_user_id  uuid,
  assigned_at          timestamptz,
  investigating_at     timestamptz,
  resolution_code      text,
  resolution_note      text,
  resolved_at          timestamptz,
  resolved_by          uuid,
  dismiss_reason       text,
  dismissed_at         timestamptz,
  dismissed_by         uuid,
  version              integer NOT NULL DEFAULT 1,
  detected_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  scan_run_id          uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_commission_review_fingerprint UNIQUE (tenant_id, finding_fingerprint),
  CONSTRAINT uq_commission_review_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_commission_review_status CHECK (status IN ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED')),
  CONSTRAINT ck_commission_review_type CHECK (finding_type IN ('RATE_CONFIG', 'REFUND_REVERSAL', 'DUPLICATE_LINE', 'MISSING_TECHNICIAN',
    'TIP_MISMATCH', 'EARNINGS_OVER_BASE', 'PAYOUT_MISMATCH')),
  CONSTRAINT ck_commission_review_verification CHECK (verification_state IN ('CONFIRMED', 'POLICY_NOT_CONFIGURED', 'REVIEW_REQUIRED')),
  CONSTRAINT ck_commission_review_severity CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT ck_commission_review_resolution CHECK (resolution_code IS NULL OR resolution_code IN ('NO_ACTION', 'CORRECTED_SEPARATELY', 'FALSE_POSITIVE')),
  CONSTRAINT ck_commission_review_lengths CHECK (length(finding_fingerprint) BETWEEN 1 AND 300 AND length(summary) <= 500
    AND (resolution_note IS NULL OR length(resolution_note) <= 2000) AND (dismiss_reason IS NULL OR length(dismiss_reason) <= 2000)
    AND (severity_reason IS NULL OR length(severity_reason) <= 300)),
  CONSTRAINT ck_commission_review_version CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_cdr_status_detected ON commission_discrepancy_reviews (tenant_id, status, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_detected ON commission_discrepancy_reviews (tenant_id, detected_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cdr_assignee ON commission_discrepancy_reviews (tenant_id, assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_cdr_technician ON commission_discrepancy_reviews (tenant_id, technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdr_ticket ON commission_discrepancy_reviews (tenant_id, transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commission_discrepancy_review_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  branch_id          uuid,
  review_id          uuid NOT NULL,
  actor_user_id      uuid,
  event_type         text NOT NULL,
  old_status         text,
  new_status         text,
  reason             text,
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- the review must belong to the SAME tenant (a plain uuid would not guarantee it)
  CONSTRAINT fk_cdr_event_review FOREIGN KEY (tenant_id, review_id) REFERENCES commission_discrepancy_reviews (tenant_id, id),
  CONSTRAINT ck_cdr_event_type CHECK (event_type IN ('DETECTED', 'ASSIGNED', 'INVESTIGATION_STARTED', 'NOTE_ADDED', 'RESOLVED', 'DISMISSED', 'REOPENED', 'RESEEN', 'DENIED')),
  CONSTRAINT ck_cdr_event_lengths CHECK ((reason IS NULL OR length(reason) <= 2000) AND (request_id IS NULL OR length(request_id) <= 100))
);
CREATE INDEX IF NOT EXISTS idx_cdr_events_review ON commission_discrepancy_review_events (tenant_id, review_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS commission_discrepancy_scan_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid,
  actor_user_id uuid,
  period_from   date,
  period_to     date,
  status        text NOT NULL DEFAULT 'running',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  summary_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    text,
  CONSTRAINT ck_cdr_scan_status CHECK (status IN ('running', 'succeeded', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_cdr_scan_runs ON commission_discrepancy_scan_runs (tenant_id, started_at DESC, id DESC);

-- ── F4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS technician_shift_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  branch_id        uuid NOT NULL,
  technician_id    uuid NOT NULL,
  local_shift_date date NOT NULL,
  timezone         text NOT NULL,
  override_type    text NOT NULL,
  start_local_time time,
  end_local_time   time,
  ends_next_day    boolean NOT NULL DEFAULT false,
  breaks_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  note             text,
  version          integer NOT NULL DEFAULT 1,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tso_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  CONSTRAINT uq_tso_tech_date UNIQUE (tenant_id, branch_id, technician_id, local_shift_date),
  CONSTRAINT uq_tso_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT ck_tso_type CHECK (override_type IN ('CUSTOM_SHIFT', 'DAY_OFF')),
  CONSTRAINT ck_tso_times CHECK ((override_type = 'DAY_OFF' AND start_local_time IS NULL AND end_local_time IS NULL AND ends_next_day = false)
    OR (override_type = 'CUSTOM_SHIFT' AND start_local_time IS NOT NULL AND end_local_time IS NOT NULL
        AND (ends_next_day OR end_local_time > start_local_time) AND (NOT ends_next_day OR end_local_time <= start_local_time))),
  CONSTRAINT ck_tso_lengths CHECK ((note IS NULL OR length(note) <= 500) AND length(timezone) BETWEEN 1 AND 64 AND jsonb_typeof(breaks_json) = 'array'),
  CONSTRAINT ck_tso_version CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS idx_tso_date ON technician_shift_overrides (tenant_id, local_shift_date, technician_id);

CREATE TABLE IF NOT EXISTS technician_shift_override_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  branch_id        uuid,
  technician_id    uuid NOT NULL,
  local_shift_date date NOT NULL,
  action           text NOT NULL,
  before_json      jsonb,
  after_json       jsonb,
  reason           text,
  actor_user_id    uuid,
  request_id       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tsoe_action CHECK (action IN ('SAVED', 'RESTORED_BASELINE')),
  CONSTRAINT ck_tsoe_lengths CHECK ((reason IS NULL OR length(reason) <= 500) AND (request_id IS NULL OR length(request_id) <= 100))
);
CREATE INDEX IF NOT EXISTS idx_tsoe_tech_date ON technician_shift_override_events (tenant_id, technician_id, local_shift_date, created_at DESC, id DESC);

-- ── F5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_score_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  branch_id       uuid,
  technician_id   uuid NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  model_version   text NOT NULL,
  components_json jsonb NOT NULL,
  missing_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  score           numeric(5, 1),
  input_checksum  text NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  computed_by     uuid,
  CONSTRAINT ck_pss_score CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT ck_pss_period CHECK (period_end >= period_start),
  CONSTRAINT ck_pss_lengths CHECK (length(model_version) BETWEEN 1 AND 40 AND length(input_checksum) BETWEEN 1 AND 128)
);
CREATE INDEX IF NOT EXISTS idx_pss_tech ON performance_score_snapshots (tenant_id, technician_id, computed_at DESC, id DESC);

-- ── append-only guards (a correction is a new row) ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION five_features_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS trg_cdr_events_append_only ON commission_discrepancy_review_events;
CREATE TRIGGER trg_cdr_events_append_only BEFORE UPDATE OR DELETE ON commission_discrepancy_review_events FOR EACH ROW EXECUTE FUNCTION five_features_append_only();
DROP TRIGGER IF EXISTS trg_tsoe_append_only ON technician_shift_override_events;
CREATE TRIGGER trg_tsoe_append_only BEFORE UPDATE OR DELETE ON technician_shift_override_events FOR EACH ROW EXECUTE FUNCTION five_features_append_only();
DROP TRIGGER IF EXISTS trg_pss_append_only ON performance_score_snapshots;
CREATE TRIGGER trg_pss_append_only BEFORE UPDATE OR DELETE ON performance_score_snapshots FOR EACH ROW EXECUTE FUNCTION five_features_append_only();

-- a review is never deleted (resolved and dismissed reviews stay in history)
CREATE OR REPLACE FUNCTION commission_review_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'commission_discrepancy_reviews rows are never deleted'; END $$;
DROP TRIGGER IF EXISTS trg_cdr_no_delete ON commission_discrepancy_reviews;
CREATE TRIGGER trg_cdr_no_delete BEFORE DELETE ON commission_discrepancy_reviews FOR EACH ROW EXECUTE FUNCTION commission_review_no_delete();

-- the audit_events export history lookups (F3)
CREATE INDEX IF NOT EXISTS idx_audit_events_report_exports ON audit_events (tenant_id, occurred_at DESC, id DESC) WHERE module = 'reports';
