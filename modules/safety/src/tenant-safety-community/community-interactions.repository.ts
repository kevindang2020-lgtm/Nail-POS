// community-interactions.repository.ts — BUILD_PLAN Phase 8 (agent C): every SQL statement of the interactions half
// (comments, similar experiences, follows, evidence, alerts, fan-out recipients, related posts, analytics, retention,
// risk fingerprints) over migration 529. Raw Kysely `sql`, no policy (the service decides), and NO swallowed errors:
// a failed write throws, so a caller can never mistake a failure for an empty result or a phantom row.
//
// Cross-tenant BY DESIGN where the community is shared: comments on a published post are read for every salon allowed to
// see it; the fan-out reads every salon's notification preferences; related-post detection compares published posts.
// Everything a salon OWNS (its follows, its evidence, its similar report, its analytics, its retention purge) is
// scoped by `tenant_id` / `origin_tenant_id` = the caller's salon from the server-side session.
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { COMMUNITY_EVIDENCE_REDACTION, COMMUNITY_EVIDENCE_SCAN, COMMUNITY_EVIDENCE_UPLOAD, COMMUNITY_POST } from './community-lifecycles';
import type { CommentRecord } from './community-comments';
import type { FollowRecord, FollowChannel } from './community-follows';
import type { FanoutRecipient } from './community-notify';
import type { AnalyticsRaw } from './community-analytics';
import type { FingerprintHit, IndicatorKind, RiskFingerprintStore } from './community-risk-matching';

type Db = Kysely<any> | Transaction<any>;
const rowsOf = (r: { rows: unknown[] }) => r.rows as any[];
const iso = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));
const jarr = (v: unknown): any[] => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } } return []; };

export interface EvidenceRecord {
  id: string; tenantId: string; postId: string | null; incidentId: string | null; storageKey: string; mimeType: string | null;
  sizeBytes: number | null; sha256: string | null; uploadStatus: 'pending_upload' | 'uploaded' | 'failed';
  scanStatus: 'unscanned' | 'clean' | 'infected' | 'error'; redactionStatus: 'pending' | 'redacted' | 'not_required';
  removedAt: string | null; createdAt: string;
}
export interface AlertPostRow { id: string; originTenantId: string; title: string; severity: string; category: string; publishedAt: string; authorLabel: string | null; region: string | null }

const toComment = (r: any): CommentRecord => ({
  id: String(r.id), postId: String(r.post_id), parentId: r.parent_id ? String(r.parent_id) : null, depth: Number(r.depth ?? 0),
  tenantId: String(r.tenant_id), createdByUserId: String(r.created_by_user_id), visibility: r.visibility, body: String(r.redacted_body ?? ''),
  authorLabel: r.author_label ?? null, version: Number(r.version ?? 1), editedAt: isoOrNull(r.edited_at), removedReason: r.removed_reason ?? null, createdAt: iso(r.created_at),
});
const toEvidence = (r: any): EvidenceRecord => ({
  id: String(r.id), tenantId: String(r.tenant_id), postId: r.post_id ? String(r.post_id) : null, incidentId: r.incident_id ? String(r.incident_id) : null,
  storageKey: String(r.storage_key), mimeType: r.mime_type ?? null, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes), sha256: r.sha256 ?? null,
  uploadStatus: r.upload_status, scanStatus: r.scan_status, redactionStatus: r.redaction_status, removedAt: isoOrNull(r.removed_at), createdAt: iso(r.created_at),
});
const toFollow = (r: any): FollowRecord => ({ id: String(r.id), category: r.category ?? null, region: r.region ?? null, severityMin: r.severity_min ?? null, channels: jarr(r.channels) as FollowChannel[] });

export class KyselyInteractionsRepo {
  constructor(readonly db: Kysely<any>) {}

  /** Run `fn` in one transaction (the comment + its counter + its outbox event commit together, or none of them). */
  tx<T>(fn: (trx: Transaction<any>) => Promise<T>): Promise<T> { return this.db.transaction().execute(fn); }

  // ── rules / restrictions helpers ──
  async rulesAcknowledged(tenantId: string, userId: string, rulesVersion: string): Promise<boolean> {
    return rowsOf(await sql`select 1 as ok from community_rules_acknowledgments where tenant_id = ${tenantId} and user_id = ${userId} and rules_version = ${rulesVersion} limit 1`.execute(this.db)).length > 0;
  }

  // ── comments (cross-tenant read of a post's thread: the post was already proven visible by the core) ──
  async listComments(postId: string): Promise<CommentRecord[]> {
    return rowsOf(await sql`
      select id, post_id, parent_id, depth, tenant_id, created_by_user_id, visibility, redacted_body, author_label, version, edited_at, removed_reason, created_at
        from community_comments where post_id = ${postId} order by created_at asc, id asc limit 2000`.execute(this.db)).map(toComment);
  }
  async getComment(id: string, db: Db = this.db, forUpdate = false): Promise<CommentRecord | null> {
    const r = rowsOf(await (forUpdate
      ? sql`select id, post_id, parent_id, depth, tenant_id, created_by_user_id, visibility, redacted_body, author_label, version, edited_at, removed_reason, created_at from community_comments where id = ${id} for update`
      : sql`select id, post_id, parent_id, depth, tenant_id, created_by_user_id, visibility, redacted_body, author_label, version, edited_at, removed_reason, created_at from community_comments where id = ${id}`).execute(db))[0];
    return r ? toComment(r) : null;
  }
  async insertComment(trx: Db, c: { postId: string; parentId: string | null; depth: number; tenantId: string; userId: string; body: string; authorLabel: string; flags: string[] }): Promise<CommentRecord> {
    const r = rowsOf(await sql`
      insert into community_comments (post_id, parent_id, depth, tenant_id, redacted_body, created_by_user_id, author_label, privacy_scan_flags)
      values (${c.postId}, ${c.parentId}, ${c.depth}, ${c.tenantId}, ${c.body}, ${c.userId}, ${c.authorLabel}, ${JSON.stringify(c.flags)}::jsonb)
      returning id, post_id, parent_id, depth, tenant_id, created_by_user_id, visibility, redacted_body, author_label, version, edited_at, removed_reason, created_at`.execute(trx))[0];
    if (!r) throw new Error('community comment insert returned no row');
    return toComment(r);
  }
  async bumpCommentCount(trx: Db, postId: string, delta: number): Promise<void> {
    await sql`update community_posts set comment_count = greatest(0, comment_count + ${delta}), last_activity_at = now() where id = ${postId}`.execute(trx);
  }
  /** Author edit — the row is already locked by getComment(…, forUpdate); history keeps the PREVIOUS text. */
  async editComment(trx: Db, c: { id: string; tenantId: string; userId: string; expectedVersion: number; body: string; flags: string[] }): Promise<CommentRecord | null> {
    await sql`
      insert into community_comment_versions (comment_id, version, redacted_body, edited_by_user_id)
      select id, version, redacted_body, ${c.userId} from community_comments
       where id = ${c.id} and tenant_id = ${c.tenantId} and created_by_user_id = ${c.userId} and version = ${c.expectedVersion} and visibility = 'community_published'
      on conflict (comment_id, version) do nothing`.execute(trx);
    const r = rowsOf(await sql`
      update community_comments set redacted_body = ${c.body}, privacy_scan_flags = ${JSON.stringify(c.flags)}::jsonb, version = version + 1, edited_at = now()
       where id = ${c.id} and tenant_id = ${c.tenantId} and created_by_user_id = ${c.userId} and version = ${c.expectedVersion} and visibility = 'community_published'
      returning id, post_id, parent_id, depth, tenant_id, created_by_user_id, visibility, redacted_body, author_label, version, edited_at, removed_reason, created_at`.execute(trx))[0];
    return r ? toComment(r) : null;
  }
  async deleteOwnComment(trx: Db, c: { id: string; tenantId: string; userId: string }): Promise<{ postId: string } | null> {
    const r = rowsOf(await sql`
      update community_comments set visibility = 'removed', removed_reason = 'deleted_by_author', removed_by_user_id = ${c.userId}, removed_at = now()
       where id = ${c.id} and tenant_id = ${c.tenantId} and created_by_user_id = ${c.userId} and visibility = 'community_published'
      returning post_id`.execute(trx))[0];
    return r ? { postId: String(r.post_id) } : null;
  }
  /** One report per salon per comment (uq_ccr_once); returns false when this salon already reported it. */
  async reportComment(c: { commentId: string; postId: string; tenantId: string; userId: string; reason: string; detail: string | null }): Promise<boolean> {
    return this.tx(async (trx) => {
      const r = rowsOf(await sql`
        insert into community_comment_reports (comment_id, post_id, reporter_tenant_id, reporter_user_id, reason, detail)
        values (${c.commentId}, ${c.postId}, ${c.tenantId}, ${c.userId}, ${c.reason}, ${c.detail})
        on conflict (comment_id, reporter_tenant_id) do nothing returning id`.execute(trx))[0];
      if (!r) return false;
      await sql`update community_comments set report_count = report_count + 1 where id = ${c.commentId}`.execute(trx);
      return true;
    });
  }
  async commentsLastHour(tenantId: string): Promise<number> {
    return Number(rowsOf(await sql`select count(*)::int as n from community_comments where tenant_id = ${tenantId} and created_at > now() - interval '1 hour'`.execute(this.db))[0]?.n ?? 0);
  }
  async reportsToday(tenantId: string): Promise<number> {
    return Number(rowsOf(await sql`
      select ((select count(*) from community_comment_reports where reporter_tenant_id = ${tenantId} and created_at > now() - interval '1 day')
            + (select count(*) from community_reports where reporter_tenant_id = ${tenantId} and created_at > now() - interval '1 day'))::int as n`.execute(this.db))[0]?.n ?? 0);
  }

  // ── similar experiences: ONE per salon per post (uq_cse_once); the counter moves only with a new row ──
  async markSimilar(c: { postId: string; tenantId: string; userId: string; note: string | null; occurredOn: string | null }): Promise<{ inserted: boolean; similarCount: number }> {
    return this.tx(async (trx) => {
      const ins = rowsOf(await sql`
        insert into community_similar_experiences (post_id, tenant_id, user_id, redacted_note, occurred_on)
        values (${c.postId}, ${c.tenantId}, ${c.userId}, ${c.note}, ${c.occurredOn}::date)
        on conflict (post_id, tenant_id) do nothing returning id`.execute(trx))[0];
      const r = ins
        ? rowsOf(await sql`update community_posts set similar_count = similar_count + 1, last_activity_at = now() where id = ${c.postId} returning similar_count`.execute(trx))[0]
        : rowsOf(await sql`select similar_count from community_posts where id = ${c.postId}`.execute(trx))[0];
      return { inserted: !!ins, similarCount: Number(r?.similar_count ?? 0) };
    });
  }

  // ── post follows (per user) ──
  async followPost(c: { postId: string; tenantId: string; userId: string }): Promise<number> {
    return this.tx(async (trx) => {
      const ins = rowsOf(await sql`insert into community_post_follows (post_id, tenant_id, user_id) values (${c.postId}, ${c.tenantId}, ${c.userId}) on conflict (post_id, tenant_id, user_id) do nothing returning id`.execute(trx))[0];
      const r = ins
        ? rowsOf(await sql`update community_posts set follower_count = follower_count + 1 where id = ${c.postId} returning follower_count`.execute(trx))[0]
        : rowsOf(await sql`select follower_count from community_posts where id = ${c.postId}`.execute(trx))[0];
      return Number(r?.follower_count ?? 0);
    });
  }
  async unfollowPost(c: { postId: string; tenantId: string; userId: string }): Promise<number> {
    return this.tx(async (trx) => {
      const del = rowsOf(await sql`delete from community_post_follows where post_id = ${c.postId} and tenant_id = ${c.tenantId} and user_id = ${c.userId} returning id`.execute(trx))[0];
      const r = del
        ? rowsOf(await sql`update community_posts set follower_count = greatest(0, follower_count - 1) where id = ${c.postId} returning follower_count`.execute(trx))[0]
        : rowsOf(await sql`select follower_count from community_posts where id = ${c.postId}`.execute(trx))[0];
      return Number(r?.follower_count ?? 0);
    });
  }
  /** Salons (other than the author) with users following this post, and those users. */
  async postFollowers(postId: string, excludeTenantId: string): Promise<{ tenantId: string; userIds: string[] }[]> {
    return rowsOf(await sql`
      select tenant_id, array_agg(user_id::text) as user_ids from community_post_follows
       where post_id = ${postId} and tenant_id <> ${excludeTenantId} group by tenant_id`.execute(this.db))
      .map((r) => ({ tenantId: String(r.tenant_id), userIds: (Array.isArray(r.user_ids) ? r.user_ids : []).map(String) }));
  }

  // ── salon follows (category / region / severity) ──
  async listFollows(tenantId: string): Promise<FollowRecord[]> {
    return rowsOf(await sql`select id, category, region, severity_min, channels from community_follows where tenant_id = ${tenantId} order by created_at asc, id asc`.execute(this.db)).map(toFollow);
  }
  async upsertFollow(tenantId: string, userId: string, f: Omit<FollowRecord, 'id'>): Promise<FollowRecord> {
    return this.tx(async (trx) => {
      const existing = rowsOf(await sql`
        select id from community_follows where tenant_id = ${tenantId} and category is not distinct from ${f.category} and region is not distinct from ${f.region} for update`.execute(trx))[0];
      const r = existing
        ? rowsOf(await sql`update community_follows set severity_min = ${f.severityMin}, channels = ${JSON.stringify(f.channels)}::jsonb, user_id = ${userId}
                            where id = ${existing.id} and tenant_id = ${tenantId} returning id, category, region, severity_min, channels`.execute(trx))[0]
        : rowsOf(await sql`insert into community_follows (tenant_id, user_id, category, region, severity_min, channels)
                            values (${tenantId}, ${userId}, ${f.category}, ${f.region}, ${f.severityMin}, ${JSON.stringify(f.channels)}::jsonb)
                            returning id, category, region, severity_min, channels`.execute(trx))[0];
      if (!r) throw new Error('community follow write returned no row');
      return toFollow(r);
    });
  }
  async deleteFollow(tenantId: string, id: string): Promise<boolean> {
    return rowsOf(await sql`delete from community_follows where id = ${id} and tenant_id = ${tenantId} returning id`.execute(this.db)).length > 0;
  }
  async notifyCategories(tenantId: string): Promise<string[]> {
    const r = rowsOf(await sql`select notify_categories from tenant_community_settings where tenant_id = ${tenantId}`.execute(this.db))[0];
    return jarr(r?.notify_categories).map(String);
  }

  // ── evidence (always the owning salon) ──
  async ownPostExists(tenantId: string, postId: string): Promise<boolean> {
    return rowsOf(await sql`select 1 as ok from community_posts where id = ${postId} and origin_tenant_id = ${tenantId}`.execute(this.db)).length > 0;
  }
  async ownIncidentExists(tenantId: string, incidentId: string): Promise<boolean> {
    return rowsOf(await sql`select 1 as ok from tenant_private_incidents where id = ${incidentId} and tenant_id = ${tenantId}`.execute(this.db)).length > 0;
  }
  async uploadsLastHour(tenantId: string): Promise<number> {
    return Number(rowsOf(await sql`select count(*)::int as n from community_evidence where tenant_id = ${tenantId} and created_at > now() - interval '1 hour'`.execute(this.db))[0]?.n ?? 0);
  }
  async insertEvidence(e: { tenantId: string; userId: string; postId: string | null; incidentId: string | null; mimeType: string; sizeBytes: number; sha256: string; keyFor: (id: string) => string }): Promise<EvidenceRecord> {
    const id = randomUUID();
    const r = rowsOf(await sql`
      insert into community_evidence (id, post_id, incident_id, tenant_id, storage_key, mime_type, size_bytes, sha256, uploaded_by_user_id, upload_status, scan_status, redaction_status)
      values (${id}, ${e.postId}, ${e.incidentId}, ${e.tenantId}, ${e.keyFor(id)}, ${e.mimeType}, ${e.sizeBytes}, ${e.sha256}, ${e.userId}, 'pending_upload', 'unscanned', 'pending')
      returning *`.execute(this.db))[0];
    if (!r) throw new Error('community evidence insert returned no row');
    return toEvidence(r);
  }
  /** Moderator path ONLY (CommunityEvidenceModeration, under an open case): the owning salon is not the caller. */
  async getEvidence(id: string): Promise<EvidenceRecord | null> {
    const r = rowsOf(await sql`select * from community_evidence where id = ${id}`.execute(this.db))[0];
    return r ? toEvidence(r) : null;
  }
  async getOwnEvidence(tenantId: string, id: string): Promise<EvidenceRecord | null> {
    const r = rowsOf(await sql`select * from community_evidence where id = ${id} and tenant_id = ${tenantId}`.execute(this.db))[0];
    return r ? toEvidence(r) : null;
  }
  async listOwnEvidenceForPost(tenantId: string, postId: string): Promise<EvidenceRecord[]> {
    return rowsOf(await sql`select * from community_evidence where post_id = ${postId} and tenant_id = ${tenantId} and removed_at is null order by created_at asc limit 200`.execute(this.db)).map(toEvidence);
  }
  async setUploadStatus(tenantId: string, id: string, status: 'uploaded' | 'failed'): Promise<void> {
    await sql`update community_evidence set upload_status = ${status}, uploaded_at = case when ${status} = 'uploaded' then now() else uploaded_at end
               where id = ${id} and tenant_id = ${tenantId} and ${canMoveToSql(COMMUNITY_EVIDENCE_UPLOAD, status)}`.execute(this.db);
  }
  async setScan(tenantId: string, id: string, status: EvidenceRecord['scanStatus'], detail: string | null): Promise<EvidenceRecord> {
    const r = rowsOf(await sql`update community_evidence set scan_status = ${status}, scanned_at = now(), scan_detail = ${detail}
                                where id = ${id} and tenant_id = ${tenantId} and ${canMoveToSql(COMMUNITY_EVIDENCE_SCAN, status)} returning *`.execute(this.db))[0];
    if (!r) {
      // a verdict is final: a concurrent scan already recorded one — return it (never overwrite clean / infected)
      const cur = await this.getOwnEvidence(tenantId, id);
      if (cur) return cur;
      throw new Error('community evidence scan update matched no row');
    }
    return toEvidence(r);
  }
  /** Safety Community 05 — who opened each of THIS salon's evidence files (newest first, ≤ 20 per file). Staff of the salon
   *  are named; a platform moderator is never named (only "under a moderation case"); no user id leaves here. */
  async evidenceAccessLog(tenantId: string, evidenceIds: string[]): Promise<{ evidenceId: string; at: string; byName: string | null; byRole: string | null; moderator: boolean; reason: string | null }[]> {
    if (!evidenceIds.length) return [];
    const rows = rowsOf(await sql`select x.evidence_id, x.created_at, x.full_name, x.role, x.moderator, x.reason from (
        select l.evidence_id, l.created_at, (l.tenant_id is null or l.tenant_id <> ${tenantId}) as moderator,
          case when l.tenant_id = ${tenantId} then u.full_name end as full_name, case when l.tenant_id = ${tenantId} then u.role end as role,
          case when l.tenant_id = ${tenantId} then l.reason end as reason,
          row_number() over (partition by l.evidence_id order by l.created_at desc, l.id desc) as rk
        from community_evidence_access_log l
        join community_evidence ce on ce.id = l.evidence_id and ce.tenant_id = ${tenantId}
        left join users u on u.id = l.user_id and u.tenant_id = ${tenantId}
        where l.evidence_id = any(${evidenceIds}::uuid[])) x where x.rk <= 20 order by x.evidence_id, x.created_at desc`.execute(this.db));
    return rows.map((r: any) => ({ evidenceId: String(r.evidence_id), at: new Date(r.created_at).toISOString(), byName: r.full_name ?? null, byRole: r.role ?? null, moderator: !!r.moderator, reason: r.reason ?? null }));
  }
  async logEvidenceAccess(a: { evidenceId: string; tenantId: string | null; userId: string; caseId: string | null; reason: string }): Promise<void> {
    await sql`insert into community_evidence_access_log (evidence_id, tenant_id, user_id, case_id, reason) values (${a.evidenceId}, ${a.tenantId}, ${a.userId}, ${a.caseId}, ${a.reason})`.execute(this.db);
  }
  async openCase(caseId: string): Promise<{ id: string; postId: string | null; kind: string; status: string } | null> {
    const r = rowsOf(await sql`select id, post_id, kind, status from community_moderation_cases where id = ${caseId}`.execute(this.db))[0];
    return r ? { id: String(r.id), postId: r.post_id ? String(r.post_id) : null, kind: String(r.kind), status: String(r.status) } : null;
  }
  /** A moderator's evidence decision (B's route, under a case): redaction status, or rejection (removed). */
  async reviewEvidence(c: { id: string; tenantId: string; decision: 'clean' | 'redacted' | 'reject'; caseId: string; moderatorUserId: string; reason: string }): Promise<EvidenceRecord> {
    const redactTo = c.decision === 'clean' ? 'not_required' : 'redacted';   // Phase 12 (#27): a redacted file is never "not required" again
    return this.tx(async (trx) => {
      const r = rowsOf(await (c.decision === 'reject'
        ? sql`update community_evidence set upload_status = 'failed', removed_at = now() where id = ${c.id} and tenant_id = ${c.tenantId} and ${canMoveToSql(COMMUNITY_EVIDENCE_UPLOAD, 'failed')} returning *`
        : sql`update community_evidence set redaction_status = ${redactTo} where id = ${c.id} and tenant_id = ${c.tenantId} and ${canMoveToSql(COMMUNITY_EVIDENCE_REDACTION, redactTo)} returning *`).execute(trx))[0];
      if (!r) {
        const cur = rowsOf(await sql`select upload_status, redaction_status from community_evidence where id = ${c.id} and tenant_id = ${c.tenantId}`.execute(trx))[0];
        if (cur && c.decision !== 'reject') throw new InvalidStateTransitionError(COMMUNITY_EVIDENCE_REDACTION, String(cur.redaction_status), redactTo);
        throw new Error('community evidence review matched no row');
      }
      if (c.decision === 'redacted') {
        await sql`insert into community_redactions (evidence_id, post_id, field, reason, case_id, redacted_by_user_id)
                  values (${c.id}, ${r.post_id ?? null}, 'evidence', ${c.reason}, ${c.caseId}, ${c.moderatorUserId})`.execute(trx);
      }
      return toEvidence(r);
    });
  }
  /** Uploaded evidence still waiting for a verdict (the scan-retry job), newest week only. */
  async unscannedUploaded(tenantId: string, limit = 50): Promise<EvidenceRecord[]> {
    return rowsOf(await sql`select * from community_evidence where tenant_id = ${tenantId} and upload_status = 'uploaded' and scan_status = 'unscanned'
                             and removed_at is null and uploaded_at > now() - interval '7 days' order by uploaded_at asc limit ${limit}`.execute(this.db)).map(toEvidence);
  }

  // ── alerts / fan-out ──
  /** High / critical advisories published in the last `hours` (other salons' only — the banner warns about others). */
  async activeAlertPosts(excludeTenantId: string, hours = 72): Promise<AlertPostRow[]> {
    return rowsOf(await sql`
      select id, origin_tenant_id, title, severity, category, published_at, author_label, region from community_posts
       where visibility = 'community_published' and status not in ('resolved','archived','removed') and severity in ('high','critical')
         and published_at > now() - make_interval(hours => ${hours}) and merged_into_post_id is null and origin_tenant_id <> ${excludeTenantId}
       order by published_at desc limit 50`.execute(this.db))
      .map((r) => ({ id: String(r.id), originTenantId: String(r.origin_tenant_id), title: String(r.title), severity: String(r.severity), category: String(r.category), publishedAt: iso(r.published_at), authorLabel: r.author_label ?? null, region: r.region ?? null }));
  }
  /** Every ENABLED, ACTIVE salon except the author, with its alert preferences and contact (never invented). */
  async fanoutRecipients(excludeTenantId: string): Promise<FanoutRecipient[]> {
    return rowsOf(await sql`
      select s.tenant_id, s.enabled, s.notify_categories, s.region_preferences, s.push_enabled, s.email_enabled, s.critical_sms_enabled,
             t.email, t.business_phone,
             coalesce((select json_agg(json_build_object('category', f.category, 'region', f.region, 'severityMin', f.severity_min, 'channels', f.channels))
                         from community_follows f where f.tenant_id = s.tenant_id), '[]'::json) as follows
        from tenant_community_settings s join tenants t on t.id = s.tenant_id
       where s.enabled = true and t.status = 'active' and s.tenant_id <> ${excludeTenantId}`.execute(this.db))
      .map((r) => ({
        tenantId: String(r.tenant_id), communityEnabled: !!r.enabled,
        notifyCategories: jarr(r.notify_categories).map(String), regionPreferences: jarr(r.region_preferences).map(String),
        follows: jarr(r.follows).map((f: any) => ({ category: f.category ?? null, region: f.region ?? null, severityMin: f.severityMin ?? null, channels: jarr(f.channels) as FollowChannel[] })),
        pushEnabled: !!r.push_enabled, emailEnabled: !!r.email_enabled, criticalSmsEnabled: !!r.critical_sms_enabled,
        email: r.email ? String(r.email) : null, phone: r.business_phone ? String(r.business_phone) : null,
      }));
  }
  async activeBranchIds(tenantId: string): Promise<string[]> {
    return rowsOf(await sql`select id from branches where tenant_id = ${tenantId} and status = 'active' order by id limit 200`.execute(this.db)).map((r) => String(r.id));
  }
  /** The salon's owner and approvers (OWNER / ADMIN / MANAGER, active) — the people a community alert is for. */
  async approverUserIds(tenantId: string): Promise<string[]> {
    return rowsOf(await sql`select id from users where tenant_id = ${tenantId} and role in ('OWNER','ADMIN','MANAGER') and status = 'active' order by id limit 50`.execute(this.db)).map((r) => String(r.id));
  }
  /** The in-app alert (the Owner app's alert feed — owner_alerts, audience all = owner + managers). Idempotent per
   *  (salon, post, dedupeKey): a redelivered publish / restore never stacks a second alert. Returns whether it wrote. */
  async insertOwnerAlert(trx: Db, a: { tenantId: string; postId: string; severity: string; title: string; body: string; link: string; dedupeKey: string; kind: string }): Promise<boolean> {
    const r = rowsOf(await sql`
      insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      select ${a.tenantId}::uuid, null::uuid, 'community_advisory', ${a.severity}::text, 'new', ${a.title}::text, ${a.body}::text,
             ${JSON.stringify({ postId: a.postId, kind: a.kind, dedupeKey: a.dedupeKey, link: a.link })}::jsonb, 'all'
       where not exists (select 1 from owner_alerts where tenant_id = ${a.tenantId} and category = 'community_advisory'
                          and metadata->>'postId' = ${a.postId} and metadata->>'dedupeKey' = ${a.dedupeKey})
      returning id`.execute(trx))[0];
    return !!r;
  }

  // ── related / duplicate detection (published posts are community-wide) ──
  async relatedCandidates(postId: string, windowDays: number, minSimilarity: number): Promise<{ id: string; similarity: number; sharedTags: number }[]> {
    return rowsOf(await sql`
      select c.id, similarity(c.title, p.title)::float8 as sim,
             (select count(*) from jsonb_array_elements_text(c.tags) as ct(tag)
               where lower(ct.tag) in (select lower(pt.tag) from jsonb_array_elements_text(p.tags) as pt(tag)))::int as shared
        from community_posts p
        join community_posts c on c.category = p.category and c.id <> p.id
       where p.id = ${postId} and c.visibility = 'community_published' and c.merged_into_post_id is null
         and coalesce(c.published_at, c.created_at) between coalesce(p.published_at, p.created_at) - make_interval(days => ${windowDays})
                                                       and coalesce(p.published_at, p.created_at) + make_interval(days => ${windowDays})
       order by sim desc limit 50`.execute(this.db))
      .map((r) => ({ id: String(r.id), similarity: Number(r.sim ?? 0), sharedTags: Number(r.shared ?? 0) }))
      .filter((r) => r.similarity >= minSimilarity || r.sharedTags > 0);
  }
  /** System link both ways; an existing pair is left as it is. Returns how many rows were new. */
  async linkRelated(postId: string, relatedId: string, relation: 'related' | 'possible_duplicate', score: number): Promise<number> {
    const r = rowsOf(await sql`
      insert into community_related_posts (post_id, related_post_id, relation, score, source)
      values (${postId}, ${relatedId}, ${relation}, ${score}, 'system'), (${relatedId}, ${postId}, ${relation}, ${score}, 'system')
      on conflict (post_id, related_post_id, relation) do nothing returning id`.execute(this.db));
    return r.length;
  }
  async recentPublishedByOrigin(tenantId: string, days: number): Promise<string[]> {
    return rowsOf(await sql`select id from community_posts where origin_tenant_id = ${tenantId} and visibility = 'community_published'
                             and published_at > now() - make_interval(days => ${days}) order by published_at desc limit 200`.execute(this.db)).map((r) => String(r.id));
  }

  // ── analytics (the salon's OWN posts only) ──
  async analytics(tenantId: string, fromTs: string, toTs: string): Promise<AnalyticsRaw> {
    const byStatus = rowsOf(await sql`select status, count(*)::int as n from community_posts where origin_tenant_id = ${tenantId} and created_at >= ${fromTs}::timestamptz and created_at < ${toTs}::timestamptz group by status`.execute(this.db));
    const pub = rowsOf(await sql`select count(*)::int as n, avg(date_part('epoch', published_at - created_at) / 3600.0)::float8 as avg_h from community_posts
                                  where origin_tenant_id = ${tenantId} and published_at >= ${fromTs}::timestamptz and published_at < ${toTs}::timestamptz`.execute(this.db))[0];
    const act = rowsOf(await sql`
      select (select count(*) from community_comments c join community_posts p on p.id = c.post_id
               where p.origin_tenant_id = ${tenantId} and c.visibility = 'community_published' and c.created_at >= ${fromTs}::timestamptz and c.created_at < ${toTs}::timestamptz)::int as comments,
             (select count(*) from community_similar_experiences s join community_posts p on p.id = s.post_id
               where p.origin_tenant_id = ${tenantId} and s.created_at >= ${fromTs}::timestamptz and s.created_at < ${toTs}::timestamptz)::int as similar,
             (select coalesce(sum(follower_count), 0) from community_posts where origin_tenant_id = ${tenantId} and visibility = 'community_published')::int as followers`.execute(this.db))[0];
    const cats = rowsOf(await sql`select category, count(*)::int as n from community_posts where origin_tenant_id = ${tenantId} and created_at >= ${fromTs}::timestamptz and created_at < ${toTs}::timestamptz
                                   group by category order by n desc, category asc limit 5`.execute(this.db));
    return {
      byStatus: byStatus.map((r) => ({ status: String(r.status), n: Number(r.n) })),
      published: Number(pub?.n ?? 0), avgHoursToPublish: pub?.avg_h == null ? null : Number(pub.avg_h),
      comments: Number(act?.comments ?? 0), similar: Number(act?.similar ?? 0), followers: Number(act?.followers ?? 0),
      categories: cats.map((r) => ({ category: String(r.category), n: Number(r.n) })),
    };
  }

  // ── retention / lifecycle jobs (each scoped to ONE salon, the job's own tenant) ──
  async retentionDays(tenantId: string): Promise<number> {
    const r = rowsOf(await sql`select retention_days from tenant_community_settings where tenant_id = ${tenantId}`.execute(this.db))[0];
    const n = Number(r?.retention_days ?? 730);
    return Number.isFinite(n) && n >= 30 ? n : 730;
  }
  /** Evidence objects that the purge will drop: of stale drafts (about to be deleted) and of removed / archived posts. */
  async evidenceToPurge(tenantId: string, days: number): Promise<{ id: string; storageKey: string }[]> {
    return rowsOf(await sql`
      select e.id, e.storage_key from community_evidence e join community_posts p on p.id = e.post_id
       where e.tenant_id = ${tenantId} and p.origin_tenant_id = ${tenantId} and e.removed_at is null
         and p.updated_at < now() - make_interval(days => ${days})
         and (p.status in ('removed','archived') or (p.visibility = 'draft' and p.status in ('incident_draft','returned_for_correction','sensitive_data_detected','rejected','evidence_requested','insufficient_information')))
      union all
      select e.id, e.storage_key from community_evidence e join tenant_private_incidents i on i.id = e.incident_id
       where e.tenant_id = ${tenantId} and i.tenant_id = ${tenantId} and e.removed_at is null and i.created_at < now() - make_interval(days => ${days})`.execute(this.db))
      .map((r) => ({ id: String(r.id), storageKey: String(r.storage_key) }));
  }
  async purgeSalon(tenantId: string, days: number, evidenceIds: string[]): Promise<{ drafts: number; incidents: number; evidence: number }> {
    return this.tx(async (trx) => {
      const ev = evidenceIds.length
        ? rowsOf(await sql`update community_evidence set removed_at = now() where tenant_id = ${tenantId} and id = any(${evidenceIds}::uuid[]) and removed_at is null returning id`.execute(trx)).length : 0;
      const drafts = rowsOf(await sql`
        delete from community_posts where origin_tenant_id = ${tenantId} and visibility = 'draft' and updated_at < now() - make_interval(days => ${days})
           and status in ('incident_draft','returned_for_correction','sensitive_data_detected','rejected','evidence_requested','insufficient_information')
        returning id`.execute(trx)).length;
      const incidents = rowsOf(await sql`delete from tenant_private_incidents where tenant_id = ${tenantId} and created_at < now() - make_interval(days => ${days}) returning id`.execute(trx)).length;
      return { drafts, incidents, evidence: ev };
    });
  }
  /** Resolved advisories untouched for 90 days → archived (version bumps; the post leaves the feed). */
  async archiveResolved(tenantId: string, days = 90): Promise<{ id: string; version: number }[]> {
    return rowsOf(await sql`
      update community_posts set status = 'archived', version = version + 1, updated_at = now()
       where origin_tenant_id = ${tenantId} and status = 'resolved' and ${canMoveToSql(COMMUNITY_POST, 'archived')} and coalesce(resolved_at, updated_at) < now() - make_interval(days => ${days})
      returning id, version`.execute(this.db)).map((r) => ({ id: String(r.id), version: Number(r.version) }));
  }
  /** Salons that have any community data (a settings row, a post, an incident) — the retention sweep's work list. */
  async salonsWithCommunityData(): Promise<string[]> {
    return rowsOf(await sql`
      select tenant_id from tenant_community_settings
      union select origin_tenant_id from community_posts
      union select tenant_id from tenant_private_incidents`.execute(this.db)).map((r) => String(r.tenant_id));
  }
  async salonsWithDueArchive(days = 90): Promise<string[]> {
    return rowsOf(await sql`select distinct origin_tenant_id from community_posts where status = 'resolved' and coalesce(resolved_at, updated_at) < now() - make_interval(days => ${days})`.execute(this.db)).map((r) => String(r.origin_tenant_id));
  }
  async salonsWithRecentPublished(days: number): Promise<string[]> {
    return rowsOf(await sql`select distinct origin_tenant_id from community_posts where visibility = 'community_published' and published_at > now() - make_interval(days => ${days})`.execute(this.db)).map((r) => String(r.origin_tenant_id));
  }
  async salonsWithUnscannedEvidence(): Promise<string[]> {
    return rowsOf(await sql`select distinct tenant_id from community_evidence where upload_status = 'uploaded' and scan_status = 'unscanned' and removed_at is null and uploaded_at > now() - interval '7 days'`.execute(this.db)).map((r) => String(r.tenant_id));
  }

  // ── platform settings ──
  async platformFlag(key: string): Promise<boolean> {
    const r = rowsOf(await sql`select value from platform_settings where setting_key = ${key} limit 1`.execute(this.db))[0];
    const v = r?.value;
    return v === true || v === 'true' || v === 1;
  }
}

/** Salted fingerprints (community_risk_fingerprints has no tenant column: it is keyed by post and never browsable). */
export class KyselyRiskFingerprintStore implements RiskFingerprintStore {
  constructor(private readonly db: Kysely<any>) {}
  async findHits(fingerprints: string[]): Promise<FingerprintHit[]> {
    const fps = fingerprints.filter(Boolean);
    if (!fps.length) return [];
    return rowsOf(await sql`select post_id, indicator_kind, reliability from community_risk_fingerprints
                            where fingerprint = any(${fps}::text[]) and retired_at is null and expires_at > now() limit 500`.execute(this.db))
      .map((r) => ({ postId: String(r.post_id), indicatorKind: r.indicator_kind as IndicatorKind, reliability: r.reliability }));
  }
  async record(postId: string, kind: IndicatorKind, fp: string, reliability: 'weak' | 'reliable'): Promise<void> {
    await sql`insert into community_risk_fingerprints (post_id, indicator_kind, fingerprint, reliability) values (${postId}, ${kind}, ${fp}, ${reliability})`.execute(this.db);
  }
  async retire(fp: string, reason: string): Promise<void> {
    await sql`update community_risk_fingerprints set retired_at = now(), retired_reason = ${reason} where fingerprint = ${fp} and retired_at is null`.execute(this.db);
  }
  async purgeExpired(): Promise<number> {
    return rowsOf(await sql`delete from community_risk_fingerprints where expires_at < now() returning id`.execute(this.db)).length;
  }
}
