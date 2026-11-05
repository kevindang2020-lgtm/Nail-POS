/**
 * workforce-core.ts — pure, DB-free helpers for the Super Admin Workforce Oversight surface.
 *
 * "Workers" are `users` rows whose role is a staff role (not CUSTOMER, not SUPER_ADMIN). The repository supplies raw
 * grouped counts and rows; these helpers categorize roles, bucket statuses, assemble the ordered health-alert list, map
 * status values to presentation classes, and verify totals reconcile. Everything here is deterministic and unit-tested
 * without a database so the aggregate's math is provable.
 *
 * Honesty rule: counts that have no real source yet (payroll-sync failures, technician-app connectivity, worker transfer
 * requests, suspicious activity) are passed in as `null`; this module renders them as unavailable (`available:false`)
 * rather than fabricating a number.
 */

// Staff roles that count as "workers" (excludes CUSTOMER and SUPER_ADMIN).
export const WORKER_ROLES = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];
export type RoleCategory = 'technician' | 'receptionist' | 'manager' | 'other';

export function isWorkerRole(role: string): boolean {
  return (WORKER_ROLES as readonly string[]).includes((role || '').toUpperCase());
}

/** Group the project's granular roles into the three reference categories (Technicians / Receptionists / Managers). */
export function roleCategory(role: string): RoleCategory {
  const r = (role || '').toUpperCase();
  if (r === 'TECHNICIAN') return 'technician';
  if (r === 'RECEPTION' || r === 'FRONT_DESK') return 'receptionist';
  if (r === 'MANAGER' || r === 'OWNER') return 'manager';
  return 'other';
}

export interface RoleCount { role: string; count: number }
export interface RoleDistribution { technicians: number; receptionists: number; managers: number; other: number; total: number }

/** Roll grouped role counts into the three primary categories. `total` is the worker total (categories sum to it). */
export function bucketRoleDistribution(rows: RoleCount[]): RoleDistribution {
  const d: RoleDistribution = { technicians: 0, receptionists: 0, managers: 0, other: 0, total: 0 };
  const keyOf: Record<RoleCategory, keyof RoleDistribution> = { technician: 'technicians', receptionist: 'receptionists', manager: 'managers', other: 'other' };
  for (const r of rows) {
    if (!isWorkerRole(r.role)) continue;
    const n = Math.max(0, Math.trunc(Number(r.count) || 0));
    d[keyOf[roleCategory(r.role)]] += n;
    d.total += n;
  }
  return d;
}

export interface StatusCount { status: string; count: number }
export interface StatusDistribution { active: number; inactive: number; suspended: number; invited: number; total: number }

/** Bucket worker account statuses (active/invited/suspended/inactive). `total` sums all provided buckets. */
export function bucketStatus(rows: StatusCount[]): StatusDistribution {
  const d: StatusDistribution = { active: 0, inactive: 0, suspended: 0, invited: 0, total: 0 };
  for (const r of rows) {
    const n = Math.max(0, Math.trunc(Number(r.count) || 0));
    const s = (r.status || '').toLowerCase();
    if (s === 'active') d.active += n;
    else if (s === 'inactive') d.inactive += n;
    else if (s === 'suspended') d.suspended += n;
    else if (s === 'invited' || s === 'pending') d.invited += n;
    d.total += n;
  }
  return d;
}

// --- Health & Alerts (§14): fixed display order. A `null` count means "no source connected yet" → available:false. ---
export type Severity = 'critical' | 'warning' | 'info';
export interface AlertCounts {
  duplicates: number | null; missingTax: number | null; payrollFailures: number | null;
  suspiciousLogin: number | null; inactiveUsers: number; transferRequests: number | null; connectivityIssues: number | null;
}
export interface HealthAlert { key: string; label: string; count: number | null; severity: Severity; available: boolean; to: string }

export function assembleHealthAlerts(c: AlertCounts): HealthAlert[] {
  const a = (key: string, label: string, count: number | null, severity: Severity, to: string): HealthAlert =>
    ({ key, label, count, severity, available: count != null, to });
  return [
    a('duplicates', 'Duplicate staff profiles', c.duplicates, 'critical', '/staff?profileStatus=duplicate'),
    a('missingTax', 'Missing tax information', c.missingTax, 'warning', '/staff?hasMissingInfo=1'),
    a('payrollFailures', 'Payroll synchronization failures', c.payrollFailures, 'critical', '/staff/payroll-sync?status=failed'),
    a('suspiciousLogin', 'Suspicious login activity', c.suspiciousLogin, 'warning', '/staff/audit-events?type=login'),
    a('inactiveUsers', 'Inactive users', c.inactiveUsers, 'info', '/staff?status=inactive'),
    a('transferRequests', 'Branch transfer requests', c.transferRequests, 'info', '/staff/transfers'),
    a('connectivityIssues', 'Technician app connectivity issues', c.connectivityIssues, 'warning', '/staff/access-connectivity?connectivity=disconnected'),
  ];
}

// --- Presentation class maps (badge colors): 'ok' green, 'warn' amber, 'danger' red, 'muted' neutral. ---
export type BadgeClass = 'ok' | 'warn' | 'danger' | 'muted';

export function availabilityClass(a: string): BadgeClass {
  switch ((a || '').toLowerCase()) {
    case 'available': return 'ok';
    case 'busy': case 'on break': return 'warn';
    case 'offline': case 'unavailable': case 'off shift': return 'muted';
    default: return 'muted';
  }
}
export function accessStatusClass(s: string): BadgeClass {
  switch ((s || '').toLowerCase()) {
    case 'ok': return 'ok';
    case 'mfa required': case 'password reset required': case 'session revocation pending': return 'warn';
    case 'access issue': case 'locked': case 'suspended': case 'no active account': return 'danger';
    default: return 'muted';
  }
}
export function payrollSyncClass(s: string): BadgeClass {
  switch ((s || '').toLowerCase()) {
    case 'synced': return 'ok';
    case 'pending': case 'processing': case 'retrying': return 'warn';
    case 'payroll error': case 'failed': return 'danger';
    case 'not configured': case 'not required': return 'muted';
    default: return 'muted';
  }
}
export function profileStatusClass(s: string): BadgeClass {
  switch ((s || '').toLowerCase()) {
    case 'verified': return 'ok';
    case 'pending review': case 'incomplete': case 'missing information': case 'missing info': return 'warn';
    case 'duplicate review': case 'rejected': return 'danger';
    default: return 'muted';
  }
}
export function workerStatusClass(s: string): BadgeClass {
  switch ((s || '').toLowerCase()) {
    case 'active': return 'ok';
    case 'pending transfer': case 'on leave': case 'invited': case 'pending activation': return 'warn';
    case 'suspended': case 'terminated': case 'locked': return 'danger';
    case 'inactive': return 'muted';
    default: return 'muted';
  }
}

/** True when the category parts exactly reconcile to the stated total (guards fabricated/percent-only charts). */
export function reconciles(parts: number[], total: number): boolean {
  return parts.reduce((s, n) => s + (Math.trunc(Number(n) || 0)), 0) === Math.trunc(Number(total) || 0);
}

/** Percentage helper that never divides by zero and rounds to one decimal. */
export function pct(n: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((n / total) * 1000) / 10;
}

// --- Workforce audit categorization (§24): map raw action_type strings into the five reference categories. ---
export const AUDIT_CATEGORIES = ['Profile Updates', 'Role Changes', 'Access Changes', 'Login Failures', 'Payroll Sync Errors'] as const;

export function categorizeAuditAction(actionType: string): string {
  const a = (actionType || '').toLowerCase();
  if (a.includes('role') || a.includes('permission')) return 'Role Changes';
  if (a.includes('login') && (a.includes('fail') || a.includes('denied') || a.includes('invalid'))) return 'Login Failures';
  if (a.includes('payroll')) return 'Payroll Sync Errors';
  if (a.includes('access') || a.includes('session') || a.includes('mfa') || a.includes('password') || a.includes('lock') || a.includes('deactiv')) return 'Access Changes';
  return 'Profile Updates';
}

/** Roll raw audit action counts into the five reference categories, always returned in fixed order (zeros if absent). */
export function summarizeAudit(rows: { actionType: string; count: number }[]): { category: string; count: number }[] {
  const m = new Map<string, number>(AUDIT_CATEGORIES.map((c) => [c, 0]));
  for (const r of rows) { const c = categorizeAuditAction(r.actionType); m.set(c, (m.get(c) || 0) + Math.max(0, Math.trunc(Number(r.count) || 0))); }
  return AUDIT_CATEGORIES.map((c) => ({ category: c, count: m.get(c) || 0 }));
}

// --- Per-worker derived monitoring fields. These are HONEST heuristics computed from real `users` facts (no stored
// verification/availability/payroll-sync model exists yet), documented so the UI never implies a process that isn't there. ---
export interface WorkerFacts {
  status: string; hasEmail: boolean; hasPhone: boolean; hasName: boolean; mustChangePassword: boolean; isDuplicate: boolean;
}

/** Profile status: a duplicate candidate → Duplicate Review; missing contact/name → Missing Information; else Verified. */
export function deriveProfileStatus(f: WorkerFacts): string {
  if (f.isDuplicate) return 'Duplicate Review';
  if (!f.hasEmail || !f.hasPhone || !f.hasName) return 'Missing Information';
  return 'Verified';
}

/** Access status from account state: suspended → Suspended; forced password change → Password Reset Required; else OK. */
export function deriveAccessStatus(f: WorkerFacts): string {
  const s = (f.status || '').toLowerCase();
  if (s === 'suspended') return 'Suspended';
  if (s === 'inactive') return 'No Active Account';
  if (f.mustChangePassword) return 'Password Reset Required';
  return 'OK';
}

/** Short flag chips shown in the directory's Flags column (no fabricated transfer/payroll flags — those have no source). */
export function deriveFlags(f: WorkerFacts): string[] {
  const flags: string[] = [];
  if (f.isDuplicate) flags.push('Duplicate');
  if ((f.status || '').toLowerCase() === 'suspended' || f.mustChangePassword) flags.push('Access');
  if ((f.status || '').toLowerCase() === 'inactive') flags.push('Inactive');
  if (!f.hasEmail || !f.hasPhone || !f.hasName) flags.push('Info Missing');
  return flags;
}
