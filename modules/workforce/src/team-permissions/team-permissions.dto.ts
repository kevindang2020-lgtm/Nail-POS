// team-permissions.dto.ts — read-only view of the RBAC role -> permission matrix (source of truth:
// auth/rbac.ts). Surfaces which team roles hold each capability, grouped by domain. Static; no storage.
import { PERMISSIONS, permissionsFor, type Role, type Permission } from '@aipowersalon/permissions';

export interface TeamPermissionsContext { tenantId: string; userId: string; role: string; permissions: string[]; }

// The staff roles relevant to a salon team (CUSTOMER + SUPER_ADMIN are not team members).
export const TEAM_ROLES: Role[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];

export interface PermissionRow { key: string; roles: Role[]; }
export interface PermissionGroup { domain: string; permissions: PermissionRow[]; }
export interface TeamPermissionsState {
  roles: Role[];
  roleSummaries: { role: Role; count: number }[];
  totalPermissions: number;
  groups: PermissionGroup[];
}

const domainOf = (p: string): string => { const seg = p.split('.'); return seg[0] === 'pos' && seg.length > 1 ? 'pos' : seg[0] || 'other'; };

export function buildPermissionMatrix(): TeamPermissionsState {
  // Precompute each role's permission set for fast membership checks.
  const held = new Map<Role, Set<string>>();
  for (const r of TEAM_ROLES) held.set(r, new Set(permissionsFor(r) as string[]));

  const groupsMap = new Map<string, PermissionRow[]>();
  for (const perm of PERMISSIONS as readonly string[]) {
    const roles = TEAM_ROLES.filter((r) => held.get(r)!.has(perm));
    if (roles.length === 0) continue; // permission no team role has (e.g. super_admin.*) — omit
    const d = domainOf(perm);
    const arr = groupsMap.get(d) || [];
    arr.push({ key: perm, roles });
    groupsMap.set(d, arr);
  }
  const groups: PermissionGroup[] = Array.from(groupsMap.entries())
    .map(([domain, permissions]) => ({ domain, permissions: permissions.sort((a, b) => a.key.localeCompare(b.key)) }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  const roleSummaries = TEAM_ROLES.map((role) => ({ role, count: held.get(role)!.size }));
  const totalPermissions = groups.reduce((a, g) => a + g.permissions.length, 0);
  return { roles: TEAM_ROLES, roleSummaries, totalPermissions, groups };
}
