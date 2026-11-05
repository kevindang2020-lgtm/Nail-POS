// community-moderation.pgtest — BUILD_PLAN Phase 8 (agent B): the Super Admin moderation center over the REAL migrated schema
// (360/362/529) in PGlite, with the real outbox writer. Proves: cases are really created (bug 3) and reused, actions are really
// written with the real moderator (bug 2), the post moves from its REAL status (bug 4), the sensitive queue exists (bug 5),
// remove works from every visible state (bug 12), appeals are decided with decided_by/decided_at and reviewer separation,
// restrictions reach the COMMUNITY_RESTRICTIONS port, events land in the outbox in the same transaction, and the
// returnReason query agent A runs reads the moderator's message.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { CommunityModerationRepo } from './community-moderation.repository';
import { CommunityModerationService, CommunityRestrictions } from './community-moderation.service';
import { OutboxCommunityEvents } from './community-events';

const id = (n: number) => `8b8b8b8b-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = id(1), T2 = id(2), MOD = id(10), MOD2 = id(11), OWNER1 = id(12), OWNER2 = id(13), B1 = id(20);
let pg: any; let db: any; let svc: CommunityModerationService; let repo: CommunityModerationRepo;
const fan: { kind: string; postId: string; change?: string }[] = [];
const notes: { tenantId: string; subject: string; body: string }[] = [];
const evidenceCalls: any[] = [];
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
const me = { userId: MOD }, other = { userId: MOD2 };
let seq = 100;

async function seedPost(over: Record<string, unknown> = {}) {
  const pid = id(seq++);
  const o: any = { status: 'moderation_review', visibility: 'draft', category: 'account_takeover_attempt', severity: 'high', title: 'Fake support call', body: 'Caller pretended to be platform support.', label: 'unverified', tenant: T1, version: 1, ...over };
  await q(`insert into community_posts (id, origin_tenant_id, origin_branch_id, visibility, status, category, severity, region, title, redacted_body, verification_label, version, created_by_user_id, author_display, published_at)
           values ($1,$2,$3,$4,$5,$6,$7,'NJ',$8,$9,$10,$11,$12,$13,$14)`, [pid, o.tenant, B1, o.visibility, o.status, o.category, o.severity, o.title, o.body, o.label, o.version, OWNER1, o.authorDisplay ?? 'display_name', o.publishedAt ?? null]);
  return pid;
}
const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return `${e.status}:${e.code}`; } };

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Bella Nails LLC','Bella Nails','bella-p8b','MODP8B1','active'), ($2,'Other Salon LLC','Other Salon','other-p8b','MODP8B2','active')`, [T1, T2]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active')`, [B1, T1]);
  await q(`insert into users (id, tenant_id, role, email, full_name, status) values ($1,null,'SUPER_ADMIN','mod1@p8b.test','Mia Moderator','active'), ($2,null,'SUPER_ADMIN','mod2@p8b.test','Max Moderator','active'),
           ($3,$5,'OWNER','owner1@p8b.test','Olive Owner','active'), ($4,$6,'OWNER','owner2@p8b.test','Otto Owner','active')`, [MOD, MOD2, OWNER1, OWNER2, T1, T2]);
  await q(`insert into tenant_community_settings (tenant_id, enabled, display_name) values ($1, true, 'Downtown salon'), ($2, true, null)`, [T1, T2]);
  repo = new CommunityModerationRepo(db);
  svc = new CommunityModerationService(repo, new OutboxCommunityEvents(db, new OutboxWriter()),
    { async advisoryPublished(p) { fan.push({ kind: 'published', postId: p.id }); }, async advisoryChanged(p, change) { fan.push({ kind: 'changed', postId: p.id, change }); } },
    { async moderatorAccess(i) { evidenceCalls.push(['access', i]); return { url: 'https://signed.example/x', expiresAt: '2026-10-08T12:05:00Z' }; },
      async review(i) { evidenceCalls.push(['review', i]); return { scanStatus: 'clean', redactionStatus: 'redacted', uploadStatus: 'uploaded' }; } },
    null, { async notify(tenantId, msg) { notes.push({ tenantId, ...msg }); return { sent: 1, failed: 0 }; } });
});
beforeEach(() => { fan.length = 0; notes.length = 0; });

describe('post actions under a real case', () => {
  it('publish opens a REAL case, writes the action with the real moderator, a version row, the audit row and outbox events in one go', async () => {
    const pid = await seedPost();
    const r = await svc.postAction(me, pid, { action: 'publish', reason: 'checked the wording', expectedVersion: 1 });
    expect(r.ok).toBe(true);
    expect(r.post).toMatchObject({ id: pid, status: 'published_unverified', visibility: 'community_published', authorLabel: 'Downtown salon', version: 2, originTenantName: 'Bella Nails', originBranchName: 'Main' });
    const [c] = await q(`select * from community_moderation_cases where id = $1`, [r.caseId]);
    expect(c).toMatchObject({ post_id: pid, kind: 'post_review', status: 'resolved', opened_by_user_id: MOD, target_tenant_id: T1, priority: 'high' });
    const acts = await q(`select * from community_moderation_actions where case_id = $1`, [r.caseId]);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ action: 'publish', actor_user_id: MOD, post_id: pid, target_tenant_id: T1, reason: 'checked the wording' });
    expect((await q(`select version, status, edited_by_user_id from community_post_versions where post_id = $1`, [pid]))).toEqual([{ version: 2, status: 'published_unverified', edited_by_user_id: MOD }]);
    expect((await q(`select tenant_id, user_id, role from audit_logs where action_type = 'community.moderation.publish' and entity_id = $1`, [pid]))).toEqual([{ tenant_id: T1, user_id: MOD, role: 'SUPER_ADMIN' }]);
    const ev = (await q(`select event_type, tenant_id, actor_id from outbox_events where aggregate_id in ($1, $2) order by event_type`, [pid, r.caseId]));
    expect(ev.map((e) => e.event_type)).toEqual(['community.advisory_published', 'community.moderation_action_taken', 'community.moderation_case_opened']);
    expect(ev.every((e) => e.tenant_id === T1 && e.actor_id === MOD)).toBe(true);
    expect(fan).toEqual([{ kind: 'published', postId: pid }]);
  });

  it('a given caseId must exist and be open; a stale version is 409 and nothing is written', async () => {
    const pid = await seedPost();
    expect(await err(svc.postAction(me, pid, { action: 'publish', reason: 'checked the wording', expectedVersion: 1, caseId: id(999) }))).toBe('404:case_not_found');
    const opened = await svc.openCase(me, { kind: 'post_review', reason: 'manual review start', postId: pid });
    await svc.updateCase(me, opened.id, { status: 'closed', resolutionNote: 'closing this one' });
    expect(await err(svc.postAction(me, pid, { action: 'publish', reason: 'checked the wording', expectedVersion: 1, caseId: opened.id }))).toBe('409:case_closed');
    await expect(svc.postAction(me, pid, { action: 'publish', reason: 'checked the wording', expectedVersion: 7 })).rejects.toMatchObject({ status: 409, code: 'version_conflict', extra: { currentVersion: 1 } });
    expect((await q(`select status, version from community_posts where id = $1`, [pid]))[0]).toEqual({ status: 'moderation_review', version: 1 });
    expect((await q(`select count(*)::int as n from community_moderation_actions where post_id = $1 and action <> 'case_updated'`, [pid]))[0].n).toBe(0);
    // the repository's own compare-and-set (defence in depth behind the row lock): a stale version writes nothing
    const locked = await repo.tx(async (trx) => repo.lockPost(trx, pid));
    expect(await repo.tx(async (trx) => repo.updatePost(trx, pid, 99, { ...(locked as any), redactedBody: 'x', title: 'x', privacyScanFlags: [], publishedAt: null, resolvedAt: null }))).toBeNull();
  });

  it('request_evidence keeps the case open, stores the message A shows as returnReason, and nudges the owner', async () => {
    const pid = await seedPost();
    const r1 = await svc.postAction(me, pid, { action: 'request_evidence', reason: 'need proof first', expectedVersion: 1, messageToTenant: 'Please upload the call log screenshot.' });
    expect(r1.post?.status).toBe('evidence_requested');
    expect((await q(`select status from community_moderation_cases where id = $1`, [r1.caseId]))[0].status).toBe('investigating');
    // agent A's returnReason read (A-interface.md (b))
    const [rr] = await q(`select coalesce(detail->>'messageToTenant', reason) as return_reason from community_moderation_actions
                          where post_id = $1 and action in ('reject','request_changes','request_evidence') order by created_at desc limit 1`, [pid]);
    expect(rr.return_reason).toBe('Please upload the call log screenshot.');
    expect(notes).toHaveLength(1); expect(notes[0].tenantId).toBe(T1); expect(notes[0].body).not.toContain('call log');
    // the author resubmits (A moves it back to moderation_review) → the SAME case is reused for the decision
    await q(`update community_posts set status = 'moderation_review', version = version + 1 where id = $1`, [pid]);
    const r2 = await svc.postAction(me, pid, { action: 'reject', reason: 'still not enough', expectedVersion: 3, messageToTenant: 'The screenshot shows a customer phone.' });
    expect(r2.caseId).toBe(r1.caseId);
    expect(r2.post?.status).toBe('rejected');
    expect((await q(`select count(*)::int as n from community_moderation_cases where post_id = $1`, [pid]))[0].n).toBe(1);
    expect((await q(`select event_type from outbox_events where aggregate_id = $1 order by occurred_at`, [pid])).map((e) => e.event_type)).toEqual(['community.advisory_returned', 'community.advisory_returned']);
  });

  it('bug 5: sensitive_data_detected has its own queue; redact + publish clears it', async () => {
    const pid = await seedPost({ status: 'sensitive_data_detected', body: 'Customer Jane said call 856-555-0111.', title: 'Sensitive one' });
    const queue = await svc.listPosts({ queue: 'sensitive' });
    expect(queue.items.map((p) => p.id)).toContain(pid);
    expect((await svc.listPosts({ queue: 'review' })).items.map((p) => p.id)).not.toContain(pid);
    const r = await svc.postAction(me, pid, { action: 'redact', reason: 'remove the name', expectedVersion: 1, redactions: [{ field: 'body', find: 'Jane', replaceWith: '[customer]' }] });
    expect(r.post?.body).toBe('Customer [customer] said call [REDACTED_PHONE].');
    expect((await q(`select kind from community_moderation_cases where id = $1`, [r.caseId]))[0].kind).toBe('sensitive_data');
    expect((await q(`select field, redacted_by_user_id from community_redactions where post_id = $1`, [pid]))).toEqual([{ field: 'body', redacted_by_user_id: MOD }]);
    const pub = await svc.postAction(me, pid, { action: 'publish', reason: 'clean after redaction', expectedVersion: 2 });
    expect(pub.caseId).toBe(r.caseId);
    expect(pub.post?.status).toBe('published_unverified');
  });

  it('bug 12: remove from published_official_report / corrected / resolved; restore brings the label-matched state back', async () => {
    for (const status of ['published_official_report', 'corrected', 'resolved']) {
      const pid = await seedPost({ status, visibility: 'community_published', label: 'official_report', publishedAt: '2026-09-01T00:00:00Z' });
      const r = await svc.postAction(me, pid, { action: 'remove', reason: 'violates the rules', expectedVersion: 1 });
      expect(r.post).toMatchObject({ status: 'removed', visibility: 'removed', removedReason: 'violates the rules' });
    }
    const pid = await seedPost({ status: 'published_unverified', visibility: 'community_published', label: 'multiple_reports', publishedAt: '2026-09-01T00:00:00Z', authorDisplay: 'anonymous' });
    await svc.postAction(me, pid, { action: 'remove', reason: 'violates the rules', expectedVersion: 1 });
    const back = await svc.postAction(me, pid, { action: 'restore', reason: 'removal was wrong', expectedVersion: 2 });
    expect(back.post).toMatchObject({ status: 'published_multiple_reports', visibility: 'community_published', authorLabel: 'A salon in NJ', publishedAt: expect.stringContaining('2026-09-01') });
  });

  it('merge_into removes the duplicate and links it; link_related links both ways', async () => {
    const keep = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    const dup = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    const r = await svc.postAction(me, dup, { action: 'merge_into', reason: 'same scam twice', expectedVersion: 1, targetPostId: keep });
    expect(r.post).toMatchObject({ status: 'removed' });
    expect((await q(`select merged_into_post_id from community_posts where id = $1`, [dup]))[0].merged_into_post_id).toBe(keep);
    expect((await q(`select relation, source from community_related_posts where post_id = $1`, [dup]))).toEqual([{ relation: 'merged_into', source: 'moderator' }]);
    const other1 = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    await svc.postAction(me, other1, { action: 'link_related', reason: 'same caller pattern', expectedVersion: 1, targetPostId: keep });
    expect((await q(`select count(*)::int as n from community_related_posts where relation = 'related' and (post_id = $1 or related_post_id = $1)`, [other1]))[0].n).toBe(2);
    const detail = await svc.postDetail(keep);
    expect(detail.related.map((x) => x.id)).toContain(other1);
    expect(detail.post.signals?.notes.length).toBeGreaterThan(0);
  });
});

describe('cases, comments, reports, disputes', () => {
  it('opening a case for a post twice returns the same open case (unique index); a case needs a target', async () => {
    const pid = await seedPost();
    const a = await svc.openCase(me, { kind: 'report', reason: 'several reports came in', postId: pid, priority: 'urgent' });
    const b = await svc.openCase(me, { kind: 'report', reason: 'several reports came in', postId: pid });
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ kind: 'report', status: 'open', priority: 'urgent', targetTenantId: T1, targetTenantName: 'Bella Nails', openedByName: 'Mia Moderator' });
    expect(await err(svc.openCase(me, { kind: 'tenant_conduct', reason: 'no target given here' }))).toBe('400:invalid_input');
    const assigned = await svc.updateCase(other, a.id, { assignToMe: true, status: 'investigating' });
    expect(assigned).toMatchObject({ assignedToUserId: MOD2, assignedToName: 'Max Moderator', status: 'investigating' });
    expect((await svc.listCases(other, { mine: 'true' })).items.map((c) => c.id)).toContain(a.id);
    expect((await svc.caseDetail(a.id)).actions.map((x) => x.action)).toContain('case_updated');
  });

  it('comment remove / restore / redact; COMMENT_REMOVED to the commenter’s salon', async () => {
    const pid = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    const cid = id(seq++);
    await q(`insert into community_comments (id, post_id, tenant_id, redacted_body, created_by_user_id) values ($1,$2,$3,'Same here, she gave her name as Ann.', $4)`, [cid, pid, T2, OWNER2]);
    await q(`update community_posts set comment_count = 1 where id = $1`, [pid]);
    const r = await svc.commentAction(me, cid, { action: 'remove', reason: 'names a person' });
    expect(r.comment).toMatchObject({ removed: true, removedReason: 'names a person', tenantName: 'Other Salon' });
    expect((await q(`select comment_count from community_posts where id = $1`, [pid]))[0].comment_count).toBe(0);
    expect((await q(`select tenant_id from outbox_events where event_type = 'community.comment_removed' and aggregate_id = $1`, [cid]))).toEqual([{ tenant_id: T2 }]);
    expect(await err(svc.commentAction(me, cid, { action: 'remove', reason: 'names a person' }))).toBe('409:illegal_transition');
    await svc.commentAction(me, cid, { action: 'restore', reason: 'restoring after edit' });
    const red = await svc.commentAction(me, cid, { action: 'redact', reason: 'drop the name', find: 'Ann', replaceWith: '[name]' });
    expect(red.comment?.body).toBe('Same here, she gave her name as [name].');
    expect((await q(`select version from community_comment_versions where comment_id = $1`, [cid]))).toEqual([{ version: 2 }]);
    expect((await svc.postComments(pid))).toHaveLength(1);
  });

  it('resolving a report closes its case when no open report is left', async () => {
    const pid = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    const rid = id(seq++);
    await q(`insert into community_reports (id, post_id, reporter_tenant_id, reason) values ($1,$2,$3,'inaccurate')`, [rid, pid, T2]);
    expect((await svc.listReports({})).items.find((x) => x.id === rid)).toMatchObject({ reporterTenantName: 'Other Salon', status: 'open' });
    const r = await svc.resolveReport(me, rid, 'post', { resolution: 'dismissed', reason: 'report not supported' });
    expect((await q(`select status, resolved_by_user_id, case_id from community_reports where id = $1`, [rid]))[0]).toEqual({ status: 'dismissed', resolved_by_user_id: MOD, case_id: r.caseId });
    expect((await q(`select status from community_moderation_cases where id = $1`, [r.caseId]))[0].status).toBe('resolved');
    expect(await err(svc.resolveReport(me, rid, 'post', { resolution: 'dismissed', reason: 'report not supported' }))).toBe('409:already_resolved');
  });

  it('dispute decisions: upheld restores the published state, corrected → corrected, overturned removes', async () => {
    const mk = async () => { const pid = await seedPost({ status: 'disputed', visibility: 'community_published', label: 'evidence_reviewed' }); const did = id(seq++);
      await q(`insert into community_disputes (id, post_id, raised_by_tenant_id, reason) values ($1,$2,$3,'this is wrong')`, [did, pid, T2]); return { pid, did }; };
    const a = await mk(); const ra = await svc.decideDispute(me, a.did, { decision: 'upheld', note: 'post is accurate' });
    expect(ra.post?.status).toBe('published_evidence_reviewed');
    expect((await q(`select status, decided_by_user_id from community_disputes where id = $1`, [a.did]))[0]).toEqual({ status: 'upheld', decided_by_user_id: MOD });
    const b = await mk(); expect((await svc.decideDispute(me, b.did, { decision: 'corrected', note: 'wording corrected' })).post?.status).toBe('corrected');
    const c = await mk(); expect((await svc.decideDispute(me, c.did, { decision: 'overturned', note: 'post was wrong' })).post?.status).toBe('removed');
    expect(await err(svc.decideDispute(me, c.did, { decision: 'overturned', note: 'post was wrong' }))).toBe('409:already_decided');
  });
});

describe('appeals', () => {
  it('reviewer separation with the REAL moderator id, decided_by + decided_at set, overturn restores the removed post', async () => {
    const pid = await seedPost({ status: 'published_unverified', visibility: 'community_published' });
    await svc.postAction(me, pid, { action: 'remove', reason: 'violates the rules', expectedVersion: 1 });
    const aid = id(seq++);
    await q(`insert into community_appeals (id, post_id, appellant_tenant_id, appellant_user_id, subject, reason, original_decider_user_id) values ($1,$2,$3,$4,'post_removed','it was accurate',$5)`, [aid, pid, T1, OWNER1, MOD]);
    const list = await svc.listAppeals(me, {});
    expect(list.items.find((x) => x.id === aid)).toMatchObject({ originalDeciderIsMe: true, appellantTenantName: 'Bella Nails' });
    expect(await err(svc.decideAppeal(me, aid, { decision: 'overturn', note: 'I made the call' }))).toBe('403:appeal_same_decider');
    const r = await svc.decideAppeal(other, aid, { decision: 'overturn', note: 'removal was too strict' });
    expect(r.post).toMatchObject({ status: 'published_unverified', visibility: 'community_published' });
    const [a] = await q(`select status, decided_by_user_id, decided_at is not null as decided, moderation_case_id from community_appeals where id = $1`, [aid]);
    expect(a).toEqual({ status: 'overturned', decided_by_user_id: MOD2, decided: true, moderation_case_id: r.caseId });
    expect(await err(svc.decideAppeal(other, aid, { decision: 'uphold', note: 'second decision' }))).toBe('409:already_decided');
    expect(fan.some((f) => f.kind === 'published' && f.postId === pid)).toBe(true);
  });
  it('the same decider may decide only with the explicit, recorded override', async () => {
    const aid = id(seq++);
    await q(`insert into community_appeals (id, appellant_tenant_id, appellant_user_id, subject, reason, original_decider_user_id) values ($1,$2,$3,'community_suspended','please lift',$4)`, [aid, T1, OWNER1, MOD]);
    const r = await svc.decideAppeal(me, aid, { decision: 'uphold', note: 'single moderator on duty', allowSameDecider: true });
    const [act] = await q(`select detail from community_moderation_actions where case_id = $1 and action = 'appeal_upheld'`, [r.caseId]);
    expect(act.detail.sameDeciderOverride).toBe(true);
  });
});

describe('salons, restrictions, evidence, incidents, settings', () => {
  it('restrict posting reaches the COMMUNITY_RESTRICTIONS port; a duplicate is refused; lift clears it', async () => {
    const port = new CommunityRestrictions(repo);
    expect(await port.active(T2, OWNER2)).toEqual({ suspended: false, postingRestricted: false, commentingRestricted: false });
    const r = await svc.tenantAction(me, T2, { action: 'restrict_posting', reason: 'repeated false reports' });
    expect(r.restriction).toMatchObject({ kind: 'posting_restricted', tenantName: 'Other Salon', liftedAt: null });
    expect(await port.active(T2, OWNER2)).toMatchObject({ postingRestricted: true });
    expect(await port.active(T1, OWNER1)).toMatchObject({ postingRestricted: false });
    expect(await err(svc.tenantAction(me, T2, { action: 'restrict_posting', reason: 'repeated false reports' }))).toBe('409:already_restricted');
    expect((await q(`select event_type, tenant_id from outbox_events where event_type = 'community.tenant_restricted' and aggregate_id = $1`, [r.restriction!.id]))).toEqual([{ event_type: 'community.tenant_restricted', tenant_id: T2 }]);
    const conduct = await svc.tenant(T2);
    expect(conduct.restrictions.map((x) => x.id)).toContain(r.restriction!.id);
    await svc.tenantAction(me, T2, { action: 'lift', reason: 'salon explained it', restrictionId: r.restriction!.id, caseId: r.caseId });
    expect(await port.active(T2, OWNER2)).toMatchObject({ postingRestricted: false });
    expect(notes.map((n) => n.tenantId)).toEqual([T2, T2]);
    const user = await svc.tenantAction(me, T2, { action: 'restrict_commenting', reason: 'one user abusive', userId: OWNER2, expiresAt: '2099-01-01T00:00:00Z' });
    expect(await port.active(T2, OWNER2)).toMatchObject({ commentingRestricted: true });
    expect(await port.active(T2, id(77))).toMatchObject({ commentingRestricted: false });
    expect(user.restriction?.userId).toBe(OWNER2);
    expect(user.caseId).toBe(r.caseId);                     // the open tenant_conduct case is reused, not duplicated
    expect(await err(svc.tenantAction(me, T2, { action: 'suspend', reason: 'wrong salon user', userId: OWNER1 }))).toBe('400:invalid_input');
  });

  it('evidence goes through the interactions port under a case; incident access needs an incident_access case and is audited', async () => {
    const pid = await seedPost();
    const eid = id(seq++);
    await q(`insert into community_evidence (id, post_id, tenant_id, storage_key, uploaded_by_user_id, upload_status) values ($1,$2,$3,'k/1',$4,'uploaded')`, [eid, pid, T1, OWNER1]);
    expect((await svc.listEvidence({})).items.map((e) => e.id)).toContain(eid);
    expect(await err(svc.evidenceAccess(me, eid, { reason: 'checking the screenshot' }))).toBe('400:invalid_input');
    const review = await svc.evidenceReview(me, eid, { decision: 'clean', reason: 'screenshot is fine' });
    const acc = await svc.evidenceAccess(me, eid, { caseId: review.caseId, reason: 'checking the screenshot' });
    expect(acc.url).toBe('https://signed.example/x');
    expect(evidenceCalls.map((c) => c[1].moderatorUserId)).toEqual([MOD, MOD]);
    const iid = id(seq++);
    await q(`insert into tenant_private_incidents (id, tenant_id, category, severity, raw_detail, created_by_user_id) values ($1,$2,'phone_scam','high','raw private detail',$3)`, [iid, T1, OWNER1]);
    expect(await err(svc.incidentAccess(me, iid, { caseId: review.caseId, reason: 'need the full story' }))).toBe('409:case_kind_mismatch');
    const kase = await svc.openCase(me, { kind: 'incident_access', reason: 'verify the advisory source', incidentId: iid });
    const inc = await svc.incidentAccess(me, iid, { caseId: kase.id, reason: 'need the full story' });
    expect(inc).toMatchObject({ ok: true, tenantName: 'Bella Nails', incident: { id: iid, rawDetail: 'raw private detail' } });
    expect((await q(`select tenant_id, user_id from audit_logs where action_type = 'community.moderation.incident_accessed' and entity_id = $1`, [iid]))).toEqual([{ tenant_id: T1, user_id: MOD }]);
  });

  it('platform settings are versioned (CAS) and audited', async () => {
    const s0 = await svc.settings();
    expect(s0).toMatchObject({ riskMatchingEnabled: false, autoHideReportThreshold: 5, rulesVersion: expect.any(String) });
    const s1 = await svc.updateSettings(me, { expectedVersion: s0.version, autoHideReportThreshold: 7, reason: 'more salons now' });
    expect(s1.autoHideReportThreshold).toBe(7);
    expect(await err(svc.updateSettings(me, { expectedVersion: s0.version, riskMatchingEnabled: true, reason: 'stale write here' }))).toBe('409:version_conflict');
    expect((await q(`select new_value, actor from platform_setting_changes where setting_key = 'community.auto_hide_report_threshold'`))).toEqual([{ new_value: 7, actor: MOD }]);
  });

  it('overview, analytics and the audit trail read the real rows', async () => {
    const o = await svc.overview(me);
    expect(o.queues.sensitive).toBeGreaterThanOrEqual(0);
    expect(o.published7d).toBeGreaterThan(0);
    expect(o.restrictionsActive).toBeGreaterThan(0);
    const a = await svc.analytics({});
    expect(a.published).toBeGreaterThan(0);
    expect(a.bySeverity.high).toBeGreaterThanOrEqual(0);
    const trail = await svc.listActions({ pageSize: 50 });
    expect(trail.items.length).toBeGreaterThan(5);
    expect(trail.items.every((x) => x.actorName === 'Mia Moderator' || x.actorName === 'Max Moderator')).toBe(true);
    expect((await svc.listTenants({ q: 'Bella' })).items.map((t) => t.tenantId)).toEqual([T1]);
  });
});
