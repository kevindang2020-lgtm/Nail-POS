// event-ops-permissions.ts — Constitution 8 §150–155: granular Super Admin permissions for event operations,
// under the repo's `super_admin.*` convention. Same shape as integration-permissions.ts: an unrestricted super
// admin keeps full access; a token that scopes event access is enforced key by key; replay and purge are
// SENSITIVE (§154–155) and never granted by the wildcard.
import { isPlatformPrincipal } from '@aipowersalon/permissions';
export const EP = {
  view: 'super_admin.events.view',
  retry: 'super_admin.events.retry',
  replay: 'super_admin.events.replay',    // §154 — sensitive
  purge: 'super_admin.events.purge',      // §155 — sensitive (discard)
} as const;
const WILDCARD = 'super_admin.events.*';
const SENSITIVE = new Set<string>([EP.replay, EP.purge]);
type PermCtx = { role?: string; permissions?: string[] };

export function checkEventPermission(ctx: PermCtx | undefined, key: string): boolean {
  if (!ctx || !isPlatformPrincipal(ctx)) return false;
  const perms = ctx.permissions || [];
  if (perms.includes('*') || perms.includes('super_admin.*')) return true;
  if (perms.includes(key)) return true;
  const restricted = perms.some((p) => p === WILDCARD || p.startsWith('super_admin.events.'));
  if (!restricted) return true;
  if (perms.includes(WILDCARD) && !SENSITIVE.has(key)) return true;
  return false;
}
