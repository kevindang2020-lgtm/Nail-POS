// community-abuse.vitest.spec.ts — proves the abuse-prevention rules: rate limits on posts/comments/reports/
// searches, identity-probe restriction (repeated refused identifier lookups pause search), reputation-driven
// escalated verification (a poor-track-record tenant's claims go to a human, they are NOT auto-banned), and the
// invariant that nothing here auto-deletes content or denies a customer service.
import { describe, it, expect, beforeEach } from 'vitest';
import { checkAbuse, reputationBand, requiresEscalatedVerification, LIMITS, type AbuseCounters } from './community-abuse';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo } from './community.repository';
import { InMemoryCommunityAuditSink } from './community-audit';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';

const zero: AbuseCounters = { postsLastHour: 0, postsLastDay: 0, commentsLastHour: 0, reportsLastDay: 0, searchesLastHour: 0, rejectedSearchesLastDay: 0 };

describe('rate limits (pure)', () => {
  it('allows normal activity', () => {
    expect(checkAbuse('post', zero).allowed).toBe(true);
    expect(checkAbuse('comment', zero).allowed).toBe(true);
  });
  it('blocks mass posting (hourly and daily)', () => {
    const h = checkAbuse('post', { ...zero, postsLastHour: LIMITS.postsPerHour });
    expect(h.allowed).toBe(false);
    expect((h as any).reason).toBe('post_rate_limited');
    expect(checkAbuse('post', { ...zero, postsLastDay: LIMITS.postsPerDay }).allowed).toBe(false);
  });
  it('blocks comment floods and report floods', () => {
    expect(checkAbuse('comment', { ...zero, commentsLastHour: LIMITS.commentsPerHour }).allowed).toBe(false);
    expect(checkAbuse('report', { ...zero, reportsLastDay: LIMITS.reportsPerDay }).allowed).toBe(false);
  });
  it('blocks scripted scraping via the search limit', () => {
    expect(checkAbuse('search', { ...zero, searchesLastHour: LIMITS.searchesPerHour }).allowed).toBe(false);
  });
  it('an active restriction blocks everything with a retry hint', () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const d = checkAbuse('post', zero, { restrictedUntil: until });
    expect(d.allowed).toBe(false);
    expect((d as any).reason).toBe('tenant_restricted');
    expect((d as any).retryAfterMinutes).toBeGreaterThan(0);
  });
  it('an EXPIRED restriction no longer blocks', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(checkAbuse('post', zero, { restrictedUntil: past }).allowed).toBe(true);   // temporary, not permanent
  });
});

describe('identity-probe detection', () => {
  it('repeated refused identifier lookups restrict search entirely', () => {
    const d = checkAbuse('search', { ...zero, rejectedSearchesLastDay: LIMITS.rejectedSearchesPerDay });
    expect(d.allowed).toBe(false);
    expect((d as any).reason).toBe('identity_probe_restricted');
    expect((d as any).message).toContain('not a customer lookup tool');
  });
  it('probe restriction outranks the ordinary search limit', () => {
    const d = checkAbuse('search', { ...zero, rejectedSearchesLastDay: 99, searchesLastHour: 999 });
    expect((d as any).reason).toBe('identity_probe_restricted');   // the safety signal, not the volume one
  });
});

describe('reputation → escalated verification (never an auto-ban)', () => {
  it('a clean tenant is good', () => {
    expect(reputationBand({ postsPublished: 10, postsRemovedByModeration: 0, disputesUpheldAgainst: 0 })).toBe('good');
  });
  it('a few strikes = watch, a poor record = escalate', () => {
    expect(reputationBand({ postsPublished: 10, postsRemovedByModeration: 1, disputesUpheldAgainst: 0 })).toBe('watch');
    expect(reputationBand({ postsPublished: 10, postsRemovedByModeration: 2, disputesUpheldAgainst: 1 })).toBe('escalate');
    expect(reputationBand({ postsPublished: 2, postsRemovedByModeration: 1, disputesUpheldAgainst: 0 })).toBe('escalate'); // 50% ratio
  });
  it('escalation means "a human reviews first" — not a ban', () => {
    const bad = { postsPublished: 4, postsRemovedByModeration: 3, disputesUpheldAgainst: 1 };
    expect(requiresEscalatedVerification(bad)).toBe(true);
    // the tenant can still post; it just cannot self-publish (proven in the service test below)
  });
});

describe('service enforcement', () => {
  let repo: InMemoryCommunityRepo; let audit: InMemoryCommunityAuditSink; let svc: CommunityService;
  const T1 = 'b1b1b1b1-0000-4000-8000-000000000001', T2 = 'b1b1b1b1-0000-4000-8000-000000000002';
  const owner = { tenantId: T1, branchId: null, userId: 'b1b1b1b1-0000-4000-8000-0000000000a1', role: 'OWNER' };
  const manager = { tenantId: T1, branchId: null, userId: 'b1b1b1b1-0000-4000-8000-0000000000a2', role: 'MANAGER' };
  const other = { tenantId: T2, branchId: null, userId: 'b1b1b1b1-0000-4000-8000-0000000000a3', role: 'OWNER' };
  const draft = (title = 'Gift card pattern') => ({ category: 'gift_card_scam', severity: 'moderate', title, body: 'gift card scam pattern seen at the desk' });

  beforeEach(async () => {
    repo = new InMemoryCommunityRepo();
    for (const t of [T1, T2]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
    audit = new InMemoryCommunityAuditSink();
    svc = new CommunityService(repo, { audit });
    for (const c of [owner, manager, other]) await svc.acknowledgeRules(c, { rulesVersion: COMMUNITY_RULES_VERSION });
  });

  it('a rate-limited tenant cannot create another advisory, and it is audited', async () => {
    repo.setCounters({ postsLastHour: LIMITS.postsPerHour });
    await expect(svc.createAdvisory(owner, draft()))
      .rejects.toMatchObject({ code: 'rate_limited', status: 429, extra: { reason: 'post_rate_limited' } });
    expect(audit.entries.some((e) => e.action === 'abuse.blocked')).toBe(true);
  });

  it('an identity prober has search paused', async () => {
    repo.setCounters({ rejectedSearchesLastDay: LIMITS.rejectedSearchesPerDay });
    await expect(svc.feed(owner, { q: 'gift card scam' }))
      .rejects.toMatchObject({ code: 'rate_limited', extra: { reason: 'identity_probe_restricted' } });
  });

  it('the hourly search limit bites (bug 10: it was never counted)', async () => {
    repo.setCounters({ searchesLastHour: LIMITS.searchesPerHour });
    await expect(svc.feed(owner, { q: 'gift card scam' })).rejects.toMatchObject({ code: 'rate_limited', extra: { reason: 'search_rate_limited' } });
    await expect(svc.feed(owner, {})).resolves.toBeDefined();                    // browsing without a search term is not a search
  });

  it('disputes are rate-limited per salon per day (bug 10)', async () => {
    const d = await svc.createAdvisory(owner, draft());
    await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    await svc.approveAdvisory(manager, d.id, { expectedVersion: d.version + 1 });
    repo.setCounters({ disputesLastDay: LIMITS.disputesPerDay });
    await expect(svc.disputePost(other, d.id, { reason: 'this did not happen like that' })).rejects.toMatchObject({ code: 'rate_limited', extra: { reason: 'dispute_rate_limited' } });
  });

  it('a poor-reputation tenant CANNOT self-publish — its advisory is held for moderation', async () => {
    repo.setReputation({ postsPublished: 4, postsRemovedByModeration: 3, disputesUpheldAgainst: 1 }); // escalate
    const d = await svc.createAdvisory(owner, draft());
    const submitted = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    expect(submitted.post.moderationRequired).toBe(true);                       // escalated on reputation grounds
    const approved = await svc.approveAdvisory(manager, d.id, { expectedVersion: submitted.post.version });
    expect(approved.status).toBe('moderation_review');                          // manager approval does NOT publish it
    await expect(svc.getPost(other, d.id)).rejects.toMatchObject({ status: 404 });   // not community-visible
  });

  it('a good-reputation tenant publishes normally', async () => {
    repo.setReputation({ postsPublished: 10, postsRemovedByModeration: 0, disputesUpheldAgainst: 0 });
    const d = await svc.createAdvisory(owner, draft());
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    const approved = await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    expect(approved.status).toBe('published_unverified');
    expect((await svc.getPost(other, d.id)).id).toBe(d.id);
  });
});
