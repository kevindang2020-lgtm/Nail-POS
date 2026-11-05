-- 377_technician_app_access.sql — the tables behind three POS screens that have never stored anything.
--
-- == WHAT THE AUDIT FOUND ==================================================================================
--
-- technicians.kysely.repository.ts says it out loud in its own header:
--
--     "skillGroups, app access, and the permission matrix have no tables → get returns defaults;
--      set is accepted but not stored."
--
--     getPermissions → defPermissions()     // a hardcoded default
--     setPermissions → return p             // echoes the input back. Persists NOTHING.
--     setAppAccess   → return a             // same
--     setSkills      → return s             // same
--
-- A manager toggles "can process payment", gets a 200, reloads, and it is back to the default. The list view
-- reports `techAppEnabled: true, canProcessPayment: false` for every technician on the platform because those
-- two booleans are literals in the mapper. And the `canProcessPayment` FILTER is this:
--
--     if (f.canProcessPayment) r = r.filter(() => !this.bool(f.canProcessPayment));  // "no schema → none can"
--
-- The screens are not broken. They are honest-looking. That is worse, and it is the exact thing this codebase's
-- honest-verification rule exists to forbid.
--
-- == WHY NOT user_permissions ==============================================================================
--
-- `user_permissions` + a `permissions` catalogue exist in migration 001. The catalogue is NEVER SEEDED — not by
-- a migration, not by a seed script, not anywhere — and nothing reads either table at runtime; the session's
-- permissions come from `permissionsFor(role)`, a static list in rbac.ts. Reviving that dead pair would buy an
-- id-indirection and a catalogue to keep in sync, and buy nothing else.
--
-- The rest of this codebase models a permission as a STRING KEY ('pos.tech.process_payment') and asks
-- `hasPermission(ctx, key)`. So does this. The key IS the identity.
--
-- == SALON-OWNED, BY CONSTRUCTION ==========================================================================
--
-- All three tables are tenant_id-scoped and keyed by technician_id — the SALON's employment record, not the
-- global profile. That is the spec's own line: "Salon-specific role, Salon-specific permissions" are salon-owned
-- and do not travel. A technician who transfers to another salon arrives with no permissions there and none of
-- these rows follow her, which is exactly right: the new salon grants what the new salon grants.

-- ── permissions: the per-salon override of the TECHNICIAN role defaults ──────────────────────────────────
--
-- Only an OVERRIDE is stored, not the whole matrix. `allowed = false` on a role default is a real, meaningful
-- row — a salon revoking something the role grants by default — which a "set of granted keys" could not express.
CREATE TABLE IF NOT EXISTS technician_permissions (
  tenant_id          UUID    NOT NULL,
  branch_id          UUID,
  technician_id      UUID    NOT NULL,
  permission_key     TEXT    NOT NULL,
  allowed            BOOLEAN NOT NULL,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, technician_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_techperm_tenant_tech ON technician_permissions (tenant_id, technician_id);

-- ── app access: the settings that are NOT permissions ────────────────────────────────────────────────────
--
-- App Access and Permissions are the same data behind two screens: every `can*` toggle on the App Access screen
-- IS a TECH_PERMISSION_KEY. So the can* flags are NOT stored here — they live in technician_permissions, once.
-- Storing them twice is how the two screens end up disagreeing, and a manager who turns payment off in one
-- place and sees it on in the other has no way to know which one is real.
--
-- What lives here is what is genuinely app CONFIG and not authority: is the app on at all, is the PIN on, which
-- sections and branches the tech sees. `loginEmail` is deliberately absent — it is `users.email`, derived, never
-- copied.
CREATE TABLE IF NOT EXISTS technician_app_settings (
  tenant_id          UUID    NOT NULL,
  branch_id          UUID,
  technician_id      UUID    NOT NULL,
  app_enabled        BOOLEAN NOT NULL DEFAULT true,
  pin_enabled        BOOLEAN NOT NULL DEFAULT true,
  allowed_sections   JSONB   NOT NULL DEFAULT '[]'::jsonb,
  allowed_branches   JSONB   NOT NULL DEFAULT '[]'::jsonb,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, technician_id)
);

-- ── skills ───────────────────────────────────────────────────────────────────────────────────────────────
--
-- NOT the same thing as `technician_services` (which service can she perform, at this salon, for booking) and
-- NOT the same thing as `technician_skill_change_requests` (which is keyed on service_id — a request to be
-- allowed to perform a SERVICE, not a skill group). Skill groups are the roster's own taxonomy — gel, acrylic,
-- nail art — and they are what the `skillGroup` filter and the `skillGroups` facet have been claiming to filter
-- on while returning an empty list.
CREATE TABLE IF NOT EXISTS technician_skills (
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  technician_id UUID NOT NULL,
  skill_group   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, technician_id, skill_group)
);
CREATE INDEX IF NOT EXISTS idx_techskill_tenant_group ON technician_skills (tenant_id, skill_group);
