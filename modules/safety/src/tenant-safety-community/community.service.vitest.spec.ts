// community.service.vitest.spec.ts — BUILD_PLAN Phase 8 (agent A): the core service over the in-memory repository with
// the REAL session roles (OWNER / MANAGER / FRONT_DESK / RECEPTION / TECHNICIAN). Proves: the workflow end to end, the
// settings + rules, the safe response shape (no other salon's ids), author labels, restrictions, visibility, CAS 409s,
// events + fanout per action, reports / disputes, private incidents, and the honest AI 503.
import { describe, it, expect, beforeEach } from 'vitest';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { CommunityService, communityRole, communityRoleOf } from './community.service';
import { permissionsFor, templatePermissions, findRoleTemplate } from '@aipowersalon/permissions';
import { InMemoryCommunityRepo } from './community.repository';
import { InMemoryCommunityEvents } from './community-events';
import { InMemoryCommunityAuditSink } from './community-audit';
import type { CommunityFanoutPort, CommunityRestrictionState } from './community.ports';

const id = (n: number) => `f1f1f1f1-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = id(1), T2 = id(2), B1 = id(3), B2 = id(4);
const ctx = (tenantId: string, role: string, u: number, branchId: string | null = B1) => ({ tenantId, branchId, userId: id(100 + u), role });
const owner = ctx(T1, 'OWNER', 1), manager = ctx(T1, 'MANAGER', 2), desk = ctx(T1, 'FRONT_DESK', 3), reception = ctx(T1, 'RECEPTION', 4), tech = ctx(T1, 'TECHNICIAN', 5);
const other = ctx(T2, 'OWNER', 6, B2), otherDesk = ctx(T2, 'FRONT_DESK', 7, B2);
const gift = { category: 'gift_card_scam', severity: 'moderate', title: 'Gift card pattern', body: 'a caller asked for gift cards to hold a booking' };

let repo: InMemoryCommunityRepo; let svc: CommunityService; let events: InMemoryCommunityEvents; let audit: InMemoryCommunityAuditSink;
let fan: { published: string[]; changed: [string, string][] }; let restr: CommunityRestrictionState;

beforeEach(async () => {
  repo = new InMemoryCommunityRepo();
  for (const t of [T1, T2]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
  repo.setTenantName(T1, 'Bella Nails'); repo.setTenantName(T2, 'Rose Spa');
  events = new InMemoryCommunityEvents(); audit = new InMemoryCommunityAuditSink();
  fan = { published: [], changed: [] };
  const fanout: CommunityFanoutPort = { async advisoryPublished(p) { fan.published.push(p.id); }, async advisoryChanged(p, c) { fan.changed.push([p.id, c]); } };
  restr = { suspended: false, postingRestricted: false, commentingRestricted: false };
  svc = new CommunityService(repo, { events, audit, fanout, restrictions: { active: async () => ({ ...restr }) } });
  for (const c of [owner, manager, desk, reception, other, otherDesk]) await svc.acknowledgeRules(c, { rulesVersion: COMMUNITY_RULES_VERSION });
});

const types = () => events.events.map((e) => e.type.replace('community.', ''));
async function publishOrdinary(by = owner) {
  const d = await svc.createAdvisory(by, gift);
  const s = await svc.submitAdvisory(by, d.id, { expectedVersion: d.version });
  return svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
}

describe('roles (bug 1)', () => {
  it('maps the real uppercase session roles', () => {
    expect(['OWNER', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'SUPER_ADMIN', 'CUSTOMER', ''].map(communityRole))
      .toEqual(['owner', 'tenant_admin', 'branch_manager', 'receptionist', 'receptionist', 'technician', 'moderator', 'technician', 'technician']);
  });
  it('a technician is refused unless the salon granted view_community', async () => {
    await expect(svc.feed(tech, {})).rejects.toMatchObject({ code: 'permission_denied', status: 403 });
    repo.setSettings({ tenantId: T1, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: { technician: ['view_community'] }, roleRemovals: {} });
    await expect(svc.feed(tech, {})).resolves.toMatchObject({ items: [] });
    await expect(svc.createAdvisory(tech, gift)).rejects.toMatchObject({ code: 'permission_denied' });
  });
});

describe('the posting workflow', () => {
  it('receptionist drafts (PII redacted) → submit → manager_approval → manager approves → published, events + fanout', async () => {
    const d = await svc.createAdvisory(reception, { ...gift, body: 'customer Jane Smith called from 201-555-0148 asking for gift cards' });
    expect(d.body).not.toMatch(/Jane|0148/);
    expect(d.privacyScanFlags.sort()).toEqual(['name', 'phone']);
    expect(d.createdByMe).toBe(true);
    const s = await svc.submitAdvisory(reception, d.id, { expectedVersion: d.version });
    expect(s.post.status).toBe('manager_approval');
    expect(s.scan).toMatchObject({ blocked: false, flagged: true });
    expect([...s.scan.categories].sort()).toEqual(['name', 'phone']);
    const mine = await svc.getMine(manager, d.id);
    expect(mine.awaitingMyApproval).toBe(true);
    const p = await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    expect(p.status).toBe('published_unverified');
    expect(p.author.label).toBe('Bella Nails');                         // display_name default → tenants.display_name
    expect(types()).toEqual(['advisory_submitted', 'advisory_approved', 'advisory_published']);
    expect(events.events.every((e) => e.tenantId === T1 && e.aggregateId === d.id)).toBe(true);
    expect(fan.published).toEqual([d.id]);
    expect((await svc.getPost(other, d.id)).id).toBe(d.id);
  });

  it('managerApprovalRequired=false: an owner submit publishes directly (bug 11); a receptionist still needs approval', async () => {
    await svc.updateSettings(owner, { expectedVersion: 1, managerApprovalRequired: false });
    const d = await svc.createAdvisory(owner, gift);
    expect((await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version })).post.status).toBe('published_unverified');
    expect(types()).toContain('advisory_published');
    const r = await svc.createAdvisory(desk, gift);
    expect((await svc.submitAdvisory(desk, r.id, { expectedVersion: r.version })).post.status).toBe('manager_approval');
  });

  it('serious category / critical go to moderation_review and stay invisible to other salons', async () => {
    const d = await svc.createAdvisory(reception, { ...gift, category: 'account_takeover_attempt', severity: 'high' });
    const s = await svc.submitAdvisory(reception, d.id, { expectedVersion: d.version });
    expect(s.post.moderationRequired).toBe(true);
    const p = await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    expect(p.status).toBe('moderation_review');
    expect(types()).toEqual(['advisory_submitted', 'advisory_approved']);
    expect(fan.published).toEqual([]);
    await expect(svc.getPost(other, d.id)).rejects.toMatchObject({ status: 404 });
  });

  it('payment data → sensitive_data_detected; edit + re-submit with clean text → manager_approval (bug 5)', async () => {
    const d = await svc.createAdvisory(owner, { ...gift, body: 'they used card 4111 1111 1111 1111 at the desk' });
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    expect(s.post.status).toBe('sensitive_data_detected');
    expect(s.scan.blocked).toBe(true);
    await expect(svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version })).rejects.toMatchObject({ code: 'invalid_state', status: 409 });
    const u = await svc.updateAdvisory(owner, d.id, { expectedVersion: s.post.version, body: 'a stolen card was used at the desk, declined' });
    expect(u.scan.blocked).toBe(false);
    const again = await svc.submitAdvisory(owner, d.id, { expectedVersion: u.post.version });
    expect(again.post.status).toBe('manager_approval');
  });

  it('accusatory wording is refused unless an official reference is cited, and then a moderator decides', async () => {
    const d = await svc.createAdvisory(owner, { ...gift, body: 'this person is a scammer who asked for gift cards' });
    await expect(svc.submitAdvisory(owner, d.id, { expectedVersion: d.version })).rejects.toMatchObject({ code: 'wording_requires_rewrite', status: 400 });
    await expect(svc.submitAdvisory(owner, d.id, { expectedVersion: d.version, officialReportReferenced: true })).rejects.toMatchObject({ code: 'wording_requires_rewrite' });
    const u = await svc.updateAdvisory(owner, d.id, { expectedVersion: d.version, officialReference: 'police report filed' });
    expect(u.wording?.matched).toBe('scammer');
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: u.post.version, officialReportReferenced: true });
    expect(s.post.moderationRequired).toBe(true);
    const p = await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    expect(p.status).toBe('moderation_review');
  });

  it('return with a note → returnReason; withdraw; re-submit', async () => {
    const d = await svc.createAdvisory(desk, gift);
    const s = await svc.submitAdvisory(desk, d.id, { expectedVersion: d.version });
    await expect(svc.returnAdvisory(manager, d.id, { expectedVersion: s.post.version })).rejects.toMatchObject({ code: 'invalid_input', extra: { field: 'note' } });
    const r = await svc.returnAdvisory(manager, d.id, { expectedVersion: s.post.version, note: 'Please add what the caller asked for (no names)' });
    expect(r.status).toBe('returned_for_correction');
    expect(r.returnReason).toBe('Please add what the caller asked for (no names)');
    expect(types()).toContain('advisory_returned');
    const w = await svc.withdrawAdvisory(desk, d.id, { expectedVersion: r.version });
    expect(w.status).toBe('incident_draft');
    expect(w.returnReason).toBeNull();
    expect((await svc.submitAdvisory(desk, d.id, { expectedVersion: w.version })).post.status).toBe('manager_approval');
  });

  it('a moderator note (agent B) is the returnReason when newer', async () => {
    const d = await svc.createAdvisory(owner, gift);
    repo.patchPostRaw(d.id, { status: 'evidence_requested' });
    repo.addModerationNote(d.id, 'request_evidence', 'Upload the screenshot of the text message');
    expect((await svc.getMine(owner, d.id)).returnReason).toBe('Upload the screenshot of the text message');
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    expect(s.post.status).toBe('manager_approval');
  });

  it('compare-and-set: a stale expectedVersion is 409 version_conflict and nothing moves', async () => {
    const d = await svc.createAdvisory(owner, gift);
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    await expect(svc.approveAdvisory(manager, d.id, { expectedVersion: d.version })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    expect((await svc.getMine(owner, d.id)).status).toBe('manager_approval');
    await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    await expect(svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version })).rejects.toMatchObject({ status: 409 });
    expect(types().filter((t) => t === 'advisory_published')).toHaveLength(1);
  });

  it('a receptionist cannot approve / return; another salon cannot touch the draft', async () => {
    const d = await svc.createAdvisory(owner, gift);
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    await expect(svc.approveAdvisory(desk, d.id, { expectedVersion: s.post.version })).rejects.toMatchObject({ code: 'permission_denied', status: 403 });
    await expect(svc.approveAdvisory(other, d.id, { expectedVersion: s.post.version })).rejects.toMatchObject({ code: 'post_not_found', status: 404 });
    await expect(svc.getPost(other, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.getMine(other, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.updateAdvisory(other, d.id, { expectedVersion: 1, title: 'hijack attempt' })).rejects.toMatchObject({ status: 404 });
  });

  it('rules must be acknowledged before drafting (403 rules_not_acknowledged); a stale version is 409', async () => {
    const fresh = ctx(T1, 'OWNER', 40);
    await expect(svc.createAdvisory(fresh, gift)).rejects.toMatchObject({ code: 'rules_not_acknowledged', status: 403 });
    await expect(svc.acknowledgeRules(fresh, { rulesVersion: '2020-01-01' })).rejects.toMatchObject({ code: 'rules_version_mismatch', status: 409 });
    expect(await svc.acknowledgeRules(fresh, { rulesVersion: COMMUNITY_RULES_VERSION })).toEqual({ acknowledged: true, rulesVersion: COMMUNITY_RULES_VERSION });
    await expect(svc.createAdvisory(fresh, gift)).resolves.toBeDefined();
    expect((await svc.viewer(fresh)).rulesAcknowledged).toBe(true);
  });

  it('validates the body: 400 invalid_input naming the field', async () => {
    await expect(svc.createAdvisory(owner, { ...gift, category: 'Gift Card Fraud' })).rejects.toMatchObject({ code: 'invalid_input', extra: { field: 'category' } });
    await expect(svc.createAdvisory(owner, { ...gift, title: 'x' })).rejects.toMatchObject({ extra: { field: 'title' } });
    await expect(svc.createAdvisory(owner, { ...gift, channels: ['fax'] })).rejects.toMatchObject({ extra: { field: 'channels' } });
    await expect(svc.createAdvisory(owner, { ...gift, incidentDate: '2026-13-45' })).rejects.toMatchObject({ extra: { field: 'incidentDate' } });
    await expect(svc.submitAdvisory(owner, id(9), {})).rejects.toMatchObject({ extra: { field: 'expectedVersion' } });
    await expect(svc.feed(owner, { pageSize: '51' })).rejects.toMatchObject({ extra: { field: 'pageSize' } });
    await expect(svc.feed(owner, { page: '0' })).rejects.toMatchObject({ extra: { field: 'page' } });
  });

  it('fromIncidentId: an explicit, sanitized promotion of a private incident (once)', async () => {
    const inc = await svc.createIncident(owner, { category: 'phone_scam', severity: 'moderate', rawDetail: 'Raw: Jane Smith 201-555-0148' });
    const d = await svc.createAdvisory(manager, { ...gift, category: 'phone_scam', fromIncidentId: inc.id });
    expect(d.fromIncidentId).toBe(inc.id);
    expect(d.body).toBe(gift.body);                                     // never the raw incident text
    await expect(svc.createAdvisory(owner, { ...gift, fromIncidentId: inc.id })).rejects.toMatchObject({ code: 'incident_already_promoted', status: 409 });
    await expect(svc.createAdvisory(other, { ...gift, fromIncidentId: inc.id })).rejects.toMatchObject({ code: 'incident_not_found', status: 404 });
    await expect(svc.createAdvisory(desk, { ...gift, fromIncidentId: (await svc.createIncident(owner, { category: 'other' })).id })).rejects.toMatchObject({ code: 'not_visible', status: 403 });
  });
});

describe('the safe shape (bug 9) + author labels', () => {
  const FORBIDDEN = ['originTenantId', 'originBranchId', 'createdByUserId', 'approvedByUserId', 'submittedByUserId', 'privacyScanFlags', 'moderationRequired', 'tenantId'];
  it('feed / detail never carry another salon\'s ids, users or scan flags', async () => {
    const p = await publishOrdinary();
    await svc.addUpdate(owner, p.id, { body: 'Update: the caller tried again today' });
    const feed = await svc.feed(other, {});
    const detail = await svc.getPost(other, p.id);
    for (const v of [feed.items[0], detail]) {
      for (const k of FORBIDDEN) expect(v).not.toHaveProperty(k);
      const json = JSON.stringify(v);
      for (const secret of [T1, B1, owner.userId, manager.userId]) expect(json).not.toContain(secret);
    }
    expect(detail.updates).toHaveLength(1);
    expect(detail.author).toEqual({ label: 'Bella Nails', isOwnSalon: false, anonymous: false });
    expect(detail.viewerActions).toMatchObject({ canEdit: false, canReport: true, canDispute: true, canMarkSimilar: true, canComment: true });
    expect((await svc.getPost(owner, p.id)).viewerActions).toMatchObject({ canEdit: true, canAddUpdate: true, canResolve: true, canReport: false });
  });
  it('author labels: tenant name / display name / anonymous (only when allowed), frozen at publish', async () => {
    expect(await svc.authorLabelFor(T1, 'tenant_name', 'NJ')).toBe('Bella Nails');
    expect(await svc.authorLabelFor(T1, 'display_name', 'NJ')).toBe('Bella Nails');
    expect(await svc.authorLabelFor(T1, 'anonymous', 'NJ')).toBe('A salon in NJ');
    expect(await svc.authorLabelFor(T1, 'anonymous', null)).toBe('A salon');
    await svc.updateSettings(owner, { expectedVersion: 1, displayName: 'Downtown salon', allowAnonymous: false });
    expect(await svc.authorLabelFor(T1, 'display_name', null)).toBe('Downtown salon');
    expect(await svc.authorLabelFor(T1, 'anonymous', 'NJ')).toBe('Downtown salon');
    await expect(svc.createAdvisory(owner, { ...gift, authorDisplay: 'anonymous' })).rejects.toMatchObject({ extra: { field: 'authorDisplay' } });
    const p = await publishOrdinary();
    await svc.updateSettings(owner, { expectedVersion: 2, displayName: 'Renamed later' });
    expect((await svc.getPost(other, p.id)).author.label).toBe('Downtown salon');   // frozen at publish
  });
  it('an anonymous post shows "A salon in <region>"', async () => {
    const d = await svc.createAdvisory(owner, { ...gift, region: 'NJ', authorDisplay: 'anonymous' });
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    expect((await svc.getPost(other, d.id)).author).toEqual({ label: 'A salon in NJ', isOwnSalon: false, anonymous: true });
  });
});

describe('settings (PUT /community/settings)', () => {
  it('owner only, CAS on version, 0 = insert, event + audit, notify categories read back', async () => {
    const fresh = id(50);
    const o = ctx(fresh, 'OWNER', 51);
    expect((await svc.getSettings(o)).version).toBe(0);
    await expect(svc.updateSettings(o, { expectedVersion: 1, enabled: true })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    const v1 = await svc.updateSettings(o, { expectedVersion: 0, enabled: true, notify: { categories: ['phone_scam'], criticalSms: true } });
    expect(v1).toMatchObject({ version: 1, enabled: true, notify: { categories: ['phone_scam'], push: true, email: true, criticalSms: true }, rulesVersion: COMMUNITY_RULES_VERSION });
    await expect(svc.updateSettings(o, { expectedVersion: 0, enabled: false })).rejects.toMatchObject({ code: 'version_conflict' });
    const v2 = await svc.updateSettings(o, { expectedVersion: 1, retentionDays: 365, branchVisibility: 'own_branch' });
    expect(v2.version).toBe(2);
    expect(events.events.filter((e) => e.type === 'community.settings_changed').map((e) => e.payload)).toEqual([{ version: 1 }, { version: 2 }]);
    await expect(svc.updateSettings(ctx(fresh, 'MANAGER', 52), { expectedVersion: 2, enabled: false })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(svc.updateSettings(o, { expectedVersion: 2, retentionDays: 5 })).rejects.toMatchObject({ extra: { field: 'retentionDays' } });
    await expect(svc.updateSettings(o, { expectedVersion: 2, riskMatchingEnabled: true })).rejects.toMatchObject({ extra: { field: 'riskMatchingEnabled' } });
    await expect(svc.updateSettings(o, { expectedVersion: 2, roleGrants: { technician: ['moderate'] } })).rejects.toMatchObject({ extra: { field: 'roleGrants' } });
  });
  it('a disabled community refuses the feed and drafts but still serves settings', async () => {
    await svc.updateSettings(owner, { expectedVersion: 1, enabled: false });
    await expect(svc.feed(manager, {})).rejects.toMatchObject({ code: 'community_disabled', status: 403 });
    await expect(svc.createAdvisory(owner, gift)).rejects.toMatchObject({ code: 'community_disabled' });
    expect((await svc.getSettings(owner)).enabled).toBe(false);
  });
});

describe('restrictions (COMMUNITY_RESTRICTIONS, agent B)', () => {
  it('suspended: read only; posting_restricted: no drafts / submits / approvals', async () => {
    const p = await publishOrdinary();
    restr = { suspended: true, postingRestricted: false, commentingRestricted: false };
    await expect(svc.feed(manager, {})).resolves.toBeDefined();
    await expect(svc.createAdvisory(owner, gift)).rejects.toMatchObject({ code: 'community_suspended', status: 403 });
    await expect(svc.requireCapability(owner, 'comment')).rejects.toMatchObject({ code: 'community_suspended' });
    await expect(svc.reportPost(owner, id(77), { reason: 'spam' })).rejects.toMatchObject({ code: 'community_suspended' });
    expect((await svc.getPost(owner, p.id)).viewerActions.canEdit).toBe(false);
    restr = { suspended: false, postingRestricted: true, commentingRestricted: false };
    await expect(svc.createAdvisory(owner, gift)).rejects.toMatchObject({ code: 'community_posting_restricted', status: 403 });
    await expect(svc.requireCapability(owner, 'comment')).resolves.toBeDefined();
    restr = { suspended: false, postingRestricted: false, commentingRestricted: true };
    expect((await svc.getPost(owner, p.id)).viewerActions.canComment).toBe(false);
  });
});

describe('live posts: edit, updates, resolve', () => {
  it('edit with card data hides the post for moderation; a clean edit stays live with a version row + event', async () => {
    const p = await publishOrdinary();
    const e1 = await svc.editPublished(owner, p.id, { expectedVersion: p.version, recommendation: 'Never sell gift cards over the phone', changeNote: 'added advice' });
    expect(e1.post.status).toBe('published_unverified');
    expect(fan.changed).toEqual([[p.id, 'edited']]);
    expect(repo.versions.some((v) => v.postId === p.id && v.changeNote === 'added advice')).toBe(true);
    const e2 = await svc.editPublished(owner, p.id, { expectedVersion: e1.post.version, body: 'they paid with 4111 1111 1111 1111 and left' });
    expect(e2.post.status).toBe('sensitive_data_detected');
    await expect(svc.getPost(other, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.editPublished(desk, p.id, { expectedVersion: e2.post.version, title: 'New title' })).rejects.toMatchObject({ code: 'permission_denied' });
  });
  it('an edit that makes the post critical sends it to moderation', async () => {
    const p = await publishOrdinary();
    const e = await svc.editPublished(owner, p.id, { expectedVersion: p.version, severity: 'critical' });
    expect(e.post.status).toBe('moderation_review');
  });
  it('updates (payment data refused) and resolve', async () => {
    const p = await publishOrdinary();
    await expect(svc.addUpdate(owner, p.id, { body: 'card 4111 1111 1111 1111' })).rejects.toMatchObject({ code: 'update_contains_payment_data' });
    const u = await svc.addUpdate(owner, p.id, { body: 'The caller now says Mr. Lee sent them' });
    expect(u.updates![0].body).toBe('The caller now says [REDACTED_NAME] sent them');
    await expect(svc.addUpdate(other, p.id, { body: 'not my post' })).rejects.toMatchObject({ status: 404 });
    const r = await svc.resolvePost(owner, p.id, { expectedVersion: u.version, note: 'No more calls this week' });
    expect(r).toMatchObject({ status: 'resolved', resolutionNote: 'No more calls this week' });
    expect(types().filter((t) => t === 'advisory_updated')).toHaveLength(2);
    expect((await svc.feed(other, {})).total).toBe(0);
    expect((await svc.feed(other, { status: 'resolved' })).total).toBe(1);
  });
});

describe('reports + disputes', () => {
  it('one open report per salon, never your own post, threshold audited — nothing removed', async () => {
    const p = await publishOrdinary();
    repo.setPlatformSetting('community.auto_hide_report_threshold', 1);
    await expect(svc.reportPost(owner, p.id, { reason: 'spam' })).rejects.toMatchObject({ code: 'cannot_report_own_post' });
    await expect(svc.reportPost(other, p.id, { reason: 'nonsense' })).rejects.toMatchObject({ extra: { field: 'reason' } });
    expect(await svc.reportPost(other, p.id, { reason: 'inaccurate', detail: 'call me at 201-555-0148' })).toEqual({ ok: true });
    expect(repo.reports[0].detail).toBe('call me at [REDACTED_PHONE]');
    await expect(svc.reportPost(otherDesk, p.id, { reason: 'spam' })).rejects.toMatchObject({ code: 'already_reported', status: 409 });
    expect(audit.entries.some((e) => e.action === 'post.report_threshold_reached')).toBe(true);
    expect((await svc.getPost(other, p.id)).status).toBe('published_unverified');
  });
  it('a dispute labels the post disputed (still visible), once per salon', async () => {
    const p = await publishOrdinary();
    expect(await svc.disputePost(other, p.id, { reason: 'this did not happen at our salon' })).toEqual({ ok: true, status: 'disputed' });
    expect((await svc.getPost(otherDesk, p.id)).status).toBe('disputed');
    await expect(svc.disputePost(otherDesk, p.id, { reason: 'still disputing this one' })).rejects.toMatchObject({ code: 'already_disputed' });
    await expect(svc.disputePost(owner, p.id, { reason: 'my own post here' })).rejects.toMatchObject({ code: 'cannot_dispute_own_post' });
    const ev = events.events.find((e) => e.payload.change === 'disputed')!;
    expect(ev.tenantId).toBe(T1);                                       // the posting salon hears about it
    expect(fan.changed).toContainEqual([p.id, 'disputed']);
  });
});

describe('private incidents', () => {
  it('reception may log but not read; a manager reads own branch + salon-wide; other salons never', async () => {
    const a = await svc.createIncident(reception, { category: 'theft_or_shoplifting', severity: 'high', occurredOn: '2026-10-07', rawDetail: 'raw' });
    expect(a).toMatchObject({ branchId: B1, occurredOn: '2026-10-07', rawDetail: 'raw' });
    await svc.createIncident(ctx(T1, 'OWNER', 1, B2), { category: 'other' });
    await svc.createIncident(ctx(T1, 'OWNER', 1, null), { category: 'other' });
    await expect(svc.listIncidents(reception, {})).rejects.toMatchObject({ code: 'incident_read_not_allowed', status: 403 });
    expect((await svc.listIncidents(owner, {})).total).toBe(3);
    expect((await svc.listIncidents(manager, {})).total).toBe(2);
    await expect(svc.getIncident(other, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.getIncident(reception, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.createIncident(tech, { category: 'other' })).rejects.toMatchObject({ status: 403 });
  });
});

describe('own lists + branch visibility', () => {
  it('mine?kind filters; own_branch hides another branch\'s drafts from a manager', async () => {
    await svc.createAdvisory(owner, gift);
    await publishOrdinary();
    const otherBranch = await svc.createAdvisory(ctx(T1, 'OWNER', 1, B2), gift);
    expect((await svc.listMine(owner, { kind: 'drafts' })).total).toBe(2);
    expect((await svc.listMine(owner, { kind: 'published' })).total).toBe(1);
    await expect(svc.listMine(owner, { kind: 'bogus' })).rejects.toMatchObject({ extra: { field: 'kind' } });
    await svc.updateSettings(owner, { expectedVersion: 1, branchVisibility: 'own_branch' });
    expect((await svc.listMine(manager, { kind: 'drafts' })).total).toBe(1);
    await expect(svc.getMine(manager, otherBranch.id)).rejects.toMatchObject({ status: 403 });
    expect((await svc.listMine(owner, { kind: 'drafts' })).total).toBe(2);
  });
});

describe('AI assist', () => {
  it('no AI backend → honest 503 ai_not_configured; with one → a suggestion only', async () => {
    await expect(svc.assist(owner, { body: 'the caller wanted gift cards for a booking' })).rejects.toMatchObject({ code: 'ai_not_configured', status: 503 });
    const withAi = new CommunityService(repo, { ai: { complete: async () => ({ text: 'A caller requested gift cards to hold a booking' }) } });
    const r = await withAi.assist(owner, { body: 'the caller wanted gift cards to hold a booking' });
    expect(r.suggestion).toContain('gift cards');
  });
});

describe('risk matching at draft time (integration, lead)', () => {
  it('hands the RAW body to the risk store once per draft; a failing store never blocks the draft', async () => {
    const calls: [string, string][] = [];
    svc.bind({ risk: { async recordFromText(postId: string, raw: string) { calls.push([postId, raw]); return { recorded: 0 }; } } });
    const d = await svc.createAdvisory(owner, { ...gift, body: 'caller from 555-201-3344 asked for gift cards' });
    expect(calls).toEqual([[d.id, 'caller from 555-201-3344 asked for gift cards\n']]);
    expect(d.body).not.toContain('555-201-3344');
    svc.bind({ risk: { async recordFromText() { throw new Error('store down'); } } });
    await expect(svc.createAdvisory(owner, gift)).resolves.toMatchObject({ status: 'incident_draft' });
  });
});

describe('the comment box before the rules are accepted (integration, lead — found by the browser proof)', () => {
  it('canComment does not wait for the rules: the box shows, and posting asks for them', async () => {
    const p = await publishOrdinary();
    const fresh = ctx(T2, 'MANAGER', 9, B2);   // never acknowledged the rules
    const view = await svc.postView(fresh, (await repo.getPost(p.id))!, { detail: true });
    expect(view.viewerActions.canComment).toBe(true);
  });
});

// BUILD_PLAN Phase 9 (Constitution 2 §148): a session's community role follows its PERMISSIONS, not its role name.
describe('Phase 9 — the community role is derived from the session permissions', () => {
  const as = (role: string, permissions: string[]) => communityRoleOf({ role, permissions });
  it('the default roles map exactly as before', () => {
    expect(['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'].map((r) => as(r, permissionsFor(r as any)))).toEqual(['owner', 'branch_manager', 'receptionist', 'receptionist', 'technician']);
    expect(as('SUPER_ADMIN', ['super_admin.users.view'])).toBe('moderator');
  });
  it('a template without the community keys, or a DENY on approve, narrows it', () => {
    expect(as('MANAGER', templatePermissions(findRoleTemplate('ACCOUNTANT')!))).toBe('technician');
    expect(as('MANAGER', permissionsFor('MANAGER' as any).filter((k) => k !== 'community.advisory.approve'))).toBe('receptionist');
  });
  it('a context with no permissions (internal / fixture) keeps the legacy name mapping', () => {
    expect(communityRoleOf({ role: 'OWNER' })).toBe('owner');
  });
});
