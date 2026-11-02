// platform-user-hierarchy.ts — Security Deep Scan A3 / C2 / C3 (Oct 23 2026): the generic Users routes
// (/super-admin/platform/users/:id/{disable,enable,reset-password,resend-invite,revoke-sessions}) acted on ANY account —
// a PLATFORM_ADMIN could disable every PLATFORM_SUPER_ADMIN (control-plane lockout) or reset their password. A platform
// account (role SUPER_ADMIN) may now be acted on only by someone who STRICTLY outranks it: the actor holds every
// permission of the target's platform role and at least one more. Equal or higher → refused (Platform Staff, with its
// platform_roles.manage + last-Super-Admin rules, is where peers are managed). Salon accounts are unaffected.
import { platformPermissionsFor } from '@aipowersalon/permissions';

export interface HierarchyActor { userId?: string; permissions?: readonly string[] }
export interface HierarchyTarget { id: string; role: string | null; platformRole?: string | null }
export type HierarchyDecision = { ok: true } | { ok: false; code: 'self_action' | 'rank'; message: string };

export function platformHierarchyDecision(actor: HierarchyActor, target: HierarchyTarget, action: string): HierarchyDecision {
  if (actor.userId && actor.userId === target.id) return { ok: false, code: 'self_action', message: `You cannot ${action} your own account here.` };
  if (String(target.role ?? '') !== 'SUPER_ADMIN') return { ok: true };
  const mine = new Set(actor.permissions ?? []);
  // a platform account with no (or an unknown) role resolves to the read-only fallback — the same rule the session uses
  const theirs = platformPermissionsFor(target.platformRole ?? null) as readonly string[];
  const covers = theirs.every((k) => mine.has(k));
  const exceeds = [...mine].some((k) => k.startsWith('super_admin.') && !theirs.includes(k));
  if (covers && exceeds) return { ok: true };
  return { ok: false, code: 'rank', message: `You cannot ${action} a platform account whose role is equal to or above yours. Use Platform Staff.` };
}
