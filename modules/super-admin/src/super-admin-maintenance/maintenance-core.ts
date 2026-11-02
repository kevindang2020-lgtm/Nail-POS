// maintenance-core.ts — pure maintenance logic. The enforcement DECISION lives here (and is exhaustively tested) so the
// "maintenance mode can never lock out administrators" guarantee is verifiable independent of the HTTP layer.

export type MaintenanceMode = 'read_only' | 'full';
export interface MaintenanceState {
  active: boolean;
  mode: MaintenanceMode;
  message: string;
  expectedRestoration: string | null;
  allowedRoles: string[];
}
export interface RequestInfo { role?: string | null; method: string; path: string }
export type MaintenanceDecision = { allow: true } | { allow: false; status: 503; body: Record<string, unknown> };

// Roles that always retain access during maintenance (emergency access — prevents total lockout).
const EMERGENCY_ROLES = new Set(['SUPER_ADMIN']);

/**
 * Decide whether a request proceeds during maintenance.
 *  - Not active → always allow.
 *  - Emergency roles (SUPER_ADMIN) → always allow (cannot be locked out).
 *  - Explicitly allowed roles → allow.
 *  - Unauthenticated (no role) → allow: these are the login/health/public entry points; blocking them would lock
 *    everyone out and hide the way back in.
 *  - read_only mode → allow safe GETs; block mutations.
 *  - Otherwise → 503 with the maintenance payload.
 */
export function maintenanceDecision(state: MaintenanceState, req: RequestInfo): MaintenanceDecision {
  if (!state.active) return { allow: true };
  const role = req.role || null;
  if (role && EMERGENCY_ROLES.has(role)) return { allow: true };
  if (role && state.allowedRoles.includes(role)) return { allow: true };
  if (!role) return { allow: true };
  if (state.mode === 'read_only' && req.method.toUpperCase() === 'GET') return { allow: true };
  return { allow: false, status: 503, body: { maintenance: true, mode: state.mode, message: state.message || 'The platform is undergoing maintenance.', expectedRestoration: state.expectedRestoration } };
}

// ── Scheduling ──────────────────────────────────────────────────────────────
export interface Window { startsAt: string; endsAt: string }

export function validateSchedule(w: Window, now: Date = new Date()): string | null {
  const s = Date.parse(w.startsAt), e = Date.parse(w.endsAt);
  if (Number.isNaN(s) || Number.isNaN(e)) return 'Start and end must be valid dates.';
  if (e <= s) return 'End must be after start.';
  if (s < now.getTime()) return 'Start must be in the future.';
  return null;
}
export function windowsOverlap(a: Window, b: Window): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}
export function durationMinutes(w: Window): number { return Math.max(0, Math.round((Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 60000)); }
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

// ── Event status transitions ─────────────────────────────────────────────────
export const MAINT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled', 'failed', 'extended', 'partially_completed'] as const;
export type MaintStatus = typeof MAINT_STATUSES[number];
const TRANSITIONS: Record<MaintStatus, MaintStatus[]> = {
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'extended', 'partially_completed'],
  extended: ['completed', 'failed', 'partially_completed'],
  completed: [], cancelled: [], failed: [], partially_completed: [],
};
export function canTransitionMaint(from: MaintStatus, to: MaintStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
