// community-interactions.service.ts — BUILD_PLAN Phase 8 (agent C): what salons DO with a published advisory —
// threaded comments, "this happened to us too", following an advisory or a category, private evidence uploads, the
// emergency banner, the salon's own analytics. Who may look and act is the CORE's call (COMMUNITY_CORE — viewer,
// capability, visibility, author labels); this service adds the interaction rules on top and never re-implements them.
//
// Every write is audited; a comment commits with its counter and its outbox event (COMMUNITY_COMMENT_ADDED, tenantId =
// the post's origin salon) in one transaction. Responses carry only the tenant-facing contract shapes — never another
// salon's id, a user id, a storage key or raw evidence.
import { checkDeclaredUpload, UploadRejected, UPLOAD_POLICIES, type StorageQuotaPort } from '@aipowersalon/media';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import {
  COMMUNITY_RULES_VERSION, type CommunityActiveAlert, type CommunityCommentView, type CommunityEvidenceAccess, type CommunityEvidenceUploadTicket,
  type CommunityEvidenceView, type CommunityFollowView, type CommunityReportReason, type CommunityTenantAnalytics,
} from '@aipowersalon/api-contracts/tenant';
import { CommunityError } from './community.service';
import type { CommunityCorePort, CommunityEventsPort, CommunityViewerInfo, CommunityEvidenceModerationPort } from './community.ports';
import type { CommunityCtx } from './community.repository';
import { scanCommunityText } from './community-privacy-scan';
import { LIMITS } from './community-abuse';
import { buildCommentTree, commentView, replyDepth, COMMENT_MAX_LENGTH } from './community-comments';
import { normalizeFollow, followMatches, SEV_RANK, type FollowRecord } from './community-follows';
import { parseAnalyticsRange, shapeAnalytics } from './community-analytics';
import {
  canAccessRawEvidence, validateEvidenceUpload, sha256HexToBase64, evidenceStorageKey, EVIDENCE_UPLOADS_PER_HOUR,
  EVIDENCE_UPLOAD_TTL_SECONDS, EVIDENCE_READ_TTL_SECONDS, type EvidenceScanner,
} from './community-evidence';
import type { EvidenceBlobStore } from './evidence-blob-store';
import type { KyselyInteractionsRepo, EvidenceRecord } from './community-interactions.repository';

/** The audit trail (community-audit.ts → audit_logs). Typed — never cast away. */
export interface InteractionsAudit { record(ctx: CommunityCtx, action: string, entityId: string, meta?: Record<string, unknown>): Promise<void> }
export type InteractionsRepo = KyselyInteractionsRepo;

export const REPORT_REASONS: readonly CommunityReportReason[] = ['contains_personal_info', 'accusatory_or_defamatory', 'inaccurate', 'spam', 'harassment', 'other'];
export const MAX_FOLLOWS_PER_SALON = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (field: string, message: string) => new CommunityError('invalid_input', 400, { field, message });
function requireId(v: unknown, field = 'id'): string { const s = String(v ?? ''); if (!UUID.test(s)) throw invalid(field, 'not an id'); return s; }
function text(v: unknown, field: string, opts: { required: boolean; max: number }): string | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) { if (opts.required) throw invalid(field, 'required'); return null; }
  if (typeof v !== 'string') throw invalid(field, 'must be text');
  const s = v.trim();
  if (s.length > opts.max) throw invalid(field, `at most ${opts.max} characters`);
  return s;
}
/** Privacy gate for any free text a salon shares: payment / government-id data is refused outright; customer PII is redacted. */
function scanned(field: string, s: string): { body: string; flags: string[] } {
  const r = scanCommunityText(s);
  if (r.blocked) throw new CommunityError('contains_payment_data', 400, { field, categories: r.categories });
  return { body: r.redactedText, flags: r.categories as string[] };
}
const evidenceView = (e: EvidenceRecord): CommunityEvidenceView => ({ id: e.id, mimeType: e.mimeType, sizeBytes: e.sizeBytes, uploadStatus: e.uploadStatus, scanStatus: e.scanStatus, redactionStatus: e.redactionStatus, createdAt: e.createdAt });
const followView = (f: FollowRecord): CommunityFollowView => ({ id: f.id, category: f.category as any, region: f.region, severityMin: f.severityMin as any, channels: f.channels });

export class CommunityInteractionsService {
  /** Phase 12 (#34): the salon's storage quota (the API's QuotaService), set by the providers; absent → not charged. */
  storageQuota: StorageQuotaPort | null = null;

  constructor(
    private readonly core: CommunityCorePort,
    private readonly repo: InteractionsRepo,
    private readonly events: CommunityEventsPort,
    private readonly audit: InteractionsAudit,
    private readonly blob: EvidenceBlobStore,
    private readonly scanner: EvidenceScanner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── shared guards ──
  private async writer(ctx: CommunityCtx, cap: 'comment' | 'view_community' | 'upload_evidence' = 'view_community'): Promise<CommunityViewerInfo> {
    const v = await this.core.requireCapability(ctx, cap);
    // requireCapability lets a suspended salon READ; every interaction below is a write
    if (v.restrictions?.suspended) throw new CommunityError('community_suspended', 403);
    return v;
  }
  private async rulesOk(ctx: CommunityCtx, v: CommunityViewerInfo): Promise<boolean> {
    const flag = (v as CommunityViewerInfo & { rulesAcknowledged?: boolean }).rulesAcknowledged;
    if (typeof flag === 'boolean') return flag;
    return this.repo.rulesAcknowledged(ctx.tenantId, ctx.userId, COMMUNITY_RULES_VERSION);
  }
  private async authorLabel(ctx: CommunityCtx, v: CommunityViewerInfo): Promise<string> {
    const s = (v.settings ?? {}) as any;
    const display = s.authorDisplay === 'tenant_name' || s.authorDisplay === 'anonymous' ? s.authorDisplay : 'display_name';
    const region = Array.isArray(s.regionPreferences) && s.regionPreferences.length ? String(s.regionPreferences[0]) : (s.region ?? null);
    return this.core.authorLabelFor(ctx.tenantId, display, region);
  }

  // ── comments ──
  async listComments(ctx: CommunityCtx, postId: string): Promise<CommunityCommentView[]> {
    requireId(postId, 'postId');
    await this.core.requireCapability(ctx, 'view_community');
    const post = await this.core.visiblePost(ctx, postId);
    return buildCommentTree(await this.repo.listComments(post.id), ctx);
  }

  async addComment(ctx: CommunityCtx, postId: string, input: { body?: unknown; parentId?: unknown }): Promise<CommunityCommentView> {
    requireId(postId, 'postId');
    const raw = text(input?.body, 'body', { required: true, max: COMMENT_MAX_LENGTH })!;
    const parentId = input?.parentId == null || input.parentId === '' ? null : requireId(input.parentId, 'parentId');
    const v = await this.writer(ctx, 'comment');
    if (v.restrictions?.commentingRestricted) throw new CommunityError('community_commenting_restricted', 403);
    if (!(await this.rulesOk(ctx, v))) throw new CommunityError('rules_not_acknowledged', 403, { rulesVersion: COMMUNITY_RULES_VERSION });
    const post = await this.core.visiblePost(ctx, postId);
    if (post.visibility !== 'community_published') throw new CommunityError('post_not_published', 409, { status: post.status });
    if (post.commentsLocked) throw new CommunityError('comments_locked', 409);
    if ((await this.repo.commentsLastHour(ctx.tenantId)) >= LIMITS.commentsPerHour) throw new CommunityError('rate_limited', 429, { reason: 'comment_rate_limited', retryAfterMinutes: 60 });
    const { body, flags } = scanned('body', raw);
    let depth = 0;
    if (parentId) {
      const parent = await this.repo.getComment(parentId);
      if (!parent || parent.postId !== post.id) throw new CommunityError('comment_not_found', 404, { field: 'parentId' });
      if (parent.visibility !== 'community_published') throw new CommunityError('parent_removed', 409);
      const d = replyDepth(parent);
      if (d === null) throw new CommunityError('max_depth', 400, { field: 'parentId', maxDepth: 3 });
      depth = d;
    }
    const label = await this.authorLabel(ctx, v);
    const c = await this.repo.tx(async (trx) => {
      const row = await this.repo.insertComment(trx, { postId: post.id, parentId, depth, tenantId: ctx.tenantId, userId: ctx.userId, body, authorLabel: label, flags });
      await this.repo.bumpCommentCount(trx, post.id, 1);
      // tenantId = the post's ORIGIN salon (its screens refetch); the commenter's user id rides along only when it is the same salon
      await this.events.emit({ tenantId: post.originTenantId, branchId: null, userId: ctx.tenantId === post.originTenantId ? ctx.userId : null },
        DOMAIN_EVENTS.COMMUNITY_COMMENT_ADDED, { type: 'community_comment', id: row.id, version: row.version }, { postId: post.id, commentId: row.id, parentId, depth }, trx);
      return row;
    });
    await this.audit.record(ctx, 'comment.created', post.id, { commentId: c.id, parentId, redactedCategories: flags });
    return { ...commentView(c, ctx), replies: [] };
  }

  async editComment(ctx: CommunityCtx, commentId: string, input: { body?: unknown; expectedVersion?: unknown }): Promise<CommunityCommentView> {
    requireId(commentId, 'commentId');
    const raw = text(input?.body, 'body', { required: true, max: COMMENT_MAX_LENGTH })!;
    const expected = Number(input?.expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) throw invalid('expectedVersion', 'a positive whole number');
    const v = await this.writer(ctx, 'comment');
    if (v.restrictions?.commentingRestricted) throw new CommunityError('community_commenting_restricted', 403);
    const existing = await this.repo.getComment(commentId);
    if (!existing || existing.tenantId !== ctx.tenantId) throw new CommunityError('comment_not_found', 404);
    if (existing.createdByUserId !== ctx.userId) throw new CommunityError('not_your_comment', 403);
    const post = await this.core.visiblePost(ctx, existing.postId);
    if (post.commentsLocked) throw new CommunityError('comments_locked', 409);
    const { body, flags } = scanned('body', raw);
    const updated = await this.repo.tx(async (trx) => {
      const cur = await this.repo.getComment(commentId, trx, true);
      if (!cur || cur.visibility !== 'community_published') throw new CommunityError('comment_removed', 409);
      if (cur.version !== expected) throw new CommunityError('version_conflict', 409, { currentVersion: cur.version });
      const row = await this.repo.editComment(trx, { id: commentId, tenantId: ctx.tenantId, userId: ctx.userId, expectedVersion: expected, body, flags });
      if (!row) throw new CommunityError('version_conflict', 409, { currentVersion: cur.version });
      return row;
    });
    await this.audit.record(ctx, 'comment.edited', post.id, { commentId, version: updated.version, redactedCategories: flags });
    return { ...commentView(updated, ctx), replies: [] };
  }

  async deleteComment(ctx: CommunityCtx, commentId: string): Promise<{ ok: true; removed: true }> {
    requireId(commentId, 'commentId');
    await this.writer(ctx, 'comment');
    const existing = await this.repo.getComment(commentId);
    if (!existing || existing.tenantId !== ctx.tenantId) throw new CommunityError('comment_not_found', 404);
    if (existing.createdByUserId !== ctx.userId) throw new CommunityError('not_your_comment', 403);
    if (existing.visibility !== 'community_published') return { ok: true, removed: true };   // already gone — idempotent
    const post = await this.core.visiblePost(ctx, existing.postId);
    const done = await this.repo.tx(async (trx) => {
      const r = await this.repo.deleteOwnComment(trx, { id: commentId, tenantId: ctx.tenantId, userId: ctx.userId });
      if (!r) return false;
      await this.repo.bumpCommentCount(trx, r.postId, -1);
      await this.events.emit({ tenantId: post.originTenantId, branchId: null, userId: ctx.tenantId === post.originTenantId ? ctx.userId : null },
        DOMAIN_EVENTS.COMMUNITY_COMMENT_REMOVED, { type: 'community_comment', id: commentId }, { postId: r.postId, commentId, by: 'author' }, trx);
      return true;
    });
    if (done) await this.audit.record(ctx, 'comment.deleted', post.id, { commentId });
    return { ok: true, removed: true };
  }

  async reportComment(ctx: CommunityCtx, commentId: string, input: { reason?: unknown; detail?: unknown }): Promise<{ ok: true }> {
    requireId(commentId, 'commentId');
    const reason = String(input?.reason ?? '');
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) throw invalid('reason', `one of ${REPORT_REASONS.join(', ')}`);
    const rawDetail = text(input?.detail, 'detail', { required: false, max: 1000 });
    await this.writer(ctx, 'view_community');
    const c = await this.repo.getComment(commentId);
    if (!c) throw new CommunityError('comment_not_found', 404);
    await this.core.visiblePost(ctx, c.postId);
    if (c.tenantId === ctx.tenantId) throw new CommunityError('own_comment', 409);
    if ((await this.repo.reportsToday(ctx.tenantId)) >= LIMITS.reportsPerDay) throw new CommunityError('rate_limited', 429, { reason: 'report_rate_limited', retryAfterMinutes: 24 * 60 });
    const detail = rawDetail ? scanned('detail', rawDetail).body : null;
    if (!(await this.repo.reportComment({ commentId, postId: c.postId, tenantId: ctx.tenantId, userId: ctx.userId, reason, detail }))) throw new CommunityError('already_reported', 409);
    await this.audit.record(ctx, 'comment.reported', c.postId, { commentId, reason });
    return { ok: true };
  }

  // ── "this happened to us too" ──
  async markSimilar(ctx: CommunityCtx, postId: string, input: { note?: unknown; occurredOn?: unknown }): Promise<{ similarCount: number; mine: true }> {
    requireId(postId, 'postId');
    const rawNote = text(input?.note, 'note', { required: false, max: 1000 });
    const occurredOn = input?.occurredOn == null || input.occurredOn === '' ? null : String(input.occurredOn);
    if (occurredOn !== null && (!YMD.test(occurredOn) || Number.isNaN(Date.parse(`${occurredOn}T00:00:00Z`)) || Date.parse(`${occurredOn}T00:00:00Z`) > this.now().getTime() + 86_400_000)) throw invalid('occurredOn', 'a past date, YYYY-MM-DD');
    await this.writer(ctx, 'view_community');
    const post = await this.core.visiblePost(ctx, postId);
    if (post.visibility !== 'community_published') throw new CommunityError('post_not_published', 409, { status: post.status });
    if (post.originTenantId === ctx.tenantId) throw new CommunityError('own_post', 409);
    const note = rawNote ? scanned('note', rawNote).body : null;
    const r = await this.repo.markSimilar({ postId: post.id, tenantId: ctx.tenantId, userId: ctx.userId, note, occurredOn });
    if (r.inserted) await this.audit.record(ctx, 'post.similar_reported', post.id, { occurredOn });
    return { similarCount: r.similarCount, mine: true };
  }

  // ── follows ──
  async followPost(ctx: CommunityCtx, postId: string): Promise<{ following: boolean; followers: number }> {
    requireId(postId, 'postId');
    await this.writer(ctx, 'view_community');
    const post = await this.core.visiblePost(ctx, postId);
    if (post.visibility !== 'community_published') throw new CommunityError('post_not_published', 409, { status: post.status });
    return { following: true, followers: await this.repo.followPost({ postId: post.id, tenantId: ctx.tenantId, userId: ctx.userId }) };
  }
  async unfollowPost(ctx: CommunityCtx, postId: string): Promise<{ following: boolean; followers: number }> {
    requireId(postId, 'postId');
    await this.core.requireCapability(ctx, 'view_community');   // leaving is always allowed, even while suspended
    const post = await this.core.visiblePost(ctx, postId);
    return { following: false, followers: await this.repo.unfollowPost({ postId: post.id, tenantId: ctx.tenantId, userId: ctx.userId }) };
  }
  async listFollows(ctx: CommunityCtx): Promise<CommunityFollowView[]> {
    await this.core.requireCapability(ctx, 'view_community');
    return (await this.repo.listFollows(ctx.tenantId)).map(followView);
  }
  async createFollow(ctx: CommunityCtx, input: unknown): Promise<CommunityFollowView> {
    const n = normalizeFollow(input as any);
    if (!n.ok) throw invalid(n.invalid.field, n.invalid.message);
    await this.writer(ctx, 'view_community');
    const existing = await this.repo.listFollows(ctx.tenantId);
    const same = existing.find((f) => f.category === n.value.category && (f.region ?? '').toLowerCase() === (n.value.region ?? '').toLowerCase());
    if (!same && existing.length >= MAX_FOLLOWS_PER_SALON) throw new CommunityError('follow_limit_reached', 409, { max: MAX_FOLLOWS_PER_SALON });
    const f = await this.repo.upsertFollow(ctx.tenantId, ctx.userId, same ? { ...n.value, region: same.region } : n.value);
    await this.audit.record(ctx, 'follow.saved', f.id, { category: f.category, region: f.region, severityMin: f.severityMin, channels: f.channels });
    return followView(f);
  }
  async deleteFollow(ctx: CommunityCtx, id: string): Promise<{ ok: true }> {
    requireId(id);
    await this.core.requireCapability(ctx, 'view_community');
    if (!(await this.repo.deleteFollow(ctx.tenantId, id))) throw new CommunityError('follow_not_found', 404);
    await this.audit.record(ctx, 'follow.deleted', id, {});
    return { ok: true };
  }

  // ── evidence (the owning salon only; bytes go straight to private storage) ──
  private storageReady(): void {
    if (!this.blob.connected || typeof this.blob.presignPut !== 'function' || typeof this.blob.head !== 'function') throw new CommunityError('evidence_storage_not_configured', 503);
  }

  async requestUpload(ctx: CommunityCtx, body: unknown): Promise<CommunityEvidenceUploadTicket> {
    const val = validateEvidenceUpload(body);
    if (!val.ok) throw invalid(val.field, val.message);
    // Phase 12 (#34): the one upload policy's no-bytes rules before anything is signed (the bytes are scanned on completion)
    try { checkDeclaredUpload(UPLOAD_POLICIES.safetyEvidence, { sizeBytes: val.value.sizeBytes, declaredType: val.value.mimeType }); }
    catch (e) { if (e instanceof UploadRejected) throw invalid(e.reason === 'TOO_LARGE' ? 'sizeBytes' : 'mimeType', e.message); throw e; }
    await this.writer(ctx, 'upload_evidence');
    this.storageReady();
    const r = val.value;
    if (r.postId && !(await this.repo.ownPostExists(ctx.tenantId, r.postId))) throw new CommunityError('post_not_found', 404);
    if (r.incidentId && !(await this.repo.ownIncidentExists(ctx.tenantId, r.incidentId))) throw new CommunityError('incident_not_found', 404);
    if ((await this.repo.uploadsLastHour(ctx.tenantId)) >= EVIDENCE_UPLOADS_PER_HOUR) throw new CommunityError('rate_limited', 429, { reason: 'evidence_rate_limited', retryAfterMinutes: 60 });
    // the declared (signed, length-bound) size counts against the salon's storage quota — a presigned PUT never passes
    // the multipart guard
    await this.storageQuota?.reserveStorage(ctx.tenantId, r.sizeBytes);
    const ev = await this.repo.insertEvidence({ tenantId: ctx.tenantId, userId: ctx.userId, postId: r.postId, incidentId: r.incidentId, mimeType: r.mimeType, sizeBytes: r.sizeBytes, sha256: r.sha256, keyFor: (id) => evidenceStorageKey(ctx.tenantId, id) });
    const signed = await this.blob.presignPut!(ev.storageKey, { contentType: r.mimeType, sizeBytes: r.sizeBytes, sha256Base64: sha256HexToBase64(r.sha256) }, EVIDENCE_UPLOAD_TTL_SECONDS);
    if (!signed) { await this.repo.setUploadStatus(ctx.tenantId, ev.id, 'failed'); await this.storageQuota?.releaseStorage(ctx.tenantId, r.sizeBytes).catch(() => undefined); throw new CommunityError('evidence_storage_not_configured', 503); }
    await this.audit.record(ctx, 'evidence.upload_requested', ev.postId ?? ev.incidentId ?? ev.id, { evidenceId: ev.id, mimeType: r.mimeType, sizeBytes: r.sizeBytes });
    return { evidenceId: ev.id, uploadUrl: signed.url, method: 'PUT', headers: signed.headers, expiresAt: signed.expiresAt };
  }

  async completeUpload(ctx: CommunityCtx, evidenceId: string): Promise<CommunityEvidenceView> {
    requireId(evidenceId, 'evidenceId');
    await this.writer(ctx, 'upload_evidence');
    // §74: ownership before configuration — another salon's evidence id is not_found whatever the storage state
    const ev = await this.repo.getOwnEvidence(ctx.tenantId, evidenceId);
    if (!ev || ev.removedAt) throw new CommunityError('evidence_not_found', 404);
    this.storageReady();
    if (ev.uploadStatus === 'failed') throw new CommunityError('upload_failed', 409);
    if (ev.uploadStatus === 'pending_upload') {
      const obj = await this.blob.head!(ev.storageKey);
      if (!obj) throw new CommunityError('upload_not_found', 409);
      if (ev.sizeBytes != null && obj.sizeBytes !== ev.sizeBytes) {
        await this.repo.setUploadStatus(ctx.tenantId, ev.id, 'failed');
        await this.blob.remove(ev.storageKey).catch(() => undefined);
        throw new CommunityError('upload_size_mismatch', 409, { expected: ev.sizeBytes, actual: obj.sizeBytes });
      }
      await this.repo.setUploadStatus(ctx.tenantId, ev.id, 'uploaded');
    }
    const out = await this.scan(ctx.tenantId, ev, ctx.userId);
    await this.audit.record(ctx, 'evidence.uploaded', ev.postId ?? ev.incidentId ?? ev.id, { evidenceId: ev.id, scanStatus: out.scanStatus });
    return evidenceView(out);
  }

  /** Ask the scanner. FAILS CLOSED: an error, no verdict or anything unrecognised stays `unscanned` (locked). */
  async scan(tenantId: string, ev: EvidenceRecord, actorUserId: string | null): Promise<EvidenceRecord> {
    if (ev.scanStatus === 'clean' || ev.scanStatus === 'infected') return ev;
    let status: EvidenceRecord['scanStatus'] = 'unscanned';
    let detail: string | null = null;
    try { const r = await this.scanner.scan(ev.storageKey); status = r?.status === 'clean' || r?.status === 'infected' ? r.status : 'unscanned'; }
    catch (e: any) { status = 'unscanned'; detail = String(e?.message ?? 'scanner_error').slice(0, 200); }
    const out = await this.repo.setScan(tenantId, ev.id, status, detail ?? (status === 'unscanned' ? 'no_verdict' : null));
    if (status !== 'unscanned') {
      await this.events.emit({ tenantId, branchId: null, userId: actorUserId && UUID.test(actorUserId) ? actorUserId : null }, DOMAIN_EVENTS.COMMUNITY_EVIDENCE_SCANNED,
        { type: 'community_evidence', id: ev.id }, { evidenceId: ev.id, postId: ev.postId, scanStatus: status });
    }
    return out;
  }

  async listEvidence(ctx: CommunityCtx, postId: string): Promise<CommunityEvidenceView[]> {
    requireId(postId, 'postId');
    await this.core.requireCapability(ctx, 'upload_evidence');
    if (!(await this.repo.ownPostExists(ctx.tenantId, postId))) throw new CommunityError('post_not_found', 404);
    return (await this.repo.listOwnEvidenceForPost(ctx.tenantId, postId)).map(evidenceView);
  }

  async accessEvidence(ctx: CommunityCtx, evidenceId: string, reasonIn: unknown): Promise<CommunityEvidenceAccess> {
    requireId(evidenceId, 'evidenceId');
    const reason = text(reasonIn, 'reason', { required: true, max: 500 })!;
    if (reason.length < 3) throw invalid('reason', 'say why you are opening this file');
    const v = await this.core.requireCapability(ctx, 'upload_evidence');
    const ev = await this.repo.getOwnEvidence(ctx.tenantId, evidenceId);
    if (!ev || ev.removedAt) throw new CommunityError('evidence_not_found', 404);
    const d = canAccessRawEvidence({ tenantId: ctx.tenantId, role: v.role, canUploadEvidence: true }, { id: ev.id, ownerTenantId: ev.tenantId, scanStatus: ev.scanStatus, redactionStatus: ev.redactionStatus });
    if (!d.allowed) {
      await this.audit.record(ctx, 'evidence.access_denied', ev.postId ?? ev.id, { evidenceId: ev.id, reason: d.reason });
      throw new CommunityError('evidence_access_denied', 403, { reason: d.reason });
    }
    if (ev.uploadStatus !== 'uploaded') throw new CommunityError('evidence_not_uploaded', 409);
    const signed = this.blob.connected ? await this.blob.signedUrl(ev.storageKey, EVIDENCE_READ_TTL_SECONDS) : null;
    if (!signed) throw new CommunityError('evidence_storage_not_configured', 503);
    await this.repo.logEvidenceAccess({ evidenceId: ev.id, tenantId: ctx.tenantId, userId: ctx.userId, caseId: null, reason });
    await this.audit.record(ctx, 'evidence.accessed', ev.postId ?? ev.id, { evidenceId: ev.id, reason });
    return { url: signed.url, expiresAt: signed.expiresAt };
  }

  // ── the emergency banner ──
  async activeAlerts(ctx: CommunityCtx): Promise<CommunityActiveAlert[]> {
    await this.core.requireCapability(ctx, 'view_community');
    const [posts, follows, cats] = await Promise.all([this.repo.activeAlertPosts(ctx.tenantId, 72), this.repo.listFollows(ctx.tenantId), this.repo.notifyCategories(ctx.tenantId)]);
    const followed = (p: { category: string; region: string | null; severity: string }) => cats.includes(p.category) || follows.some((f) => followMatches(f, p));
    return posts
      .map((p) => ({ p, f: followed(p) ? 1 : 0 }))
      .sort((a, b) => b.f - a.f || (SEV_RANK[b.p.severity] ?? 0) - (SEV_RANK[a.p.severity] ?? 0) || (a.p.publishedAt < b.p.publishedAt ? 1 : a.p.publishedAt > b.p.publishedAt ? -1 : 0))
      .slice(0, 10)
      .map(({ p }) => {
        const label = p.authorLabel || 'A salon';
        return { postId: p.id, title: p.title, severity: p.severity as any, category: p.category as any, publishedAt: p.publishedAt, author: { label, isOwnSalon: false, anonymous: /^A salon( in .+)?$/.test(label) } };
      });
  }

  // ── analytics (own salon) ──
  async analytics(ctx: CommunityCtx, q: { from?: unknown; to?: unknown }): Promise<CommunityTenantAnalytics> {
    const r = parseAnalyticsRange(q, this.now());
    if (!r.ok) throw invalid(r.field, r.message);
    await this.core.requireCapability(ctx, 'manage_tenant_settings');
    return shapeAnalytics(r.from, r.to, await this.repo.analytics(ctx.tenantId, r.fromTs, r.toExclusiveTs));
  }
}

/** COMMUNITY_EVIDENCE_MODERATION — agent B's moderation routes reach evidence ONLY through this, under an OPEN case, with a
 *  reason; every access is logged (community_evidence_access_log) and audited; the file must be scanned clean. */
export class CommunityEvidenceModeration implements CommunityEvidenceModerationPort {
  constructor(private readonly repo: InteractionsRepo, private readonly blob: EvidenceBlobStore, private readonly audit: InteractionsAudit) {}

  private async caseFor(caseId: string, ev: EvidenceRecord) {
    if (!UUID.test(String(caseId ?? ''))) throw new CommunityError('moderation_case_required', 400);
    const c = await this.repo.openCase(caseId);
    if (!c) throw new CommunityError('case_not_found', 404);
    if (c.status !== 'open' && c.status !== 'investigating') throw new CommunityError('case_not_open', 409, { status: c.status });
    if (c.postId && ev.postId && c.postId !== ev.postId) throw new CommunityError('case_mismatch', 409);
    return c;
  }
  private modCtx(userId: string): CommunityCtx { return { tenantId: '*', branchId: null, userId, role: 'SUPER_ADMIN' }; }

  async moderatorAccess(input: { evidenceId: string; caseId: string; moderatorUserId: string; reason: string }): Promise<{ url: string; expiresAt: string }> {
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < 3) throw invalid('reason', 'required');
    if (!UUID.test(String(input?.moderatorUserId ?? ''))) throw new CommunityError('moderator_required', 403);
    const ev = UUID.test(String(input?.evidenceId ?? '')) ? await this.repo.getEvidence(input.evidenceId) : null;
    if (!ev || ev.removedAt) throw new CommunityError('evidence_not_found', 404);
    await this.caseFor(input.caseId, ev);
    const d = canAccessRawEvidence({ tenantId: '*', role: 'moderator', canUploadEvidence: false, moderationCaseId: input.caseId }, { id: ev.id, ownerTenantId: ev.tenantId, scanStatus: ev.scanStatus, redactionStatus: ev.redactionStatus });
    if (!d.allowed) {
      await this.audit.record(this.modCtx(input.moderatorUserId), 'evidence.access_denied', ev.postId ?? ev.id, { evidenceId: ev.id, caseId: input.caseId, ownerTenant: ev.tenantId, reason: d.reason });
      throw new CommunityError('evidence_access_denied', 403, { reason: d.reason });
    }
    const signed = this.blob.connected ? await this.blob.signedUrl(ev.storageKey, EVIDENCE_READ_TTL_SECONDS) : null;
    if (!signed) throw new CommunityError('evidence_storage_not_configured', 503);
    await this.repo.logEvidenceAccess({ evidenceId: ev.id, tenantId: null, userId: input.moderatorUserId, caseId: input.caseId, reason });
    await this.audit.record(this.modCtx(input.moderatorUserId), 'evidence.accessed', ev.postId ?? ev.id, { evidenceId: ev.id, caseId: input.caseId, ownerTenant: ev.tenantId, reason });
    return { url: signed.url, expiresAt: signed.expiresAt };
  }

  async review(input: { evidenceId: string; caseId: string; moderatorUserId: string; decision: 'clean' | 'redacted' | 'reject'; reason: string }): Promise<{ scanStatus: string; redactionStatus: string; uploadStatus: string }> {
    if (!['clean', 'redacted', 'reject'].includes(String(input?.decision))) throw invalid('decision', 'clean | redacted | reject');
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < 3) throw invalid('reason', 'required');
    if (!UUID.test(String(input?.moderatorUserId ?? ''))) throw new CommunityError('moderator_required', 403);
    const ev = UUID.test(String(input?.evidenceId ?? '')) ? await this.repo.getEvidence(input.evidenceId) : null;
    if (!ev || ev.removedAt) throw new CommunityError('evidence_not_found', 404);
    await this.caseFor(input.caseId, ev);
    const out = await this.repo.reviewEvidence({ id: ev.id, tenantId: ev.tenantId, decision: input.decision, caseId: input.caseId, moderatorUserId: input.moderatorUserId, reason });
    if (input.decision === 'reject') await this.blob.remove(ev.storageKey).catch(() => undefined);
    await this.audit.record(this.modCtx(input.moderatorUserId), 'evidence.reviewed', ev.postId ?? ev.id, { evidenceId: ev.id, caseId: input.caseId, ownerTenant: ev.tenantId, decision: input.decision, reason });
    return { scanStatus: out.scanStatus, redactionStatus: out.redactionStatus, uploadStatus: out.uploadStatus };
  }
}
