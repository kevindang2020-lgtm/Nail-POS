// community-moderation.repository.ts — BUILD_PLAN Phase 8 (agent B): persistence for the Super Admin "Safety Community
// Moderation" center. Raw SQL over migrations 360 / 362 / 529. Every WRITE runs inside the caller's transaction (the
// service passes the handle) so the post change, its version row, the moderation action, the case, the audit row and the
// outbox events commit together or not at all. Nothing here swallows an error: a failed write throws (bug 7's lesson).
//
// CROSS-TENANT BY DESIGN: this repository serves ONLY the Super Admin moderation center (SuperAdminGuard on
// CommunityModerationController, 'super-admin/community-moderation'). Reading every salon's advisories, reports, comments,
// evidence metadata and restrictions is the moderator's job; it never serves a tenant session. A private incident is read
// only by id under an `incident_access` case (the service checks the case first and audits the read loudly).
import { sql, type Kysely } from 'kysely';
import type { PostRow } from './community.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { COMMUNITY_APPEAL, COMMUNITY_COMMENT_REPORT, COMMUNITY_DISPUTE, COMMUNITY_MODERATION_CASE, COMMUNITY_POST, COMMUNITY_REPORT } from './community-lifecycles';

export type Exec = Kysely<any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const iso = (v: any): string => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: any): string | null => (v == null ? null : iso(v));
const jarr = (v: any): any[] => { try { const x = v == null ? [] : typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(x) ? x : []; } catch { return []; } };
const jobj = (v: any): Record<string, unknown> => { try { const x = v == null ? {} : typeof v === 'string' ? JSON.parse(v) : v; return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
const num = (v: any): number => (v == null ? 0 : Number(v));
const dateOnly = (v: any): string | null => { if (v == null) return null; if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`; return String(v).slice(0, 10); };

/** A post row with the moderator-only joins (salon / branch / author names, open reports, disputes, evidence). */
export interface ModPostRow extends PostRow {
  originTenantName: string; originBranchName: string | null; createdByName: string | null;
  openReports: number; disputeCount: number; evidenceCount: number;
}

export function toPostRow(r: any): PostRow {
  return {
    id: String(r.id), originTenantId: String(r.origin_tenant_id), originBranchId: r.origin_branch_id ?? null,
    classification: r.classification ?? 'community_advisory', visibility: r.visibility, status: r.status, category: r.category,
    severity: r.severity, region: r.region ?? null, title: r.title, redactedBody: r.redacted_body, privacyScanFlags: jarr(r.privacy_scan_flags),
    moderationRequired: !!r.moderation_required, verificationLabel: r.verification_label ?? 'unverified', version: num(r.version ?? 1),
    createdByUserId: String(r.created_by_user_id), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), publishedAt: isoOrNull(r.published_at),
    incidentDate: dateOnly(r.incident_date), scamMethod: r.scam_method ?? null, channels: jarr(r.channels), recommendation: r.recommendation ?? null,
    tags: jarr(r.tags), paymentProcessor: r.payment_processor ?? null, amountRange: r.amount_range ?? null, officialReference: r.official_reference ?? null,
    authorDisplay: r.author_display ?? 'display_name', authorLabel: r.author_label ?? null,
    commentCount: num(r.comment_count), reportCount: num(r.report_count), similarCount: num(r.similar_count), followerCount: num(r.follower_count),
    lastActivityAt: isoOrNull(r.last_activity_at), resolvedAt: isoOrNull(r.resolved_at), resolutionNote: r.resolution_note ?? null,
    commentsLocked: !!r.comments_locked, removedReason: r.removed_reason ?? null, submittedByUserId: r.submitted_by_user_id ?? null,
    mergedIntoPostId: r.merged_into_post_id ?? null, approvedByUserId: r.approved_by_user_id ?? null,
  } as PostRow;
}
const toModPostRow = (r: any): ModPostRow => ({
  ...toPostRow(r), originTenantName: r.origin_tenant_name ?? '', originBranchName: r.origin_branch_name ?? null, createdByName: r.created_by_name ?? null,
  openReports: num(r.open_reports), disputeCount: num(r.dispute_count), evidenceCount: num(r.evidence_count),
});

export interface CaseRow {
  id: string; kind: string; status: string; priority: string; reason: string; postId: string | null; postTitle: string | null;
  commentId: string | null; incidentId: string | null; targetTenantId: string | null; targetTenantName: string | null;
  openedByUserId: string; openedByName: string | null; assignedToUserId: string | null; assignedToName: string | null;
  resolutionNote: string | null; createdAt: string; updatedAt: string; closedAt: string | null;
}
const toCase = (r: any): CaseRow => ({
  id: String(r.id), kind: r.kind ?? 'post_review', status: r.status, priority: r.priority ?? 'normal', reason: r.reason,
  postId: r.post_id ?? null, postTitle: r.post_title ?? null, commentId: r.comment_id ?? null, incidentId: r.incident_id ?? null,
  targetTenantId: r.target_tenant_id ?? null, targetTenantName: r.target_tenant_name ?? null,
  openedByUserId: String(r.opened_by_user_id), openedByName: r.opened_by_name ?? null,
  assignedToUserId: r.assigned_to_user_id ?? null, assignedToName: r.assigned_to_name ?? null,
  resolutionNote: r.resolution_note ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at ?? r.created_at), closedAt: isoOrNull(r.closed_at),
});
export interface ActionRow { id: string; caseId: string; action: string; actorUserId: string; actorName: string | null; reason: string | null; postId: string | null; commentId: string | null; targetTenantId: string | null; targetTenantName: string | null; detail: Record<string, unknown>; createdAt: string }
const toAction = (r: any): ActionRow => ({
  id: String(r.id), caseId: String(r.case_id), action: r.action, actorUserId: String(r.actor_user_id), actorName: r.actor_name ?? null, reason: r.reason ?? null,
  postId: r.post_id ?? null, commentId: r.comment_id ?? null, targetTenantId: r.target_tenant_id ?? null, targetTenantName: r.target_tenant_name ?? null,
  detail: jobj(r.detail), createdAt: iso(r.created_at),
});
export interface ReportRowM { id: string; kind: 'post' | 'comment'; postId: string; commentId: string | null; reporterTenantId: string; reporterTenantName: string; reason: string; detail: string | null; status: string; caseId: string | null; createdAt: string }
const toReport = (kind: 'post' | 'comment') => (r: any): ReportRowM => ({
  id: String(r.id), kind, postId: String(r.post_id), commentId: r.comment_id ?? null, reporterTenantId: String(r.reporter_tenant_id), reporterTenantName: r.reporter_tenant_name ?? '',
  reason: r.reason, detail: r.detail ?? null, status: r.status, caseId: r.case_id ?? null, createdAt: iso(r.created_at),
});
export interface DisputeRowM { id: string; postId: string; raisedByKind: string; raisedByTenantId: string | null; raisedByTenantName: string | null; reason: string; status: string; resolutionNote: string | null; caseId: string | null; createdAt: string }
const toDispute = (r: any): DisputeRowM => ({
  id: String(r.id), postId: String(r.post_id), raisedByKind: r.raised_by_kind, raisedByTenantId: r.raised_by_tenant_id ?? null, raisedByTenantName: r.raised_by_tenant_name ?? null,
  reason: r.reason, status: r.status, resolutionNote: r.resolution_note ?? null, caseId: r.case_id ?? null, createdAt: iso(r.created_at),
});
export interface AppealRowM { id: string; postId: string | null; commentId: string | null; appellantTenantId: string; appellantTenantName: string; subject: string; reason: string; status: string; originalDecision: string | null; originalDeciderUserId: string | null; decidedByUserId: string | null; decisionNote: string | null; caseId: string | null; createdAt: string; decidedAt: string | null }
const toAppeal = (r: any): AppealRowM => ({
  id: String(r.id), postId: r.post_id ?? null, commentId: r.comment_id ?? null, appellantTenantId: String(r.appellant_tenant_id), appellantTenantName: r.appellant_tenant_name ?? '',
  subject: r.subject, reason: r.reason, status: r.status, originalDecision: r.original_decision ?? null, originalDeciderUserId: r.original_decider_user_id ?? null,
  decidedByUserId: r.decided_by_user_id ?? null, decisionNote: r.decision_note ?? null, caseId: r.moderation_case_id ?? null, createdAt: iso(r.created_at), decidedAt: isoOrNull(r.decided_at),
});
export interface EvidenceRowM { id: string; postId: string | null; incidentId: string | null; tenantId: string; tenantName: string; mimeType: string | null; sizeBytes: number | null; uploadStatus: string; scanStatus: string; redactionStatus: string; createdAt: string }
const toEvidence = (r: any): EvidenceRowM => ({
  id: String(r.id), postId: r.post_id ?? null, incidentId: r.incident_id ?? null, tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? '',
  mimeType: r.mime_type ?? null, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), uploadStatus: r.upload_status ?? 'pending_upload',
  scanStatus: r.scan_status ?? 'unscanned', redactionStatus: r.redaction_status ?? 'pending', createdAt: iso(r.created_at),
});
export interface CommentRowM { id: string; postId: string; parentId: string | null; tenantId: string; tenantName: string; body: string; authorLabel: string | null; visibility: string; removedReason: string | null; reportCount: number; version: number; createdAt: string }
const toComment = (r: any): CommentRowM => ({
  id: String(r.id), postId: String(r.post_id), parentId: r.parent_id ?? null, tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? '', body: r.redacted_body,
  authorLabel: r.author_label ?? null, visibility: r.visibility, removedReason: r.removed_reason ?? null, reportCount: num(r.report_count), version: num(r.version ?? 1), createdAt: iso(r.created_at),
});
export interface RestrictionRow { id: string; tenantId: string; tenantName: string; userId: string | null; kind: 'suspended' | 'posting_restricted' | 'commenting_restricted'; reason: string; caseId: string | null; expiresAt: string | null; createdAt: string; liftedAt: string | null }
const toRestriction = (r: any): RestrictionRow => ({
  id: String(r.id), tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? '', userId: r.user_id ?? null, kind: r.kind, reason: r.reason, caseId: r.case_id ?? null,
  expiresAt: isoOrNull(r.expires_at), createdAt: iso(r.created_at), liftedAt: isoOrNull(r.lifted_at),
});
export interface IncidentRowM { id: string; tenantId: string; tenantName: string; branchId: string | null; category: string; severity: string; occurredOn: string | null; rawDetail: string | null; advisoryPostId: string | null; createdAt: string }

/** The next full state of a post, written column by column (never a client object). */
export interface PostWrite {
  status: string; visibility: string; verificationLabel: string; severity: string; title: string; redactedBody: string;
  recommendation: string | null; officialReference: string | null; privacyScanFlags: string[]; commentsLocked: boolean;
  removedReason: string | null; mergedIntoPostId: string | null; authorLabel: string | null; publishedAt: string | null;
  resolvedAt: string | null; resolutionNote: string | null;
}

const POST_SELECT = sql`
  select p.*, coalesce(t.display_name, t.legal_name) as origin_tenant_name, b.name as origin_branch_name, u.full_name as created_by_name,
         (select count(*) from community_reports r where r.post_id = p.id and r.status in ('open','reviewing'))::int as open_reports,
         (select count(*) from community_disputes d where d.post_id = p.id)::int as dispute_count,
         (select count(*) from community_evidence e where e.post_id = p.id and e.removed_at is null)::int as evidence_count
    from community_posts p
    left join tenants t on t.id = p.origin_tenant_id
    left join branches b on b.id = p.origin_branch_id
    left join users u on u.id = p.created_by_user_id`;

export class CommunityModerationRepo {
  constructor(readonly db: Exec) {}

  /** One transaction for a whole moderator action. */
  tx<T>(fn: (trx: Exec) => Promise<T>): Promise<T> { return this.db.transaction().execute((trx) => fn(trx as unknown as Exec)); }

  // ── posts ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async lockPost(trx: Exec, id: string): Promise<PostRow | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select * from community_posts where id = ${id} for update`.execute(trx)).rows[0];
    return r ? toPostRow(r) : null;
  }
  async getPost(id: string, ex: Exec = this.db): Promise<ModPostRow | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`${POST_SELECT} where p.id = ${id}`.execute(ex)).rows[0];
    return r ? toModPostRow(r) : null;
  }
  async listPosts(f: { queue: string; q: string | null; category: string | null; severity: string | null; limit: number; offset: number }): Promise<{ rows: ModPostRow[]; total: number }> {
    const rs = (await sql<any>`
      with picked as (
        select p.id from community_posts p
         where (case ${f.queue}::text
                  when 'review' then (p.status = 'moderation_review'
                                      or (p.status = 'evidence_requested' and exists (select 1 from community_evidence e2 where e2.post_id = p.id and e2.created_at > p.updated_at)))
                  when 'sensitive' then p.status = 'sensitive_data_detected'
                  when 'returned' then p.status in ('returned_for_correction', 'evidence_requested')
                  when 'published' then p.visibility = 'community_published'
                  when 'removed' then p.status = 'removed'
                  else true end)
           and (${f.category}::text is null or p.category = ${f.category}::text)
           and (${f.severity}::text is null or p.severity = ${f.severity}::text)
           and (${f.q}::text is null or p.search_document @@ plainto_tsquery('english', ${f.q}::text) or p.title ilike '%' || ${f.q}::text || '%')
      )
      select x.*, (select count(*) from picked)::int as total_count from (
        ${POST_SELECT} where p.id in (select id from picked)
      ) x
      order by case when ${f.queue}::text in ('review', 'sensitive')
                    then (case x.severity when 'critical' then 0 when 'high' then 1 when 'moderate' then 2 when 'low' then 3 else 4 end) else 0 end,
               case when ${f.queue}::text in ('review', 'sensitive') then x.updated_at end asc,
               x.updated_at desc, x.id
      limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    let total = rs.length ? num(rs[0].total_count) : 0;
    if (!rs.length && f.offset > 0) {
      total = num((await sql<any>`select count(*)::int as n from community_posts p where (case ${f.queue}::text
                  when 'review' then (p.status = 'moderation_review' or (p.status = 'evidence_requested' and exists (select 1 from community_evidence e2 where e2.post_id = p.id and e2.created_at > p.updated_at)))
                  when 'sensitive' then p.status = 'sensitive_data_detected' when 'returned' then p.status in ('returned_for_correction', 'evidence_requested')
                  when 'published' then p.visibility = 'community_published' when 'removed' then p.status = 'removed' else true end)
           and (${f.category}::text is null or p.category = ${f.category}::text) and (${f.severity}::text is null or p.severity = ${f.severity}::text)
           and (${f.q}::text is null or p.search_document @@ plainto_tsquery('english', ${f.q}::text) or p.title ilike '%' || ${f.q}::text || '%')`.execute(this.db)).rows[0]?.n);
    }
    return { rows: rs.map(toModPostRow), total };
  }
  /** Compare-and-set write of the next full state. Returns null when the version moved (the caller answers 409). */
  async updatePost(trx: Exec, id: string, expectedVersion: number, w: PostWrite): Promise<PostRow | null> {
    const r = (await sql<any>`
      update community_posts set
        status = ${w.status}, visibility = ${w.visibility}, verification_label = ${w.verificationLabel}, severity = ${w.severity},
        title = ${w.title}, redacted_body = ${w.redactedBody}, recommendation = ${w.recommendation}, official_reference = ${w.officialReference},
        privacy_scan_flags = ${JSON.stringify(w.privacyScanFlags)}::jsonb, comments_locked = ${w.commentsLocked},
        removed_reason = ${w.removedReason}, merged_into_post_id = ${w.mergedIntoPostId}::uuid, author_label = ${w.authorLabel},
        published_at = ${w.publishedAt}::timestamptz, resolved_at = ${w.resolvedAt}::timestamptz, resolution_note = ${w.resolutionNote},
        version = version + 1, updated_at = now(), last_activity_at = now()
      where id = ${id} and version = ${expectedVersion} and ${canMoveToSql(COMMUNITY_POST, w.status)}
      returning *`.execute(trx)).rows[0];
    return r ? toPostRow(r) : null;
  }
  async insertPostVersion(trx: Exec, p: PostRow, editedBy: string, changeNote: string, snapshot: Record<string, unknown>): Promise<void> {
    await sql`insert into community_post_versions (post_id, version, title, redacted_body, status, edited_by_user_id, change_note, snapshot)
              values (${p.id}, ${p.version}, ${p.title}, ${p.redactedBody}, ${p.status}, ${editedBy}, ${changeNote}, ${JSON.stringify(snapshot)}::jsonb)`.execute(trx);
  }
  async insertRedaction(trx: Exec, r: { postId: string | null; commentId: string | null; evidenceId: string | null; field: string; reason: string; caseId: string; by: string }): Promise<void> {
    await sql`insert into community_redactions (post_id, comment_id, evidence_id, field, reason, case_id, redacted_by_user_id)
              values (${r.postId}::uuid, ${r.commentId}::uuid, ${r.evidenceId}::uuid, ${r.field}, ${r.reason}, ${r.caseId}, ${r.by})`.execute(trx);
  }
  async linkPosts(trx: Exec, postId: string, relatedId: string, relation: 'related' | 'merged_into', by: string): Promise<void> {
    await sql`insert into community_related_posts (post_id, related_post_id, relation, score, source, created_by_user_id)
              values (${postId}, ${relatedId}, ${relation}, null, 'moderator', ${by})
              on conflict (post_id, related_post_id, relation) do nothing`.execute(trx);
  }
  async postDetailParts(postId: string): Promise<{ versions: any[]; reports: ReportRowM[]; disputes: DisputeRowM[]; evidence: EvidenceRowM[]; cases: CaseRow[]; related: any[]; redactions: any[] }> {
    const versions = (await sql<any>`select v.version, v.title, v.redacted_body, v.status, coalesce(u.full_name, u.email) as edited_by_name, v.change_note, v.created_at
                                     from community_post_versions v left join users u on u.id = v.edited_by_user_id
                                     where v.post_id = ${postId} order by v.version desc limit 100`.execute(this.db)).rows;
    const reports = await this.listReports({ kind: 'post', status: null, postId, limit: 200, offset: 0 });
    const disputes = await this.listDisputes({ status: null, postId, limit: 200, offset: 0 });
    const evidence = await this.listEvidence({ status: 'all', postId, limit: 200, offset: 0 });
    const cases = await this.listCases({ status: null, kind: null, assignedTo: null, postId, limit: 100, offset: 0 });
    const related = (await sql<any>`select rp.related_post_id as id, p2.title, rp.relation, rp.score
                                     from community_related_posts rp join community_posts p2 on p2.id = rp.related_post_id
                                     where rp.post_id = ${postId}
                                    union all
                                    select rp.post_id as id, p3.title, rp.relation, rp.score
                                     from community_related_posts rp join community_posts p3 on p3.id = rp.post_id
                                     where rp.related_post_id = ${postId} and rp.relation <> 'merged_into'`.execute(this.db)).rows;
    const redactions = (await sql<any>`select r.field, r.reason, coalesce(u.full_name, u.email) as by_name, r.created_at
                                        from community_redactions r left join users u on u.id = r.redacted_by_user_id
                                        where r.post_id = ${postId} order by r.created_at desc limit 200`.execute(this.db)).rows;
    return { versions, reports: reports.rows, disputes: disputes.rows, evidence: evidence.rows, cases: cases.rows, related, redactions };
  }

  // ── cases ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async lockCase(trx: Exec, id: string): Promise<CaseRow | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select * from community_moderation_cases where id = ${id} for update`.execute(trx)).rows[0];
    return r ? toCase(r) : null;
  }
  async getCase(id: string): Promise<CaseRow | null> {
    if (!isUuid(id)) return null;
    const r = (await this.caseQuery(id, null, null, null, null, 1, 0)).rows[0];
    return r ?? null;
  }
  /** The open case for (post, kind) — the unique index uq_cmc_open_post_kind guarantees at most one. */
  async openCaseForPost(trx: Exec, postId: string, kind: string): Promise<CaseRow | null> {
    const r = (await sql<any>`select * from community_moderation_cases where post_id = ${postId} and kind = ${kind} and status in ('open','investigating') for update`.execute(trx)).rows[0];
    return r ? toCase(r) : null;
  }
  /** Open case for a target salon (tenant_conduct / incident_access with no post). Serialised by an advisory lock. */
  async openCaseForTenant(trx: Exec, tenantId: string, kind: string): Promise<CaseRow | null> {
    await sql`select pg_advisory_xact_lock(hashtext(${'cmc:' + kind + ':' + tenantId}))`.execute(trx);
    const r = (await sql<any>`select * from community_moderation_cases where target_tenant_id = ${tenantId} and kind = ${kind} and post_id is null and status in ('open','investigating')
                              order by created_at desc limit 1 for update`.execute(trx)).rows[0];
    return r ? toCase(r) : null;
  }
  /** Insert a case; for a post case a concurrent opener loses the unique index race and gets the winner's row. */
  async insertCase(trx: Exec, c: { kind: string; reason: string; priority: string; postId: string | null; commentId: string | null; incidentId: string | null; targetTenantId: string | null; openedBy: string }): Promise<{ row: CaseRow; created: boolean }> {
    const r = (await sql<any>`
      insert into community_moderation_cases (post_id, comment_id, incident_id, target_tenant_id, kind, priority, reason, opened_by_user_id, status)
      values (${c.postId}::uuid, ${c.commentId}::uuid, ${c.incidentId}::uuid, ${c.targetTenantId}::uuid, ${c.kind}, ${c.priority}, ${c.reason}, ${c.openedBy}, 'open')
      on conflict (post_id, kind) where status in ('open','investigating') and post_id is not null do nothing
      returning *`.execute(trx)).rows[0];
    if (r) return { row: toCase(r), created: true };
    const existing = c.postId ? await this.openCaseForPost(trx, c.postId, c.kind) : null;
    if (!existing) throw new Error('community moderation case insert returned nothing');
    return { row: existing, created: false };
  }
  async updateCase(trx: Exec, id: string, u: { status: string; priority: string; assignedTo: string | null; resolutionNote: string | null; incidentId?: string | null }): Promise<CaseRow> {
    const r = (await sql<any>`
      update community_moderation_cases set status = ${u.status}, priority = ${u.priority}, assigned_to_user_id = ${u.assignedTo}::uuid,
             resolution_note = ${u.resolutionNote}, incident_id = coalesce(${u.incidentId ?? null}::uuid, incident_id), updated_at = now(),
             closed_at = case when ${u.status} in ('resolved','closed') then coalesce(closed_at, now()) else null end
       where id = ${id} and ${canMoveToSql(COMMUNITY_MODERATION_CASE, u.status)} returning *`.execute(trx)).rows[0];
    if (!r) throw new Error('community moderation case update matched nothing');
    return toCase(r);
  }
  private caseQuery(id: string | null, status: string | null, kind: string | null, assignedTo: string | null, postId: string | null, limit: number, offset: number) {
    return sql<any>`
      select c.*, p.title as post_title, coalesce(t.display_name, t.legal_name) as target_tenant_name,
             coalesce(uo.full_name, uo.email) as opened_by_name, coalesce(ua.full_name, ua.email) as assigned_to_name,
             count(*) over()::int as total_count
        from community_moderation_cases c
        left join community_posts p on p.id = c.post_id
        left join tenants t on t.id = c.target_tenant_id
        left join users uo on uo.id = c.opened_by_user_id
        left join users ua on ua.id = c.assigned_to_user_id
       where (${id}::uuid is null or c.id = ${id}::uuid)
         and (${status}::text is null or c.status = ${status}::text)
         and (${kind}::text is null or c.kind = ${kind}::text)
         and (${assignedTo}::uuid is null or c.assigned_to_user_id = ${assignedTo}::uuid)
         and (${postId}::uuid is null or c.post_id = ${postId}::uuid)
       order by case c.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, c.created_at desc
       limit ${limit} offset ${offset}`.execute(this.db).then((res) => ({ rows: res.rows.map(toCase), total: res.rows.length ? num(res.rows[0].total_count) : 0 }));
  }
  listCases(f: { status: string | null; kind: string | null; assignedTo: string | null; postId?: string | null; limit: number; offset: number }) {
    return this.caseQuery(null, f.status, f.kind, f.assignedTo, f.postId ?? null, f.limit, f.offset);
  }

  // ── actions (the case-keyed trail) + audit ────────────────────────────────────────────────────────────────────────
  async insertAction(trx: Exec, a: { caseId: string; action: string; actor: string; postId: string | null; commentId: string | null; targetTenantId: string | null; reason: string; detail: Record<string, unknown> }): Promise<string> {
    const r = (await sql<any>`
      insert into community_moderation_actions (case_id, action, actor_user_id, post_id, comment_id, target_tenant_id, reason, detail)
      values (${a.caseId}, ${a.action}, ${a.actor}, ${a.postId}::uuid, ${a.commentId}::uuid, ${a.targetTenantId}::uuid, ${a.reason}, ${JSON.stringify(a.detail)}::jsonb)
      returning id`.execute(trx)).rows[0];
    return String(r.id);
  }
  async listActions(f: { caseId: string | null; postId: string | null; limit: number; offset: number }): Promise<{ rows: ActionRow[]; total: number }> {
    const rs = (await sql<any>`
      select a.*, coalesce(u.full_name, u.email) as actor_name, coalesce(t.display_name, t.legal_name) as target_tenant_name, count(*) over()::int as total_count
        from community_moderation_actions a
        left join users u on u.id = a.actor_user_id
        left join tenants t on t.id = a.target_tenant_id
       where (${f.caseId}::uuid is null or a.case_id = ${f.caseId}::uuid)
         and (${f.postId}::uuid is null or a.post_id = ${f.postId}::uuid)
       order by a.created_at desc, a.id
       limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return { rows: rs.map(toAction), total: rs.length ? num(rs[0].total_count) : 0 };
  }
  /** audit_logs row for a moderator acting on one salon (tenant_id = the salon acted on; the actor is the moderator). */
  async audit(trx: Exec, a: { tenantId: string | null; userId: string; action: string; entityType: string; entityId: string | null; meta: Record<string, unknown> }): Promise<void> {
    await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              values (${a.tenantId}::uuid, null, ${a.userId}, 'SUPER_ADMIN', ${a.action}, ${a.entityType}, ${a.entityId}::uuid, ${JSON.stringify(a.meta)}::jsonb)`.execute(trx);
  }

  // ── comments ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async listComments(postId: string): Promise<CommentRowM[]> {
    const rs = (await sql<any>`select c.*, coalesce(t.display_name, t.legal_name) as tenant_name from community_comments c left join tenants t on t.id = c.tenant_id
                               where c.post_id = ${postId} order by c.created_at asc, c.id limit 1000`.execute(this.db)).rows;
    return rs.map(toComment);
  }
  async lockComment(trx: Exec, id: string): Promise<CommentRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select c.* from community_comments c where c.id = ${id} for update`.execute(trx)).rows[0];
    return r ? toComment(r) : null;
  }
  async getComment(id: string, ex: Exec = this.db): Promise<CommentRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select c.*, coalesce(t.display_name, t.legal_name) as tenant_name from community_comments c left join tenants t on t.id = c.tenant_id where c.id = ${id}`.execute(ex)).rows[0];
    return r ? toComment(r) : null;
  }
  async setCommentVisibility(trx: Exec, c: CommentRowM, visible: boolean, reason: string | null, by: string): Promise<void> {
    await sql`update community_comments set visibility = ${visible ? 'community_published' : 'removed'},
                     removed_reason = ${visible ? null : reason}, removed_by_user_id = ${visible ? null : by}::uuid,
                     removed_at = case when ${visible} then null else now() end
               where id = ${c.id} and tenant_id = ${c.tenantId}`.execute(trx);
    await sql`update community_posts set comment_count = greatest(comment_count + ${visible ? 1 : -1}, 0), updated_at = now() where id = ${c.postId}`.execute(trx);
  }
  async redactComment(trx: Exec, c: CommentRowM, body: string, flags: string[], by: string): Promise<number> {
    const next = c.version + 1;
    await sql`update community_comments set redacted_body = ${body}, version = ${next}, edited_at = now(),
                     privacy_scan_flags = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(privacy_scan_flags || ${JSON.stringify(flags)}::jsonb) as f(x))
               where id = ${c.id} and tenant_id = ${c.tenantId}`.execute(trx);
    await sql`insert into community_comment_versions (comment_id, version, redacted_body, edited_by_user_id) values (${c.id}, ${next}, ${body}, ${by})`.execute(trx);
    return next;
  }

  // ── reports ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async listReports(f: { kind: 'post' | 'comment'; status: string | null; postId?: string | null; limit: number; offset: number }): Promise<{ rows: ReportRowM[]; total: number }> {
    if (f.kind === 'comment') {
      const rs = (await sql<any>`select r.*, coalesce(t.display_name, t.legal_name) as reporter_tenant_name, count(*) over()::int as total_count
                                  from community_comment_reports r left join tenants t on t.id = r.reporter_tenant_id
                                 where (${f.status}::text is null or r.status = ${f.status}::text) and (${f.postId ?? null}::uuid is null or r.post_id = ${f.postId ?? null}::uuid)
                                 order by r.created_at desc, r.id limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
      return { rows: rs.map(toReport('comment')), total: rs.length ? num(rs[0].total_count) : 0 };
    }
    const rs = (await sql<any>`select r.*, coalesce(t.display_name, t.legal_name) as reporter_tenant_name, count(*) over()::int as total_count
                                from community_reports r left join tenants t on t.id = r.reporter_tenant_id
                               where (${f.status}::text is null or r.status = ${f.status}::text) and (${f.postId ?? null}::uuid is null or r.post_id = ${f.postId ?? null}::uuid)
                               order by r.created_at desc, r.id limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return { rows: rs.map(toReport('post')), total: rs.length ? num(rs[0].total_count) : 0 };
  }
  async lockReport(trx: Exec, kind: 'post' | 'comment', id: string): Promise<ReportRowM | null> {
    if (!isUuid(id)) return null;
    const r = kind === 'comment'
      ? (await sql<any>`select r.* from community_comment_reports r where r.id = ${id} for update`.execute(trx)).rows[0]
      : (await sql<any>`select r.* from community_reports r where r.id = ${id} for update`.execute(trx)).rows[0];
    return r ? toReport(kind)(r) : null;
  }
  async resolveReport(trx: Exec, kind: 'post' | 'comment', id: string, status: 'actioned' | 'dismissed', caseId: string, by: string, reason: string): Promise<void> {
    if (kind === 'comment') {
      await sql`update community_comment_reports set status = ${status}, case_id = ${caseId}, resolved_by_user_id = ${by}, resolved_at = now() where id = ${id} and ${canMoveToSql(COMMUNITY_COMMENT_REPORT, status)}`.execute(trx);
    } else {
      await sql`update community_reports set status = ${status}, case_id = ${caseId}, resolved_by_user_id = ${by}, resolved_at = now(), resolution = ${reason} where id = ${id} and ${canMoveToSql(COMMUNITY_REPORT, status)}`.execute(trx);
    }
  }

  // ── disputes ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async listDisputes(f: { status: string | null; postId?: string | null; limit: number; offset: number }): Promise<{ rows: DisputeRowM[]; total: number }> {
    const rs = (await sql<any>`select d.*, coalesce(t.display_name, t.legal_name) as raised_by_tenant_name, count(*) over()::int as total_count
                                from community_disputes d left join tenants t on t.id = d.raised_by_tenant_id
                               where (${f.status}::text is null or d.status = ${f.status}::text) and (${f.postId ?? null}::uuid is null or d.post_id = ${f.postId ?? null}::uuid)
                               order by d.created_at desc, d.id limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return { rows: rs.map(toDispute), total: rs.length ? num(rs[0].total_count) : 0 };
  }
  async lockDispute(trx: Exec, id: string): Promise<DisputeRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select d.* from community_disputes d where d.id = ${id} for update`.execute(trx)).rows[0];
    return r ? toDispute(r) : null;
  }
  async decideDispute(trx: Exec, id: string, status: 'upheld' | 'overturned', note: string, caseId: string, by: string): Promise<void> {
    await sql`update community_disputes set status = ${status}, resolution_note = ${note}, case_id = ${caseId}, decided_by_user_id = ${by}, resolved_at = now() where id = ${id} and ${canMoveToSql(COMMUNITY_DISPUTE, status)}`.execute(trx);
  }

  // ── appeals ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async listAppeals(f: { status: string | null; limit: number; offset: number }): Promise<{ rows: AppealRowM[]; total: number }> {
    const rs = (await sql<any>`select a.*, coalesce(t.display_name, t.legal_name) as appellant_tenant_name, count(*) over()::int as total_count
                                from community_appeals a left join tenants t on t.id = a.appellant_tenant_id
                               where (${f.status}::text is null or a.status = ${f.status}::text)
                               order by a.created_at desc, a.id limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return { rows: rs.map(toAppeal), total: rs.length ? num(rs[0].total_count) : 0 };
  }
  async lockAppeal(trx: Exec, id: string): Promise<AppealRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select a.* from community_appeals a where a.id = ${id} for update`.execute(trx)).rows[0];
    return r ? toAppeal(r) : null;
  }
  async getAppeal(id: string): Promise<AppealRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select a.* from community_appeals a where a.id = ${id}`.execute(this.db)).rows[0];
    return r ? toAppeal(r) : null;
  }
  /** Sets status + decided_by + decided_at together (ck_appeal_decided). Only an undecided appeal matches. */
  async decideAppeal(trx: Exec, id: string, status: 'upheld' | 'overturned', by: string, note: string, caseId: string): Promise<boolean> {
    const r = await sql`update community_appeals set status = ${status}, decided_by_user_id = ${by}, decided_at = now(), decision_note = ${note}, moderation_case_id = ${caseId}
                         where id = ${id} and ${canMoveToSql(COMMUNITY_APPEAL, status)}`.execute(trx);
    return Number((r as any).numAffectedRows ?? (r as any).numUpdatedRows ?? 0) === 1;
  }

  // ── evidence ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async listEvidence(f: { status: string | null; postId?: string | null; limit: number; offset: number }): Promise<{ rows: EvidenceRowM[]; total: number }> {
    const rs = (await sql<any>`
      select e.*, coalesce(t.display_name, t.legal_name) as tenant_name, count(*) over()::int as total_count
        from community_evidence e left join tenants t on t.id = e.tenant_id
       where e.removed_at is null
         and (${f.postId ?? null}::uuid is null or e.post_id = ${f.postId ?? null}::uuid)
         and (case coalesce(${f.status}::text, 'needs_review')
                when 'all' then true
                when 'needs_review' then e.upload_status = 'uploaded' and (e.redaction_status = 'pending' or e.scan_status <> 'clean')
                when 'unscanned' then e.scan_status = 'unscanned'
                when 'clean' then e.scan_status = 'clean'
                when 'infected' then e.scan_status = 'infected'
                when 'error' then e.scan_status = 'error'
                when 'pending' then e.redaction_status = 'pending'
                when 'redacted' then e.redaction_status = 'redacted'
                else false end)
       order by e.created_at desc, e.id limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return { rows: rs.map(toEvidence), total: rs.length ? num(rs[0].total_count) : 0 };
  }
  async getEvidence(id: string): Promise<EvidenceRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select e.*, coalesce(t.display_name, t.legal_name) as tenant_name from community_evidence e left join tenants t on t.id = e.tenant_id where e.id = ${id}`.execute(this.db)).rows[0];
    return r ? toEvidence(r) : null;
  }

  // ── private incident (only under an incident_access case — the service checks first) ─────────────────────────────
  async getIncident(id: string): Promise<IncidentRowM | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select i.*, coalesce(t.display_name, t.legal_name) as tenant_name from tenant_private_incidents i left join tenants t on t.id = i.tenant_id where i.id = ${id}`.execute(this.db)).rows[0];
    return r ? { id: String(r.id), tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? '', branchId: r.branch_id ?? null, category: r.category, severity: r.severity,
      occurredOn: dateOnly(r.occurred_on), rawDetail: r.raw_detail ?? null, advisoryPostId: r.advisory_post_id ?? null, createdAt: iso(r.created_at) } : null;
  }

  // ── salons + restrictions ─────────────────────────────────────────────────────────────────────────────────────────
  async tenantExists(tenantId: string, ex: Exec = this.db): Promise<{ id: string; name: string } | null> {
    if (!isUuid(tenantId)) return null;
    const r = (await sql<any>`select t.id, coalesce(t.display_name, t.legal_name) as tenant_name from tenants t where t.id = ${tenantId}`.execute(ex)).rows[0];
    return r ? { id: String(r.id), name: r.tenant_name ?? '' } : null;
  }
  async userInTenant(userId: string, tenantId: string): Promise<boolean> {
    return !!(await sql<any>`select 1 as ok from users u where u.id = ${userId} and u.tenant_id = ${tenantId}`.execute(this.db)).rows[0];
  }
  async tenantConduct(f: { tenantId: string | null; q: string | null; limit: number; offset: number }): Promise<{ rows: { tenantId: string; tenantName: string; enabled: boolean; posts: number; removed: number; upheldDisputes: number; reportsAgainst: number }[]; total: number }> {
    const rs = (await sql<any>`
      select t.id as tenant_id, coalesce(t.display_name, t.legal_name) as tenant_name, coalesce(s.enabled, false) as enabled,
             (select count(*) from community_posts p where p.origin_tenant_id = t.id)::int as posts,
             (select count(*) from community_posts p where p.origin_tenant_id = t.id and p.status = 'removed')::int as removed,
             (select count(*) from community_disputes d join community_posts p on p.id = d.post_id where p.origin_tenant_id = t.id and d.status = 'overturned')::int as upheld_disputes,
             (select count(*) from community_reports r join community_posts p on p.id = r.post_id where p.origin_tenant_id = t.id)::int as reports_against,
             count(*) over()::int as total_count
        from tenants t
        left join tenant_community_settings s on s.tenant_id = t.id
       where (${f.tenantId}::uuid is null or t.id = ${f.tenantId}::uuid)
         and (${f.tenantId}::uuid is not null
              or s.tenant_id is not null
              or exists (select 1 from community_posts p where p.origin_tenant_id = t.id)
              or exists (select 1 from community_restrictions cr where cr.tenant_id = t.id))
         and (${f.q}::text is null or coalesce(t.display_name, t.legal_name) ilike '%' || ${f.q}::text || '%' or t.tenant_code ilike ${f.q}::text)
       order by coalesce(t.display_name, t.legal_name), t.id
       limit ${f.limit} offset ${f.offset}`.execute(this.db)).rows;
    return {
      rows: rs.map((r) => ({ tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? '', enabled: !!r.enabled, posts: num(r.posts), removed: num(r.removed), upheldDisputes: num(r.upheld_disputes), reportsAgainst: num(r.reports_against) })),
      total: rs.length ? num(rs[0].total_count) : 0,
    };
  }
  async listRestrictions(f: { tenantIds: string[] | null; active: boolean | null }): Promise<RestrictionRow[]> {
    const ids = f.tenantIds;
    const rs = (await sql<any>`
      select r.*, coalesce(t.display_name, t.legal_name) as tenant_name from community_restrictions r left join tenants t on t.id = r.tenant_id
       where (${ids === null} or r.tenant_id = any(${ids ?? []}::uuid[]))
         and (${f.active}::boolean is null
              or (${f.active}::boolean = (r.lifted_at is null and (r.expires_at is null or r.expires_at > now()))))
       order by r.created_at desc, r.id limit 500`.execute(this.db)).rows;
    return rs.map(toRestriction);
  }
  async activeRestrictionOf(trx: Exec, tenantId: string, userId: string | null, kind: string): Promise<RestrictionRow | null> {
    await sql`select pg_advisory_xact_lock(hashtext(${'crx:' + tenantId}))`.execute(trx);
    const r = (await sql<any>`select r.* from community_restrictions r where r.tenant_id = ${tenantId} and r.kind = ${kind}
                                and r.user_id is not distinct from ${userId}::uuid and r.lifted_at is null and (r.expires_at is null or r.expires_at > now()) limit 1`.execute(trx)).rows[0];
    return r ? toRestriction(r) : null;
  }
  async insertRestriction(trx: Exec, r: { tenantId: string; userId: string | null; kind: string; reason: string; caseId: string; by: string; expiresAt: string | null }): Promise<RestrictionRow> {
    const row = (await sql<any>`insert into community_restrictions (tenant_id, user_id, kind, reason, case_id, created_by_user_id, expires_at)
                                values (${r.tenantId}, ${r.userId}::uuid, ${r.kind}, ${r.reason}, ${r.caseId}, ${r.by}, ${r.expiresAt}::timestamptz) returning *`.execute(trx)).rows[0];
    return toRestriction(row);
  }
  async liftRestriction(trx: Exec, tenantId: string, id: string, by: string): Promise<RestrictionRow | null> {
    if (!isUuid(id)) return null;
    const row = (await sql<any>`update community_restrictions set lifted_at = now(), lifted_by_user_id = ${by}
                                 where id = ${id} and tenant_id = ${tenantId} and lifted_at is null returning *`.execute(trx)).rows[0];
    return row ? toRestriction(row) : null;
  }
  async liftAll(trx: Exec, tenantId: string, kind: string, by: string): Promise<number> {
    const r = await sql`update community_restrictions set lifted_at = now(), lifted_by_user_id = ${by} where tenant_id = ${tenantId} and kind = ${kind} and lifted_at is null`.execute(trx);
    return Number((r as any).numAffectedRows ?? (r as any).numUpdatedRows ?? 0);
  }
  /** COMMUNITY_RESTRICTIONS: the salon-wide restrictions plus this user's own, active now. */
  async activeKinds(tenantId: string, userId: string | null): Promise<string[]> {
    if (!isUuid(tenantId)) return [];
    const rs = (await sql<any>`select distinct r.kind from community_restrictions r
                               where r.tenant_id = ${tenantId} and r.lifted_at is null and (r.expires_at is null or r.expires_at > now())
                                 and (r.user_id is null or r.user_id = ${isUuid(userId) ? userId : null}::uuid)`.execute(this.db)).rows;
    return rs.map((r) => String(r.kind));
  }
  /** Owner + approvers of a salon (who hear the moderator's message). */
  async tenantContacts(tenantId: string): Promise<{ userId: string; email: string }[]> {
    const rs = (await sql<any>`select u.id, u.email from users u where u.tenant_id = ${tenantId} and u.role in ('OWNER','ADMIN','MANAGER')
                               and u.status = 'active' and u.email is not null order by u.role, u.created_at limit 20`.execute(this.db)).rows;
    return rs.map((r) => ({ userId: String(r.id), email: String(r.email) }));
  }
  async authorLabelParts(tenantId: string): Promise<{ tenantName: string; displayName: string | null }> {
    const r = (await sql<any>`select coalesce(t.display_name, t.legal_name) as tenant_name, s.display_name from tenants t
                              left join tenant_community_settings s on s.tenant_id = t.id where t.id = ${tenantId}`.execute(this.db)).rows[0];
    return { tenantName: r?.tenant_name ?? '', displayName: r?.display_name ?? null };
  }

  // ── platform settings (platform_settings keys community.*) ───────────────────────────────────────────────────────
  async readSettings(ex: Exec = this.db): Promise<{ riskMatchingEnabled: boolean; autoHideReportThreshold: number; version: number }> {
    const rs = (await sql<any>`select setting_key, value, version from platform_settings
                               where setting_key in ('community.risk_matching_enabled', 'community.auto_hide_report_threshold')`.execute(ex)).rows;
    const by = new Map(rs.map((r) => [String(r.setting_key), r]));
    const val = (k: string) => { const v = by.get(k)?.value; return typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v; };
    const rm = val('community.risk_matching_enabled'); const th = val('community.auto_hide_report_threshold');
    return {
      riskMatchingEnabled: rm === true || rm === 'true',
      autoHideReportThreshold: Number.isFinite(Number(th)) && th != null ? Number(th) : 5,
      version: rs.reduce((s, r) => s + num(r.version), 0),
    };
  }
  async lockSettings(trx: Exec): Promise<void> { await sql`select pg_advisory_xact_lock(hashtext('community.platform_settings'))`.execute(trx); }
  async writeSetting(trx: Exec, key: string, value: unknown, valueType: string, actor: string, reason: string): Promise<void> {
    const prev = (await sql<any>`select value, version from platform_settings where setting_key = ${key}`.execute(trx)).rows[0];
    const json = JSON.stringify(value);
    const next = prev ? num(prev.version) + 1 : 1;
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type, version, changed_by)
              values (${key}, 'community', ${json}::jsonb, ${valueType}, 1, ${actor})
              on conflict (setting_key) do update set value = excluded.value, version = platform_settings.version + 1, changed_by = excluded.changed_by, updated_at = now()`.execute(trx);
    await sql`insert into platform_setting_changes (setting_key, setting_group, previous_value, new_value, version, actor, actor_role, reason, source)
              values (${key}, 'community', ${prev ? JSON.stringify(prev.value) : null}::jsonb, ${json}::jsonb, ${next}, ${actor}, 'SUPER_ADMIN', ${reason}, 'api')`.execute(trx);
  }

  // ── overview + analytics ──────────────────────────────────────────────────────────────────────────────────────────
  async overview(me: string): Promise<Record<string, any>> {
    const r = (await sql<any>`
      select
        (select count(*) from community_posts p where p.status = 'moderation_review'
            or (p.status = 'evidence_requested' and exists (select 1 from community_evidence e2 where e2.post_id = p.id and e2.created_at > p.updated_at)))::int as q_review,
        (select count(*) from community_posts p where p.status = 'sensitive_data_detected')::int as q_sensitive,
        (select count(*) from community_reports rep where rep.status in ('open','reviewing'))::int as q_reports,
        (select count(*) from community_comment_reports crep where crep.status in ('open','reviewing'))::int as q_comment_reports,
        (select count(*) from community_disputes dsp where dsp.status in ('open','under_review'))::int as q_disputes,
        (select count(*) from community_appeals apl where apl.status in ('submitted','under_review'))::int as q_appeals,
        (select count(*) from community_evidence ev where ev.removed_at is null and ev.upload_status = 'uploaded' and (ev.redaction_status = 'pending' or ev.scan_status <> 'clean'))::int as q_evidence,
        (select count(*) from community_posts p where p.status in ('returned_for_correction','evidence_requested'))::int as q_returned,
        (select count(*) from community_posts p where p.visibility = 'community_published')::int as q_published,
        (select count(*) from community_posts p where p.status = 'removed')::int as q_removed,
        (select count(*) from community_moderation_cases c where c.status = 'open')::int as c_open,
        (select count(*) from community_moderation_cases c where c.status = 'investigating')::int as c_investigating,
        (select count(*) from community_moderation_cases c where c.status in ('open','investigating') and c.priority = 'urgent')::int as c_urgent,
        (select count(*) from community_moderation_cases c where c.status in ('open','investigating') and c.assigned_to_user_id = ${me}::uuid)::int as c_mine,
        (select count(*) from community_moderation_actions act where act.action in ('publish','restore') and act.created_at > now() - interval '7 days')::int as published7d,
        (select count(*) from community_moderation_actions act where act.action in ('remove','merge_into') and act.created_at > now() - interval '7 days')::int as removed7d,
        (select count(*) from community_moderation_actions act where act.action = 'reject' and act.created_at > now() - interval '7 days')::int as rejected7d,
        (select count(*) from community_restrictions rst where rst.lifted_at is null and (rst.expires_at is null or rst.expires_at > now()))::int as restrictions_active,
        (select count(*) from tenant_community_settings tcs where tcs.enabled)::int as tenants_enabled,
        (select avg(extract(epoch from (c.closed_at - c.created_at))) / 3600.0 from community_moderation_cases c
           where c.closed_at is not null and c.closed_at > now() - interval '30 days') as avg_hours,
        (select max(extract(epoch from (now() - p.updated_at))) / 3600.0 from community_posts p where p.status in ('moderation_review','sensitive_data_detected')) as oldest_hours`.execute(this.db)).rows[0];
    return r ?? {};
  }
  async analytics(from: string, to: string): Promise<Record<string, any>> {
    const r = (await sql<any>`
      select
        (select count(*) from community_moderation_actions act where act.action in ('publish','restore') and act.created_at >= ${from}::date and act.created_at < (${to}::date + 1))::int as published,
        (select count(*) from community_moderation_actions act where act.action = 'reject' and act.created_at >= ${from}::date and act.created_at < (${to}::date + 1))::int as rejected,
        (select count(*) from community_moderation_actions act where act.action in ('remove','merge_into') and act.created_at >= ${from}::date and act.created_at < (${to}::date + 1))::int as removed,
        (select count(*) from community_disputes dsp where dsp.created_at >= ${from}::date and dsp.created_at < (${to}::date + 1))::int as disputes,
        (select count(*) from community_appeals apl where apl.created_at >= ${from}::date and apl.created_at < (${to}::date + 1))::int as appeals,
        (select count(*) from community_appeals apl where apl.status = 'overturned' and apl.decided_at >= ${from}::date and apl.decided_at < (${to}::date + 1))::int as overturned,
        (select count(*) from community_appeals apl where apl.status in ('upheld','overturned') and apl.decided_at >= ${from}::date and apl.decided_at < (${to}::date + 1))::int as decided,
        (select percentile_cont(0.5) within group (order by extract(epoch from (c.closed_at - c.created_at)) / 3600.0) from community_moderation_cases c
           where c.closed_at >= ${from}::date and c.closed_at < (${to}::date + 1)) as median_hours`.execute(this.db)).rows[0] ?? {};
    const byCat = (await sql<any>`select p.category, count(*)::int as n from community_posts p
                                   where p.published_at >= ${from}::date and p.published_at < (${to}::date + 1) group by p.category order by n desc, p.category`.execute(this.db)).rows;
    const bySev = (await sql<any>`select p.severity, count(*)::int as n from community_posts p
                                   where p.published_at >= ${from}::date and p.published_at < (${to}::date + 1) group by p.severity`.execute(this.db)).rows;
    return { ...r, byCategory: byCat, bySeverity: bySev };
  }
}
