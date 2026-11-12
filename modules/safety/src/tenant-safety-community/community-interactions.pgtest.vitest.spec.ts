// community-interactions.pgtest — BUILD_PLAN Phase 8 (agent C): the interactions half against the REAL migrated schema
// (529 included), with the core (agent A's COMMUNITY_CORE) faked at its port and the REAL outbox writer. Salon A posts;
// salon B (enabled) reads, comments, follows, marks "happened to us too"; salon C has the community disabled; salon D
// opted into critical SMS and only wants Pennsylvania. Proves: threaded comments (depth, lock, restriction, rules,
// privacy scan, CAS edit, own delete, one report per salon), one "similar" per salon, follows, evidence (own salon only,
// presigned upload, size check, scanner fail-closed, logged access, moderator access only under an OPEN case),
// the emergency banner, analytics of the salon's OWN posts, the fan-out (B alerted, A / C never, D only when critical,
// SMS only with the opt-in, idempotent), followed-advisory change alerts, related / duplicate detection, the jobs
// (retention, archive, rescan, fingerprint expiry, dispatch) and the risk-matching store behind the platform flag.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter, DOMAIN_EVENTS } from '@aipowersalon/events';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { CommunityError } from './community.service';
import { OutboxCommunityEvents } from './community-events';
import { InMemoryCommunityAuditSink } from './community-audit';
import type { CommunityCorePort, CommunityViewerInfo } from './community.ports';
import type { CommunityCtx, PostRow } from './community.repository';
import type { EvidenceBlobStore } from './evidence-blob-store';
import { KyselyInteractionsRepo, KyselyRiskFingerprintStore } from './community-interactions.repository';
import { CommunityInteractionsService, CommunityEvidenceModeration } from './community-interactions.service';
import { CommunityFanoutService } from './community-fanout';
import { dispatchCommunityJobs, runRetentionJob, runArchiveJob, runEvidenceRescanJob, runRelatedJob, COMMUNITY_JOB, type CommunityJobDeps } from './community-jobs';
import { RiskMatchingService, RISK_MATCHING_FLAG } from './community-risk-matching';
import { DELETED_BY_AUTHOR } from './community-comments';

const id = (n: number) => `c8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), C = id(3), D = id(4);
const BA = id(11), BB1 = id(12), BB2 = id(13);
const A_OWNER = id(21), A_MGR = id(22), B_OWNER = id(31), B_MGR = id(32), B_DESK = id(33), B_DESK2 = id(34), D_OWNER = id(41), MOD = id(90);
const P1 = id(100), P_DRAFT = id(101), P_LOCKED = id(102), P_OLD = id(103), P_LOW = id(104), P_CRIT = id(105), P_DUP = id(106), P_REL = id(107), P_RESOLVED = id(108), P_REMOVED = id(109), P_STALE_DRAFT = id(110);
const INC_OLD = id(120), INC_NEW = id(121), CASE_OPEN = id(130), CASE_CLOSED = id(131);

let pg: any; let db: any; let repo: KyselyInteractionsRepo;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const ctxOf = (tenantId: string, userId: string, role = 'OWNER', branchId: string | null = null): CommunityCtx => ({ tenantId, branchId, userId, role });

// ── a fake COMMUNITY_CORE (agent A's port) over the real rows ──
type SalonOpts = { enabled?: boolean; suspended?: boolean; commentingRestricted?: boolean; rules?: boolean; caps?: string[] };
const salons: Record<string, SalonOpts> = {};
const ALL_CAPS = ['view_community', 'comment', 'upload_evidence', 'manage_tenant_settings', 'create_advisory_draft'];
const core: CommunityCorePort = {
  async viewer(ctx) {
    const s = salons[ctx.tenantId] ?? {};
    const caps = new Set<any>(ctx.role === 'RECEPTION' ? ['view_community', 'comment'] : (s.caps ?? ALL_CAPS));
    return { ctx, role: ctx.role === 'RECEPTION' ? 'receptionist' : ctx.role === 'MANAGER' ? 'branch_manager' : 'owner', capabilities: caps,
      settings: { tenantId: ctx.tenantId, authorDisplay: ctx.tenantId === B ? 'tenant_name' : 'anonymous', regionPreferences: ['NJ'] } as any, communityEnabled: s.enabled !== false,
      restrictions: { suspended: !!s.suspended, postingRestricted: false, commentingRestricted: !!s.commentingRestricted }, rulesAcknowledged: s.rules !== false } as CommunityViewerInfo & { rulesAcknowledged: boolean };
  },
  async requireCapability(ctx, cap) {
    const v = await core.viewer(ctx);
    if (!v.communityEnabled) throw new CommunityError('community_disabled', 403);
    if (v.restrictions.suspended && cap !== 'view_community') throw new CommunityError('community_suspended', 403);
    if (!v.capabilities.has(cap)) throw new CommunityError('permission_denied', 403);
    return v;
  },
  async visiblePost(ctx, postId) {
    const r = (await q('select * from community_posts where id = $1', [postId]))[0];
    if (!r) throw new CommunityError('post_not_found', 404);
    if (r.visibility !== 'community_published' && r.origin_tenant_id !== ctx.tenantId) throw new CommunityError('post_not_found', 404);
    return postRow(r);
  },
  async postView() { throw new Error('not used'); },
  async authorLabelFor(tenantId, display, region) { return display === 'anonymous' ? (region ? `A salon in ${region}` : 'A salon') : (tenantId === B ? 'Bella Nails B' : 'Salon'); },
};
const postRow = (r: any): PostRow => ({ id: r.id, originTenantId: r.origin_tenant_id, originBranchId: r.origin_branch_id, classification: r.classification, visibility: r.visibility, status: r.status, category: r.category, severity: r.severity, region: r.region, title: r.title, redactedBody: r.redacted_body, privacyScanFlags: [], moderationRequired: false, verificationLabel: r.verification_label, version: r.version, createdByUserId: r.created_by_user_id, createdAt: String(r.created_at), commentsLocked: r.comments_locked, authorLabel: r.author_label });
const post = async (pid: string) => postRow((await q('select * from community_posts where id = $1', [pid]))[0]);

// ── fakes for storage / scanner / push / notifications ──
class FakeBlob implements EvidenceBlobStore {
  connected = true; objects = new Map<string, number>(); removed: string[] = [];
  async put(key: string) { return { key }; }
  async signedUrl(key: string) { return { url: `https://bucket.test/${key}?sig=1`, expiresAt: new Date(Date.now() + 300_000).toISOString() }; }
  async remove(key: string) { this.removed.push(key); this.objects.delete(key); }
  async presignPut(key: string, o: { contentType: string; sizeBytes: number; sha256Base64: string }) { return { url: `https://bucket.test/${key}?put=1`, headers: { 'Content-Type': o.contentType, 'x-amz-checksum-sha256': o.sha256Base64 }, expiresAt: new Date(Date.now() + 600_000).toISOString() }; }
  async head(key: string) { return this.objects.has(key) ? { sizeBytes: this.objects.get(key)! } : null; }
}
const scanner = { next: 'clean' as any, throws: false, async scan() { if (scanner.throws) throw new Error('s3 down'); return { status: scanner.next }; } };
const pushes: { tenantId: string; userId: string; msg: any }[] = [];
const push = { async dispatchToUser(tenantId: string | null, userId: string, msg: any) { pushes.push({ tenantId: String(tenantId), userId, msg }); return { sent: 1 }; } };
const sends: { tenantId: string; channel: string; to: string; body: string }[] = [];
const notifications = { async send(ctx: any, req: any) { sends.push({ tenantId: ctx.tenantId, channel: req.channel, to: req.to, body: req.body }); return { sent: true }; } };

let blob: FakeBlob; let audit: InMemoryCommunityAuditSink; let svc: CommunityInteractionsService; let fanout: CommunityFanoutService; let events: OutboxCommunityEvents;
const outbox = async (type: string) => q('select tenant_id, branch_id, aggregate_id, payload_json, actor_id from outbox_events where event_type = $1 order by occurred_at, id', [type]);
const expectCode = async (p: Promise<unknown>, code: string, status?: number) => {
  try { await p; } catch (e: any) { expect(e).toBeInstanceOf(CommunityError); expect(e.code).toBe(code); if (status) expect(e.status).toBe(status); return e; }
  throw new Error(`expected ${code}`);
};

async function insertPost(pid: string, o: Record<string, unknown> = {}) {
  const p: any = { origin: A, visibility: 'community_published', status: 'published_unverified', category: 'phone_scam', severity: 'high', region: 'NJ', title: 'Caller pretends to be the card processor', tags: '[]', published: "now() - interval '1 hour'", ...o };
  await pg.exec(`insert into community_posts (id, origin_tenant_id, visibility, status, category, severity, region, title, redacted_body, created_by_user_id, tags, published_at, author_label, comments_locked)
    values ('${pid}', '${p.origin}', '${p.visibility}', '${p.status}', '${p.category}', '${p.severity}', ${p.region ? `'${p.region}'` : 'null'}, '${p.title.replace(/'/g, "''")}', 'body', '${A_OWNER}', '${p.tags}'::jsonb, ${p.published}, 'A salon in NJ', ${p.locked ? 'true' : 'false'})`);
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  for (const [t, code, phone] of [[A, 'P8CA', '+15550000001'], [B, 'P8CB', '+15550000002'], [C, 'P8CC', '+15550000003'], [D, 'P8CD', '+15550000004']]) {
    await pg.exec(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, email, business_phone) values ('${t}', 'Salon ${code}', 'Salon ${code}', 'salon-${code.toLowerCase()}', '${code}', 'active', '${code.toLowerCase()}@x.test', '${phone}')`);
  }
  await pg.exec(`insert into branches (id, tenant_id, name, status) values ('${BA}', '${A}', 'A main', 'active'), ('${BB1}', '${B}', 'B one', 'active'), ('${BB2}', '${B}', 'B two', 'active')`);
  await pg.exec(`insert into users (id, tenant_id, role, email, status) values
    ('${A_OWNER}', '${A}', 'OWNER', 'ao@x.test', 'active'), ('${A_MGR}', '${A}', 'MANAGER', 'am@x.test', 'active'),
    ('${B_OWNER}', '${B}', 'OWNER', 'bo@x.test', 'active'), ('${B_MGR}', '${B}', 'MANAGER', 'bm@x.test', 'active'), ('${B_DESK}', '${B}', 'RECEPTION', 'bd@x.test', 'active'), ('${B_DESK2}', '${B}', 'FRONT_DESK', 'bd2@x.test', 'active'),
    ('${D_OWNER}', '${D}', 'OWNER', 'do@x.test', 'active')`);
  await pg.exec(`insert into tenant_community_settings (tenant_id, enabled, critical_sms_enabled, region_preferences, push_enabled, email_enabled) values
    ('${A}', true, true, '[]', true, true), ('${B}', true, false, '[]', true, true), ('${C}', false, true, '[]', true, true), ('${D}', true, true, '["PA"]', false, false)`);
  await insertPost(P1);
  await insertPost(P_DRAFT, { visibility: 'draft', status: 'incident_draft', published: 'null' });
  await insertPost(P_LOCKED, { locked: true });
  repo = new KyselyInteractionsRepo(db);
  blob = new FakeBlob();
  audit = new InMemoryCommunityAuditSink();
  events = new OutboxCommunityEvents(db, new OutboxWriter());
  svc = new CommunityInteractionsService(core, repo, events, audit, blob, scanner as any);
  fanout = new CommunityFanoutService(repo, events, push, notifications, 'https://pos.test');
});

describe('comments', () => {
  it('salon B comments on salon A\'s advisory: redacted, labelled, counted, one outbox event for the ORIGIN salon', async () => {
    const c = await svc.addComment(ctxOf(B, B_DESK, 'RECEPTION', BB1), P1, { body: 'Same caller rang us from 856-555-0199 today' });
    expect(c.body).not.toContain('856-555-0199');
    expect(c.body).toContain('[REDACTED_PHONE]');
    expect(c).toMatchObject({ depth: 0, parentId: null, mine: true, removed: false, version: 1, author: { label: 'Bella Nails B', isOwnSalon: true, anonymous: false } });
    expect((await q('select comment_count, last_activity_at from community_posts where id = $1', [P1]))[0].comment_count).toBe(1);
    const ev = await outbox(DOMAIN_EVENTS.COMMUNITY_COMMENT_ADDED);
    expect(ev).toHaveLength(1);
    expect(ev[0].tenant_id).toBe(A);
    expect(ev[0].actor_id).toBeNull();                         // salon B's user id never rides on salon A's event
    expect(JSON.stringify(ev[0].payload_json)).not.toContain(B);
    expect(audit.entries.some((e) => e.action === 'comment.created' && e.entityId === P1)).toBe(true);
  });
  it('threads to depth 3 and no deeper; the reader sees no salon / user ids', async () => {
    const top = (await svc.listComments(ctxOf(A, A_OWNER), P1))[0];
    const r1 = await svc.addComment(ctxOf(A, A_OWNER), P1, { body: 'Thanks — reply 1', parentId: top.id });
    const r2 = await svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'reply 2', parentId: r1.id });
    const r3 = await svc.addComment(ctxOf(A, A_MGR, 'MANAGER'), P1, { body: 'reply 3', parentId: r2.id });
    expect([r1.depth, r2.depth, r3.depth]).toEqual([1, 2, 3]);
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'too deep', parentId: r3.id }), 'max_depth', 400);
    const tree = await svc.listComments(ctxOf(B, B_OWNER), P1);
    expect(tree[0].replies[0].replies[0].replies[0].id).toBe(r3.id);
    expect(tree[0].replies[0].author).toEqual({ label: 'A salon in NJ', isOwnSalon: false, anonymous: true });
    const json = JSON.stringify(tree);
    for (const x of [A, B, A_OWNER, B_DESK, B_OWNER, A_MGR]) expect(json).not.toContain(x);
  });
  it('a reply to a comment on ANOTHER post is refused', async () => {
    await insertPost(id(150));
    const other = await svc.addComment(ctxOf(B, B_OWNER), id(150), { body: 'elsewhere' });
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'x', parentId: other.id }), 'comment_not_found', 404);
  });
  it('locked → 409, restricted → 403, rules not acknowledged → 403, draft → 409 (and invisible to others), payment data → 400', async () => {
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P_LOCKED, { body: 'hi' }), 'comments_locked', 409);
    salons[B] = { commentingRestricted: true };
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'hi' }), 'community_commenting_restricted', 403);
    salons[B] = { rules: false };
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'hi' }), 'rules_not_acknowledged', 403);
    salons[B] = { suspended: true };
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'hi' }), 'community_suspended', 403);
    salons[B] = {};
    await expectCode(svc.addComment(ctxOf(A, A_OWNER), P_DRAFT, { body: 'hi' }), 'post_not_published', 409);
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P_DRAFT, { body: 'hi' }), 'post_not_found', 404);
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'card 4111 1111 1111 1111 was used' }), 'contains_payment_data', 400);
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), P1, { body: '   ' }), 'invalid_input', 400);
    await expectCode(svc.addComment(ctxOf(B, B_OWNER), 'not-an-id', { body: 'x' }), 'invalid_input', 400);
  });
  it('the rules check falls back to the acknowledgment table when the core does not say', async () => {
    const bare: CommunityCorePort = { ...core, viewer: async (ctx) => { const v: any = await core.viewer(ctx); delete v.rulesAcknowledged; return v; }, requireCapability: async (ctx, cap) => { const v: any = await core.requireCapability(ctx, cap); delete v.rulesAcknowledged; return v; } };
    const s2 = new CommunityInteractionsService(bare, repo, events, audit, blob, scanner as any);
    await expectCode(s2.addComment(ctxOf(B, B_MGR, 'MANAGER'), P1, { body: 'hello' }), 'rules_not_acknowledged', 403);
    await pg.exec(`insert into community_rules_acknowledgments (tenant_id, user_id, rules_version) values ('${B}', '${B_MGR}', '${COMMUNITY_RULES_VERSION}')`);
    expect((await s2.addComment(ctxOf(B, B_MGR, 'MANAGER'), P1, { body: 'hello' })).body).toBe('hello');
  });
  it('edit: own comment only, compare-and-set on version, history keeps the previous text', async () => {
    const c = await svc.addComment(ctxOf(B, B_DESK, 'RECEPTION'), P1, { body: 'first words' });
    await expectCode(svc.editComment(ctxOf(B, B_OWNER), c.id, { body: 'x', expectedVersion: 1 }), 'not_your_comment', 403);
    await expectCode(svc.editComment(ctxOf(A, A_OWNER), c.id, { body: 'x', expectedVersion: 1 }), 'comment_not_found', 404);
    await expectCode(svc.editComment(ctxOf(B, B_DESK, 'RECEPTION'), c.id, { body: 'x', expectedVersion: 2 }), 'version_conflict', 409);
    const e = await svc.editComment(ctxOf(B, B_DESK, 'RECEPTION'), c.id, { body: 'second words', expectedVersion: 1 });
    expect(e).toMatchObject({ body: 'second words', version: 2, edited: true });
    await expectCode(svc.editComment(ctxOf(B, B_DESK, 'RECEPTION'), c.id, { body: 'third', expectedVersion: 1 }), 'version_conflict', 409);
    expect(await q('select version, redacted_body from community_comment_versions where comment_id = $1', [c.id])).toEqual([{ version: 1, redacted_body: 'first words' }]);
  });
  it('delete: own → removed in place, counter down, idempotent; nobody else\'s', async () => {
    const before = (await q('select comment_count from community_posts where id = $1', [P1]))[0].comment_count;
    const c = await svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'to be deleted' });
    await expectCode(svc.deleteComment(ctxOf(B, B_MGR, 'MANAGER'), c.id), 'not_your_comment', 403);
    expect(await svc.deleteComment(ctxOf(B, B_OWNER), c.id)).toEqual({ ok: true, removed: true });
    expect(await svc.deleteComment(ctxOf(B, B_OWNER), c.id)).toEqual({ ok: true, removed: true });
    expect((await q('select comment_count from community_posts where id = $1', [P1]))[0].comment_count).toBe(before);
    const shown = JSON.stringify(await svc.listComments(ctxOf(A, A_OWNER), P1));
    expect(shown).toContain(DELETED_BY_AUTHOR);
    expect(shown).not.toContain('to be deleted');
    await expectCode(svc.addComment(ctxOf(A, A_OWNER), P1, { body: 'reply to deleted', parentId: c.id }), 'parent_removed', 409);
  });
  it('report: once per salon per comment; never your own salon\'s comment', async () => {
    const c = await svc.addComment(ctxOf(B, B_OWNER), P1, { body: 'reportable' });
    expect(await svc.reportComment(ctxOf(A, A_OWNER), c.id, { reason: 'harassment', detail: 'call me at 856-555-0123' })).toEqual({ ok: true });
    await expectCode(svc.reportComment(ctxOf(A, A_MGR, 'MANAGER'), c.id, { reason: 'spam' }), 'already_reported', 409);
    await expectCode(svc.reportComment(ctxOf(B, B_MGR, 'MANAGER'), c.id, { reason: 'spam' }), 'own_comment', 409);
    await expectCode(svc.reportComment(ctxOf(A, A_OWNER), c.id, { reason: 'because' }), 'invalid_input', 400);
    const r = await q('select reason, detail, status from community_comment_reports where comment_id = $1', [c.id]);
    expect(r).toEqual([{ reason: 'harassment', detail: 'call me at [REDACTED_PHONE]', status: 'open' }]);
    expect((await q('select report_count from community_comments where id = $1', [c.id]))[0].report_count).toBe(1);
  });
});

describe('similar experiences + post follows', () => {
  it('one per salon: the second press does not count again; never on your own post', async () => {
    expect(await svc.markSimilar(ctxOf(B, B_DESK, 'RECEPTION'), P1, { note: 'same caller, 856-555-0101', occurredOn: '2026-10-01' })).toEqual({ similarCount: 1, mine: true });
    expect(await svc.markSimilar(ctxOf(B, B_OWNER), P1, {})).toEqual({ similarCount: 1, mine: true });
    expect((await q('select redacted_note from community_similar_experiences where post_id = $1', [P1]))[0].redacted_note).toBe('same caller, [REDACTED_PHONE]');
    await expectCode(svc.markSimilar(ctxOf(A, A_OWNER), P1, {}), 'own_post', 409);
    await expectCode(svc.markSimilar(ctxOf(B, B_OWNER), P1, { occurredOn: '2099-01-01' }), 'invalid_input', 400);
    salons[D] = { suspended: true };
    await expectCode(svc.markSimilar(ctxOf(D, D_OWNER), P1, {}), 'community_suspended', 403);
    salons[D] = {};
    expect((await q('select similar_count from community_posts where id = $1', [P1]))[0].similar_count).toBe(1);
  });
  it('follow / unfollow a post per user; counter tracks real rows', async () => {
    expect(await svc.followPost(ctxOf(B, B_DESK, 'RECEPTION'), P1)).toEqual({ following: true, followers: 1 });
    expect(await svc.followPost(ctxOf(B, B_DESK, 'RECEPTION'), P1)).toEqual({ following: true, followers: 1 });
    expect(await svc.followPost(ctxOf(B, B_OWNER), P1)).toEqual({ following: true, followers: 2 });
    expect(await svc.unfollowPost(ctxOf(B, B_OWNER), P1)).toEqual({ following: false, followers: 1 });
    expect(await svc.unfollowPost(ctxOf(B, B_OWNER), P1)).toEqual({ following: false, followers: 1 });
    await expectCode(svc.followPost(ctxOf(B, B_OWNER), P_DRAFT), 'post_not_found', 404);
  });
  it('salon follows: create, upsert on the same category + region, list own only, delete own only', async () => {
    const f = await svc.createFollow(ctxOf(B, B_OWNER), { category: 'gift_card_scam', channels: ['in_app', 'push'] });
    const again = await svc.createFollow(ctxOf(B, B_MGR, 'MANAGER'), { category: 'gift_card_scam', severityMin: 'high' });
    expect(again.id).toBe(f.id);
    expect(again).toMatchObject({ category: 'gift_card_scam', region: null, severityMin: 'high', channels: ['in_app'] });
    expect((await svc.listFollows(ctxOf(B, B_OWNER))).map((x) => x.id)).toEqual([f.id]);
    expect(await svc.listFollows(ctxOf(A, A_OWNER))).toEqual([]);
    await expectCode(svc.deleteFollow(ctxOf(A, A_OWNER), f.id), 'follow_not_found', 404);
    await expectCode(svc.createFollow(ctxOf(B, B_OWNER), { category: 'nope' }), 'invalid_input', 400);
    expect(await svc.deleteFollow(ctxOf(B, B_OWNER), f.id)).toEqual({ ok: true });
  });
});

describe('evidence (own salon only, private storage, scanner fails closed)', () => {
  const sha = 'b'.repeat(64);
  it('no storage configured → 503 evidence_storage_not_configured (never 500, never a fake URL)', async () => {
    const off = new CommunityInteractionsService(core, repo, events, audit, { connected: false, put: async (k: string) => ({ key: k }), signedUrl: async () => null, remove: async () => undefined, presignPut: async () => null, head: async () => null }, scanner as any);
    await expectCode(off.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/png', sizeBytes: 10, sha256: sha }), 'evidence_storage_not_configured', 503);
    // §74: completing an id that is not this salon's is not_found — ownership is checked before configuration
    await expectCode(off.completeUpload(ctxOf(B, B_OWNER), '00000000-0000-4000-8000-0000000000e1'), 'evidence_not_found', 404);
  });
  it('upload → complete → scan; size mismatch fails; another salon cannot touch it; access is logged', async () => {
    await expectCode(svc.requestUpload(ctxOf(B, B_OWNER), { postId: P1, mimeType: 'image/png', sizeBytes: 10, sha256: sha }), 'post_not_found', 404);
    await expectCode(svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/gif', sizeBytes: 10, sha256: sha }), 'invalid_input', 400);
    const t = await svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/png', sizeBytes: 10, sha256: sha });
    expect(t).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/png' } });
    expect(t.uploadUrl).toContain(`tenants/${A}/community-evidence/${t.evidenceId}`);
    expect(Date.parse(t.expiresAt) - Date.now()).toBeLessThanOrEqual(600_000);
    await expectCode(svc.completeUpload(ctxOf(A, A_OWNER), t.evidenceId), 'upload_not_found', 409);
    await expectCode(svc.completeUpload(ctxOf(B, B_OWNER), t.evidenceId), 'evidence_not_found', 404);
    blob.objects.set(`tenants/${A}/community-evidence/${t.evidenceId}`, 10);
    scanner.next = 'clean';
    const done = await svc.completeUpload(ctxOf(A, A_OWNER), t.evidenceId);
    expect(done).toMatchObject({ id: t.evidenceId, uploadStatus: 'uploaded', scanStatus: 'clean', redactionStatus: 'pending', mimeType: 'image/png', sizeBytes: 10 });
    expect(JSON.stringify(done)).not.toContain('tenants/');
    const scanned = await outbox(DOMAIN_EVENTS.COMMUNITY_EVIDENCE_SCANNED);
    expect(scanned.at(-1)).toMatchObject({ tenant_id: A, aggregate_id: t.evidenceId });

    const bad = await svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'application/pdf', sizeBytes: 100, sha256: sha });
    blob.objects.set(`tenants/${A}/community-evidence/${bad.evidenceId}`, 99);
    await expectCode(svc.completeUpload(ctxOf(A, A_OWNER), bad.evidenceId), 'upload_size_mismatch', 409);
    expect((await q('select upload_status from community_evidence where id = $1', [bad.evidenceId]))[0].upload_status).toBe('failed');
    expect(blob.removed).toContain(`tenants/${A}/community-evidence/${bad.evidenceId}`);

    expect((await svc.listEvidence(ctxOf(A, A_OWNER), P1)).map((e) => e.id)).toEqual([t.evidenceId, bad.evidenceId]);
    await expectCode(svc.listEvidence(ctxOf(B, B_OWNER), P1), 'post_not_found', 404);
    await expectCode(svc.accessEvidence(ctxOf(A, A_OWNER), t.evidenceId, ''), 'invalid_input', 400);
    await expectCode(svc.accessEvidence(ctxOf(A, A_OWNER), t.evidenceId, 'ok'), 'invalid_input', 400);   // a reason, not a token
    await expectCode(svc.accessEvidence(ctxOf(B, B_OWNER), t.evidenceId, 'looking'), 'evidence_not_found', 404);
    const acc = await svc.accessEvidence(ctxOf(A, A_OWNER), t.evidenceId, 'checking the screenshot before a dispute');
    expect(acc.url).toContain('sig=1');
    expect(await q('select tenant_id, user_id, case_id, reason from community_evidence_access_log where evidence_id = $1', [t.evidenceId]))
      .toEqual([{ tenant_id: A, user_id: A_OWNER, case_id: null, reason: 'checking the screenshot before a dispute' }]);
    // Safety Community 05 — the access timeline rides on the evidence list: who (by role), when, why; a moderator unnamed; no ids
    await q(`update users set full_name = 'Amy Owner' where id = $1`, [A_OWNER]);
    await q(`insert into community_evidence_access_log (evidence_id, tenant_id, user_id, case_id, reason, created_at) values ($1, null, $2, $3, 'case review of a reported post', now() + interval '1 minute')`, [t.evidenceId, MOD, id(77)]);
    const withLog: any[] = await svc.listEvidence(ctxOf(A, A_OWNER), P1);
    const tl = withLog.find((e) => e.id === t.evidenceId).accessLog;
    expect(tl).toEqual([
      { at: expect.any(String), byName: null, byRole: null, moderator: true, reason: null },
      { at: expect.any(String), byName: 'Amy Owner', byRole: 'OWNER', moderator: false, reason: 'checking the screenshot before a dispute' }]);
    expect(withLog.find((e) => e.id === bad.evidenceId).accessLog).toEqual([]);
    expect(JSON.stringify(withLog)).not.toContain(MOD); expect(JSON.stringify(withLog)).not.toContain(A_OWNER);
  });
  it('the scanner fails CLOSED: an error or no verdict stays unscanned; the rescan job retries', async () => {
    const t = await svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/jpeg', sizeBytes: 5, sha256: sha });
    blob.objects.set(`tenants/${A}/community-evidence/${t.evidenceId}`, 5);
    scanner.throws = true;
    expect((await svc.completeUpload(ctxOf(A, A_OWNER), t.evidenceId)).scanStatus).toBe('unscanned');
    scanner.throws = false; scanner.next = 'unscanned';
    expect((await svc.completeUpload(ctxOf(A, A_OWNER), t.evidenceId)).scanStatus).toBe('unscanned');
    scanner.next = 'infected';
    const r = await runEvidenceRescanJob(jobDeps(), A);
    expect(r).toMatchObject({ checked: 1, infected: 1 });
    expect((await q('select scan_status from community_evidence where id = $1', [t.evidenceId]))[0].scan_status).toBe('infected');
    await expectCode(svc.accessEvidence(ctxOf(A, A_OWNER), t.evidenceId, 'want it'), 'evidence_access_denied', 403);
    scanner.next = 'clean';
  });
  it('moderator access only through the port, under an OPEN case, clean files only — logged with the case', async () => {
    const t = await svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/png', sizeBytes: 3, sha256: sha });
    blob.objects.set(`tenants/${A}/community-evidence/${t.evidenceId}`, 3);
    scanner.next = 'unscanned';
    await svc.completeUpload(ctxOf(A, A_OWNER), t.evidenceId);
    await pg.exec(`insert into community_moderation_cases (id, post_id, opened_by_user_id, reason, status, kind) values ('${CASE_OPEN}', '${P1}', '${MOD}', 'review evidence', 'open', 'evidence'), ('${CASE_CLOSED}', '${P1}', '${MOD}', 'old', 'closed', 'evidence')`);
    const mod = new CommunityEvidenceModeration(repo, blob, audit);
    await expectCode(mod.moderatorAccess({ evidenceId: t.evidenceId, caseId: id(999), moderatorUserId: MOD, reason: 'review' }), 'case_not_found', 404);
    await expectCode(mod.moderatorAccess({ evidenceId: t.evidenceId, caseId: CASE_CLOSED, moderatorUserId: MOD, reason: 'review' }), 'case_not_open', 409);
    await expectCode(mod.moderatorAccess({ evidenceId: t.evidenceId, caseId: CASE_OPEN, moderatorUserId: MOD, reason: 'review' }), 'evidence_access_denied', 403);   // unscanned → never to a third party
    scanner.next = 'clean';
    await runEvidenceRescanJob(jobDeps(), A);
    const got = await mod.moderatorAccess({ evidenceId: t.evidenceId, caseId: CASE_OPEN, moderatorUserId: MOD, reason: 'review the screenshot' });
    expect(got.url).toContain(t.evidenceId);
    expect(await q('select tenant_id, user_id, case_id from community_evidence_access_log where evidence_id = $1', [t.evidenceId])).toEqual([{ tenant_id: null, user_id: MOD, case_id: CASE_OPEN }]);
    expect(await mod.review({ evidenceId: t.evidenceId, caseId: CASE_OPEN, moderatorUserId: MOD, decision: 'redacted', reason: 'faces blurred' }))
      .toEqual({ scanStatus: 'clean', redactionStatus: 'redacted', uploadStatus: 'uploaded' });
    expect(await q('select field, case_id, redacted_by_user_id from community_redactions where evidence_id = $1', [t.evidenceId])).toEqual([{ field: 'evidence', case_id: CASE_OPEN, redacted_by_user_id: MOD }]);
    expect(await mod.review({ evidenceId: t.evidenceId, caseId: CASE_OPEN, moderatorUserId: MOD, decision: 'reject', reason: 'not relevant' })).toMatchObject({ uploadStatus: 'failed' });
    await expectCode(mod.moderatorAccess({ evidenceId: t.evidenceId, caseId: CASE_OPEN, moderatorUserId: MOD, reason: 'again' }), 'evidence_not_found', 404);
  });
  it('Phase 12 (#34): the presigned request is charged to the salon\'s storage quota; over quota nothing is signed', async () => {
    const charged: number[] = [];
    svc.storageQuota = { reserveStorage: async (_t: string, n: number) => { charged.push(n); if (n > 1000) throw Object.assign(new Error('quota'), { status: 429 }); }, releaseStorage: async () => undefined };
    try {
      await svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'image/png', sizeBytes: 10, sha256: sha });
      expect(charged).toEqual([10]);
      await expect(svc.requestUpload(ctxOf(A, A_OWNER), { postId: P1, mimeType: 'application/pdf', sizeBytes: 5000, sha256: sha })).rejects.toThrow('quota');
    } finally { svc.storageQuota = null; }
  });
});

describe('fan-out: how a published advisory reaches salon B', () => {
  it('B (enabled, no preferences) is alerted: in-app alert + ONE alert_delivered for B with its branches + push to its approvers + email; A, C, D are not', async () => {
    pushes.length = 0; sends.length = 0;
    const r = await fanout.publish(await post(P1));
    expect(r).toMatchObject({ recipients: 1, delivered: 1, sms: 0 });
    const alerts = await q(`select tenant_id, severity, title, metadata from owner_alerts where category = 'community_advisory' and metadata->>'postId' = $1`, [P1]);
    expect(alerts.map((a) => a.tenant_id)).toEqual([B]);
    expect(alerts[0].metadata).toMatchObject({ postId: P1, kind: 'published', link: `https://pos.test/community/posts/${P1}` });
    const ev = (await outbox(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED)).filter((e) => e.aggregate_id === P1);
    expect(ev.map((e) => e.tenant_id)).toEqual([B]);
    expect(ev[0].payload_json).toMatchObject({ postId: P1, severity: 'high', category: 'phone_scam', title: 'Caller pretends to be the card processor', kind: 'published' });
    expect([...ev[0].payload_json.branchIds].sort()).toEqual([BB1, BB2].sort());
    expect(JSON.stringify(ev[0].payload_json)).not.toContain(A);
    expect(pushes.map((p) => p.userId).sort()).toEqual([B_OWNER, B_MGR].sort());
    expect(pushes.every((p) => p.tenantId === B && !p.msg.body.includes('body'))).toBe(true);
    expect(sends).toEqual([{ tenantId: B, channel: 'email', to: 'p8cb@x.test', body: expect.stringContaining(`/community/posts/${P1}`) }]);
  });
  it('idempotent: a redelivered publish (or a restore) never stacks a second alert, push or email', async () => {
    pushes.length = 0; sends.length = 0;
    expect((await fanout.publish(await post(P1))).delivered).toBe(0);
    expect(pushes).toEqual([]); expect(sends).toEqual([]);
    expect((await outbox(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED)).filter((e) => e.aggregate_id === P1)).toHaveLength(1);
  });
  it('a draft is never fanned out', async () => {
    expect((await fanout.publish(await post(P_DRAFT))).recipients).toBe(0);
  });
  it('CRITICAL reaches every enabled salon (D despite its PA-only preference); SMS only to the salon that opted in', async () => {
    sends.length = 0;
    await insertPost(P_CRIT, { severity: 'critical', title: 'Fake processor technician visiting salons' });
    const r = await fanout.publish(await post(P_CRIT));
    expect(r).toMatchObject({ recipients: 2, delivered: 2, sms: 1 });
    expect((await q(`select tenant_id from owner_alerts where metadata->>'postId' = $1 order by tenant_id`, [P_CRIT])).map((x) => x.tenant_id)).toEqual([B, D].sort());
    expect(sends.filter((s) => s.channel === 'sms')).toEqual([{ tenantId: D, channel: 'sms', to: '+15550000004', body: expect.not.stringContaining('technician visiting') }]);
    expect(sends.filter((s) => s.channel === 'email').map((s) => s.tenantId)).toEqual([B]);   // D has email off
  });
  it('a follower salon hears a change once per post version; the change alert never names the removed post', async () => {
    pushes.length = 0;
    const r = await fanout.changed({ ...(await post(P1)), version: 2 }, 'resolved');
    expect(r.delivered).toBe(1);
    expect(pushes.map((p) => p.userId)).toEqual([B_DESK]);             // the user who follows it (B_OWNER unfollowed)
    expect((await fanout.changed({ ...(await post(P1)), version: 2 }, 'resolved')).delivered).toBe(0);
    await fanout.changed({ ...(await post(P1)), version: 3 }, 'removed');
    const removed = (await outbox(DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED)).filter((e) => e.payload_json.kind === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ tenant_id: B, payload_json: { title: '' } });
  });
  it('advisoryPublished never throws into the caller', async () => {
    const broken = new CommunityFanoutService({ fanoutRecipients: async () => { throw new Error('db down'); } } as any, events, push, notifications);
    await expect(broken.advisoryPublished(await post(P1))).resolves.toBeUndefined();
    await expect(broken.advisoryChanged(await post(P1), 'edited')).resolves.toBeUndefined();
  });
});

describe('related / duplicate detection', () => {
  it('same category within 14 days: near-identical title → possible_duplicate, similar → related, other category / far apart → nothing', async () => {
    await insertPost(P_DUP, { title: 'Caller pretends to be the card processor!' });
    await insertPost(P_REL, { title: 'Phone caller pretends to be from the card company', tags: '["Processor"]' });
    await pg.exec(`update community_posts set tags = '["processor"]' where id = '${P1}'`);
    await insertPost(id(160), { title: 'Caller pretends to be the card processor', category: 'gift_card_scam' });
    await insertPost(id(161), { title: 'Caller pretends to be the card processor', published: "now() - interval '40 days'" });
    expect(await fanout.detectRelated(P1)).toBeGreaterThanOrEqual(2);
    const links = await q(`select related_post_id, relation from community_related_posts where post_id = $1 order by relation`, [P1]);
    expect(links).toContainEqual({ related_post_id: P_DUP, relation: 'possible_duplicate' });
    expect(links).toContainEqual({ related_post_id: P_REL, relation: 'related' });
    expect(links.map((l) => l.related_post_id)).not.toContain(id(160));
    expect(links.map((l) => l.related_post_id)).not.toContain(id(161));
    expect(await q(`select relation from community_related_posts where post_id = $1 and related_post_id = $2`, [P_DUP, P1])).toEqual([{ relation: 'possible_duplicate' }]);   // both ways
    expect(await fanout.detectRelated(P1)).toBe(0);                     // a re-run adds nothing
    expect((await runRelatedJob(jobDeps(), A)).linked).toBeGreaterThanOrEqual(0);
  });
});

describe('the emergency banner + analytics', () => {
  it('active alerts: other salons\' high / critical from the last 72 h, followed categories first, no ids', async () => {
    await insertPost(P_OLD, { title: 'Old', published: "now() - interval '80 hours'" });
    await insertPost(P_LOW, { title: 'Low one', severity: 'low' });
    await insertPost(id(170), { title: 'Gift card high', category: 'gift_card_scam', severity: 'high' });
    await svc.createFollow(ctxOf(B, B_OWNER), { category: 'gift_card_scam' });
    const list = await svc.activeAlerts(ctxOf(B, B_DESK, 'RECEPTION'));
    const ids = list.map((a) => a.postId);
    expect(ids[0]).toBe(id(170));                                      // followed first
    expect(ids).toContain(P_CRIT);
    expect(ids).not.toContain(P_OLD); expect(ids).not.toContain(P_LOW); expect(ids).not.toContain(P_DRAFT);
    expect(list[0].author).toEqual({ label: 'A salon in NJ', isOwnSalon: false, anonymous: true });
    expect(JSON.stringify(list)).not.toContain(A);
    expect(await svc.activeAlerts(ctxOf(A, A_OWNER))).toEqual([]);   // never your own posts
  });
  it('analytics count the salon\'s OWN posts only, and need settings.manage', async () => {
    const a = await svc.analytics(ctxOf(A, A_OWNER), {});
    expect(a.published).toBeGreaterThanOrEqual(5);
    expect(a.posts.incident_draft).toBe(1);
    expect(a.comments).toBeGreaterThanOrEqual(5);
    expect(a.similarReports).toBe(1);
    expect(a.topCategories[0]).toEqual({ category: 'phone_scam', count: expect.any(Number) });
    const b = await svc.analytics(ctxOf(B, B_OWNER), {});
    expect(b).toMatchObject({ published: 0, comments: 0, similarReports: 0, posts: {} });
    await expectCode(svc.analytics(ctxOf(B, B_DESK, 'RECEPTION'), {}), 'permission_denied', 403);
    await expectCode(svc.analytics(ctxOf(A, A_OWNER), { from: '2026-13-01' }), 'invalid_input', 400);
  });
});

function jobDeps(): CommunityJobDeps {
  return { db, repo, events, blob, interactions: svc, fanout, fingerprints: new KyselyRiskFingerprintStore(db), audit };
}

describe('jobs (one salon each, systemContext, idempotent dispatch)', () => {
  it('retention purges stale drafts, old private incidents and the evidence of removed posts — and nothing recent or published', async () => {
    await insertPost(P_STALE_DRAFT, { visibility: 'draft', status: 'returned_for_correction', published: 'null' });
    await insertPost(P_REMOVED, { visibility: 'removed', status: 'removed', published: 'null' });
    await pg.exec(`update community_posts set updated_at = now() - interval '800 days' where id in ('${P_STALE_DRAFT}', '${P_REMOVED}')`);
    await pg.exec(`insert into tenant_private_incidents (id, tenant_id, category, severity, raw_detail, created_by_user_id, created_at) values
      ('${INC_OLD}', '${A}', 'phone_scam', 'high', 'old raw', '${A_OWNER}', now() - interval '800 days'), ('${INC_NEW}', '${A}', 'phone_scam', 'high', 'new raw', '${A_OWNER}', now())`);
    await pg.exec(`insert into community_evidence (id, post_id, tenant_id, storage_key, uploaded_by_user_id, upload_status) values ('${id(180)}', '${P_REMOVED}', '${A}', 'tenants/${A}/community-evidence/${id(180)}', '${A_OWNER}', 'uploaded')`);
    const r = await runRetentionJob(jobDeps(), A);
    expect(r).toMatchObject({ retentionDays: 730, drafts: 1, incidents: 1, evidence: 1, blobsRemoved: 1 });
    expect(await q(`select id from community_posts where id in ('${P_STALE_DRAFT}', '${P_DRAFT}', '${P1}') order by id`)).toEqual([{ id: P1 }, { id: P_DRAFT }]);
    expect(await q(`select id from tenant_private_incidents where tenant_id = $1`, [A])).toEqual([{ id: INC_NEW }]);
    expect((await q(`select removed_at from community_evidence where id = $1`, [id(180)]))[0].removed_at).not.toBeNull();
    expect(audit.entries.some((e) => e.action === 'retention.purged' && e.role === 'SYSTEM')).toBe(true);
    await expect(runRetentionJob(jobDeps(), null)).rejects.toThrow(/salon/);
  });
  it('archive: resolved > 90 days → archived, version bumped, ADVISORY_UPDATED for the origin salon', async () => {
    await insertPost(P_RESOLVED, { status: 'resolved' });
    await pg.exec(`update community_posts set resolved_at = now() - interval '100 days' where id = '${P_RESOLVED}'`);
    expect(await runArchiveJob(jobDeps(), A)).toEqual({ archived: 1 });
    expect((await q('select status, version from community_posts where id = $1', [P_RESOLVED]))[0]).toEqual({ status: 'archived', version: 2 });
    expect((await outbox(DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED)).find((e) => e.aggregate_id === P_RESOLVED)).toMatchObject({ tenant_id: A, payload_json: { status: 'archived' } });
    expect(await runArchiveJob(jobDeps(), A)).toEqual({ archived: 0 });
  });
  it('dispatch enqueues one job per salon per day (a second dispatch is a no-op) and purges expired fingerprints', async () => {
    await pg.exec(`insert into community_risk_fingerprints (post_id, indicator_kind, fingerprint, expires_at) values ('${P1}', 'phone', 'f-old', now() - interval '1 day'), ('${P1}', 'phone', 'f-live', now() + interval '1 day')`);
    const first = await dispatchCommunityJobs(jobDeps());
    expect(first.retention).toBeGreaterThanOrEqual(3);                 // A, B, C, D have settings rows
    expect(first.related).toBeGreaterThanOrEqual(1);
    expect(first.fingerprintsPurged).toBe(1);
    const second = await dispatchCommunityJobs(jobDeps());
    expect(second).toMatchObject({ retention: 0, related: 0, archive: 0 });
    const jobs = await q(`select job_type, tenant_id from jobs where job_type like 'community.%' and tenant_id = $1 order by job_type`, [A]);
    expect(jobs.map((j) => j.job_type)).toEqual(expect.arrayContaining([COMMUNITY_JOB.retention, COMMUNITY_JOB.related]));
    expect(await q(`select fingerprint from community_risk_fingerprints`)).toEqual([{ fingerprint: 'f-live' }]);
  });
});

describe('risk matching behind the platform flag', () => {
  it('flag OFF → nothing hashed or written; ON (+ policy + salt) → salted fingerprints, surfaced only as a count', async () => {
    const env = { COMMUNITY_RISK_POLICY_REF: 'privacy-policy-2026-10', COMMUNITY_RISK_SALT: 's'.repeat(32) } as any;
    const rm = new RiskMatchingService(new KyselyRiskFingerprintStore(db), repo, env);
    expect(await rm.recordFromText(P_DUP, 'caller 856-555-0142 bad@x.test')).toEqual({ recorded: 0, reason: 'disabled' });
    expect(await rm.relatedReports(P1, 'caller 856-555-0142')).toBeNull();
    await pg.exec(`insert into platform_settings (setting_key, setting_group, value, value_type) values ('${RISK_MATCHING_FLAG}', 'community', 'true'::jsonb, 'boolean')`);
    expect(await rm.recordFromText(P_DUP, 'caller 856-555-0142 bad@x.test')).toEqual({ recorded: 2 });
    expect(await rm.recordFromText(P_REL, 'call (856) 555-0142, write BAD@x.test')).toEqual({ recorded: 2 });
    const stored = await q(`select fingerprint from community_risk_fingerprints where post_id in ($1, $2)`, [P_DUP, P_REL]);
    expect(JSON.stringify(stored)).not.toContain('555');
    const rel = await rm.relatedReports(P1, 'they used 8565550142 and bad@x.test');
    expect(rel).toMatchObject({ surfaced: true, matchingReports: 2, mayDenyService: false, reportingTenants: [] });
    expect(await new RiskMatchingService(new KyselyRiskFingerprintStore(db), repo, {} as any).recordFromText(P1, '856-555-0142')).toEqual({ recorded: 0, reason: 'disabled' });   // no policy / salt
  });
});
