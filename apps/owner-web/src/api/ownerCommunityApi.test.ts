// ownerCommunityApi.test.ts — BUILD_PLAN Phase 8: the Owner App's Safety Community routes (contract §2 / §4) —
// method + path + query / body, with the session cookie.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ownerCommunityApi as api } from './ownerCommunityApi';

let f: ReturnType<typeof vi.fn>;
beforeEach(() => {
  f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ id: 'x' }], page: 1, pageSize: 50, total: 1, hasMore: false }), headers: { get: () => null } }));
  globalThis.fetch = f as any;
});
const last = () => { const [url, init] = f.mock.calls.slice(-1)[0] as unknown as [string, RequestInit]; return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, credentials: init.credentials }; };

describe('ownerCommunityApi', () => {
  it('alerts, awaiting approval (list unwrapped), settings', async () => {
    expect(await api.activeAlerts()).toEqual([{ id: 'x' }]);
    expect(last()).toMatchObject({ url: '/api/v1/community/alerts/active', method: 'GET', credentials: 'include' });
    expect(await api.awaitingApproval()).toEqual([{ id: 'x' }]);
    expect(last().url).toBe('/api/v1/community/mine?kind=awaiting_approval&page=1&pageSize=50');
    await api.settings();
    expect(last()).toMatchObject({ url: '/api/v1/community/settings', method: 'GET' });
  });
  it('approve / return / save carry the version', async () => {
    await api.approve('d 1', 3);
    expect(last()).toMatchObject({ url: '/api/v1/community/advisories/d%201/approve', method: 'POST', body: { expectedVersion: 3 } });
    await api.returnAdvisory('d1', 3, 'fix it');
    expect(last()).toMatchObject({ url: '/api/v1/community/advisories/d1/return', method: 'POST', body: { expectedVersion: 3, note: 'fix it' } });
    await api.saveSettings({ expectedVersion: 0, enabled: true });
    expect(last()).toMatchObject({ url: '/api/v1/community/settings', method: 'PUT', body: { expectedVersion: 0, enabled: true } });
  });
});
