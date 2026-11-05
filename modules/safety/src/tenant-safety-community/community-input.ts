// community-input.ts — BUILD_PLAN Phase 8 (agent A): the Safety Community's error type and the request validators.
// The old controller passed `b?.x` straight into the service (no types, no bounds, no enums). Every route now validates
// its body / query here: a bad value is `400 invalid_input` naming the field — never a 500 from a CHECK constraint,
// never a silently-defaulted value. PURE (no I/O).
import {
  COMMUNITY_CATEGORIES,
  type CommunityAdvisoryInput, type CommunityAmountRange, type CommunityAuthorDisplay, type CommunityCategory, type CommunityChannel,
  type CommunityFeedQuery, type CommunityIncidentInput, type CommunityReportReason, type CommunitySettingsUpdate, type CommunitySeverity,
} from '@aipowersalon/api-contracts/tenant';
import type { Capability } from './community-permissions';

export class CommunityError extends Error {
  constructor(public code: string, public status = 400, public extra?: any) { super(code); }
}
export const invalid = (field: string, why = 'invalid'): CommunityError => new CommunityError('invalid_input', 400, { field, why });

export const SEVERITIES: readonly CommunitySeverity[] = ['informational', 'low', 'moderate', 'high', 'critical'];
export const CHANNELS: readonly CommunityChannel[] = ['phone', 'sms', 'email', 'in_person', 'online_booking', 'social', 'other'];
export const AMOUNT_RANGES: readonly CommunityAmountRange[] = ['under_50', '50_200', '200_500', '500_2000', 'over_2000'];
export const AUTHOR_DISPLAYS: readonly CommunityAuthorDisplay[] = ['tenant_name', 'display_name', 'anonymous'];
export const REPORT_REASONS: readonly CommunityReportReason[] = ['contains_personal_info', 'accusatory_or_defamatory', 'inaccurate', 'spam', 'harassment', 'other'];
export const APPEAL_SUBJECTS = ['post_rejected', 'post_removed', 'comment_removed', 'community_suspended', 'verification_status', 'severity_change'] as const;
export const CAPABILITIES: readonly Capability[] = ['view_community', 'create_private_incident', 'create_advisory_draft', 'submit_advisory', 'approve_advisory', 'comment', 'upload_evidence', 'request_removal', 'manage_tenant_settings'];
const TENANT_ROLES = ['owner', 'tenant_admin', 'branch_manager', 'receptionist', 'technician'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function body(v: unknown): Record<string, any> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) throw invalid('body', 'object_required');
  return v;
}
export function uuidParam(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw invalid(field, 'uuid_required');
  return v;
}
export function str(v: unknown, field: string, o: { min?: number; max: number; required?: boolean }): string | null {
  if (v === undefined || v === null || v === '') { if (o.required) throw invalid(field, 'required'); return null; }
  if (typeof v !== 'string') throw invalid(field, 'string_required');
  const t = v.trim();
  if (o.required && !t) throw invalid(field, 'required');
  if (t.length < (o.min ?? 0)) throw invalid(field, `min_${o.min}`);
  if (t.length > o.max) throw invalid(field, `max_${o.max}`);
  return t || null;
}
export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], required = false): T | null {
  if (v === undefined || v === null || v === '') { if (required) throw invalid(field, 'required'); return null; }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw invalid(field, 'not_allowed');
  return v as T;
}
export function int(v: unknown, field: string, o: { min: number; max: number; dflt?: number; required?: boolean }): number {
  if (v === undefined || v === null || v === '') { if (o.required || o.dflt === undefined) throw invalid(field, 'required'); return o.dflt; }
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < o.min || n > o.max) throw invalid(field, `int_${o.min}_${o.max}`);
  return n;
}
export function bool(v: unknown, field: string, dflt?: boolean): boolean | undefined {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw invalid(field, 'boolean_required');
}
export function date(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw invalid(field, 'date_required');
  return v;
}
function strList(v: unknown, field: string, o: { maxItems: number; maxLen: number; allowed?: readonly string[] }): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > o.maxItems) throw invalid(field, `list_max_${o.maxItems}`);
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !x.trim() || x.trim().length > o.maxLen) throw invalid(field, 'bad_item');
    if (o.allowed && !o.allowed.includes(x)) throw invalid(field, 'not_allowed');
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
}
export const expectedVersion = (b: Record<string, any>, min = 1) => int(b.expectedVersion, 'expectedVersion', { min, max: 1_000_000, required: true });

/** pagination: page ≥ 1, pageSize 1..50 (default 20) */
export function paging(q: Record<string, any>): { page: number; pageSize: number; limit: number; offset: number } {
  const page = int(q.page, 'page', { min: 1, max: 100_000, dflt: 1 });
  const pageSize = int(q.pageSize, 'pageSize', { min: 1, max: 50, dflt: 20 });
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function parseFeedQuery(raw: unknown): Required<Pick<CommunityFeedQuery, 'status' | 'sort' | 'followingOnly'>> & { q: string | null; category: CommunityCategory | null; severity: CommunitySeverity | null; region: string | null; page: number; pageSize: number; limit: number; offset: number } {
  const q = body(raw);
  return {
    q: str(q.q, 'q', { max: 120 }),
    category: oneOf(q.category, 'category', COMMUNITY_CATEGORIES),
    severity: oneOf(q.severity, 'severity', SEVERITIES),
    region: str(q.region, 'region', { max: 64 }),
    status: oneOf(q.status, 'status', ['active', 'resolved', 'all'] as const) ?? 'active',
    sort: oneOf(q.sort, 'sort', ['newest', 'most_active', 'severity'] as const) ?? 'newest',
    followingOnly: bool(q.followingOnly, 'followingOnly', false)!,
    ...paging(q),
  };
}

export type AdvisoryFields = Partial<Omit<CommunityAdvisoryInput, 'fromIncidentId'>> & { fromIncidentId?: string | null };
/** a new advisory (all required fields) or a partial update (`partial`) */
export function parseAdvisory(raw: unknown, partial: boolean): AdvisoryFields {
  const b = body(raw);
  const out: AdvisoryFields = {};
  const has = (k: string) => !partial || b[k] !== undefined;
  if (has('category')) out.category = oneOf(b.category, 'category', COMMUNITY_CATEGORIES, true)!;
  if (has('severity')) out.severity = oneOf(b.severity, 'severity', SEVERITIES, true)!;
  if (has('title')) out.title = str(b.title, 'title', { min: 4, max: 140, required: true })!;
  if (has('body')) out.body = str(b.body, 'body', { min: 10, max: 5000, required: true })!;
  if (b.region !== undefined) out.region = str(b.region, 'region', { max: 64 });
  if (b.incidentDate !== undefined) out.incidentDate = date(b.incidentDate, 'incidentDate');
  if (b.scamMethod !== undefined) out.scamMethod = str(b.scamMethod, 'scamMethod', { max: 200 });
  if (b.channels !== undefined) out.channels = (strList(b.channels, 'channels', { maxItems: CHANNELS.length, maxLen: 20, allowed: CHANNELS }) ?? []) as CommunityChannel[];
  if (b.recommendation !== undefined) out.recommendation = str(b.recommendation, 'recommendation', { max: 2000 });
  if (b.tags !== undefined) out.tags = (strList(b.tags, 'tags', { maxItems: 10, maxLen: 40 }) ?? []).map((t) => t.toLowerCase());
  if (b.paymentProcessor !== undefined) out.paymentProcessor = str(b.paymentProcessor, 'paymentProcessor', { max: 60 });
  if (b.amountRange !== undefined) out.amountRange = oneOf(b.amountRange, 'amountRange', AMOUNT_RANGES);
  if (b.officialReference !== undefined) out.officialReference = str(b.officialReference, 'officialReference', { max: 300 });
  if (b.authorDisplay !== undefined) out.authorDisplay = oneOf(b.authorDisplay, 'authorDisplay', AUTHOR_DISPLAYS);
  if (!partial && b.fromIncidentId !== undefined && b.fromIncidentId !== null) out.fromIncidentId = uuidParam(b.fromIncidentId, 'fromIncidentId');
  if (partial && b.fromIncidentId !== undefined) throw invalid('fromIncidentId', 'create_only');
  return out;
}

export function parseIncident(raw: unknown): Required<Pick<CommunityIncidentInput, 'category' | 'severity'>> & { occurredOn: string | null; rawDetail: string | null } {
  const b = body(raw);
  return {
    category: oneOf(b.category, 'category', COMMUNITY_CATEGORIES, true)!,
    severity: oneOf(b.severity, 'severity', SEVERITIES) ?? 'moderate',
    occurredOn: date(b.occurredOn, 'occurredOn'),
    rawDetail: str(b.rawDetail, 'rawDetail', { max: 5000 }),
  };
}

export function parseReport(raw: unknown): { reason: CommunityReportReason; detail: string | null } {
  const b = body(raw);
  return { reason: oneOf(b.reason, 'reason', REPORT_REASONS, true)!, detail: str(b.detail, 'detail', { max: 1000 }) };
}

function grantMap(v: unknown, field: string): Record<string, string[]> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) throw invalid(field, 'object_required');
  const out: Record<string, string[]> = {};
  for (const [role, caps] of Object.entries(v)) {
    if (!TENANT_ROLES.includes(role)) throw invalid(field, 'unknown_role');
    out[role] = strList(caps, field, { maxItems: CAPABILITIES.length, maxLen: 40, allowed: CAPABILITIES }) ?? [];
  }
  return out;
}

export function parseSettingsUpdate(raw: unknown): CommunitySettingsUpdate {
  const b = body(raw);
  const out: CommunitySettingsUpdate = { expectedVersion: int(b.expectedVersion, 'expectedVersion', { min: 0, max: 1_000_000, required: true }) };
  const allowedKeys = new Set(['expectedVersion', 'enabled', 'receptionistApprovalRequired', 'managerApprovalRequired', 'displayName', 'authorDisplay', 'allowAnonymous', 'branchVisibility', 'retentionDays', 'regionPreferences', 'notify', 'roleGrants', 'roleRemovals']);
  for (const k of Object.keys(b)) if (!allowedKeys.has(k)) throw invalid(k, 'not_allowed');
  for (const k of ['enabled', 'receptionistApprovalRequired', 'managerApprovalRequired', 'allowAnonymous'] as const) if (b[k] !== undefined) (out as any)[k] = bool(b[k], k);
  if (b.displayName !== undefined) out.displayName = str(b.displayName, 'displayName', { max: 80 });
  if (b.authorDisplay !== undefined) out.authorDisplay = oneOf(b.authorDisplay, 'authorDisplay', AUTHOR_DISPLAYS, true)!;
  if (b.branchVisibility !== undefined) out.branchVisibility = oneOf(b.branchVisibility, 'branchVisibility', ['tenant', 'own_branch'] as const, true)!;
  if (b.retentionDays !== undefined) out.retentionDays = int(b.retentionDays, 'retentionDays', { min: 30, max: 3650, required: true });
  if (b.regionPreferences !== undefined) out.regionPreferences = strList(b.regionPreferences, 'regionPreferences', { maxItems: 20, maxLen: 64 });
  if (b.notify !== undefined) {
    if (!isObj(b.notify)) throw invalid('notify', 'object_required');
    const n = b.notify;
    for (const k of Object.keys(n)) if (!['categories', 'push', 'email', 'criticalSms'].includes(k)) throw invalid(`notify.${k}`, 'not_allowed');
    out.notify = {};
    if (n.categories !== undefined) out.notify.categories = strList(n.categories, 'notify.categories', { maxItems: COMMUNITY_CATEGORIES.length, maxLen: 60, allowed: COMMUNITY_CATEGORIES }) as CommunityCategory[];
    for (const k of ['push', 'email', 'criticalSms'] as const) if (n[k] !== undefined) out.notify[k] = bool(n[k], `notify.${k}`);
  }
  out.roleGrants = grantMap(b.roleGrants, 'roleGrants');
  out.roleRemovals = grantMap(b.roleRemovals, 'roleRemovals');
  return out;
}
