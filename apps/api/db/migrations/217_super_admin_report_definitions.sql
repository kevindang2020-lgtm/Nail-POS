-- 172_super_admin_report_definitions.sql — Saved Super Admin report-builder definitions.
-- Platform-scoped (Super Admin) saved reports. A definition is a validated (dimension, measure, visualization)
-- selection over the existing platform analytics aggregates, plus an optional tenant scope and range. Running a
-- definition composes from already-computed aggregates — this table stores only the *selection*, never tenant data.
--
-- Design invariants:
--   * Money is never stored here (definitions only). tenant_id is the OPTIONAL report SCOPE (NULL = all branches /
--     platform-wide), not row ownership — this is a Super Admin surface gated by SuperAdminGuard.
--   * dimension / measure / visualization are validated against the server allow-list before insert; the CHECKs
--     below are a defense-in-depth backstop, not the primary validation.

CREATE TABLE IF NOT EXISTS super_admin_report_definitions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  dimension             TEXT NOT NULL,
  measure               TEXT NOT NULL,
  visualization         TEXT NOT NULL DEFAULT 'table',
  range_key             TEXT NOT NULL DEFAULT '30d',            -- 7d | 30d | 90d | 6m | 12m
  scope_tenant_id       UUID,                                   -- NULL = platform-wide (all branches)
  filters_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_limit             INTEGER NOT NULL DEFAULT 50,
  created_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT super_admin_report_definitions_visualization_chk
    CHECK (visualization IN ('table','bar','line','donut','kpi')),
  CONSTRAINT super_admin_report_definitions_range_chk
    CHECK (range_key IN ('7d','30d','90d','6m','12m')),
  CONSTRAINT super_admin_report_definitions_limit_chk
    CHECK (row_limit BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS super_admin_report_definitions_created_at ON super_admin_report_definitions (created_at DESC);
CREATE INDEX IF NOT EXISTS super_admin_report_definitions_scope ON super_admin_report_definitions (scope_tenant_id) WHERE scope_tenant_id IS NOT NULL;
