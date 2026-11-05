// community.service.pgtest.vitest.spec.ts — BUILD_PLAN Phase 8 (agent A): the core over the REAL KyselyCommunityRepo on
// the fully migrated schema (PGlite, every migration incl. 529) with TWO salons. Pins: a draft is invisible to the other
// salon, a published advisory is visible, no response to salon B ever carries salon A's ids or users; full-text +
// trigram search; CAS writes; the outbox event commits with the change (and rolls back with it); settings insert / CAS;
// rules acknowledgment; one open report per salon (partial unique index); returnReason from both sources; related posts,
// viewer flags and evidence counts read from the interaction tables; incidents' dates as text.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { KyselyCommunityRepo } from './community.repository';
import { CommunityService } from './community.service';
import { OutboxCommunityEvents } from './community-events';
import { KyselyCommunityAuditSink } from './community-audit';

const id = (n: number) => `a8a8a8a8-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = id(1), TB = id(2), BA = id(3), BB = id(4);
const OWNER_A = id(11), MGR_A = id(12), DESK_A = id(13), OWNER_B = id(21), DESK_B = id(22), MOD = id(31);
const c = (tenantId: string, userId: string, role: string, branchId: string | null) => ({ tenantId, userId, role, branchId });
const ownerA = c(TA, OWNER_A, 'OWNER', BA), mgrA = c(TA, MGR_A, 'MANAGER', BA), deskA = c(TA, DESK_A, 'RECEPTION', BA);
const ownerB = c(TB, OWNER_B, 'OWNER', BB), deskB = c(TB, DESK_B, 'FRONT_DESK', BB);
const gift = { category: 'gift_card_scam', severity: 'moderate', title: 'Gift card callers', body: 'a caller asked the front desk for gift cards to hold a booking' };

let pg: any; let db: any; let svc: CommunityService;
const q = async (s: string) => (await pg.query(s)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, lifecycle_state) VALUES
      ('${TA}','Bella Nails LLC','Bella Nails','p8a-bella','P8APGA','active','ACTIVE'), ('${TB}','Rose Spa LLC','Rose Spa','p8a-rose','P8APGB','active','ACTIVE')
      ON CONFLICT DO NOTHING;
    INSERT INTO tenant_community_settings (tenant_id, enabled) VALUES ('${TA}', true), ('${TB}', true);
    INSERT INTO community_rules_acknowledgments (tenant_id, user_id, rules_version) VALUES
      ('${TA}','${OWNER_A}','${COMMUNITY_RULES_VERSION}'), ('${TA}','${MGR_A}','${COMMUNITY_RULES_VERSION}'), ('${TA}','${DESK_A}','${COMMUNITY_RULES_VERSION}'),
      ('${TB}','${OWNER_B}','${COMMUNITY_RULES_VERSION}'), ('${TB}','${DESK_B}','${COMMUNITY_RULES_VERSION}');
  `);
  svc = new CommunityService(new KyselyCommunityRepo(db), { events: new OutboxCommunityEvents(db, new OutboxWriter()), audit: new KyselyCommunityAuditSink(db) });
}, 120_000);

async function publish(body = gift.body, title = gift.title) {
  const d = await svc.createAdvisory(deskA, { ...gift, body, title, region: 'NJ', incidentDate: '2026-10-01', channels: ['phone'], tags: ['gift-cards'] });
  const s = await svc.submitAdvisory(deskA, d.id, { expectedVersion: d.version });
  return svc.approveAdvisory(mgrA, d.id, { expectedVersion: s.post.version });
}
/** salon A posts a lot in this file: age its earlier posts so the real per-salon post rate limit (5 / hour) does not bite */
const cool = () => pg.exec(`update community_posts set created_at = now() - interval '3 days' where origin_tenant_id = '${TA}'`);
const noIdsOfA = (v: unknown) => { const j = JSON.stringify(v); for (const x of [TA, BA, OWNER_A, MGR_A, DESK_A]) expect(j).not.toContain(x); };

describe('two salons on the real schema', () => {
  beforeEach(async () => { await cool(); });
  it('a draft is invisible to salon B; once published it is visible — with no salon-A ids anywhere', async () => {
    const d = await svc.createAdvisory(deskA, { ...gift, body: 'customer Jane Smith called from 201-555-0148 asking for gift cards' });
    expect(d.body).toContain('[REDACTED_PHONE]');
    await expect(svc.getPost(ownerB, d.id)).rejects.toMatchObject({ status: 404 });
    expect((await svc.feed(ownerB, {})).items.map((p) => p.id)).not.toContain(d.id);
    const s = await svc.submitAdvisory(deskA, d.id, { expectedVersion: d.version });
    expect(s.post.status).toBe('manager_approval');
    await expect(svc.getPost(ownerB, d.id)).rejects.toMatchObject({ status: 404 });
    const p = await svc.approveAdvisory(mgrA, d.id, { expectedVersion: s.post.version });
    expect(p.status).toBe('published_unverified');
    const feed = await svc.feed(deskB, {});
    expect(feed.items.map((x) => x.id)).toContain(d.id);
    const detail = await svc.getPost(deskB, d.id);
    expect(detail.author.label).toBe('Bella Nails');
    noIdsOfA(feed); noIdsOfA(detail);
    const row = (await q(`select author_label, published_at is not null as pub, approved_by_user_id, submitted_by_user_id, version from community_posts where id = '${d.id}'`))[0];
    expect(row).toEqual({ author_label: 'Bella Nails', pub: true, approved_by_user_id: MGR_A, submitted_by_user_id: DESK_A, version: 3 });
    expect((await q(`select count(*)::int as n from community_post_versions where post_id = '${d.id}'`))[0].n).toBe(3);
  });

  it('the outbox events ride the same transaction (origin salon, aggregate community_post)', async () => {
    const p = await publish();
    const ev = await q(`select event_type, tenant_id, aggregate_type, aggregate_version from outbox_events where aggregate_id = '${p.id}' order by event_type`);
    expect(ev).toEqual([
      { event_type: 'community.advisory_approved', tenant_id: TA, aggregate_type: 'community_post', aggregate_version: 3 },
      { event_type: 'community.advisory_published', tenant_id: TA, aggregate_type: 'community_post', aggregate_version: 3 },
      { event_type: 'community.advisory_submitted', tenant_id: TA, aggregate_type: 'community_post', aggregate_version: 2 },
    ]);
  });

  it('a failing write inside the transaction rolls the change AND its event back', async () => {
    const d = await svc.createAdvisory(ownerA, gift);
    const broken = new CommunityService(new KyselyCommunityRepo(db), { events: { emit: async () => { throw new Error('outbox down'); } } });
    await expect(broken.submitAdvisory(ownerA, d.id, { expectedVersion: d.version })).rejects.toThrow('outbox down');
    expect((await q(`select status, version from community_posts where id = '${d.id}'`))[0]).toEqual({ status: 'incident_draft', version: 1 });
  });

  it('full-text + trigram search over published posts; identifier queries refused', async () => {
    const p = await publish('a caller pretending to be the card processor asked us to reset the terminal', 'Fake processor support call');
    expect((await svc.feed(ownerB, { q: 'terminal reset' })).items.map((x) => x.id)).toContain(p.id);
    expect((await svc.feed(ownerB, { q: 'Fake procesor suport' })).items.map((x) => x.id)).toContain(p.id);   // trigram on the title
    expect((await svc.feed(ownerB, { q: 'zebra unicorn' })).items).toEqual([]);
    await expect(svc.feed(ownerB, { q: 'jane@x.com' })).rejects.toMatchObject({ code: 'search_identifier_rejected' });
    const counted = await q(`select count(*)::int as n from audit_logs where tenant_id = '${TB}' and action_type = 'community.search.performed'`);
    expect(counted[0].n).toBe(3);
    expect((await new KyselyCommunityRepo(db).abuseCounters(TB))).toMatchObject({ searchesLastHour: 3, rejectedSearchesLastDay: 1 });
  });

  it('sort + paging', async () => {
    const page = await svc.feed(ownerB, { sort: 'severity', pageSize: 1, page: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    expect(page.hasMore).toBe(true);
    expect((await svc.feed(ownerB, { sort: 'most_active', pageSize: 50 })).items.length).toBe(page.total);
  });

  it('one open report per salon (partial unique index) + report_count; dispute labels; reasons stored redacted', async () => {
    const p = await publish();
    await svc.reportPost(ownerB, p.id, { reason: 'inaccurate' });
    await expect(svc.reportPost(deskB, p.id, { reason: 'spam' })).rejects.toMatchObject({ code: 'already_reported' });
    expect((await q(`select report_count from community_posts where id = '${p.id}'`))[0].report_count).toBe(1);
    expect(await svc.disputePost(ownerB, p.id, { reason: 'we never saw this, call 201-555-0148' })).toEqual({ ok: true, status: 'disputed' });
    expect((await q(`select reason, raised_by_user_id from community_disputes where post_id = '${p.id}'`))[0]).toEqual({ reason: 'we never saw this, call [REDACTED_PHONE]', raised_by_user_id: OWNER_B });
    const ev = await q(`select tenant_id, actor_id, payload_json from outbox_events where aggregate_id = '${p.id}' and event_type = 'community.advisory_updated'`);
    expect(ev).toHaveLength(1);
    expect(ev[0].tenant_id).toBe(TA);
    expect(ev[0].actor_id).toBeNull();                                  // salon B's user never rides salon A's event
  });

  it('settings: insert at 0, CAS update, event in the same transaction; rules acknowledgment', async () => {
    const fresh = id(90), o = c(fresh, id(91), 'OWNER', null);
    const v1 = await svc.updateSettings(o, { expectedVersion: 0, enabled: true, displayName: 'Uptown', notify: { categories: ['phone_scam'], push: false } });
    expect(v1).toMatchObject({ version: 1, enabled: true, displayName: 'Uptown', notify: { categories: ['phone_scam'], push: false, email: true, criticalSms: false }, rulesAcknowledgedByMe: false });
    await expect(svc.updateSettings(o, { expectedVersion: 0, enabled: false })).rejects.toMatchObject({ code: 'version_conflict' });
    const v2 = await svc.updateSettings(o, { expectedVersion: 1, authorDisplay: 'anonymous', regionPreferences: ['NJ', 'PA'] });
    expect(v2).toMatchObject({ version: 2, authorDisplay: 'anonymous', regionPreferences: ['NJ', 'PA'] });
    await expect(svc.updateSettings(o, { expectedVersion: 1, enabled: false })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    expect((await q(`select count(*)::int as n from outbox_events where event_type = 'community.settings_changed' and tenant_id = '${fresh}'`))[0].n).toBe(2);
    await svc.acknowledgeRules(o, { rulesVersion: COMMUNITY_RULES_VERSION });
    await svc.acknowledgeRules(o, { rulesVersion: COMMUNITY_RULES_VERSION });               // idempotent
    expect((await svc.getSettings(o)).rulesAcknowledgedByMe).toBe(true);
  });

  it('returnReason: the approver note, then a newer moderator message (agent B\'s action row)', async () => {
    const d = await svc.createAdvisory(deskA, gift);
    const s = await svc.submitAdvisory(deskA, d.id, { expectedVersion: d.version });
    const r = await svc.returnAdvisory(mgrA, d.id, { expectedVersion: s.post.version, note: 'Add the date it happened' });
    expect(r.returnReason).toBe('Add the date it happened');
    await pg.exec(`
      INSERT INTO community_moderation_cases (id, post_id, opened_by_user_id, reason, kind) VALUES ('${id(70)}', '${d.id}', '${MOD}', 'review', 'post_review');
      INSERT INTO community_moderation_actions (case_id, action, actor_user_id, post_id, reason, detail, created_at)
        VALUES ('${id(70)}', 'request_changes', '${MOD}', '${d.id}', 'needs neutral wording', '{"messageToTenant":"Please remove the accusation"}'::jsonb, now() + interval '1 minute');
    `);
    expect((await svc.getMine(deskA, d.id)).returnReason).toBe('Please remove the accusation');
  });

  it('viewer flags, evidence counts and related posts come from the interaction tables (agent C writes them)', async () => {
    const p1 = await publish(); const p2 = await publish('another caller asked for gift cards to confirm a booking', 'Gift card confirmation scam');
    await pg.exec(`
      INSERT INTO community_post_follows (post_id, tenant_id, user_id) VALUES ('${p1.id}', '${TB}', '${OWNER_B}');
      INSERT INTO community_similar_experiences (post_id, tenant_id, user_id) VALUES ('${p1.id}', '${TB}', '${DESK_B}');
      INSERT INTO community_evidence (post_id, tenant_id, storage_key, uploaded_by_user_id, upload_status, scan_status, redaction_status)
        VALUES ('${p1.id}', '${TA}', 'k1', '${OWNER_A}', 'uploaded', 'clean', 'not_required'), ('${p1.id}', '${TA}', 'k2', '${OWNER_A}', 'pending_upload', 'unscanned', 'pending');
      INSERT INTO community_related_posts (post_id, related_post_id, relation, score) VALUES ('${p1.id}', '${p2.id}', 'possible_duplicate', 0.85);
    `);
    const v = await svc.getPost(ownerB, p1.id);
    expect(v).toMatchObject({ following: true, similarReportedByMe: true, evidence: { count: 1, reviewed: true } });
    expect(v.related).toEqual([{ id: p2.id, title: 'Gift card confirmation scam', relation: 'possible_duplicate', severity: 'moderate', publishedAt: expect.any(String) }]);
    expect((await svc.getPost(ownerB, p2.id)).related!.map((r) => r.id)).toEqual([p1.id]);
    expect((await svc.feed(ownerB, { followingOnly: 'true' })).items.map((x) => x.id)).toEqual([p1.id]);
    expect(v.incidentDate).toBe('2026-10-01');
    expect(v.channels).toEqual(['phone']);
  });

  it('private incidents stay with their salon; dates travel as text', async () => {
    const inc = await svc.createIncident(ownerA, { category: 'theft_or_shoplifting', severity: 'high', occurredOn: '2026-10-05', rawDetail: 'raw detail' });
    expect(inc.occurredOn).toBe('2026-10-05');
    await expect(svc.getIncident(ownerB, inc.id)).rejects.toMatchObject({ status: 404 });
    expect((await svc.listIncidents(ownerB, {})).items.map((i) => i.id)).not.toContain(inc.id);
    expect((await svc.listIncidents(ownerA, {})).items.map((i) => i.id)).toContain(inc.id);
  });

  it('the per-salon post limit is real on this schema (5 an hour)', async () => {
    for (let i = 0; i < 5; i++) await svc.createAdvisory(ownerA, gift);
    await expect(svc.createAdvisory(ownerA, gift)).rejects.toMatchObject({ code: 'rate_limited', status: 429, extra: { reason: 'post_rate_limited' } });
  });

  it('a write that fails throws (no phantom rows — bug 7)', async () => {
    const repo = new KyselyCommunityRepo(db);
    await expect(repo.createPost({ originTenantId: TA, category: 'other', title: 't', redactedBody: 'b', createdByUserId: 'not-a-uuid' })).rejects.toThrow();
    await expect(repo.linkIncidentAdvisory(ownerA, id(999), id(998))).rejects.toThrow('community_write_failed');
    expect(await repo.updatePost(id(999), 1, null, { title: 'x' })).toBeNull();
    // compare-and-set on the VERSION even when the status did not move (two edits of one draft)
    const d = await svc.createAdvisory(ownerA, gift);
    expect(await repo.updatePost(d.id, d.version, 'incident_draft', { title: 'First edit wins' })).not.toBeNull();
    expect(await repo.updatePost(d.id, d.version, 'incident_draft', { title: 'Stale edit loses' })).toBeNull();
    expect((await q(`select title, version from community_posts where id = '${d.id}'`))[0]).toEqual({ title: 'First edit wins', version: 2 });
  });

  it('an empty branch is null in the database (bug 8)', async () => {
    const d = await svc.createAdvisory({ ...ownerA, branchId: '' as any }, gift);
    expect((await q(`select origin_branch_id from community_posts where id = '${d.id}'`))[0].origin_branch_id).toBeNull();
    await sql`select 1`.execute(db);
  });
});
