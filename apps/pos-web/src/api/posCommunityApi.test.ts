// posCommunityApi.test.ts — BUILD_PLAN Phase 8: pins every Safety Community client method to the contract's route
// (method + path + query/body). The backend is written concurrently — this is CONTRACT.md §2 and §4 exactly.
import { describe, it, expect, beforeEach } from 'vitest';
import { posCommunityApi as api, pageOf, sha256Hex } from './posCommunityApi';
import { installFetch, calls } from '../screens/community/communityTestKit';

beforeEach(() => installFetch({ 'GET /community/feed': { body: { items: [], page: 1, pageSize: 20, total: 0, hasMore: false } } }));
const last = () => calls[calls.length - 1];

describe('posCommunityApi routes', () => {
  const cases: [string, () => Promise<unknown>, string, string, any?][] = [
    ['feed', () => api.feed({ category: 'phone_scam', followingOnly: true, page: 2, pageSize: 20, sort: 'severity' }), 'GET', '/community/feed'],
    ['search', () => api.search({ q: 'gift card' }), 'GET', '/community/search'],
    ['post', () => api.post('p 1'), 'GET', '/community/posts/p%201'],
    ['editPost', () => api.editPost('p1', { expectedVersion: 3, title: 'x' }), 'PUT', '/community/posts/p1', { expectedVersion: 3, title: 'x' }],
    ['addUpdate', () => api.addUpdate('p1', 'Still happening'), 'POST', '/community/posts/p1/updates', { body: 'Still happening' }],
    ['resolve', () => api.resolve('p1', 3, 'done'), 'POST', '/community/posts/p1/resolve', { expectedVersion: 3, note: 'done' }],
    ['reportPost', () => api.reportPost('p1', { reason: 'spam' }), 'POST', '/community/posts/p1/report', { reason: 'spam' }],
    ['dispute', () => api.dispute('p1', { reason: 'not accurate at all' }), 'POST', '/community/posts/p1/dispute', { reason: 'not accurate at all' }],
    ['appeal', () => api.appeal('p1', { subject: 'post_removed', reason: 'please look again' }), 'POST', '/community/posts/p1/appeal', { subject: 'post_removed', reason: 'please look again' }],
    ['appeals', () => api.appeals(), 'GET', '/community/appeals'],
    ['mine', () => api.mine('returned', 2), 'GET', '/community/mine'],
    ['myPost', () => api.myPost('p1'), 'GET', '/community/mine/p1'],
    ['createAdvisory', () => api.createAdvisory({ category: 'phone_scam', severity: 'low', title: 'tt', body: 'bb' }), 'POST', '/community/advisories', { category: 'phone_scam', severity: 'low', title: 'tt', body: 'bb' }],
    ['updateAdvisory', () => api.updateAdvisory('p1', { expectedVersion: 1 }), 'PUT', '/community/advisories/p1', { expectedVersion: 1 }],
    ['submit', () => api.submit('p1', 2), 'POST', '/community/advisories/p1/submit', { expectedVersion: 2 }],
    ['approve', () => api.approve('p1', 2), 'POST', '/community/advisories/p1/approve', { expectedVersion: 2 }],
    ['returnAdvisory', () => api.returnAdvisory('p1', 2, 'fix'), 'POST', '/community/advisories/p1/return', { expectedVersion: 2, note: 'fix' }],
    ['withdraw', () => api.withdraw('p1', 2), 'POST', '/community/advisories/p1/withdraw', { expectedVersion: 2 }],
    ['assist', () => api.assist('text'), 'POST', '/community/advisories/assist', { body: 'text' }],
    ['incidents', () => api.incidents(3), 'GET', '/community/incidents'],
    ['incident', () => api.incident('i1'), 'GET', '/community/incidents/i1'],
    ['createIncident', () => api.createIncident({ category: 'theft_or_shoplifting', severity: 'low' }), 'POST', '/community/incidents', { category: 'theft_or_shoplifting', severity: 'low' }],
    ['settings', () => api.settings(), 'GET', '/community/settings'],
    ['saveSettings', () => api.saveSettings({ expectedVersion: 0, enabled: true }), 'PUT', '/community/settings', { expectedVersion: 0, enabled: true }],
    ['acknowledgeRules', () => api.acknowledgeRules('v9'), 'POST', '/community/rules/acknowledge', { rulesVersion: 'v9' }],
    ['comments', () => api.comments('p1'), 'GET', '/community/posts/p1/comments'],
    ['addComment', () => api.addComment('p1', { body: 'hi', parentId: 'c1' }), 'POST', '/community/posts/p1/comments', { body: 'hi', parentId: 'c1' }],
    ['editComment', () => api.editComment('c1', { body: 'x', expectedVersion: 2 }), 'PUT', '/community/comments/c1', { body: 'x', expectedVersion: 2 }],
    ['deleteComment', () => api.deleteComment('c1'), 'DELETE', '/community/comments/c1'],
    ['reportComment', () => api.reportComment('c1', { reason: 'harassment' }), 'POST', '/community/comments/c1/report', { reason: 'harassment' }],
    ['markSimilar', () => api.markSimilar('p1', { note: null }), 'POST', '/community/posts/p1/similar', { note: null }],
    ['followPost', () => api.followPost('p1'), 'POST', '/community/posts/p1/follow'],
    ['unfollowPost', () => api.unfollowPost('p1'), 'DELETE', '/community/posts/p1/follow'],
    ['follows', () => api.follows(), 'GET', '/community/follows'],
    ['addFollow', () => api.addFollow({ category: 'phone_scam' }), 'POST', '/community/follows', { category: 'phone_scam' }],
    ['removeFollow', () => api.removeFollow('f1'), 'DELETE', '/community/follows/f1'],
    ['requestEvidenceUpload', () => api.requestEvidenceUpload({ postId: 'p1', mimeType: 'image/png', sizeBytes: 10, sha256: 'ab' }), 'POST', '/community/evidence/uploads', { postId: 'p1', mimeType: 'image/png', sizeBytes: 10, sha256: 'ab' }],
    ['completeEvidence', () => api.completeEvidence('e1'), 'POST', '/community/evidence/e1/complete'],
    ['postEvidence', () => api.postEvidence('p1'), 'GET', '/community/posts/p1/evidence'],
    ['evidenceAccess', () => api.evidenceAccess('e1', 'checking'), 'GET', '/community/evidence/e1/access'],
    ['activeAlerts', () => api.activeAlerts(), 'GET', '/community/alerts/active'],
    ['analytics', () => api.analytics('2026-09-01', '2026-10-01'), 'GET', '/community/analytics'],
  ];
  for (const [name, fn, method, path, body] of cases) {
    it(`${name} → ${method} ${path}`, async () => {
      await fn();
      expect(last().method).toBe(method);
      expect(last().path).toBe(path);
      if (body !== undefined) expect(last().body).toEqual(body);
    });
  }
  it('queries: only chosen filters, booleans as "true"; mine sends kind/page/pageSize; access sends the reason', async () => {
    await api.feed({ category: 'phone_scam', region: '', followingOnly: false, sort: 'severity', page: 2 });
    expect(Object.fromEntries(last().query)).toEqual({ category: 'phone_scam', sort: 'severity', page: '2' });
    await api.feed({ followingOnly: true });
    expect(last().query.get('followingOnly')).toBe('true');
    await api.mine('returned', 2);
    expect(Object.fromEntries(last().query)).toEqual({ kind: 'returned', page: '2', pageSize: '20' });
    await api.evidenceAccess('e1', 'checking');
    expect(last().query.get('reason')).toBe('checking');
    await api.analytics('2026-09-01', '2026-10-01');
    expect(Object.fromEntries(last().query)).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });
  it('the body never carries a tenant / branch / user id', async () => {
    await api.createAdvisory({ category: 'phone_scam', severity: 'low', title: 'tt', body: 'bb' });
    expect(JSON.stringify(last().body)).not.toMatch(/tenant|branch|userId/i);
  });
  it('pageOf tolerates a bare array and garbage', () => {
    expect(pageOf([1, 2]).total).toBe(2);
    expect(pageOf(null).items).toEqual([]);
  });
  it('sha256Hex is the lowercase hex digest', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('putEvidenceBytes PUTs to the ticket URL with its headers; a storage failure is an evidence_upload_failed error', async () => {
    installFetch({ 'PUT /upload': { status: 403 } });
    await expect(api.putEvidenceBytes({ evidenceId: 'e1', uploadUrl: 'https://s3.example/upload?sig=1', method: 'PUT', headers: { 'content-type': 'image/png' }, expiresAt: '' }, new Blob(['x'])))
      .rejects.toMatchObject({ code: 'evidence_upload_failed' });
    expect(last().method).toBe('PUT');
    expect(last().url).toBe('https://s3.example/upload?sig=1');
  });
});
