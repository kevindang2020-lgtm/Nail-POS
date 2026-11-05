// Pure logic for suspicious login/permission activity (§37). Alerts are DERIVED from real signals (sessions +
// audit_logs + user status); this module maps signal counts to severity + evidence and never asserts confirmed
// compromise — an alert means "exceeded a configured rule and warrants review", not proven wrongdoing.

export const SECURITY_SIGNAL_TYPES = ['terminated_access', 'excessive_sessions', 'mfa_anomalies', 'permission_denials', 'role_churn'] as const;
export type SecuritySignalType = (typeof SECURITY_SIGNAL_TYPES)[number];

// Documented thresholds. A signal below its threshold is not an alert. terminated_access is 1 (any active access for a
// non-active worker is worth review). Callers may override.
export const DEFAULT_THRESHOLDS: Record<SecuritySignalType, number> = {
  terminated_access: 1, excessive_sessions: 10, mfa_anomalies: 3, permission_denials: 5, role_churn: 3,
};

const LABELS: Record<SecuritySignalType, string> = {
  terminated_access: 'Inactive/suspended worker with active access',
  excessive_sessions: 'Excessive session creation',
  mfa_anomalies: 'Repeated MFA anomalies',
  permission_denials: 'Repeated permission denials',
  role_churn: 'Frequent role changes',
};

export interface SecuritySignal { type: SecuritySignalType; userId: string; name: string; tenant: string | null; status: string; count: number }
export interface SecurityAlert { key: string; type: SecuritySignalType; label: string; severity: 'critical' | 'warning' | 'info'; workerId: string; workerName: string; tenant: string | null; count: number; reason: string }

function severityFor(type: SecuritySignalType, count: number): 'critical' | 'warning' | 'info' {
  if (type === 'terminated_access') return 'critical';
  if (type === 'mfa_anomalies') return count >= 5 ? 'critical' : 'warning';
  if (type === 'permission_denials') return count >= 10 ? 'critical' : 'warning';
  return 'warning';
}
function reasonFor(type: SecuritySignalType, count: number): string {
  switch (type) {
    case 'terminated_access': return `${count} active session(s) despite a non-active account — review and revoke.`;
    case 'excessive_sessions': return `${count} sessions created in the last 24h — unusually high.`;
    case 'mfa_anomalies': return `${count} MFA anomalies recently — possible takeover attempt.`;
    case 'permission_denials': return `${count} permission denials — possible probing outside job function.`;
    case 'role_churn': return `${count} role changes recently — verify each was authorized.`;
  }
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// Keep only signals at/above their threshold, map to alerts, order by severity then count. Alert key is stable per
// (type,user) so a review decision can reference it even though alerts are recomputed each request.
export function assembleSecurityAlerts(signals: SecuritySignal[], thresholds: Record<SecuritySignalType, number> = DEFAULT_THRESHOLDS): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  for (const s of signals || []) {
    const th = thresholds[s.type] ?? DEFAULT_THRESHOLDS[s.type];
    if ((s.count ?? 0) < th) continue;
    alerts.push({ key: `${s.type}:${s.userId}`, type: s.type, label: LABELS[s.type], severity: severityFor(s.type, s.count), workerId: s.userId, workerName: s.name, tenant: s.tenant, count: s.count, reason: reasonFor(s.type, s.count) });
  }
  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count);
}

export const SECURITY_REVIEW_RESOLUTIONS = ['reviewed', 'dismissed', 'escalated'] as const;
export type SecurityReviewResolution = (typeof SECURITY_REVIEW_RESOLUTIONS)[number];
export const SECURITY_REVIEW_AUDIT_TYPE = 'workforce_security_reviewed';
export const MIN_SECURITY_REASON_LEN = 8;

export interface SecurityReviewInput { alertKey?: unknown; resolution?: unknown; reason?: unknown }
export type SecurityReviewValidation = { ok: true; alertKey: string; resolution: SecurityReviewResolution; reason: string } | { ok: false; error: string };
export function validateSecurityReview(input: SecurityReviewInput): SecurityReviewValidation {
  const alertKey = typeof input?.alertKey === 'string' ? input.alertKey.trim() : '';
  if (!alertKey) return { ok: false, error: 'alertKey is required' };
  const resolution = input?.resolution;
  if (resolution !== 'reviewed' && resolution !== 'dismissed' && resolution !== 'escalated') return { ok: false, error: `resolution must be one of: ${SECURITY_REVIEW_RESOLUTIONS.join(', ')}` };
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_SECURITY_REASON_LEN) return { ok: false, error: `reason is required (at least ${MIN_SECURITY_REASON_LEN} characters)` };
  return { ok: true, alertKey, resolution, reason };
}
