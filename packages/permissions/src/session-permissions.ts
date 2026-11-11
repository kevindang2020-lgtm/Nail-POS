// session-permissions.ts — a role's SESSION permissions for a background job that acts as a staff member (the scheduled AI
// Business evaluator, the Daily Summary e-mail schedule): its catalog grants plus every legacy pos.* key those grants allow —
// exactly what a signed-in session carries. Moved here from analytics (Nov 10 2026) so every job uses one rule.
import { permissionsFor, type Role } from './rbac';
import { hasPermission } from './security-core';
import { POS_ROUTE_KEY_ALIASES } from './permission-aliases.generated';

export function sessionPermissionsForRole(role: string): string[] {
  const base = permissionsFor(role as Role) as string[];   // an unknown role has no grants
  if (!base.length) return [];
  const aliases = POS_ROUTE_KEY_ALIASES.filter((k) => hasPermission({ userId: 'scheduler', tenantId: 'scheduler', branchId: '', role, permissions: base } as unknown as Parameters<typeof hasPermission>[0], k));
  return [...new Set([...base, ...aliases])];
}
