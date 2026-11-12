// quickActionGate.ts — Extras (AI PowerSalon Live Operations 06): why a Live Operations Quick Action is enabled or not.
// The action's route is matched to the sidebar item that owns it (exact path, else the longest route prefix) and the
// SAME permission keys the sidebar requires are checked. A missing key disables the button and names the key; nothing
// is submitted from a Quick Action (each only opens its real flow), and the server still enforces every action.
import { allNavItems, requiredPermissions } from '../shell/tenant-nav';

export interface QuickActionGate { ok: boolean; required: string[]; missing: string[]; owner: string | null }
export function quickActionGate(to: string, can: (permission: string) => boolean): QuickActionGate {
  const path = to.split('?')[0];
  const items = allNavItems();
  const owner = items.find((i) => i.route === path)
    ?? items.filter((i) => i.route !== '/' && path.startsWith(i.route + '/')).sort((a, b) => b.route.length - a.route.length)[0] ?? null;
  const required = owner ? requiredPermissions(owner) : [];
  const missing = required.filter((p) => !can(p));
  return { ok: missing.length === 0, required, missing, owner: owner?.id ?? null };
}
