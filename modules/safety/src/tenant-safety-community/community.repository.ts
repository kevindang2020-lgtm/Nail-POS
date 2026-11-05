// community.repository.ts — persistence for the Safety Community (migrations 360-363 + 529). Raw-sql Kysely adapter +
// an in-memory fake for tests / no-DB. The repository does NO policy: every visibility / permission / workflow decision
// is made by the service using the Phase-1 pure core. Private incidents are read tenant-scoped here; PUBLISHED community
// posts are read cross-tenant by design (the service applies canView and the safe response shape).
//
// BUILD_PLAN Phase 8 (bug 7): every statement THROWS on failure. The old adapter swallowed errors and returned rows with
// id '' (a "created" post that did not exist) or an empty list (a broken query read as "nothing to show"). A write that
// returns no row is an error too. Post writes are compare-and-set on `version` (+ the expected status) and return null
// when another writer got there first — the service turns that into 409 version_conflict.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { COMMUNITY_POST } from './community-lifecycles';
import type { AppDatabase } from '@aipowersalon/database';
import type { AdvisoryStatus, Classification } from './community-classification';
import type { AbuseCounters } from './community-abuse';
import type { TenantReputation } from './community-abuse';

export interface CommunityCtx { tenantId: string; branchId: string | null; userId: string; role: string; /** BUILD_PLAN Phase 9: the session's permissions — the community role is derived from them */ permissions?: readonly string[] }

export interface IncidentRow {
  id: string; tenantId: string; branchId: string | null; category: string; severity: string;
  rawDetail: string | null; advisoryPostId: string | null; createdAt: string; occurredOn?: string | null; createdByUserId?: string | null;
}
export interface PostRow {
  id: string; originTenantId: string; originBranchId: string | null; classification: Classification;
  visibility: 'draft' | 'community_published' | 'removed'; status: AdvisoryStatus; category: string;
  severity: string; region: string | null; title: string; redactedBody: string; privacyScanFlags: string[];
  moderationRequired: boolean; verificationLabel: string; version: number; createdByUserId: string; createdAt: string;
  // BUILD_PLAN Phase 8 (migration 529) — the full advisory. Agent A maps these in every read; B / C read them.
  updatedAt?: string; publishedAt?: string | null;
  incidentDate?: string | null; scamMethod?: string | null; channels?: string[]; recommendation?: string | null; tags?: string[];
  paymentProcessor?: string | null; amountRange?: string | null; officialReference?: string | null;
  authorDisplay?: 'tenant_name' | 'display_name' | 'anonymous'; authorLabel?: string | null;
  commentCount?: number; reportCount?: number; similarCount?: number; followerCount?: number;
  lastActivityAt?: string | null; resolvedAt?: string | null; resolutionNote?: string | null; commentsLocked?: boolean;
  removedReason?: string | null; submittedByUserId?: string | null; mergedIntoPostId?: string | null; approvedByUserId?: string | null;
}
/** A salon's community settings. The Phase-8 fields are optional in the TYPE (older fixtures) but every read through
 *  this repository / the service fills them (normalizeSettings). */
export interface TenantSettingsRow {
  tenantId: string; enabled: boolean; receptionistApprovalRequired: boolean; managerApprovalRequired: boolean;
  roleGrants: Record<string, string[]>; roleRemovals: Record<string, string[]>;
  notifyCategories?: string[]; criticalSmsEnabled?: boolean; pushEnabled?: boolean; emailEnabled?: boolean;
  displayName?: string | null; authorDisplay?: 'tenant_name' | 'display_name' | 'anonymous'; allowAnonymous?: boolean;
  branchVisibility?: 'tenant' | 'own_branch'; retentionDays?: number; regionPreferences?: string[];
  riskMatchingEnabled?: boolean; version?: number; exists?: boolean;
}
export const DEFAULT_SETTINGS = (tenantId: string): Required<TenantSettingsRow> => ({
  tenantId, enabled: false, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {},
  notifyCategories: [], criticalSmsEnabled: false, pushEnabled: true, emailEnabled: true, displayName: null,
  authorDisplay: 'display_name', allowAnonymous: true, branchVisibility: 'tenant', retentionDays: 730, regionPreferences: [],
  riskMatchingEnabled: false, version: 0, exists: false,
});
export function normalizeSettings(s: TenantSettingsRow | null, tenantId: string): Required<TenantSettingsRow> {
  const d = DEFAULT_SETTINGS(tenantId);
  if (!s) return d;
  const out: any = { ...d };
  for (const [k, v] of Object.entries(s)) if (v !== undefined) out[k] = v;
  if (s.exists === undefined) out.exists = true;
  if (s.version === undefined) out.version = 1;
  return out;
}

export type SettingsPatch = Partial<Omit<TenantSettingsRow, 'tenantId' | 'version' | 'exists'>>;

export interface ReportRow { id: string; postId: string; reporterTenantId: string; reason: string; detail: string | null; status: string; createdAt: string; }
export interface DisputeRow { id: string; postId: string; raisedByTenantId: string | null; raisedByKind: string; reason: string; status: string; createdAt: string; }
export interface UpdateRow { id: string; postId: string; tenantId: string; redactedBody: string; createdByUserId: string; createdAt: string }
export interface RelatedRow { id: string; title: string; relation: 'related' | 'possible_duplicate' | 'merged_into'; severity: string; publishedAt: string | null }
export interface ViewerFlags { following: boolean; similar: boolean; evidenceCount: number; evidenceReviewed: number }

/** Post fields a write may set. `now` markers set the column to now(). */
export interface PostPatch {
  status?: AdvisoryStatus; visibility?: PostRow['visibility']; title?: string; redactedBody?: string; category?: string; severity?: string;
  region?: string | null; incidentDate?: string | null; scamMethod?: string | null; channels?: string[]; recommendation?: string | null;
  tags?: string[]; paymentProcessor?: string | null; amountRange?: string | null; officialReference?: string | null;
  authorDisplay?: 'tenant_name' | 'display_name' | 'anonymous'; authorLabel?: string | null; privacyScanFlags?: string[];
  moderationRequired?: boolean; verificationLabel?: string; resolutionNote?: string | null; submittedByUserId?: string | null;
  approvedByUserId?: string | null;
  publishedNow?: boolean; activityNow?: boolean; resolvedNow?: boolean;
}

export interface FeedRepoQuery {
  viewerTenantId: string; viewerUserId: string;
  term: string | null; category: string | null; severity: string | null; region: string | null;
  status: 'active' | 'resolved' | 'all'; sort: 'newest' | 'most_active' | 'severity'; followingOnly: boolean;
  limit: number; offset: number;
}
export interface Paged<T> { items: T[]; total: number }

export interface AppealRow {
  id: string; postId: string | null; appellantTenantId: string; appellantUserId: string;
  subject: string; reason: string; status: string; originalDeciderUserId: string | null;
  decidedByUserId: string | null; decisionNote: string | null; createdAt: string; decidedAt?: string | null; commentId?: string | null;
}

/** A tenant eligible to be alerted about an advisory: contact address + its notification preferences. */
export interface SubscriberRow {
  tenantId: string; address: string; followsCategories: string[]; region: string | null;
  criticalSmsEnabled: boolean; communityEnabled: boolean;
}

export interface CommunityRepo {
  /** run fn in ONE transaction (the change, its version row and its outbox event commit together) */
  tx<T>(fn: (repo: CommunityRepo, trx: unknown) => Promise<T>): Promise<T>;
  tenantDisplayName(tenantId: string): Promise<string | null>;
  getSettings(tenantId: string): Promise<TenantSettingsRow | null>;
  /** insert the first settings row (version 1); null when a row already exists */
  insertSettings(tenantId: string, patch: SettingsPatch, userId: string): Promise<TenantSettingsRow | null>;
  /** compare-and-set on version; null on a version mismatch */
  updateSettings(tenantId: string, expectedVersion: number, patch: SettingsPatch, userId: string): Promise<TenantSettingsRow | null>;
  hasAcknowledgedRules(tenantId: string, userId: string, rulesVersion: string): Promise<boolean>;
  acknowledgeRules(tenantId: string, userId: string, rulesVersion: string): Promise<void>;
  createIncident(ctx: CommunityCtx, input: { category: string; severity: string; rawDetail: string | null; occurredOn?: string | null }): Promise<IncidentRow>;
  getIncident(ctx: CommunityCtx, id: string): Promise<IncidentRow | null>;
  listIncidents(tenantId: string, scope: { branchOnly: string | null | undefined }, limit: number, offset: number): Promise<Paged<IncidentRow>>;
  linkIncidentAdvisory(ctx: CommunityCtx, incidentId: string, postId: string): Promise<void>;
  incidentForPost(tenantId: string, postId: string): Promise<string | null>;
  createPost(input: Partial<PostRow> & { originTenantId: string; category: string; title: string; redactedBody: string; createdByUserId: string }): Promise<PostRow>;
  getPost(id: string): Promise<PostRow | null>;
  /** CAS write: `where id and version = expectedVersion [and status = expectedStatus]`, version + 1. null = lost the race */
  updatePost(id: string, expectedVersion: number, expectedStatus: string | null, patch: PostPatch): Promise<PostRow | null>;
  insertPostVersion(v: { postId: string; version: number; title: string; redactedBody: string; status: string; editedByUserId: string | null; changeNote: string | null; snapshot: Record<string, unknown> }): Promise<void>;
  listFeed(q: FeedRepoQuery): Promise<Paged<PostRow>>;
  listMine(tenantId: string, statuses: readonly string[] | null, branchOnly: string | null | undefined, limit: number, offset: number): Promise<Paged<PostRow>>;
  viewerFlags(tenantId: string, userId: string, postIds: string[]): Promise<Map<string, ViewerFlags>>;
  listUpdates(postId: string): Promise<UpdateRow[]>;
  addUpdate(ctx: CommunityCtx, postId: string, redactedBody: string): Promise<UpdateRow>;
  listRelated(postId: string): Promise<RelatedRow[]>;
  returnReason(postId: string): Promise<string | null>;
  abuseCounters(tenantId: string): Promise<AbuseCounters>;
  tenantReputation(tenantId: string): Promise<TenantReputation>;
  platformSetting(key: string): Promise<unknown>;
  /** one OPEN report per salon per post; null when this salon already has one open. Bumps report_count. */
  createReport(ctx: CommunityCtx, postId: string, reason: string, detail: string | null): Promise<{ report: ReportRow; reportCount: number } | null>;
  /** one OPEN dispute per salon per post; null when this salon already has one open */
  createDispute(ctx: CommunityCtx, postId: string, reason: string, raisedByKind: string): Promise<DisputeRow | null>;
  lastModeratorFor(postId: string): Promise<string | null>;
  commentRef(commentId: string): Promise<{ id: string; postId: string; tenantId: string; visibility: string } | null>;
  openAppealExists(tenantId: string, postId: string | null, subject: string, commentId: string | null): Promise<boolean>;
  createAppeal(ctx: CommunityCtx, input: { postId?: string | null; commentId?: string | null; subject: string; reason: string; originalDecision?: string | null; originalDeciderUserId?: string | null }): Promise<AppealRow>;
  listAppealsForTenant(tenantId: string, limit: number): Promise<AppealRow[]>;
  listSubscribers(post: PostRow): Promise<SubscriberRow[]>;
}

const jparse = (v: any, d: any) => { try { return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return d; } };
const iso = (v: any): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: any): string | null => (v == null ? null : iso(v));
const strArr = (v: any): string[] => { const a = jparse(v, []); return Array.isArray(a) ? a.map(String) : []; };

const toIncident = (r: any): IncidentRow => ({ id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ?? null, category: r.category, severity: r.severity, rawDetail: r.raw_detail ?? null, advisoryPostId: r.advisory_post_id ?? null, createdAt: iso(r.created_at), occurredOn: r.occurred_on_text ?? null, createdByUserId: r.created_by_user_id ?? null });
export const toPost = (r: any): PostRow => ({
  id: String(r.id), originTenantId: String(r.origin_tenant_id), originBranchId: r.origin_branch_id ?? null, classification: r.classification,
  visibility: r.visibility, status: r.status, category: r.category, severity: r.severity, region: r.region ?? null, title: r.title,
  redactedBody: r.redacted_body, privacyScanFlags: strArr(r.privacy_scan_flags), moderationRequired: !!r.moderation_required,
  verificationLabel: r.verification_label, version: Number(r.version ?? 1), createdByUserId: String(r.created_by_user_id), createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at ?? r.created_at), publishedAt: isoOrNull(r.published_at),
  incidentDate: r.incident_date_text ?? null, scamMethod: r.scam_method ?? null, channels: strArr(r.channels), recommendation: r.recommendation ?? null,
  tags: strArr(r.tags), paymentProcessor: r.payment_processor ?? null, amountRange: r.amount_range ?? null, officialReference: r.official_reference ?? null,
  authorDisplay: r.author_display ?? 'display_name', authorLabel: r.author_label ?? null,
  commentCount: Number(r.comment_count ?? 0), reportCount: Number(r.report_count ?? 0), similarCount: Number(r.similar_count ?? 0), followerCount: Number(r.follower_count ?? 0),
  lastActivityAt: isoOrNull(r.last_activity_at), resolvedAt: isoOrNull(r.resolved_at), resolutionNote: r.resolution_note ?? null, commentsLocked: !!r.comments_locked,
  removedReason: r.removed_reason ?? null, submittedByUserId: r.submitted_by_user_id ?? null, mergedIntoPostId: r.merged_into_post_id ?? null, approvedByUserId: r.approved_by_user_id ?? null,
});
const toAppeal = (r: any): AppealRow => ({ id: String(r.id), postId: r.post_id ?? null, commentId: r.comment_id ?? null, appellantTenantId: String(r.appellant_tenant_id), appellantUserId: String(r.appellant_user_id), subject: r.subject, reason: r.reason, status: r.status ?? 'submitted', originalDeciderUserId: r.original_decider_user_id ?? null, decidedByUserId: r.decided_by_user_id ?? null, decisionNote: r.decision_note ?? null, createdAt: iso(r.created_at), decidedAt: isoOrNull(r.decided_at) });
const toSettings = (r: any): TenantSettingsRow => ({
  tenantId: String(r.tenant_id), enabled: !!r.enabled, receptionistApprovalRequired: !!r.receptionist_approval_required, managerApprovalRequired: !!r.manager_approval_required,
  roleGrants: jparse(r.role_grants, {}), roleRemovals: jparse(r.role_removals, {}), notifyCategories: strArr(r.notify_categories),
  criticalSmsEnabled: !!r.critical_sms_enabled, pushEnabled: r.push_enabled !== false, emailEnabled: r.email_enabled !== false,
  displayName: r.display_name ?? null, authorDisplay: r.author_display ?? 'display_name', allowAnonymous: r.allow_anonymous !== false,
  branchVisibility: r.branch_visibility ?? 'tenant', retentionDays: Number(r.retention_days ?? 730), regionPreferences: strArr(r.region_preferences),
  riskMatchingEnabled: !!r.risk_matching_enabled, version: Number(r.version ?? 1), exists: true,
});
const toUpdate = (r: any): UpdateRow => ({ id: String(r.id), postId: String(r.post_id), tenantId: String(r.tenant_id), redactedBody: r.redacted_body, createdByUserId: String(r.created_by_user_id), createdAt: iso(r.created_at) });

/** every read of a post carries its incident date as text (a DATE must not travel as a local-midnight JS Date) */
const POST_COLS = sql`community_posts.*, to_char(community_posts.incident_date, 'YYYY-MM-DD') as incident_date_text`;
const VISIBLE_STATUSES = ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report', 'disputed', 'corrected', 'resolved'];
const json = (v: unknown) => JSON.stringify(v ?? null);

const SETTINGS_COLS: Record<string, [string, (v: any) => RawBuilder<unknown>]> = {
  enabled: ['enabled', (v) => sql`${!!v}`],
  receptionistApprovalRequired: ['receptionist_approval_required', (v) => sql`${!!v}`],
  managerApprovalRequired: ['manager_approval_required', (v) => sql`${!!v}`],
  roleGrants: ['role_grants', (v) => sql`${json(v)}::jsonb`],
  roleRemovals: ['role_removals', (v) => sql`${json(v)}::jsonb`],
  notifyCategories: ['notify_categories', (v) => sql`${json(v)}::jsonb`],
  criticalSmsEnabled: ['critical_sms_enabled', (v) => sql`${!!v}`],
  pushEnabled: ['push_enabled', (v) => sql`${!!v}`],
  emailEnabled: ['email_enabled', (v) => sql`${!!v}`],
  displayName: ['display_name', (v) => sql`${v ?? null}`],
  authorDisplay: ['author_display', (v) => sql`${v}`],
  allowAnonymous: ['allow_anonymous', (v) => sql`${!!v}`],
  branchVisibility: ['branch_visibility', (v) => sql`${v}`],
  retentionDays: ['retention_days', (v) => sql`${Number(v)}`],
  regionPreferences: ['region_preferences', (v) => sql`${json(v)}::jsonb`],
};

const POST_SET: Record<string, [string, (v: any) => RawBuilder<unknown>]> = {
  status: ['status', (v) => sql`${v}`], visibility: ['visibility', (v) => sql`${v}`], title: ['title', (v) => sql`${v}`],
  redactedBody: ['redacted_body', (v) => sql`${v}`], category: ['category', (v) => sql`${v}`], severity: ['severity', (v) => sql`${v}`],
  region: ['region', (v) => sql`${v}`], incidentDate: ['incident_date', (v) => sql`${v}::date`], scamMethod: ['scam_method', (v) => sql`${v}`],
  channels: ['channels', (v) => sql`${json(v ?? [])}::jsonb`], recommendation: ['recommendation', (v) => sql`${v}`], tags: ['tags', (v) => sql`${json(v ?? [])}::jsonb`],
  paymentProcessor: ['payment_processor', (v) => sql`${v}`], amountRange: ['amount_range', (v) => sql`${v}`], officialReference: ['official_reference', (v) => sql`${v}`],
  authorDisplay: ['author_display', (v) => sql`${v}`], authorLabel: ['author_label', (v) => sql`${v}`], privacyScanFlags: ['privacy_scan_flags', (v) => sql`${json(v ?? [])}::jsonb`],
  moderationRequired: ['moderation_required', (v) => sql`${!!v}`], verificationLabel: ['verification_label', (v) => sql`${v}`],
  resolutionNote: ['resolution_note', (v) => sql`${v}`], submittedByUserId: ['submitted_by_user_id', (v) => sql`${v}`], approvedByUserId: ['approved_by_user_id', (v) => sql`${v}`],
};

export class KyselyCommunityRepo implements CommunityRepo {
  private readonly db: Kysely<any>;
  constructor(db: AppDatabase | Kysely<any>) { this.db = db as Kysely<any>; }
  private async rows<T = any>(q: RawBuilder<unknown>): Promise<T[]> { return (await q.execute(this.db)).rows as T[]; }
  private async first<T = any>(q: RawBuilder<unknown>): Promise<T | null> { return ((await q.execute(this.db)).rows[0] as T) ?? null; }
  /** a write that must produce a row: no row is an error, never a phantom */
  private async must<T = any>(q: RawBuilder<unknown>, what: string): Promise<T> {
    const r = await this.first<T>(q);
    if (!r) throw new Error(`community_write_failed:${what}`);
    return r;
  }

  async tx<T>(fn: (repo: CommunityRepo, trx: unknown) => Promise<T>): Promise<T> {
    if ((this.db as any).isTransaction) return fn(this, this.db);
    return this.db.transaction().execute((trx) => fn(new KyselyCommunityRepo(trx), trx));
  }

  async tenantDisplayName(tenantId: string): Promise<string | null> {
    const r = await this.first<any>(sql`select display_name from tenants where id = ${tenantId}`);
    return r?.display_name ?? null;
  }
  async getSettings(tenantId: string): Promise<TenantSettingsRow | null> {
    const r = await this.first<any>(sql`select * from tenant_community_settings where tenant_id = ${tenantId}`);
    return r ? toSettings(r) : null;
  }
  async insertSettings(tenantId: string, patch: SettingsPatch, userId: string): Promise<TenantSettingsRow | null> {
    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && SETTINGS_COLS[k]);
    const cols = [sql.raw('tenant_id'), sql.raw('updated_by_user_id'), sql.raw('version'), ...entries.map(([k]) => sql.raw(SETTINGS_COLS[k][0]))];
    const vals = [sql`${tenantId}`, sql`${userId}`, sql`1`, ...entries.map(([k, v]) => SETTINGS_COLS[k][1](v))];
    const r = await this.first<any>(sql`insert into tenant_community_settings (${sql.join(cols)}) values (${sql.join(vals)})
      on conflict (tenant_id) do nothing returning *`);
    return r ? toSettings(r) : null;
  }
  async updateSettings(tenantId: string, expectedVersion: number, patch: SettingsPatch, userId: string): Promise<TenantSettingsRow | null> {
    const sets = Object.entries(patch).filter(([k, v]) => v !== undefined && SETTINGS_COLS[k]).map(([k, v]) => sql`${sql.raw(SETTINGS_COLS[k][0])} = ${SETTINGS_COLS[k][1](v)}`);
    const r = await this.first<any>(sql`update tenant_community_settings set ${sql.join([...sets, sql`version = version + 1`, sql`updated_by_user_id = ${userId}`, sql`updated_at = now()`])}
      where tenant_id = ${tenantId} and version = ${expectedVersion} returning *`);
    return r ? toSettings(r) : null;
  }
  async hasAcknowledgedRules(tenantId: string, userId: string, rulesVersion: string): Promise<boolean> {
    const r = await this.first(sql`select 1 as ok from community_rules_acknowledgments where tenant_id = ${tenantId} and user_id = ${userId} and rules_version = ${rulesVersion}`);
    return !!r;
  }
  async acknowledgeRules(tenantId: string, userId: string, rulesVersion: string): Promise<void> {
    await sql`insert into community_rules_acknowledgments (tenant_id, user_id, rules_version) values (${tenantId}, ${userId}, ${rulesVersion})
      on conflict (tenant_id, user_id, rules_version) do nothing`.execute(this.db);
  }

  async createIncident(ctx: CommunityCtx, input: { category: string; severity: string; rawDetail: string | null; occurredOn?: string | null }): Promise<IncidentRow> {
    const r = await this.must<any>(sql`
      insert into tenant_private_incidents (tenant_id, branch_id, category, severity, raw_detail, occurred_on, created_by_user_id)
      values (${ctx.tenantId}, ${ctx.branchId || null}, ${input.category}, ${input.severity}, ${input.rawDetail}, ${input.occurredOn ?? null}::date, ${ctx.userId})
      returning *, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on_text`, 'incident');
    return toIncident(r);
  }
  async getIncident(ctx: CommunityCtx, id: string): Promise<IncidentRow | null> {
    const r = await this.first<any>(sql`select *, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on_text from tenant_private_incidents where id = ${id} and tenant_id = ${ctx.tenantId}`);
    return r ? toIncident(r) : null;
  }
  async listIncidents(tenantId: string, scope: { branchOnly: string | null | undefined }, limit: number, offset: number): Promise<Paged<IncidentRow>> {
    // branchOnly undefined → the whole salon; a branch id → that branch + salon-wide rows; null → salon-wide rows only
    const branch = scope.branchOnly === undefined ? sql`true` : scope.branchOnly ? sql`(branch_id = ${scope.branchOnly} or branch_id is null)` : sql`branch_id is null`;
    const list = await this.rows<any>(sql`
      select *, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on_text, count(*) over () as total_count
      from tenant_private_incidents where tenant_id = ${tenantId} and ${branch}
      order by created_at desc limit ${limit} offset ${offset}`);
    return { items: list.map(toIncident), total: Number(list[0]?.total_count ?? 0) };
  }
  async linkIncidentAdvisory(ctx: CommunityCtx, incidentId: string, postId: string): Promise<void> {
    await this.must(sql`update tenant_private_incidents set advisory_post_id = ${postId}, updated_at = now()
      where id = ${incidentId} and tenant_id = ${ctx.tenantId} returning id`, 'incident_link');
  }
  async incidentForPost(tenantId: string, postId: string): Promise<string | null> {
    const r = await this.first<any>(sql`select id from tenant_private_incidents where tenant_id = ${tenantId} and advisory_post_id = ${postId} limit 1`);
    return r ? String(r.id) : null;
  }

  async createPost(input: Partial<PostRow> & { originTenantId: string; category: string; title: string; redactedBody: string; createdByUserId: string }): Promise<PostRow> {
    const r = await this.must<any>(sql`
      insert into community_posts (origin_tenant_id, origin_branch_id, visibility, status, category, severity, region, title, redacted_body,
        privacy_scan_flags, moderation_required, created_by_user_id, incident_date, scam_method, channels, recommendation, tags,
        payment_processor, amount_range, official_reference, author_display)
      values (${input.originTenantId}, ${input.originBranchId || null}, ${input.visibility ?? 'draft'}, ${input.status ?? 'incident_draft'}, ${input.category},
        ${input.severity ?? 'moderate'}, ${input.region ?? null}, ${input.title}, ${input.redactedBody}, ${json(input.privacyScanFlags ?? [])}::jsonb,
        ${input.moderationRequired ?? false}, ${input.createdByUserId}, ${input.incidentDate ?? null}::date, ${input.scamMethod ?? null},
        ${json(input.channels ?? [])}::jsonb, ${input.recommendation ?? null}, ${json(input.tags ?? [])}::jsonb, ${input.paymentProcessor ?? null},
        ${input.amountRange ?? null}, ${input.officialReference ?? null}, ${input.authorDisplay ?? 'display_name'})
      returning ${POST_COLS}`, 'post');
    return toPost(r);
  }
  async getPost(id: string): Promise<PostRow | null> {
    const r = await this.first<any>(sql`select ${POST_COLS} from community_posts where id = ${id}`);
    return r ? toPost(r) : null;
  }
  async updatePost(id: string, expectedVersion: number, expectedStatus: string | null, patch: PostPatch): Promise<PostRow | null> {
    const sets: RawBuilder<unknown>[] = Object.entries(patch).filter(([k, v]) => v !== undefined && POST_SET[k]).map(([k, v]) => sql`${sql.raw(POST_SET[k][0])} = ${POST_SET[k][1](v)}`);
    if (patch.publishedNow) sets.push(sql`published_at = now()`);
    if (patch.activityNow || patch.publishedNow) sets.push(sql`last_activity_at = now()`);
    if (patch.resolvedNow) sets.push(sql`resolved_at = now()`);
    sets.push(sql`version = version + 1`, sql`updated_at = now()`);
    // Phase 12 (#27): a status change only from a state the community_post machine allows (on top of the version and
    // expected-status compare-and-set)
    const moves = patch.status !== undefined && patch.status !== null ? canMoveToSql(COMMUNITY_POST, String(patch.status)) : sql`true`;
    const r = await this.first<any>(sql`update community_posts set ${sql.join(sets)}
      where id = ${id} and version = ${expectedVersion} and (${expectedStatus}::text is null or status = ${expectedStatus}) and ${moves}
      returning ${POST_COLS}`);
    return r ? toPost(r) : null;
  }
  async insertPostVersion(v: { postId: string; version: number; title: string; redactedBody: string; status: string; editedByUserId: string | null; changeNote: string | null; snapshot: Record<string, unknown> }): Promise<void> {
    await this.must(sql`insert into community_post_versions (post_id, version, title, redacted_body, status, edited_by_user_id, change_note, snapshot)
      values (${v.postId}, ${v.version}, ${v.title}, ${v.redactedBody}, ${v.status}, ${v.editedByUserId}, ${v.changeNote}, ${json(v.snapshot)}::jsonb)
      on conflict (post_id, version) do nothing returning id`, 'post_version');
  }

  /** The community feed: PUBLISHED advisories only (cross-tenant by design). `term` is full-text over search_document
   *  plus title trigram similarity; it was screened for identifiers before it got here. */
  async listFeed(q: FeedRepoQuery): Promise<Paged<PostRow>> {
    const where: RawBuilder<unknown>[] = [sql`visibility = 'community_published'`, sql`status in (${sql.join(VISIBLE_STATUSES)})`];
    if (q.status === 'active') where.push(sql`status <> 'resolved'`);
    if (q.status === 'resolved') where.push(sql`status = 'resolved'`);
    if (q.category) where.push(sql`category = ${q.category}`);
    if (q.severity) where.push(sql`severity = ${q.severity}`);
    if (q.region) where.push(sql`region = ${q.region}`);
    if (q.term) where.push(sql`(search_document @@ websearch_to_tsquery('english', ${q.term}) or similarity(title, ${q.term}) > 0.3)`);
    if (q.followingOnly) where.push(sql`(id in (select pf.post_id from community_post_follows pf where pf.tenant_id = ${q.viewerTenantId} and pf.user_id = ${q.viewerUserId})
      or category in (select cf.category from community_follows cf where cf.tenant_id = ${q.viewerTenantId} and cf.category is not null))`);
    const order = q.sort === 'most_active'
      ? sql`coalesce(last_activity_at, published_at) desc nulls last, (comment_count + similar_count) desc, id`
      : q.sort === 'severity'
        ? sql`case severity when 'critical' then 5 when 'high' then 4 when 'moderate' then 3 when 'low' then 2 else 1 end desc, published_at desc nulls last, id`
        : sql`published_at desc nulls last, id`;
    const list = await this.rows<any>(sql`select ${POST_COLS}, count(*) over () as total_count from community_posts
      where ${sql.join(where, sql` and `)} order by ${order} limit ${q.limit} offset ${q.offset}`);
    return { items: list.map(toPost), total: Number(list[0]?.total_count ?? 0) };
  }
  async listMine(tenantId: string, statuses: readonly string[] | null, branchOnly: string | null | undefined, limit: number, offset: number): Promise<Paged<PostRow>> {
    const st = statuses ? sql`status in (${sql.join([...statuses])})` : sql`true`;
    const branch = branchOnly === undefined ? sql`true` : branchOnly ? sql`(origin_branch_id = ${branchOnly} or origin_branch_id is null)` : sql`origin_branch_id is null`;
    const list = await this.rows<any>(sql`select ${POST_COLS}, count(*) over () as total_count from community_posts
      where origin_tenant_id = ${tenantId} and ${st} and ${branch} order by updated_at desc, id limit ${limit} offset ${offset}`);
    return { items: list.map(toPost), total: Number(list[0]?.total_count ?? 0) };
  }
  async viewerFlags(tenantId: string, userId: string, postIds: string[]): Promise<Map<string, ViewerFlags>> {
    const out = new Map<string, ViewerFlags>();
    if (!postIds.length) return out;
    const list = await this.rows<any>(sql`
      select cp.id,
        exists (select 1 from community_post_follows pf where pf.post_id = cp.id and pf.tenant_id = ${tenantId} and pf.user_id = ${userId}) as following,
        exists (select 1 from community_similar_experiences se where se.post_id = cp.id and se.tenant_id = ${tenantId}) as similar,
        (select count(*) from community_evidence ev where ev.post_id = cp.id and ev.upload_status = 'uploaded' and ev.removed_at is null)::int as evidence_count,
        (select count(*) from community_evidence ev2 where ev2.post_id = cp.id and ev2.upload_status = 'uploaded' and ev2.removed_at is null
           and ev2.scan_status = 'clean' and ev2.redaction_status <> 'pending')::int as evidence_reviewed
      from community_posts cp where cp.id in (${sql.join(postIds)})`);
    for (const r of list) out.set(String(r.id), { following: !!r.following, similar: !!r.similar, evidenceCount: Number(r.evidence_count ?? 0), evidenceReviewed: Number(r.evidence_reviewed ?? 0) });
    return out;
  }
  async listUpdates(postId: string): Promise<UpdateRow[]> {
    return (await this.rows<any>(sql`select * from community_post_updates where post_id = ${postId} and visibility = 'community_published' order by created_at asc limit 100`)).map(toUpdate);
  }
  async addUpdate(ctx: CommunityCtx, postId: string, redactedBody: string): Promise<UpdateRow> {
    const r = await this.must<any>(sql`insert into community_post_updates (post_id, tenant_id, redacted_body, created_by_user_id)
      values (${postId}, ${ctx.tenantId}, ${redactedBody}, ${ctx.userId}) returning *`, 'post_update');
    return toUpdate(r);
  }
  async listRelated(postId: string): Promise<RelatedRow[]> {
    const list = await this.rows<any>(sql`
      select rp.related_post_id as other_id, rp.relation, rp.score from community_related_posts rp where rp.post_id = ${postId}
      union all
      select rq.post_id as other_id, rq.relation, rq.score from community_related_posts rq where rq.related_post_id = ${postId} and rq.relation <> 'merged_into'`);
    if (!list.length) return [];
    const ids = [...new Set(list.map((r) => String(r.other_id)))];
    const posts = await this.rows<any>(sql`select id, title, severity, published_at from community_posts
      where id in (${sql.join(ids)}) and visibility = 'community_published' and status in (${sql.join(VISIBLE_STATUSES)})`);
    const byId = new Map(posts.map((p) => [String(p.id), p]));
    const seen = new Set<string>();
    return list.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)).flatMap((r) => {
      const p = byId.get(String(r.other_id));
      if (!p || seen.has(String(p.id))) return [];
      seen.add(String(p.id));
      return [{ id: String(p.id), title: p.title, relation: r.relation, severity: p.severity, publishedAt: isoOrNull(p.published_at) }];
    }).slice(0, 10);
  }
  /** The note the posting salon sees when its advisory came back: an approver's return note (a version row) or the
   *  moderator's message (agent B's action row: detail.messageToTenant, else the action reason). Newest wins. */
  async returnReason(postId: string): Promise<string | null> {
    const r = await this.first<any>(sql`
      select note from (
        select pv.change_note as note, pv.created_at as at from community_post_versions pv
          where pv.post_id = ${postId} and pv.change_note is not null
            and pv.status in ('returned_for_correction', 'rejected', 'evidence_requested', 'sensitive_data_detected')
        union all
        select coalesce(ma.detail->>'messageToTenant', ma.reason) as note, ma.created_at as at from community_moderation_actions ma
          where ma.post_id = ${postId} and ma.action in ('reject', 'request_changes', 'request_evidence')
      ) notes where note is not null order by at desc limit 1`);
    return r?.note ?? null;
  }
  /** Search runs ONLY over the REDACTED body + title of PUBLISHED advisories — the raw incident text in
   *  tenant_private_incidents is never searchable and never leaves its tenant. */
  async abuseCounters(tenantId: string): Promise<AbuseCounters> {
    const r = await this.first<any>(sql`
      select
        (select count(*) from community_posts where origin_tenant_id = ${tenantId} and created_at > now() - interval '1 hour')::int as posts_hour,
        (select count(*) from community_posts where origin_tenant_id = ${tenantId} and created_at > now() - interval '1 day')::int  as posts_day,
        (select count(*) from community_comments where tenant_id = ${tenantId} and created_at > now() - interval '1 hour')::int      as comments_hour,
        (select count(*) from community_reports where reporter_tenant_id = ${tenantId} and created_at > now() - interval '1 day')::int as reports_day,
        (select count(*) from audit_logs where tenant_id = ${tenantId} and action_type = 'community.search.rejected' and created_at > now() - interval '1 day')::int as rejected_day,
        (select count(*) from audit_logs where tenant_id = ${tenantId} and action_type = 'community.search.performed' and created_at > now() - interval '1 hour')::int as searches_hour,
        (select count(*) from community_disputes where raised_by_tenant_id = ${tenantId} and created_at > now() - interval '1 day')::int as disputes_day
    `);
    return {
      postsLastHour: Number(r?.posts_hour ?? 0), postsLastDay: Number(r?.posts_day ?? 0),
      commentsLastHour: Number(r?.comments_hour ?? 0), reportsLastDay: Number(r?.reports_day ?? 0),
      searchesLastHour: Number(r?.searches_hour ?? 0),
      rejectedSearchesLastDay: Number(r?.rejected_day ?? 0),
      disputesLastDay: Number(r?.disputes_day ?? 0),
    };
  }
  async tenantReputation(tenantId: string): Promise<TenantReputation> {
    const r = await this.first<any>(sql`
      select
        (select count(*) from community_posts where origin_tenant_id = ${tenantId} and visibility = 'community_published')::int as published,
        (select count(*) from community_posts where origin_tenant_id = ${tenantId} and status = 'removed')::int as removed,
        (select count(*) from community_disputes d join community_posts p on p.id = d.post_id
          where p.origin_tenant_id = ${tenantId} and d.status = 'upheld')::int as upheld
    `);
    return { postsPublished: Number(r?.published ?? 0), postsRemovedByModeration: Number(r?.removed ?? 0), disputesUpheldAgainst: Number(r?.upheld ?? 0) };
  }
  async platformSetting(key: string): Promise<unknown> {
    const r = await this.first<any>(sql`select value from platform_settings where setting_key = ${key}`);
    return r ? jparse(r.value, null) : null;
  }
  async createReport(ctx: CommunityCtx, postId: string, reason: string, detail: string | null): Promise<{ report: ReportRow; reportCount: number } | null> {
    const r = await this.first<any>(sql`
      insert into community_reports (post_id, reporter_tenant_id, reporter_user_id, reason, detail)
      values (${postId}, ${ctx.tenantId}, ${ctx.userId}, ${reason}, ${detail})
      on conflict (post_id, reporter_tenant_id) where status in ('open', 'reviewing') do nothing returning *`);
    if (!r) return null;
    const c = await this.must<any>(sql`update community_posts set report_count = report_count + 1 where id = ${postId} returning report_count`, 'report_count');
    return { report: { id: String(r.id), postId, reporterTenantId: ctx.tenantId, reason, detail, status: r.status, createdAt: iso(r.created_at) }, reportCount: Number(c.report_count) };
  }
  async createDispute(ctx: CommunityCtx, postId: string, reason: string, raisedByKind: string): Promise<DisputeRow | null> {
    const open = await this.first(sql`select 1 as found from community_disputes where post_id = ${postId} and raised_by_tenant_id = ${ctx.tenantId} and status in ('open', 'under_review')`);
    if (open) return null;
    const r = await this.must<any>(sql`
      insert into community_disputes (post_id, raised_by_tenant_id, raised_by_user_id, raised_by_kind, reason)
      values (${postId}, ${ctx.tenantId}, ${ctx.userId}, ${raisedByKind}, ${reason}) returning *`, 'dispute');
    return { id: String(r.id), postId, raisedByTenantId: ctx.tenantId, raisedByKind, reason, status: r.status, createdAt: iso(r.created_at) };
  }
  /** The moderator who last acted on this post — read from the case-keyed moderation trail. Used to enforce
   *  appeal reviewer separation (the original decider may not review the appeal against their own decision). */
  async lastModeratorFor(postId: string): Promise<string | null> {
    const r = await this.first<any>(sql`
      select actor_user_id from community_moderation_actions
      where post_id = ${postId} or detail->>'postId' = ${postId}
      order by created_at desc limit 1`);
    return r?.actor_user_id ? String(r.actor_user_id) : null;
  }
  async commentRef(commentId: string): Promise<{ id: string; postId: string; tenantId: string; visibility: string } | null> {
    const r = await this.first<any>(sql`select id, post_id, tenant_id, visibility from community_comments where id = ${commentId}`);
    return r ? { id: String(r.id), postId: String(r.post_id), tenantId: String(r.tenant_id), visibility: r.visibility } : null;
  }
  async openAppealExists(tenantId: string, postId: string | null, subject: string, commentId: string | null): Promise<boolean> {
    const r = await this.first(sql`select 1 as found from community_appeals where appellant_tenant_id = ${tenantId} and subject = ${subject}
      and post_id is not distinct from ${postId}::uuid and comment_id is not distinct from ${commentId}::uuid and status in ('submitted', 'under_review')`);
    return !!r;
  }
  async createAppeal(ctx: CommunityCtx, input: { postId?: string | null; commentId?: string | null; subject: string; reason: string; originalDecision?: string | null; originalDeciderUserId?: string | null }): Promise<AppealRow> {
    const r = await this.must<any>(sql`
      insert into community_appeals (post_id, comment_id, appellant_tenant_id, appellant_user_id, subject, reason, original_decision, original_decider_user_id)
      values (${input.postId ?? null}, ${input.commentId ?? null}, ${ctx.tenantId}, ${ctx.userId}, ${input.subject}, ${input.reason},
              ${input.originalDecision ?? null}, ${input.originalDeciderUserId ?? null})
      returning *`, 'appeal');
    return toAppeal(r);
  }
  async listAppealsForTenant(tenantId: string, limit: number): Promise<AppealRow[]> {
    return (await this.rows<any>(sql`select * from community_appeals where appellant_tenant_id = ${tenantId} order by created_at desc limit ${limit}`)).map(toAppeal);
  }

  /**
   * Who should be alerted about this advisory (kept for agent C's notifier). Joins the tenants that have the community
   * ENABLED to their real contact address; the posting tenant is excluded; a tenant with no usable address is skipped.
   */
  async listSubscribers(post: PostRow): Promise<SubscriberRow[]> {
    const critical = post.severity === 'critical';
    const list = await this.rows<any>(sql`
      select s.tenant_id,
             s.critical_sms_enabled,
             s.enabled as community_enabled,
             t.email       as email,
             t.business_phone as phone,
             coalesce(array_agg(f.category) filter (where f.category is not null), '{}') as follow_categories,
             max(f.region) as follow_region
      from tenant_community_settings s
      join tenants t on t.id = s.tenant_id
      left join community_follows f on f.tenant_id = s.tenant_id
      where s.enabled = true
        and s.tenant_id <> ${post.originTenantId}
      group by s.tenant_id, s.critical_sms_enabled, s.enabled, t.email, t.business_phone`);
    return list
      .map((r) => {
        const useSms = critical && !!r.critical_sms_enabled && !!r.phone;
        const address = useSms ? String(r.phone) : (r.email ? String(r.email) : '');
        return {
          tenantId: String(r.tenant_id), address,
          followsCategories: Array.isArray(r.follow_categories) ? r.follow_categories.filter(Boolean) : [],
          region: r.follow_region ?? null, criticalSmsEnabled: !!r.critical_sms_enabled, communityEnabled: !!r.community_enabled,
        };
      })
      .filter((s) => s.address !== '');
  }
}

// ── In-memory fake (dev/tests) — same contract, including CAS and "one open report / dispute per salon". ──
export class InMemoryCommunityRepo implements CommunityRepo {
  private incidents = new Map<string, IncidentRow>();
  private posts = new Map<string, PostRow>();
  private settings = new Map<string, TenantSettingsRow>();
  private names = new Map<string, string>();
  private acks = new Set<string>();
  versions: { postId: string; version: number; status: string; changeNote: string | null; editedByUserId: string | null; at: number }[] = [];
  moderationNotes: { postId: string; action: string; note: string; at: number }[] = [];
  private updates: UpdateRow[] = [];
  private related: { postId: string; relatedPostId: string; relation: RelatedRow['relation']; score: number }[] = [];
  private flags = new Map<string, ViewerFlags>();
  private platform = new Map<string, unknown>();
  private id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });
  private seq = 0;
  private now = () => new Date(Date.UTC(2026, 9, 8, 12, 0, this.seq++)).toISOString();

  async tx<T>(fn: (repo: CommunityRepo, trx: unknown) => Promise<T>): Promise<T> { return fn(this, undefined); }
  setTenantName(tenantId: string, name: string) { this.names.set(tenantId, name); }
  async tenantDisplayName(tenantId: string) { return this.names.get(tenantId) ?? null; }
  async getSettings(tenantId: string) { const s = this.settings.get(tenantId); return s ? { ...s } : null; }
  setSettings(s: TenantSettingsRow) { this.settings.set(s.tenantId, { exists: true, version: 1, ...s }); }
  async insertSettings(tenantId: string, patch: SettingsPatch): Promise<TenantSettingsRow | null> {
    if (this.settings.has(tenantId)) return null;
    const row = { ...DEFAULT_SETTINGS(tenantId), ...strip(patch), version: 1, exists: true };
    this.settings.set(tenantId, row); return { ...row };
  }
  async updateSettings(tenantId: string, expectedVersion: number, patch: SettingsPatch): Promise<TenantSettingsRow | null> {
    const cur = this.settings.get(tenantId);
    if (!cur || (cur.version ?? 1) !== expectedVersion) return null;
    const row = { ...cur, ...strip(patch), version: (cur.version ?? 1) + 1 };
    this.settings.set(tenantId, row); return { ...row };
  }
  async hasAcknowledgedRules(tenantId: string, userId: string, v: string) { return this.acks.has(`${tenantId}|${userId}|${v}`); }
  async acknowledgeRules(tenantId: string, userId: string, v: string) { this.acks.add(`${tenantId}|${userId}|${v}`); }

  async createIncident(ctx: CommunityCtx, input: { category: string; severity: string; rawDetail: string | null; occurredOn?: string | null }): Promise<IncidentRow> {
    const row: IncidentRow = { id: this.id(), tenantId: ctx.tenantId, branchId: ctx.branchId || null, category: input.category, severity: input.severity, rawDetail: input.rawDetail, advisoryPostId: null, createdAt: this.now(), occurredOn: input.occurredOn ?? null, createdByUserId: ctx.userId };
    this.incidents.set(row.id, row); return { ...row };
  }
  async getIncident(ctx: CommunityCtx, id: string) { const r = this.incidents.get(id); return r && r.tenantId === ctx.tenantId ? { ...r } : null; }
  async listIncidents(tenantId: string, scope: { branchOnly: string | null | undefined }, limit: number, offset: number) {
    const all = [...this.incidents.values()].filter((i) => i.tenantId === tenantId
      && (scope.branchOnly === undefined || i.branchId === null || i.branchId === scope.branchOnly)).reverse();
    return { items: all.slice(offset, offset + limit).map((i) => ({ ...i })), total: all.length };
  }
  async linkIncidentAdvisory(ctx: CommunityCtx, incidentId: string, postId: string) { const r = this.incidents.get(incidentId); if (!r || r.tenantId !== ctx.tenantId) throw new Error('community_write_failed:incident_link'); r.advisoryPostId = postId; }
  async incidentForPost(tenantId: string, postId: string) { return [...this.incidents.values()].find((i) => i.tenantId === tenantId && i.advisoryPostId === postId)?.id ?? null; }

  async createPost(input: any): Promise<PostRow> {
    const at = this.now();
    const row: PostRow = { id: this.id(), originTenantId: input.originTenantId, originBranchId: input.originBranchId || null, classification: 'community_advisory', visibility: input.visibility ?? 'draft', status: input.status ?? 'incident_draft', category: input.category, severity: input.severity ?? 'moderate', region: input.region ?? null, title: input.title, redactedBody: input.redactedBody, privacyScanFlags: input.privacyScanFlags ?? [], moderationRequired: input.moderationRequired ?? false, verificationLabel: 'unverified', version: 1, createdByUserId: input.createdByUserId, createdAt: at, updatedAt: at, publishedAt: null,
      incidentDate: input.incidentDate ?? null, scamMethod: input.scamMethod ?? null, channels: input.channels ?? [], recommendation: input.recommendation ?? null, tags: input.tags ?? [], paymentProcessor: input.paymentProcessor ?? null, amountRange: input.amountRange ?? null, officialReference: input.officialReference ?? null, authorDisplay: input.authorDisplay ?? 'display_name', authorLabel: null,
      commentCount: 0, reportCount: 0, similarCount: 0, followerCount: 0, lastActivityAt: null, resolvedAt: null, resolutionNote: null, commentsLocked: false, removedReason: null, submittedByUserId: null, mergedIntoPostId: null, approvedByUserId: null };
    this.posts.set(row.id, row); return { ...row };
  }
  async getPost(id: string) { const r = this.posts.get(id); return r ? { ...r } : null; }
  /** test helper: force fields (e.g. a moderator's state) */
  patchPostRaw(id: string, patch: Partial<PostRow>) { const r = this.posts.get(id); if (r) Object.assign(r, patch); }
  async updatePost(id: string, expectedVersion: number, expectedStatus: string | null, patch: PostPatch): Promise<PostRow | null> {
    const r = this.posts.get(id);
    if (!r || r.version !== expectedVersion || (expectedStatus !== null && r.status !== expectedStatus)) return null;
    const { publishedNow, activityNow, resolvedNow, ...rest } = patch;
    const at = this.now();
    Object.assign(r, strip(rest), { version: r.version + 1, updatedAt: at });
    if (publishedNow) r.publishedAt = at;
    if (publishedNow || activityNow) r.lastActivityAt = at;
    if (resolvedNow) r.resolvedAt = at;
    if (r.status.startsWith('published_') && r.visibility !== 'community_published') throw new Error('ck_published_visibility');
    return { ...r };
  }
  async insertPostVersion(v: { postId: string; version: number; status: string; editedByUserId: string | null; changeNote: string | null }) {
    this.versions.push({ postId: v.postId, version: v.version, status: v.status, changeNote: v.changeNote, editedByUserId: v.editedByUserId, at: this.seq++ });
  }
  async listFeed(q: FeedRepoQuery) {
    const t = q.term?.toLowerCase() ?? null;
    let all = [...this.posts.values()].filter((p) => p.visibility === 'community_published' && VISIBLE_STATUSES.includes(p.status)
      && (q.status !== 'active' || p.status !== 'resolved') && (q.status !== 'resolved' || p.status === 'resolved')
      && (!q.category || p.category === q.category) && (!q.severity || p.severity === q.severity) && (!q.region || p.region === q.region)
      && (!t || p.title.toLowerCase().includes(t) || p.redactedBody.toLowerCase().includes(t)));
    const rank: Record<string, number> = { critical: 5, high: 4, moderate: 3, low: 2, informational: 1 };
    all = all.sort((a, b) => q.sort === 'severity' ? (rank[b.severity] - rank[a.severity]) || String(b.publishedAt).localeCompare(String(a.publishedAt))
      : q.sort === 'most_active' ? String(b.lastActivityAt ?? b.publishedAt).localeCompare(String(a.lastActivityAt ?? a.publishedAt))
        : String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { items: all.slice(q.offset, q.offset + q.limit).map((p) => ({ ...p })), total: all.length };
  }
  async listMine(tenantId: string, statuses: readonly string[] | null, branchOnly: string | null | undefined, limit: number, offset: number) {
    const all = [...this.posts.values()].filter((p) => p.originTenantId === tenantId && (!statuses || statuses.includes(p.status))
      && (branchOnly === undefined || p.originBranchId === null || p.originBranchId === branchOnly)).reverse();
    return { items: all.slice(offset, offset + limit).map((p) => ({ ...p })), total: all.length };
  }
  setViewerFlags(postId: string, f: Partial<ViewerFlags>) { this.flags.set(postId, { following: false, similar: false, evidenceCount: 0, evidenceReviewed: 0, ...f }); }
  async viewerFlags(_t: string, _u: string, postIds: string[]) {
    const m = new Map<string, ViewerFlags>();
    for (const id of postIds) m.set(id, this.flags.get(id) ?? { following: false, similar: false, evidenceCount: 0, evidenceReviewed: 0 });
    return m;
  }
  async listUpdates(postId: string) { return this.updates.filter((u) => u.postId === postId).map((u) => ({ ...u })); }
  async addUpdate(ctx: CommunityCtx, postId: string, redactedBody: string) {
    const u: UpdateRow = { id: this.id(), postId, tenantId: ctx.tenantId, redactedBody, createdByUserId: ctx.userId, createdAt: this.now() };
    this.updates.push(u); return { ...u };
  }
  addRelated(postId: string, relatedPostId: string, relation: RelatedRow['relation'], score = 0.7) { this.related.push({ postId, relatedPostId, relation, score }); }
  async listRelated(postId: string) {
    return this.related.filter((r) => r.postId === postId).flatMap((r) => {
      const p = this.posts.get(r.relatedPostId);
      return p && p.visibility === 'community_published' ? [{ id: p.id, title: p.title, relation: r.relation, severity: p.severity, publishedAt: p.publishedAt ?? null }] : [];
    });
  }
  addModerationNote(postId: string, action: string, note: string) { this.moderationNotes.push({ postId, action, note, at: this.seq++ }); }
  async returnReason(postId: string) {
    const notes = [
      ...this.versions.filter((v) => v.postId === postId && v.changeNote && ['returned_for_correction', 'rejected', 'evidence_requested', 'sensitive_data_detected'].includes(v.status)).map((v) => ({ note: v.changeNote!, at: v.at })),
      ...this.moderationNotes.filter((n) => n.postId === postId && ['reject', 'request_changes', 'request_evidence'].includes(n.action)),
    ].sort((a, b) => b.at - a.at);
    return notes[0]?.note ?? null;
  }
  counters: AbuseCounters = { postsLastHour: 0, postsLastDay: 0, commentsLastHour: 0, reportsLastDay: 0, searchesLastHour: 0, rejectedSearchesLastDay: 0, disputesLastDay: 0 };
  reputation: TenantReputation = { postsPublished: 0, postsRemovedByModeration: 0, disputesUpheldAgainst: 0 };
  async abuseCounters() { return { ...this.counters }; }
  async tenantReputation() { return { ...this.reputation }; }
  setCounters(c: Partial<AbuseCounters>) { this.counters = { ...this.counters, ...c }; }
  setReputation(r: Partial<TenantReputation>) { this.reputation = { ...this.reputation, ...r }; }
  setPlatformSetting(key: string, v: unknown) { this.platform.set(key, v); }
  async platformSetting(key: string) { return this.platform.get(key) ?? null; }
  reports: ReportRow[] = []; disputes: DisputeRow[] = [];
  async createReport(ctx: CommunityCtx, postId: string, reason: string, detail: string | null) {
    if (this.reports.some((r) => r.postId === postId && r.reporterTenantId === ctx.tenantId && (r.status === 'open' || r.status === 'reviewing'))) return null;
    const report: ReportRow = { id: this.id(), postId, reporterTenantId: ctx.tenantId, reason, detail, status: 'open', createdAt: this.now() };
    this.reports.push(report);
    const p = this.posts.get(postId)!; p.reportCount = (p.reportCount ?? 0) + 1;
    return { report: { ...report }, reportCount: p.reportCount };
  }
  async createDispute(ctx: CommunityCtx, postId: string, reason: string, raisedByKind: string) {
    if (this.disputes.some((d) => d.postId === postId && d.raisedByTenantId === ctx.tenantId && (d.status === 'open' || d.status === 'under_review'))) return null;
    const row: DisputeRow = { id: this.id(), postId, raisedByTenantId: ctx.tenantId, raisedByKind, reason, status: 'open', createdAt: this.now() };
    this.disputes.push(row); return { ...row };
  }
  private lastMods = new Map<string, string>();
  setLastModerator(postId: string, userId: string) { this.lastMods.set(postId, userId); }
  async lastModeratorFor(postId: string) { return this.lastMods.get(postId) ?? null; }
  private comments = new Map<string, { id: string; postId: string; tenantId: string; visibility: string }>();
  setComment(c: { id: string; postId: string; tenantId: string; visibility: string }) { this.comments.set(c.id, c); }
  async commentRef(id: string) { return this.comments.get(id) ?? null; }
  appeals: AppealRow[] = [];
  async openAppealExists(tenantId: string, postId: string | null, subject: string, commentId: string | null) {
    return this.appeals.some((a) => a.appellantTenantId === tenantId && a.postId === postId && a.subject === subject && (a.commentId ?? null) === commentId && (a.status === 'submitted' || a.status === 'under_review'));
  }
  async createAppeal(ctx: CommunityCtx, input: { postId?: string | null; commentId?: string | null; subject: string; reason: string; originalDecision?: string | null; originalDeciderUserId?: string | null }): Promise<AppealRow> {
    const row: AppealRow = { id: this.id(), postId: input.postId ?? null, commentId: input.commentId ?? null, appellantTenantId: ctx.tenantId, appellantUserId: ctx.userId, subject: input.subject, reason: input.reason, status: 'submitted', originalDeciderUserId: input.originalDeciderUserId ?? null, decidedByUserId: null, decisionNote: null, createdAt: this.now(), decidedAt: null };
    this.appeals.push(row); return { ...row };
  }
  async listAppealsForTenant(tenantId: string, limit: number) { return this.appeals.filter((a) => a.appellantTenantId === tenantId).slice(-limit).reverse().map((a) => ({ ...a })); }
  private subs: SubscriberRow[] = [];
  setSubscribers(list: SubscriberRow[]) { this.subs = list; }
  async listSubscribers(post: PostRow): Promise<SubscriberRow[]> { return this.subs.filter((s) => s.tenantId !== post.originTenantId && s.address); }
}

function strip<T extends object>(o: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
