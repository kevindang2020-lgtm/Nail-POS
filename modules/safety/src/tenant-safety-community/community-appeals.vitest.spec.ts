// community-appeals.vitest.spec.ts — proves the appeal rules, above all the spec's reviewer-separation
// requirement: the moderator who made the original decision cannot review the appeal against it, and the
// "where practical" exception is an EXPLICIT, audited override rather than a silent fallback.
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { describe, it, expect, beforeEach } from 'vitest';
import { canFileAppeal, canReviewAppeal, restoredStatusOnOverturn, upheldChangesContent, type AppealRecord } from './community-appeals';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo } from './community.repository';
import { InMemoryCommunityAuditSink } from './community-audit';

const appeal = (o: Partial<AppealRecord> = {}): AppealRecord => ({
  id: 'a1', appellantTenantId: 'T1', subject: 'post_removed', status: 'submitted', originalDeciderUserId: 'mod-1', ...o,
});

describe('appeal rules (pure)', () => {
  it('only the tenant a decision went against may appeal, and only via authorized roles', () => {
    expect(canFileAppeal({ role: 'owner', tenantId: 'T1', targetTenantId: 'T1' }).ok).toBe(true);
    expect(canFileAppeal({ role: 'branch_manager', tenantId: 'T1', targetTenantId: 'T1' }).ok).toBe(true);
    expect(canFileAppeal({ role: 'owner', tenantId: 'T2', targetTenantId: 'T1' })).toEqual({ ok: false, reason: 'not_your_tenant' });
    expect(canFileAppeal({ role: 'receptionist', tenantId: 'T1', targetTenantId: 'T1' })).toEqual({ ok: false, reason: 'role_cannot_appeal' });
    expect(canFileAppeal({ role: 'technician', tenantId: 'T1', targetTenantId: 'T1' }).ok).toBe(false);
  });

  it('THE KEY RULE: the original decider cannot review the appeal against their own decision', () => {
    expect(canReviewAppeal({ userId: 'mod-1', role: 'moderator' }, appeal()))
      .toEqual({ ok: false, reason: 'original_decider_cannot_review' });
    expect(canReviewAppeal({ userId: 'mod-2', role: 'moderator' }, appeal()).ok).toBe(true);
  });

  it('the "where practical" exception is an explicit override, not a silent default', () => {
    expect(canReviewAppeal({ userId: 'mod-1', role: 'moderator' }, appeal()).ok).toBe(false);           // default: refused
    expect(canReviewAppeal({ userId: 'mod-1', role: 'moderator' }, appeal(), true).ok).toBe(true);      // explicit override
  });

  it('non-moderators cannot review; decided/withdrawn appeals cannot be re-decided', () => {
    expect(canReviewAppeal({ userId: 'u1', role: 'owner' }, appeal())).toEqual({ ok: false, reason: 'moderator_required' });
    expect(canReviewAppeal({ userId: 'mod-2', role: 'moderator' }, appeal({ status: 'upheld' }))).toEqual({ ok: false, reason: 'already_decided' });
    expect(canReviewAppeal({ userId: 'mod-2', role: 'moderator' }, appeal({ status: 'withdrawn' })).ok).toBe(false);
  });

  it('overturning restores conservatively — never auto-verifies, and re-moderates when required', () => {
    expect(restoredStatusOnOverturn('post_removed', { moderationRequired: false })).toBe('published_unverified');
    expect(restoredStatusOnOverturn('post_removed', { moderationRequired: true })).toBe('moderation_review'); // back to review, not public
    expect(restoredStatusOnOverturn('comment_removed', { moderationRequired: false })).toBeNull();
  });

  it('upholding an appeal changes nothing about the content', () => {
    expect(upheldChangesContent()).toBe(false);
  });
});

// Filing is the core's (agent A, POST /community/posts/:id/appeal); deciding moved to the moderation half (agent B).
describe('appeal filing (core service)', () => {
  let repo: InMemoryCommunityRepo; let audit: InMemoryCommunityAuditSink; let svc: CommunityService;
  const T1 = 'd1d1d1d1-0000-4000-8000-000000000001', T2 = 'd1d1d1d1-0000-4000-8000-000000000002';
  const u = (n: number) => `d1d1d1d1-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const owner = { tenantId: T1, branchId: null, userId: u(1), role: 'OWNER' };
  const manager = { tenantId: T1, branchId: null, userId: u(2), role: 'MANAGER' };
  const receptionist = { tenantId: T1, branchId: null, userId: u(3), role: 'RECEPTION' };
  const otherOwner = { tenantId: T2, branchId: null, userId: u(5), role: 'OWNER' };

  beforeEach(async () => {
    repo = new InMemoryCommunityRepo();
    for (const t of [T1, T2]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
    audit = new InMemoryCommunityAuditSink();
    svc = new CommunityService(repo, { audit });
    for (const c of [owner, manager, receptionist, otherOwner]) await svc.acknowledgeRules(c, { rulesVersion: COMMUNITY_RULES_VERSION });
  });

  async function removedPost() {
    const d = await svc.createAdvisory(owner, { category: 'gift_card_scam', severity: 'moderate', title: 'Gift cards', body: 'gift card scam pattern at the desk' });
    const s1 = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    const p = await svc.approveAdvisory(manager, d.id, { expectedVersion: s1.post.version });   // published
    repo.patchPostRaw(d.id, { status: 'removed', visibility: 'removed', version: p.version + 1 });  // a moderator (agent B) removed it
    repo.setLastModerator(d.id, 'mod-1');
    return d.id;
  }

  it('the posting tenant can appeal a removal; another tenant cannot', async () => {
    const id = await removedPost();
    await expect(svc.fileAppeal(otherOwner, id, { subject: 'post_removed', reason: 'we disagree with this' }))
      .rejects.toMatchObject({ code: 'appeal_not_allowed', status: 403 });
    const a = await svc.fileAppeal(owner, id, { subject: 'post_removed', reason: 'the pattern was accurate' });
    expect(a.status).toBe('submitted');
    expect(a).not.toHaveProperty('appellantTenantId');                       // the safe shape
    expect(audit.entries.map((e) => e.action)).toContain('appeal.filed');
    expect(repo.appeals[0].originalDeciderUserId).toBe('mod-1');            // reviewer separation input for agent B
  });

  it('a receptionist cannot file an appeal', async () => {
    const id = await removedPost();
    await expect(svc.fileAppeal(receptionist, id, { subject: 'post_removed', reason: 'please look again' }))
      .rejects.toMatchObject({ code: 'appeal_not_allowed' });
  });

  it('the subject must match the post state, and one open appeal per subject', async () => {
    const id = await removedPost();
    await expect(svc.fileAppeal(owner, id, { subject: 'post_rejected', reason: 'please look again' })).rejects.toMatchObject({ code: 'invalid_state', status: 409 });
    await svc.fileAppeal(owner, id, { subject: 'post_removed', reason: 'please look again' });
    await expect(svc.fileAppeal(owner, id, { subject: 'post_removed', reason: 'please look again' })).rejects.toMatchObject({ code: 'appeal_already_open', status: 409 });
    await expect(svc.fileAppeal(owner, id, { subject: 'nope', reason: 'please look again' })).rejects.toMatchObject({ code: 'invalid_input', extra: { field: 'subject' } });
    await expect(svc.fileAppeal(owner, id, { subject: 'post_removed', reason: 'short' })).rejects.toMatchObject({ code: 'invalid_input', extra: { field: 'reason' } });
  });

  it('GET appeals lists only my salon\'s appeals, approvers only', async () => {
    const id = await removedPost();
    await svc.fileAppeal(owner, id, { subject: 'post_removed', reason: 'please look again' });
    expect((await svc.listAppeals(manager)).length).toBe(1);
    expect(await svc.listAppeals(otherOwner)).toEqual([]);
    await expect(svc.listAppeals(receptionist)).rejects.toMatchObject({ status: 403 });
  });
});
