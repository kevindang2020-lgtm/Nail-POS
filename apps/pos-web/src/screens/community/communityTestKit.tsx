// communityTestKit.tsx — test-only fixtures + a routed fetch for the Safety Community screen tests (BUILD_PLAN Phase 8).
// The tests go through the REAL posCommunityApi + client, so a wrong path, verb, query or body fails. Shapes are the
// contract's (`@aipowersalon/api-contracts/tenant` Community*). Imported only by *.test.tsx files.
import { vi } from 'vitest';
import { COMMUNITY_RULES_VERSION } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export type Call = { url: string; method: string; body?: any; path: string; query: URLSearchParams };
export type Reply = { status?: number; body?: any };
export type Route = Reply | ((c: Call) => Reply);

export const actions = (o: any = {}) => ({ canComment: true, canEdit: false, canAddUpdate: false, canResolve: false, canReport: true, canDispute: true, canAppeal: false, canFollow: true, canUploadEvidence: false, canMarkSimilar: true, ...o });
export const author = (o: any = {}) => ({ label: t('pos.a_salon_in_nj'), isOwnSalon: false, anonymous: true, ...o });
export const post = (o: any = {}) => ({
  id: 'p1', title: t('pos.caller_asked_for_the_processor_login_1bvq'), body: t('pos.a_caller_claiming_to_be_our_1x8a'),
  category: 'account_takeover_attempt', severity: 'high', status: 'published_unverified', verificationLabel: 'unverified',
  region: 'NJ', incidentDate: '2026-10-07', scamMethod: 'Phone call pretending to be support', channels: ['phone'], recommendation: 'Never read a login code to a caller.',
  tags: ['processor'], paymentProcessor: null, amountRange: null, officialReference: null, author: author(),
  counts: { comments: 2, similar: 1, followers: 3 }, publishedAt: '2026-10-08T12:00:00Z', lastActivityAt: '2026-10-08T13:00:00Z', resolvedAt: null, resolutionNote: null,
  commentsLocked: false, following: false, similarReportedByMe: false, evidence: { count: 0, reviewed: false }, viewerActions: actions(),
  version: 3, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T12:00:00Z', ...o,
});
export const myPost = (o: any = {}) => ({
  ...post({ status: 'incident_draft', author: author({ label: t('pos.bella_nails'), isOwnSalon: true, anonymous: false }), publishedAt: null, version: 1, viewerActions: actions({ canEdit: true, canUploadEvidence: true }) }),
  privacyScanFlags: [], moderationRequired: true, authorDisplay: 'tenant_name', createdByMe: true, awaitingMyApproval: false, returnReason: null, fromIncidentId: null, ...o,
});
export const page = (items: any[], o: any = {}) => ({ items, page: 1, pageSize: 20, total: items.length, hasMore: false, ...o });
export const settings = (o: any = {}) => ({
  enabled: true, receptionistApprovalRequired: true, managerApprovalRequired: false, displayName: null, authorDisplay: 'tenant_name', allowAnonymous: false,
  branchVisibility: 'tenant', retentionDays: 365, regionPreferences: ['NJ'], riskMatchingEnabled: false,
  notify: { categories: [], push: true, email: false, criticalSms: false }, roleGrants: {}, roleRemovals: {}, version: 4,
  rulesVersion: COMMUNITY_RULES_VERSION, rulesAcknowledgedByMe: true, ...o,
});
export const comment = (o: any = {}) => ({ id: 'c1', postId: 'p1', parentId: null, depth: 1, body: t('pos.we_got_the_same_call_yesterday'), author: author({ label: t('pos.glow_spa') }), mine: false, edited: false, removed: false, version: 1, createdAt: '2026-10-08T13:00:00Z', replies: [], ...o });
export const scanSummary = (o: any = {}) => ({ blocked: false, flagged: true, categories: ['phone'], redactedPreview: 'Call from [phone removed]', ...o });

export const B = '/community';
export let calls: Call[] = [];
export function installFetch(routes: Record<string, Route>) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input); const method = (init?.method || 'GET').toUpperCase();
    let body: any; try { body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body; } catch { /* */ }
    const rel = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1(?=\/)/, '')   /* BUILD_PLAN Phase 12: the client calls /api/v1/<path> */;
    const [path, qs] = rel.split('?');
    const call: Call = { url, method, body, path, query: new URLSearchParams(qs || '') };
    calls.push(call);
    const r = routes[`${method} ${path}`];
    const rep: Reply = typeof r === 'function' ? r(call) : r || { body: {} };
    const status = rep.status ?? 200;
    const text = JSON.stringify(rep.body ?? null);
    return { ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => text, json: async () => JSON.parse(text), headers: { get: () => null } } as any;
  }) as any;
}
export const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
export const err = (status: number, code: string, extra: any = {}): Reply => ({ status, body: { ok: false, code, message: code, ...extra } });
