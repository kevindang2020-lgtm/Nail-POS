// community-diagnostics.ts — Safety Community backlog · 09 (Nov 12 2026): Safe Export / Developer Incident Report. A
// sanitized operational diagnostics file a salon can hand to support: its community settings, restrictions and COUNTS of its
// own posts, evidence states, moderation / appeals / disputes, received alerts, comments and reports over one bounded range.
// Never private data — no titles, bodies, names, phone numbers, e-mail addresses, user ids, file keys or another salon's
// anything; there is no "include PII" switch. The export is audited (fail-closed) before the file leaves. Pure builder here.
export const DIAG_MAX_DAYS = 92;
export const DIAG_FORMAT_VERSION = 1;

export type CountRow = { key: string; n: number };
export interface DiagnosticsCounts {
  postsByStatus: CountRow[]; evidenceUpload: CountRow[]; evidenceScan: CountRow[]; evidenceRedaction: CountRow[];
  openCasesOnOwnPosts: number; appealsByStatus: CountRow[]; disputesOnOwnPostsByStatus: CountRow[];
  alertsReceivedByKind: CountRow[]; alertsReceivedByStatus: CountRow[]; commentsByVisibility: CountRow[]; reportsFiledByStatus: CountRow[];
  rulesAcknowledgedUsers: number;
}
export interface DiagnosticsSettings {
  enabled: boolean; receptionistApprovalRequired: boolean; managerApprovalRequired: boolean; branchVisibility: string; retentionDays: number;
  allowAnonymous: boolean; authorDisplay: string; notify: { push: boolean; email: boolean; criticalSms: boolean; categories: number }; regionPreferences: number;
  roleGrants: Record<string, string[]>; roleRemovals: Record<string, string[]>; rulesVersion: string; settingsVersion: number;
}

/** a cell: formula-safe, quoted when needed; codes / counts only ever reach here */
export function diagCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** a stored code is shown only when it is a plain code (letters, digits, _ . -) — anything else becomes "other" */
const code = (s: string) => (/^[a-z0-9_.-]{1,64}$/i.test(s) ? s : 'other');

export function buildDiagnosticsCsv(i: { generatedAt: string; from: string; to: string; settings: DiagnosticsSettings;
  restrictions: { suspended: boolean; postingRestricted: boolean; commentingRestricted: boolean }; counts: DiagnosticsCounts }): string {
  const rows: unknown[][] = [];
  const add = (section: string, metric: string, value: unknown) => rows.push([section, metric, value]);
  const s = i.settings;
  add('settings', 'enabled', s.enabled ? 'yes' : 'no'); add('settings', 'receptionist_approval_required', s.receptionistApprovalRequired ? 'yes' : 'no');
  add('settings', 'manager_approval_required', s.managerApprovalRequired ? 'yes' : 'no'); add('settings', 'branch_visibility', code(s.branchVisibility));
  add('settings', 'retention_days', s.retentionDays); add('settings', 'allow_anonymous', s.allowAnonymous ? 'yes' : 'no'); add('settings', 'author_display', code(s.authorDisplay));
  add('settings', 'notify_push', s.notify.push ? 'yes' : 'no'); add('settings', 'notify_email', s.notify.email ? 'yes' : 'no'); add('settings', 'notify_critical_sms', s.notify.criticalSms ? 'yes' : 'no');
  add('settings', 'notify_categories_selected', s.notify.categories); add('settings', 'region_preferences_set', s.regionPreferences);
  for (const [role, caps] of Object.entries(s.roleGrants)) add('settings', `role_grants.${code(role)}`, caps.map(code).join(' '));
  for (const [role, caps] of Object.entries(s.roleRemovals)) add('settings', `role_removals.${code(role)}`, caps.map(code).join(' '));
  add('settings', 'rules_version', code(s.rulesVersion)); add('settings', 'settings_version', s.settingsVersion);
  add('restrictions', 'suspended', i.restrictions.suspended ? 'yes' : 'no'); add('restrictions', 'posting_restricted', i.restrictions.postingRestricted ? 'yes' : 'no');
  add('restrictions', 'commenting_restricted', i.restrictions.commentingRestricted ? 'yes' : 'no');
  const c = i.counts;
  const group = (section: string, prefix: string, list: CountRow[]) => { if (!list.length) add(section, `${prefix}.none`, 0); for (const r of list) add(section, `${prefix}.${code(r.key)}`, r.n); };
  group('posts', 'status', c.postsByStatus);
  group('evidence', 'upload', c.evidenceUpload); group('evidence', 'scan', c.evidenceScan); group('evidence', 'redaction', c.evidenceRedaction);
  add('moderation', 'open_cases_on_own_posts', c.openCasesOnOwnPosts);
  group('moderation', 'appeals', c.appealsByStatus); group('moderation', 'disputes_on_own_posts', c.disputesOnOwnPostsByStatus);
  group('alerts_received', 'kind', c.alertsReceivedByKind); group('alerts_received', 'status', c.alertsReceivedByStatus);
  group('participation', 'comments', c.commentsByVisibility); group('participation', 'reports_filed', c.reportsFiledByStatus);
  add('participation', 'rules_acknowledged_users', c.rulesAcknowledgedUsers);
  const line = (cells: unknown[]) => cells.map(diagCell).join(',');
  const head = [line(['Safety Community diagnostics (sanitized)']), line(['Format version', String(DIAG_FORMAT_VERSION)]), line(['Generated', i.generatedAt]),
    line(['Period', `${i.from} to ${i.to} (UTC days; settings and restrictions are as of generation)`]),
    line(['Contains', 'settings and counts only — no titles, bodies, names, phone numbers, e-mail addresses, user ids, file keys or other salons\' data']),
    line(['Rows', String(rows.length)]), ''];
  return '﻿' + [...head, line(['Section', 'Metric', 'Value']), ...rows.map(line)].join('\r\n') + '\r\n';
}
