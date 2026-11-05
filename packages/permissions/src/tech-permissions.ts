// tech-permissions.ts — the technician-app permission vocabulary and the ONE rule that applies a salon's per-technician
// overrides to the role defaults (never widening beyond the vocabulary). Moved from apps/api/src/technicians/technicians.dto
// (Constitution 13 §76): identity (login) and the technician domain both need it, and neither may import the other.
export const TECH_PERMISSION_KEYS = [
  "pos.tech.view_schedule", "pos.tech.accept_ticket", "pos.tech.start_service", "pos.tech.mark_done",
  "pos.tech.edit_service_notes", "pos.tech.request_break", "pos.tech.view_earnings", "pos.tech.process_payment",
  "pos.tech.edit_customer", "pos.tech.reopen_service",
] as const;
export type TechPermissionKey = typeof TECH_PERMISSION_KEYS[number];

/**
 * The permissions a TECHNICIAN actually carries in their session at one salon.
 *
 * Role defaults, then the salon's own overrides on top. An override with `allowed: false` is not the absence of
 * a grant — it is a salon deliberately REVOKING something the TECHNICIAN role grants by default, and it has to
 * be able to say so.
 *
 * == THE ESCALATION GUARD ==================================================================================
 *
 * Only keys in TECH_PERMISSION_KEYS may move. A row in `technician_permissions` saying `super_admin.all` —
 * however it got there, whether by a future bug, a bad migration, or a compromised write — is IGNORED, not
 * honoured. This function is on the path that mints a session, so it is the last place standing between a
 * corrupt row and a technician holding platform-admin rights. It does not trust its own table.
 */
export function effectiveTechPermissions(
  roleDefaults: readonly string[],
  overrides: readonly { permission: string; allowed: boolean }[],
): string[] {
  const known = new Set<string>(TECH_PERMISSION_KEYS as readonly string[]);
  const out = new Set<string>(roleDefaults);
  for (const o of overrides ?? []) {
    if (!known.has(o.permission)) continue;      // ← the guard. Never widen beyond the technician vocabulary.
    if (o.allowed) out.add(o.permission);
    else out.delete(o.permission);
  }
  return [...out].sort();
}
