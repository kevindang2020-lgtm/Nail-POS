// alerts-core.ts — pure, framework-free logic for the Super-Admin Alerts module. Tested by alerts-core.spec.ts.
// Alerts are ACTIONABLE items (read/resolve/dismiss) distinct from audit_logs (immutable history). They are materialized
// from real platform signals (payments, applications, hardware, gateway errors, support) — never fabricated.

export type AlertType = 'tenant' | 'payment' | 'hardware' | 'support' | 'application' | 'security' | 'system' | 'billing' | 'ai_package' | 'usage_limit';
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'unread' | 'read' | 'resolved' | 'dismissed';

export const SEVERITIES: AlertSeverity[] = ['low', 'medium', 'high', 'critical'];
export const STATUSES: AlertStatus[] = ['unread', 'read', 'resolved', 'dismissed'];

export interface AlertRow {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  title: string;
  message: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  relatedModule: string | null;   // route to the related module (e.g. '/payment-gateways')
  relatedRecordId: string | null;
  dedupeKey: string;              // natural key so re-sync is idempotent
  createdAt: string;
  updatedAt: string;
  readAt?: string | null;
  resolvedAt?: string | null;
  dismissedAt?: string | null;
}

export interface AlertsQuery {
  search?: string; severity?: string; type?: string; status?: string; tenantId?: string;
  sortBy?: 'createdAt' | 'severity' | 'type' | 'status'; sortDirection?: 'asc' | 'desc';
  page?: number; limit?: number;
}

const sevRank: Record<AlertSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function severityRank(s: AlertSeverity): number { return sevRank[s] ?? 0; }

/** Severity → badge colours (low=blue/gray, medium=amber, high=red/orange, critical=red). */
export function severityBadge(s: AlertSeverity): { bg: string; fg: string } {
  switch (s) {
    case 'critical': return { bg: '#FBE3E0', fg: '#B23B2E' };
    case 'high': return { bg: '#FBEFE9', fg: '#B85B4D' };
    case 'medium': return { bg: '#FFF6E5', fg: '#D09A36' };
    default: return { bg: '#EAF2FB', fg: '#3C7FB6' };
  }
}

export function statusBadge(s: AlertStatus): { bg: string; fg: string } {
  switch (s) {
    case 'resolved': return { bg: '#EAF5EE', fg: '#3E8F57' };
    case 'dismissed': return { bg: '#EEEAE3', fg: '#8A8076' };
    case 'read': return { bg: '#F0ECF8', fg: '#7B5BB6' };
    default: return { bg: '#EAF2FB', fg: '#3C7FB6' };   // unread
  }
}

/** Map the overview's coarse severity to the alert severity scale. */
export function mapOverviewSeverity(s: string): AlertSeverity {
  return s === 'error' ? 'high' : s === 'warning' ? 'medium' : s === 'success' ? 'low' : 'low';
}

export function applyFilters(rows: AlertRow[], q: AlertsQuery): AlertRow[] {
  let out = rows.slice();
  if (q.severity) out = out.filter((r) => r.severity === q.severity);
  if (q.type) out = out.filter((r) => r.type === q.type);
  if (q.status) out = out.filter((r) => r.status === q.status);
  if (q.tenantId) out = out.filter((r) => r.tenantId === q.tenantId);
  if (q.search) {
    const t = q.search.toLowerCase();
    out = out.filter((r) => [r.title, r.message, r.tenantName, r.type, r.severity].some((v) => (v || '').toLowerCase().includes(t)));
  }
  const dir = q.sortDirection === 'asc' ? 1 : -1;
  const by = q.sortBy || 'createdAt';
  out.sort((a, b) => {
    const x = by === 'severity' ? severityRank(a.severity) : by === 'type' ? a.type : by === 'status' ? a.status : a.createdAt;
    const y = by === 'severity' ? severityRank(b.severity) : by === 'type' ? b.type : by === 'status' ? b.status : b.createdAt;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  return out;
}

export function paginate<T>(rows: T[], page = 1, limit = 25): { rows: T[]; total: number } {
  const p = Math.max(1, page); const ps = Math.min(100, Math.max(1, limit));
  return { rows: rows.slice((p - 1) * ps, p * ps), total: rows.length };
}

export interface AlertsSummary {
  total: number; unread: number; critical: number; high: number;
  payment: number; system: number; security: number; support: number;
}

export function summarize(rows: AlertRow[]): AlertsSummary {
  const active = rows.filter((r) => r.status !== 'dismissed');
  const countType = (t: AlertType) => active.filter((r) => r.type === t).length;
  return {
    total: active.length,
    unread: active.filter((r) => r.status === 'unread').length,
    critical: active.filter((r) => r.severity === 'critical').length,
    high: active.filter((r) => r.severity === 'high').length,
    payment: countType('payment'), system: countType('system'), security: countType('security'), support: countType('support'),
  };
}

/** Validate a status transition. Resolved/dismissed are terminal except back to read/unread by an admin reopening. */
export function canSetStatus(from: AlertStatus, to: AlertStatus): { ok: boolean; error?: string } {
  if (!STATUSES.includes(to)) return { ok: false, error: `Unknown status: ${to}` };
  if (from === to) return { ok: false, error: `Alert is already ${to}` };
  return { ok: true };
}

/** A platform signal (from the overview's real queries) → a normalized alert seed used by sync. */
export interface SignalSeed {
  tenantId: string | null; tenantName: string | null; title: string; message: string;
  type: AlertType; severity: AlertSeverity; relatedModule: string | null; relatedRecordId: string | null; dedupeKey: string;
}
