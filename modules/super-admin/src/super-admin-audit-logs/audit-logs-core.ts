// audit-logs-core.ts — pure shaping for Super Admin → System Settings → Audit Logs. No I/O; deterministic + tested.
// Reads the existing audit_events table (append-only; this surface NEVER edits or deletes rows — tamper-resistance).
// Previous/new values are derived from metadata.before/after. Anything not modelled yet (legal holds, investigations,
// evidence packets) is surfaced honestly as available:false until its backing table exists.
// Semantic (the good / warn / bad / neutral tone of a KPI): ONE definition, the platform contract's (Constitution 13 §15)
// — this module had its own copy (four modules did, one of them without 'warn').
export type { Semantic } from '@aipowersalon/api-contracts/platform';
import type { Semantic } from '@aipowersalon/api-contracts/platform';

// Result buckets from audit_events.status. 'ok' is the success state written across the platform.
export function resultBucket(status: string | null | undefined): { key: 'success' | 'warning' | 'failed' | 'under_review'; label: string; semantic: Semantic } {
  switch ((status || '').toLowerCase()) {
    case 'ok': case 'success': return { key: 'success', label: 'Success', semantic: 'good' };
    case 'warning': case 'warn': return { key: 'warning', label: 'Warning', semantic: 'warn' };
    case 'under_review': case 'review': return { key: 'under_review', label: 'Under Review', semantic: 'neutral' };
    default: return { key: 'failed', label: 'Failed', semantic: 'bad' };
  }
}

// Severity ordering for risk classification.
const SEV_RANK: Record<string, number> = { info: 0, low: 1, warning: 2, medium: 2, high: 3, critical: 4 };
export function isCritical(severity: string | null | undefined): boolean {
  return SEV_RANK[(severity || '').toLowerCase()] >= 3;
}

// A human category label for an audit module (used by the "Audit Events by Category" breakdown).
const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Authentication', authentication: 'Authentication', 'tenant-management': 'Tenant Management', tenants: 'Tenant Management',
  'customer-data': 'Customer Data', customers: 'Customer Data', payments: 'Payments', 'merchant-accounts': 'Payments',
  devices: 'Devices', integrations: 'Integrations', security: 'Security', ai: 'AI Configuration', 'ai-config': 'AI Configuration',
  communications: 'Communications', 'smart-reminders': 'Smart Reminders',
};
export function categoryLabel(module: string | null | undefined): string {
  const m = (module || 'other').toLowerCase();
  if (CATEGORY_LABELS[m]) return CATEGORY_LABELS[m];
  return m.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Risk level for the Suspicious Activity Queue: failed auth / critical severity / support-mode access are elevated.
export function riskLevel(action: string | null | undefined, status: string | null | undefined, severity: string | null | undefined): { key: 'high' | 'medium' | 'low'; label: string } {
  const a = (action || '').toLowerCase(), s = (status || '').toLowerCase();
  if (isCritical(severity) || (a.includes('login') && s === 'failed')) return { key: 'high', label: 'High' };
  if (a.includes('support') || a.includes('export') || s === 'warning' || s === 'under_review') return { key: 'medium', label: 'Medium' };
  return { key: 'low', label: 'Low' };
}

export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
export function distribution<T extends { key: string; label: string; count: number }>(rows: T[], total: number): (T & { pct: number })[] {
  return rows.map((r) => ({ ...r, pct: pct(r.count, total) }));
}
export function trendDelta(current: number, prior: number): { deltaPct: number; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0) return { deltaPct: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'flat' };
  const d = Math.round(((current - prior) / prior) * 1000) / 10;
  return { deltaPct: d, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
// For most audit KPIs an upward trend is neutral-to-concerning; failures/critical up is bad.
export function kpiTrendSemantic(key: string, direction: 'up' | 'down' | 'flat'): Semantic {
  const upIsBad = ['failed_logins', 'critical', 'high_risk', 'investigations'].includes(key);
  if (direction === 'flat') return 'neutral';
  const up = direction === 'up';
  return upIsBad ? (up ? 'bad' : 'good') : 'neutral';
}

// Does an ACTIVE legal hold cover a given audit event? This is the check a retention purge consults before deleting an
// aged log row — a covered row is protected. Holds are an overlay: they never modify or reference log rows destructively.
export interface HoldLike { status: string; scopeType: string; scopeValue: string | null }
export interface EventLike { tenantId: string | null; actorUserId: string | null; action: string | null; occurredAt: string }
export function holdCovers(hold: HoldLike, ev: EventLike): boolean {
  if ((hold.status || '').toLowerCase() !== 'active') return false;
  const v = hold.scopeValue || '';
  switch ((hold.scopeType || '').toLowerCase()) {
    case 'global': return true;
    case 'tenant': return !!ev.tenantId && ev.tenantId === v;
    case 'user': return !!ev.actorUserId && ev.actorUserId === v;
    case 'action': return !!ev.action && ev.action.toLowerCase().includes(v.toLowerCase());
    case 'date_range': { const [s, e] = v.split('|'); const t = new Date(ev.occurredAt).getTime(); return (!s || t >= new Date(s).getTime()) && (!e || t < new Date(e).getTime()); }
    default: return false;
  }
}
export function isEventHeld(holds: HoldLike[], ev: EventLike): boolean { return holds.some((h) => holdCovers(h, ev)); }

// Evidence export redaction (§ "Sensitive-data redaction"). Field keys that must never appear in an evidence packet.
const SENSITIVE_KEYS = ['password', 'passwordhash', 'temporarypassword', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken', 'apikey', 'clientsecret', 'webhooksecret', 'secret', 'privatekey', 'encryptionkey', 'mfasecret', 'recoverycode', 'cvv', 'pin', 'magneticstripe', 'fullcardnumber', 'cardnumber', 'fullbankaccount', 'bankaccount', 'routingnumber', 'providercredential', 'credential'];
export function isSensitiveKey(key: string): boolean {
  const k = (key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}
// Mask secret-looking substrings inside a free-text cell: long digit runs (card/bank) and long token-like strings.
export function redactText(value: string | number | null | undefined): string {
  let s = String(value ?? '');
  s = s.replace(/\b\d[\d\s-]{11,}\b/g, '****REDACTED****');            // >=12-digit sequences (card / bank / routing)
  s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '****REDACTED****');        // long token / key / secret strings
  return s;
}

// Deterministic manifest for an evidence packet (integrity metadata that travels with the export).
export interface EvidenceManifest { packRef: string; format: string; eventCount: number; checksumAlgorithm: 'sha256'; checksum: string; generatedAt: string; redactionApplied: boolean }
export function buildManifest(i: { packRef: string; format: string; eventCount: number; checksum: string; generatedAt: string; redactionApplied: boolean }): EvidenceManifest {
  return { packRef: i.packRef, format: i.format, eventCount: i.eventCount, checksumAlgorithm: 'sha256', checksum: i.checksum, generatedAt: i.generatedAt, redactionApplied: i.redactionApplied };
}
// Export-risk flagging (§ suspicious-activity analysis). DOCUMENTED, versioned rules over data-export events — not a
// black-box model. Each tripped rule yields a flag that a reviewer can confirm or dismiss as a false positive.
export interface ExportEventLike { action: string | null; status: string | null; summary: string | null; metadata: any; occurredAt: string }
export interface ExportRiskContext { actorExportsLastHour?: number; actorMedianRecordCount?: number }
export interface ExportFlag { ruleKey: string; ruleVersion: number; risk: 'low' | 'medium' | 'high' | 'critical'; reason: string }
export function evaluateExportRisk(ev: ExportEventLike, ctx: ExportRiskContext = {}): ExportFlag[] {
  const flags: ExportFlag[] = [];
  const action = (ev.action || '').toLowerCase();
  if (!action.includes('export')) return flags;                         // only data-export events are evaluated
  const status = (ev.status || '').toLowerCase();
  const text = `${ev.summary || ''} ${JSON.stringify(ev.metadata ?? {})}`.toLowerCase();
  const recordCount = Number(ev.metadata?.recordCount ?? ev.metadata?.rows ?? 0) || 0;
  if (status === 'failed' || status === 'error') flags.push({ ruleKey: 'export_failed', ruleVersion: 1, risk: 'medium', reason: 'Export attempt failed' });
  if (recordCount >= 1000) flags.push({ ruleKey: 'large_export', ruleVersion: 1, risk: 'high', reason: `Large export (${recordCount} records)` });
  if (/customer|financial|payment|bank|card/.test(text)) flags.push({ ruleKey: 'sensitive_scope', ruleVersion: 1, risk: 'medium', reason: 'Export covers sensitive data categories' });
  const hour = new Date(ev.occurredAt).getUTCHours();
  if (hour < 6 || hour >= 22) flags.push({ ruleKey: 'off_hours', ruleVersion: 1, risk: 'low', reason: 'Export performed outside business hours (UTC)' });
  // Context-aware rules (documented). Skipped when the context isn't supplied — keeps the evaluator pure + inspectable.
  const velocity = Number(ctx.actorExportsLastHour ?? 0) || 0;
  if (velocity >= 5) flags.push({ ruleKey: 'velocity', ruleVersion: 1, risk: 'medium', reason: `High export velocity (${velocity} exports in the last hour by this user)` });
  const baseline = Number(ctx.actorMedianRecordCount ?? 0) || 0;
  if (baseline > 0 && recordCount >= baseline * 4) flags.push({ ruleKey: 'volume_spike', ruleVersion: 1, risk: 'high', reason: `Volume spike: ${recordCount} records vs this user's ~${baseline} baseline` });
  return flags;
}

// Median helper for baselining (pure). Empty → 0.
export function median(nums: number[]): number {
  const xs = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Retention policy engine (§ retention). Per-category policies define hot-storage days + archive days; an event is
// eligible for archival/purge once it is older than hot+archive AND not covered by a legal hold. This computes
// eligibility only — it NEVER deletes a log row (the surface is append-only). Pure + deterministic.
export interface RetentionPolicyLike { hotDays: number; archiveDays: number }
export function retentionTotalDays(p: RetentionPolicyLike): number { return Math.max(0, (Number(p.hotDays) || 0) + (Number(p.archiveDays) || 0)); }
export function retentionCutoff(p: RetentionPolicyLike, now: Date = new Date()): string {
  return new Date(now.getTime() - retentionTotalDays(p) * 86400000).toISOString();
}
export function isPurgeEligible(occurredAt: string, p: RetentionPolicyLike, held: boolean, now: Date = new Date()): boolean {
  if (held) return false;                                               // legal holds override retention — never eligible
  if (retentionTotalDays(p) <= 0) return false;                         // 0 = keep indefinitely
  return new Date(occurredAt).getTime() < new Date(retentionCutoff(p, now)).getTime();
}

export function beforeAfter(metadata: any): { previous: string | null; next: string | null } {
  const b = metadata?.before, a = metadata?.after;
  const fmt = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return null; }
  };
  return { previous: fmt(b), next: fmt(a) };
}
