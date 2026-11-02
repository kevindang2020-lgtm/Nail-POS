-- 530_authorization_version_overrides.sql — BUILD_PLAN Phase 9 (Constitution 2, Permissions) — the authorization core.
--
-- 1. An AUTHORIZATION VERSION per salon and per user. Every change that can alter what someone may do bumps it IN THE
--    DATABASE (triggers below), so no code path can forget: a user's role / status / home branch / platform role, their
--    template assignment, their branch access, their permission overrides; a salon's custom-role definitions bump the
--    salon's version (everyone on that template). Sessions carry the versions they were minted with; a request whose
--    session is older is re-authorized from the current grants (the API never trusts stale claims).
-- 2. Per-user permission OVERRIDES: an explicit ALLOW (incl. a TEMPORARY grant with expires_at) or an explicit DENY (deny
--    always wins). Capped by the salon's safety rules in code (no override may grant a super_admin.* key; an ALLOW may not
--    exceed what the granting actor holds).
-- 3. user_branch_access made consistent: role CHECK, FKs (NOT VALID — new rows only), one row per user per branch.
-- 4. An append-only authorization audit trail (what changed, before / after, who, why, correlation).

-- ── 1. versions ─────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE users   ADD COLUMN IF NOT EXISTS authorization_version INT NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS authorization_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION authz_bump_user(p_user UUID) RETURNS void LANGUAGE sql AS $$
  UPDATE users SET authorization_version = authorization_version + 1 WHERE id = p_user;
$$;
CREATE OR REPLACE FUNCTION authz_bump_tenant(p_tenant UUID) RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET authorization_version = authorization_version + 1 WHERE id = p_tenant;
$$;

-- users: role / status / home branch / platform role / tenant change → the user's version
CREATE OR REPLACE FUNCTION trg_users_authz_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.platform_role IS DISTINCT FROM OLD.platform_role OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    NEW.authorization_version := OLD.authorization_version + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_authz_version ON users;
CREATE TRIGGER users_authz_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trg_users_authz_version();

-- per-user child tables → that user's version
CREATE OR REPLACE FUNCTION trg_user_child_authz_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM authz_bump_user(OLD.user_id); RETURN OLD; END IF;
  PERFORM authz_bump_user(NEW.user_id);
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN PERFORM authz_bump_user(OLD.user_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS staff_role_assignments_authz_version ON staff_role_assignments;
CREATE TRIGGER staff_role_assignments_authz_version AFTER INSERT OR UPDATE OR DELETE ON staff_role_assignments FOR EACH ROW EXECUTE FUNCTION trg_user_child_authz_version();
DROP TRIGGER IF EXISTS user_branch_access_authz_version ON user_branch_access;
CREATE TRIGGER user_branch_access_authz_version AFTER INSERT OR UPDATE OR DELETE ON user_branch_access FOR EACH ROW EXECUTE FUNCTION trg_user_child_authz_version();

-- a salon's custom role definitions → the salon's version (everyone on that template re-authorizes)
CREATE OR REPLACE FUNCTION trg_tenant_child_authz_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM authz_bump_tenant(OLD.tenant_id); RETURN OLD; END IF;
  PERFORM authz_bump_tenant(NEW.tenant_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_custom_roles_authz_version ON tenant_custom_roles;
CREATE TRIGGER tenant_custom_roles_authz_version AFTER INSERT OR UPDATE OR DELETE ON tenant_custom_roles FOR EACH ROW EXECUTE FUNCTION trg_tenant_child_authz_version();

-- ── 2. per-user overrides (explicit ALLOW incl. temporary, explicit DENY) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_user_permission_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  user_id             UUID NOT NULL,
  permission          TEXT NOT NULL,
  effect              TEXT NOT NULL CHECK (effect IN ('ALLOW','DENY')),
  reason              TEXT NOT NULL,
  branch_id           UUID,                                   -- NULL = every branch the user may enter
  granted_by_user_id  UUID NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,                            -- set = a temporary grant / deny
  revoked_at          TIMESTAMPTZ,
  revoked_by_user_id  UUID,
  revoke_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tupo_window CHECK (expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT chk_tupo_no_platform CHECK (permission NOT LIKE 'super_admin.%')
);
CREATE INDEX IF NOT EXISTS ix_tupo_user ON tenant_user_permission_overrides (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_tupo_expiring ON tenant_user_permission_overrides (expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
-- one LIVE override per user + permission + branch
CREATE UNIQUE INDEX IF NOT EXISTS uq_tupo_live ON tenant_user_permission_overrides (tenant_id, user_id, permission, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) WHERE revoked_at IS NULL;
DROP TRIGGER IF EXISTS tenant_user_permission_overrides_authz_version ON tenant_user_permission_overrides;
CREATE TRIGGER tenant_user_permission_overrides_authz_version AFTER INSERT OR UPDATE OR DELETE ON tenant_user_permission_overrides FOR EACH ROW EXECUTE FUNCTION trg_user_child_authz_version();
ALTER TABLE tenant_user_permission_overrides DROP CONSTRAINT IF EXISTS fk_tupo_user;
ALTER TABLE tenant_user_permission_overrides ADD CONSTRAINT fk_tupo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;

-- ── 3. user_branch_access consistency ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_branch_access DROP CONSTRAINT IF EXISTS chk_uba_role;
ALTER TABLE user_branch_access ADD CONSTRAINT chk_uba_role CHECK (role IS NULL OR role IN ('OWNER','ADMIN','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')) NOT VALID;
ALTER TABLE user_branch_access DROP CONSTRAINT IF EXISTS chk_uba_level;
ALTER TABLE user_branch_access ADD CONSTRAINT chk_uba_level CHECK (access_level IN ('owner','manager','staff','viewer','report_only')) NOT VALID;
ALTER TABLE user_branch_access DROP CONSTRAINT IF EXISTS fk_uba_user;
ALTER TABLE user_branch_access ADD CONSTRAINT fk_uba_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE user_branch_access DROP CONSTRAINT IF EXISTS fk_uba_branch;
ALTER TABLE user_branch_access ADD CONSTRAINT fk_uba_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uba_user_branch ON user_branch_access (tenant_id, user_id, branch_id);

-- ── 4. authorization audit trail (append-only) ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS authorization_audit_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID,                                       -- NULL = platform
  actor_user_id    UUID,
  target_user_id   UUID,
  action           TEXT NOT NULL,                              -- role.assigned | role.custom_created | override.granted | override.revoked | branch_access.granted | branch_access.revoked | ownership.transferred | session.revoked | access_review.decided | ...
  before_state     JSONB,
  after_state      JSONB,
  reason           TEXT,
  correlation_id   TEXT,
  ip               TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_aae_tenant ON authorization_audit_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_aae_target ON authorization_audit_events (tenant_id, target_user_id, created_at DESC);
CREATE OR REPLACE FUNCTION authorization_audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'authorization_audit_events is append-only'; END $$;
DROP TRIGGER IF EXISTS authorization_audit_events_no_change ON authorization_audit_events;
CREATE TRIGGER authorization_audit_events_no_change BEFORE UPDATE OR DELETE ON authorization_audit_events FOR EACH ROW EXECUTE FUNCTION authorization_audit_events_append_only();
