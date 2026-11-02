// community-search.vitest.spec.ts — proves the spec's hardest search rule: the community cannot be used as a
// customer-lookup tool. Identifier searches are REFUSED (not quietly sanitized and run), pattern searches work,
// results stay visibility-gated, and only redacted published text is ever searched.
import { describe, it, expect, beforeEach } from 'vitest';
import { screenQuery, buildSafeQuery, SearchRejected } from './community-search';
import { CommunityService } from './community.service';
import { InMemoryCommunityRepo } from './community.repository';
import { InMemoryCommunityAuditSink } from './community-audit';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';

describe('query screening (pure)', () => {
  it('REFUSES a phone-number lookup', () => {
    const s = screenQuery('201-555-0148');
    expect(s.allowed).toBe(false);
    expect(s.rejection).toBe('phone_number');
  });
  it('REFUSES an email lookup', () => {
    expect(screenQuery('jane.doe@example.com').rejection).toBe('email_address');
  });
  it('REFUSES card / bank / long-digit lookups', () => {
    expect(screenQuery('4111 1111 1111 1111').rejection).toBe('card_or_bank_number');
    expect(screenQuery('account 123456789').rejection).toBe('card_or_bank_number');
  });
  it('REFUSES government-id lookups', () => {
    expect(screenQuery('123-45-6789').rejection).toBe('government_id');
    expect(screenQuery('driver license number').rejection).toBe('government_id');
  });
  it('REFUSES an explicit person lookup by name', () => {
    expect(screenQuery('find John Smith').rejection).toBe('personal_name_lookup');
    expect(screenQuery('who is Jane Doe').rejection).toBe('personal_name_lookup');
  });
  it('ALLOWS pattern / method / behavior searches — the point of the community', () => {
    for (const q of ['gift card scam', 'chargeback pattern', 'fake support call', 'no-show booking attack', 'refund abuse']) {
      expect(screenQuery(q).allowed).toBe(true);
    }
  });
  it('does not sanitize-and-run — it throws, so no results can leak', () => {
    expect(() => buildSafeQuery({ q: 'call 201-555-0148' })).toThrow(SearchRejected);
  });
  it('bounds the term length (no giant scraping queries)', () => {
    const safe = buildSafeQuery({ q: 'a'.repeat(500) });
    expect(safe.term!.length).toBe(120);
  });
});

describe('search service (GET /community/feed?q / /community/search)', () => {
  let repo: InMemoryCommunityRepo; let audit: InMemoryCommunityAuditSink; let svc: CommunityService;
  const T1 = 'c1c1c1c1-0000-4000-8000-000000000001', T2 = 'c1c1c1c1-0000-4000-8000-000000000002';
  const owner = { tenantId: T1, branchId: null, userId: 'c1c1c1c1-0000-4000-8000-0000000000a1', role: 'OWNER' };
  const manager = { tenantId: T1, branchId: null, userId: 'c1c1c1c1-0000-4000-8000-0000000000a2', role: 'MANAGER' };
  const other = { tenantId: T2, branchId: null, userId: 'c1c1c1c1-0000-4000-8000-0000000000a3', role: 'OWNER' };
  let publishedId = '';

  beforeEach(async () => {
    repo = new InMemoryCommunityRepo();
    for (const t of [T1, T2]) repo.setSettings({ tenantId: t, enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
    audit = new InMemoryCommunityAuditSink();
    svc = new CommunityService(repo, { audit });
    for (const c of [owner, manager, other]) await svc.acknowledgeRules(c, { rulesVersion: COMMUNITY_RULES_VERSION });
    // one published advisory + one unpublished draft
    const d = await svc.createAdvisory(owner, { category: 'gift_card_scam', severity: 'moderate', title: 'Caller demands gift cards', body: 'caller claimed to be support and demanded gift cards to release a booking' });
    const s = await svc.submitAdvisory(owner, d.id, { expectedVersion: d.version });
    await svc.approveAdvisory(manager, d.id, { expectedVersion: s.post.version });
    publishedId = d.id;
    await svc.createAdvisory(owner, { category: 'phone_scam', severity: 'low', title: 'Secret draft', body: 'unpublished draft about a phone scam' });
  });

  it('finds advisories by scam method, and records the search for the hourly limit', async () => {
    const r = await svc.feed(other, { q: 'gift cards' });
    expect(r.items.map((p) => p.id)).toEqual([publishedId]);
    expect(r.items[0].title).toContain('gift cards');
    expect(audit.entries.some((e) => e.action === 'search.performed')).toBe(true);
  });

  it('an identifier search is REFUSED (400, field q) and audited — no results returned', async () => {
    await expect(svc.feed(other, { q: '201-555-0148' })).rejects.toMatchObject({ code: 'search_identifier_rejected', status: 400, extra: { field: 'q', rejection: 'phone_number' } });
    expect(audit.entries.some((e) => e.action === 'search.rejected' && e.meta.rejection === 'phone_number')).toBe(true);
    expect(audit.entries.some((e) => e.action === 'search.performed')).toBe(false);
  });

  it('a phone number is unfindable two ways over: the query is refused, AND no published body contains one', async () => {
    await expect(svc.feed(other, { q: '201-555-0148' })).rejects.toBeTruthy();
    const withPii = await svc.createAdvisory(owner, { category: 'phone_scam', severity: 'moderate', title: 'Caller pattern', body: 'the caller used 201-555-0148 repeatedly' });
    expect(withPii.body).toContain('[REDACTED_PHONE]');
    expect(withPii.privacyScanFlags).toContain('phone');
    const s = await svc.submitAdvisory(owner, withPii.id, { expectedVersion: withPii.version });
    await svc.approveAdvisory(manager, withPii.id, { expectedVersion: s.post.version });
    const all = await svc.feed(other, { q: 'caller' });
    expect(all.items.length).toBe(2);
    expect(all.items.every((p) => !/\d{3}-\d{3}-\d{4}/.test(p.body))).toBe(true);
  });

  it('unpublished drafts are never searchable by another tenant', async () => {
    expect((await svc.feed(other, { q: 'Secret draft' })).items).toEqual([]);
  });

  it('facets filter without free text', async () => {
    expect((await svc.feed(other, { category: 'gift_card_scam' })).total).toBe(1);
    expect((await svc.feed(other, { category: 'phone_scam' })).total).toBe(0); // that one is a draft
    expect((await svc.feed(other, { severity: 'critical' })).total).toBe(0);
    await expect(svc.feed(other, { category: 'Gift Card Fraud' })).rejects.toMatchObject({ code: 'invalid_input', extra: { field: 'category' } });
  });

  it('a tenant with the community disabled is refused (403 community_disabled)', async () => {
    repo.setSettings({ tenantId: T2, enabled: false, receptionistApprovalRequired: true, managerApprovalRequired: true, roleGrants: {}, roleRemovals: {} });
    await expect(svc.feed(other, { q: 'gift cards' })).rejects.toMatchObject({ code: 'community_disabled', status: 403 });
  });
});
