-- 486_staff_roles.sql — Functional Decision 12, step 2: storage for staff role templates.
--
-- The ten default roles are defined in code (packages/permissions role-templates.ts) — every salon gets the same
-- vocabulary. A salon's OWN roles (e.g. "Assistant Manager", "Front Desk Lead") live here. Each assignment is per
-- (tenant, user): a person can work at more than one salon, so the role cannot sit on the global users row.
-- A template only ever NARROWS its base role (enforced in code at create time and again at sign-in).
CREATE TABLE IF NOT EXISTS tenant_custom_roles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  name         TEXT        NOT NULL,
  base_role    TEXT        NOT NULL,
  scope        TEXT        NOT NULL CHECK (scope IN ('OWN', 'BRANCH', 'SELECTED_BRANCHES', 'TENANT')),
  permissions  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);
-- one live role per name per salon (an archived one keeps its name for history)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_custom_roles_name_live ON tenant_custom_roles (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_role_assignments (
  tenant_id     UUID        NOT NULL,
  user_id       UUID        NOT NULL,
  template_key  TEXT        NOT NULL,     -- a default key ('ACCOUNTANT', …) or 'custom:<tenant_custom_roles.id>'
  assigned_by   UUID,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
