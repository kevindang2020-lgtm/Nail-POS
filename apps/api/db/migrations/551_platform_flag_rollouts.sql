-- 551_platform_flag_rollouts.sql — BUILD_PLAN Phase 11 (Constitution 4 §76: feature flags with percentage and
-- selected-tenant rollout, and a per-flag kill).
--
-- One row per flag key that has a rollout policy. The key is either a platform feature (platform_features.feature_key,
-- resolved by FeatureRegistry.resolve) or a boolean platform setting read through PlatformFlagService.isEnabledFor
-- (e.g. 'rate_limit.tenant_api_enabled'). No row = no rollout restriction (100 %, nobody denied, not killed), so every
-- flag behaves exactly as before this migration until a Super Admin sets a policy.
--
-- Decision order (pure, `rolloutDecision` in apps/api/src/common/platform-flags.ts — the one copy):
--   killed → OFF for everyone · tenant in deny list → OFF · tenant in allow list → ON ·
--   bucket(hash(flag_key + ':' + tenant_id) % 100) < rollout_percent → ON · else OFF.
-- The bucket is deterministic: raising the percentage only ever ADDS tenants; it never reshuffles who already has it.
--
-- Changes are made only by the Super Admin API (step-up + reason + audit_logs row); `version` is an optimistic lock.
CREATE TABLE IF NOT EXISTS platform_flag_rollouts (
  flag_key          text PRIMARY KEY CHECK (flag_key ~ '^[a-z][a-z0-9_.]{1,99}$'),
  rollout_percent   smallint NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  allow_tenant_ids  uuid[] NOT NULL DEFAULT '{}',
  deny_tenant_ids   uuid[] NOT NULL DEFAULT '{}',
  killed            boolean NOT NULL DEFAULT false,
  reason            text CHECK (reason IS NULL OR length(reason) <= 500),
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  CONSTRAINT platform_flag_rollouts_lists_small CHECK (cardinality(allow_tenant_ids) <= 1000 AND cardinality(deny_tenant_ids) <= 1000)
);
