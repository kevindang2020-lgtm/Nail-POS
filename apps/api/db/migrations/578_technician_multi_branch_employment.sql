-- 578_technician_multi_branch_employment.sql — branch membership is AUTHORITATIVE, the roster row is the DEFAULT.
-- Technician Profile package (their 461), merged Oct 12 2026.
--
-- == THE MODEL =============================================================================================
--   technicians.branch_id          — the technician's PRIMARY / default branch at this salon (NOT NULL, unchanged).
--   tech_salon_memberships         — one row per (profile, tenant, branch): where she is employed, and in what status.
--   user_branch_access             — one row per (tenant, user, branch): which branches her LOGIN may select, with
--                                    the role she holds there (TECHNICIAN, or MANAGER when the membership says so).
--
-- `user_branch_access` existed since 068 but was never written for technicians, so branch selection fell open for
-- every technician in a multi-branch salon. From here on the identity service writes a grant whenever a membership
-- becomes active and removes it when the employment ends; branch selection for TECHNICIAN sessions fails CLOSED
-- once modules/identity/src/auth/branch-access.ts is switched (AUTH merge).
--
-- Backfill grants for every technician who is employed somewhere TODAY, so nobody is locked out by the fail-closed
-- rule. Idempotent: ON CONFLICT on the (tenant, user, branch) key.
--   a) from active memberships that know their branch and their login
INSERT INTO user_branch_access (tenant_id, branch_id, user_id, role, access_level)
SELECT m.tenant_id, m.branch_id, m.user_id,
       CASE WHEN m.role_label ~* 'manager' THEN 'MANAGER' ELSE 'TECHNICIAN' END, 'staff'
  FROM tech_salon_memberships m
  JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
 WHERE m.status = 'active' AND m.branch_id IS NOT NULL AND m.user_id IS NOT NULL
ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING;
--   b) from live roster rows with a login (covers technicians whose membership carries no branch)
INSERT INTO user_branch_access (tenant_id, branch_id, user_id, role, access_level)
SELECT t.tenant_id, t.branch_id, t.user_id,
       CASE WHEN t.role_label ~* 'manager' THEN 'MANAGER' ELSE 'TECHNICIAN' END, 'staff'
  FROM technicians t
  JOIN users u ON u.id = t.user_id AND u.tenant_id = t.tenant_id AND u.role = 'TECHNICIAN'
 WHERE t.is_active AND t.archived_at IS NULL AND t.user_id IS NOT NULL AND t.branch_id IS NOT NULL
ON CONFLICT (tenant_id, user_id, branch_id) DO NOTHING;
