// superAdminCommunityModerationApi.test.ts — BUILD_PLAN Phase 8: every Super Admin Safety Community moderation route
// (contract §3), through the real client: paths, verbs, bodies, and query strings that carry only what was chosen.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { superAdminCommunityModerationApi as api } from './superAdminCommunityModerationApi';

let calls: { url: string; method: string; body?: any }[];
let reply: any;
beforeEach(() => {
  calls = []; reply = {};
  globalThis.fetch = vi.fn(async (u: any, init?: any) => { calls.push({ url: String(u), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply), headers: { get: () => null } } as any; }) as any;
});
// BUILD_PLAN Phase 12: every call is /api/v1/<path> — asserted once per call here, then compared on <path>
const path = (i: number) => { const u = calls[i].url.replace(/^https?:\/\/[^/]+/, ''); expect(u.startsWith('/api/v1/')).toBe(true); return u.slice('/api/v1'.length); };
const call = (i: number) => [calls[i].method, path(i), calls[i].body];
const M = '/super-admin/community-moderation';

describe('superAdminCommunityModerationApi', () => {
  it('reads: overview, queues (empty filters dropped), post detail + comments, cases, reports, disputes, appeals, evidence', async () => {
    await api.overview();
    await api.posts({ queue: 'review', q: '', category: 'phone_scam', page: 2 });
    await api.post('p/1');
    await api.postComments('p1');
    await api.cases({ status: 'open', kind: '', mine: true, page: 1 });
    await api.caseDetail('c1');
    await api.reports('comment', { status: 'open' });
    await api.disputes({ status: 'open', page: 3 });
    await api.appeals({});
    await api.evidence({ status: 'pending' });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(path)).toEqual([
      `${M}/overview`, `${M}/posts?queue=review&category=phone_scam&page=2`, `${M}/posts/p%2F1`, `${M}/posts/p1/comments`,
      `${M}/cases?status=open&mine=true&page=1`, `${M}/cases/c1`, `${M}/reports?kind=comment&status=open`, `${M}/disputes?status=open&page=3`,
      `${M}/appeals`, `${M}/evidence?status=pending`,
    ]);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('reads: salons, restrictions, audit trail, analytics, settings, evidence access with case + reason', async () => {
    await api.tenants({ q: 'glow', page: 1 });
    await api.tenant('t1');
    await api.restrictions(true);
    await api.actions({ postId: 'p1' });
    await api.analytics('2026-09-01', '2026-10-01');
    await api.settings();
    await api.evidenceAccess('e1', 'c1', 'checking the redaction');
    expect([0, 1, 2, 3, 4, 5, 6].map(path)).toEqual([
      `${M}/tenants?q=glow&page=1`, `${M}/tenants/t1`, `${M}/restrictions?active=true`, `${M}/actions?postId=p1`,
      `${M}/analytics?from=2026-09-01&to=2026-10-01`, `${M}/settings`, `${M}/evidence/e1/access?caseId=c1&reason=checking%20the%20redaction`,
    ]);
  });

  it('writes: post / comment actions, cases, report / dispute / appeal decisions, evidence review, incident access, salon actions, settings', async () => {
    await api.postAction('p1', { action: 'publish', reason: 'checked and fine', expectedVersion: 3, label: 'unverified' });
    await api.commentAction('k1', { action: 'remove', reason: 'personal data' });
    await api.openCase({ kind: 'tenant_conduct', reason: 'repeated reports', targetTenantId: 't1' });
    await api.updateCase('c1', { assignToMe: true });
    await api.resolveReport('r1', 'comment', { resolution: 'dismissed', reason: 'not a violation' });
    await api.decideDispute('d1', { decision: 'upheld', note: 'the post stands' });
    await api.decideAppeal('a1', { decision: 'overturn', note: 'new evidence', allowSameDecider: false });
    await api.reviewEvidence('e1', { decision: 'clean', reason: 'no personal data' });
    await api.incidentAccess('i1', { caseId: 'c1', reason: 'legal hold request' });
    await api.tenantAction('t1', { action: 'suspend', reason: 'repeated abuse', expiresAt: null });
    await api.saveSettings({ expectedVersion: 2, autoHideReportThreshold: 7, reason: 'more reports first' });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(call)).toEqual([
      ['POST', `${M}/posts/p1/actions`, { action: 'publish', reason: 'checked and fine', expectedVersion: 3, label: 'unverified' }],
      ['POST', `${M}/comments/k1/actions`, { action: 'remove', reason: 'personal data' }],
      ['POST', `${M}/cases`, { kind: 'tenant_conduct', reason: 'repeated reports', targetTenantId: 't1' }],
      ['PATCH', `${M}/cases/c1`, { assignToMe: true }],
      ['POST', `${M}/reports/r1/resolve?kind=comment`, { resolution: 'dismissed', reason: 'not a violation' }],
      ['POST', `${M}/disputes/d1/decide`, { decision: 'upheld', note: 'the post stands' }],
      ['POST', `${M}/appeals/a1/decide`, { decision: 'overturn', note: 'new evidence', allowSameDecider: false }],
      ['POST', `${M}/evidence/e1/review`, { decision: 'clean', reason: 'no personal data' }],
      ['POST', `${M}/incidents/i1/access`, { caseId: 'c1', reason: 'legal hold request' }],
      ['POST', `${M}/tenants/t1/actions`, { action: 'suspend', reason: 'repeated abuse', expiresAt: null }],
      ['PUT', `${M}/settings`, { expectedVersion: 2, autoHideReportThreshold: 7, reason: 'more reports first' }],
    ]);
  });
});
