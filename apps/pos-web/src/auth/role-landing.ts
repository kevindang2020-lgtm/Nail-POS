// role-landing.ts — where each role lands immediately after signing in.
//
// Security note (spec §5: "Do not let the frontend choose its own role or redirect into an unauthorized
// application"): this does NOT let the client pick a role. The role comes from the SERVER-ISSUED principal
// (`/auth/me` / the login response), which is derived from the verified session cookie. This module only decides
// which screen to *land* on — it grants nothing. Every screen and every API call behind it is still gated by the
// backend's RolePermissionGuard, so landing a user somewhere they may not act simply yields the normal denial;
// it cannot escalate anything.
//
// Rationale per role (matching the spec's examples):
//   OWNER        → /overview        — the business overview is the owner's home.
//   MANAGER      → /live-operations — a manager runs the floor; branch operations is the useful first screen.
//   RECEPTIONIST → /live-operations — the front desk works the queue/arrivals, not the P&L overview.
//   TECHNICIAN   → /tech-queue      — a technician's own queue. (Technicians CAN sign in to the POS — the backend
//                                     permits it — so we land them on their work surface rather than a business
//                                     overview full of controls they cannot use.)
// Unknown/absent role falls back to /overview — the previous behavior, so nothing regresses.

export const DEFAULT_LANDING = '/overview';

const LANDING_BY_ROLE: Record<string, string> = {
  OWNER: '/overview',
  MANAGER: '/live-operations',
  RECEPTIONIST: '/live-operations',
  TECHNICIAN: '/tech-queue',
};

/** Resolve the post-login landing path from the SERVER-ISSUED role. Never trusts a client-supplied role. */
export function landingPathForRole(role: string | null | undefined): string {
  if (!role) return DEFAULT_LANDING;
  return LANDING_BY_ROLE[String(role).toUpperCase()] ?? DEFAULT_LANDING;
}
