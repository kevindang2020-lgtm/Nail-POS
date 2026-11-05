// Pure logic for the Security & Compliance oversight aggregate. No DB/Nest deps. Assembles the reference's 12 KPIs from
// real sources where they exist and marks the rest honest gaps (never fabricated). Encodes business-semantic tone so a
// numeric increase is not blindly "favorable" (more failed logins = bad; fewer suspicious sessions = good; more
// privileged accounts = review). Also privacy helpers (IP masking) and chart/mix assembly.

export type Tone = 'good' | 'bad' | 'neutral' | 'review';
export interface Kpi { value: number | string | null; available: boolean; note?: string; delta?: string; deltaTone?: Tone }
const kpi = (value: number | string | null, available: boolean, extra: Partial<Kpi> = {}): Kpi => ({ value, available, ...extra });

export function pct(n: number, d: number): number { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

// Mask an IP for display: keep the network portion, hide the host identifier. Never present as exact location.
export function maskIp(ip: string | null | undefined): string {
  const s = String(ip || '').trim();
  if (!s) return '—';
  if (s.includes(':')) { const p = s.split(':'); return p.slice(0, 3).join(':') + '::xxxx'; } // IPv6
  const p = s.split('.'); return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.xxx` : s;
}

export interface SecurityKpiRaw {
  twoFaEnabled?: number | null; twoFaTotal?: number | null;
  failedLogins7d?: number | null;
  suspiciousSessions?: number | null;
  privilegedAccounts?: number | null;
  dataExportEvents7d?: number | null;
  privacyRequestsOpen?: number | null;
  // honest gaps unless a real source is wired:
  securityIncidentsOpen?: number | null;
  complianceScorePct?: number | null;
  encryptionCoveragePct?: number | null;
  backupSuccessRatePct?: number | null;
  sessionPolicyCompliant?: boolean | null;
  passwordPolicyCompliant?: boolean | null;
}

// The 12 reference KPIs. `available:false` renders "Not connected"; tone drives the delta color semantic.
export function assembleSecurityKpis(raw: SecurityKpiRaw) {
  const twoFaRate = raw.twoFaTotal && raw.twoFaTotal > 0 ? pct(raw.twoFaEnabled || 0, raw.twoFaTotal) : null;
  return {
    twoFaEnabledUsers: kpi(raw.twoFaEnabled ?? null, raw.twoFaEnabled != null && raw.twoFaTotal != null, { note: twoFaRate == null ? 'No users' : `${twoFaRate}% of ${raw.twoFaTotal}` }),
    failedLoginActivity: kpi(raw.failedLogins7d ?? null, raw.failedLogins7d != null, { note: 'Failed auth attempts (7d) — increases are unfavorable', deltaTone: 'bad' }),
    suspiciousSessions: kpi(raw.suspiciousSessions ?? null, raw.suspiciousSessions != null, { note: 'Fewer is favorable', deltaTone: 'good' }),
    privilegedAccounts: kpi(raw.privilegedAccounts ?? null, raw.privilegedAccounts != null, { note: 'Review-oriented, not automatically favorable', deltaTone: 'review' }),
    dataExportEvents: kpi(raw.dataExportEvents7d ?? null, raw.dataExportEvents7d != null, { note: 'Export events (7d)', deltaTone: 'neutral' }),
    privacyRequests: kpi(raw.privacyRequestsOpen ?? null, raw.privacyRequestsOpen != null, { note: 'Open privacy requests', deltaTone: 'neutral' }),
    securityIncidents: kpi(raw.securityIncidentsOpen ?? null, raw.securityIncidentsOpen != null, { note: raw.securityIncidentsOpen != null ? 'Open incidents' : 'No security-incident schema' }),
    complianceStatus: kpi(raw.complianceScorePct != null ? `${raw.complianceScorePct}%` : null, raw.complianceScorePct != null, { note: raw.complianceScorePct != null ? 'Internal control-coverage score' : 'No compliance-control schema' }),
    encryptionStatus: kpi(raw.encryptionCoveragePct != null ? `${raw.encryptionCoveragePct}%` : null, raw.encryptionCoveragePct != null, { note: raw.encryptionCoveragePct != null ? 'Encryption coverage' : 'No encryption-health schema' }),
    backupStatus: kpi(raw.backupSuccessRatePct != null ? `${raw.backupSuccessRatePct}%` : null, raw.backupSuccessRatePct != null, { note: raw.backupSuccessRatePct != null ? 'Backup success rate' : 'No verified-backup schema' }),
    sessionPolicyStatus: kpi(raw.sessionPolicyCompliant == null ? null : (raw.sessionPolicyCompliant ? 'Compliant' : 'Review'), raw.sessionPolicyCompliant != null, { note: raw.sessionPolicyCompliant != null ? 'Session policy' : 'No session-policy record' }),
    passwordPolicyStatus: kpi(raw.passwordPolicyCompliant == null ? null : (raw.passwordPolicyCompliant ? 'Compliant' : 'Review'), raw.passwordPolicyCompliant != null, { note: raw.passwordPolicyCompliant != null ? 'Password policy' : 'No password-policy record' }),
  };
}

export function assembleFailedLoginTrend(rows: { day: string; count: number }[]): { day: string; count: number }[] {
  return (rows || []).map((r) => ({ day: r.day, count: Number(r.count) || 0 }));
}

// Suspicious-session mix reconciles by construction (segments sum to total).
export function assembleSuspiciousMix(counts: { normal: number; warning: number; highRisk: number }) {
  const normal = counts.normal || 0, warning = counts.warning || 0, highRisk = counts.highRisk || 0;
  const total = normal + warning + highRisk;
  return { segments: [{ label: 'Normal', value: normal, sharePct: pct(normal, total) }, { label: 'Warning', value: warning, sharePct: pct(warning, total) }, { label: 'High Risk', value: highRisk, sharePct: pct(highRisk, total) }].filter((s) => s.value > 0), total };
}

const RISK_ORDER = ['low', 'medium', 'high', 'critical'];
export function riskRank(level: string): number { return RISK_ORDER.indexOf(String(level || '').toLowerCase()); }
export function sessionStatusTone(status: string): Tone {
  const s = String(status || '').toLowerCase();
  if (['active'].includes(s)) return 'good';
  if (['suspicious', 'idle'].includes(s)) return 'review';
  if (['revoked', 'blocked', 'expired'].includes(s)) return 'bad';
  return 'neutral';
}
export function isSecurityAuditModule(module: string): boolean {
  return ['auth', 'security', 'session', 'mfa', 'privacy', 'access', 'login', 'user', 'role'].some((m) => String(module || '').toLowerCase().includes(m));
}
