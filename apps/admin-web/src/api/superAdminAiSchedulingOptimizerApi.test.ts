// superAdminAiSchedulingOptimizerApi.test.ts — BUILD_PLAN Phase 7: every Super Admin optimizer route (contract §3.9),
// through the real client: paths, verbs, bodies; the detail no longer sends the old ad-hoc ?reason=.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { superAdminAiSchedulingOptimizerApi as api } from './superAdminAiSchedulingOptimizerApi';

let calls: { url: string; method: string; body?: any }[];
let reply: any;
beforeEach(() => {
  calls = []; reply = {};
  globalThis.fetch = vi.fn(async (u: any, init?: any) => { calls.push({ url: String(u), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, status: 200, json: async () => reply, text: async () => JSON.stringify(reply), headers: { get: () => null } } as any; }) as any;
});
// BUILD_PLAN Phase 12: every call is /api/v1/<path> — asserted once per call here, then compared on <path>
const path = (i: number) => { const u = calls[i].url.replace(/^https?:\/\/[^/]+/, ''); expect(u.startsWith('/api/v1/')).toBe(true); return u.slice('/api/v1'.length); };

describe('superAdminAiSchedulingOptimizerApi', () => {
  it('reads: overview, tenants (bare array or { rows }, search trimmed), one tenant without ?reason', async () => {
    await api.overview();
    expect(path(0)).toBe('/super-admin/ai-scheduling-optimizer/overview');
    reply = [{ tenantId: 't1' }];
    expect((await api.tenants('  glow ')).map((t) => t.tenantId)).toEqual(['t1']);
    expect(path(1)).toBe('/super-admin/ai-scheduling-optimizer/tenants?search=glow');
    reply = { rows: [{ tenantId: 't2' }] };
    expect((await api.tenants()).map((t) => t.tenantId)).toEqual(['t2']);
    expect(path(2)).toBe('/super-admin/ai-scheduling-optimizer/tenants');
    await api.tenant('t/1');
    expect(path(3)).toBe('/super-admin/ai-scheduling-optimizer/tenants/t%2F1');
  });
  it('writes: retry / rollback / disable / platform switch carry the reason', async () => {
    await api.retry('t1', 'r1', 'customer called twice');
    expect([calls[0].method, path(0), calls[0].body]).toEqual(['POST', '/super-admin/ai-scheduling-optimizer/tenants/t1/recommendations/r1/retry', { reason: 'customer called twice' }]);
    await api.rollback('t1', 'r1', 'wrong technician moved');
    expect(path(1)).toBe('/super-admin/ai-scheduling-optimizer/tenants/t1/recommendations/r1/rollback');
    await api.disable('t1', 'double bookings reported');
    expect([calls[2].method, path(2), calls[2].body]).toEqual(['POST', '/super-admin/ai-scheduling-optimizer/tenants/t1/disable', { reason: 'double bookings reported' }]);
    await api.platformSwitch(true, 'engine incident 42 today');
    expect([calls[3].method, path(3), calls[3].body]).toEqual(['PUT', '/super-admin/ai-scheduling-optimizer/platform-switch', { killed: true, reason: 'engine incident 42 today' }]);
    await api.startSupportSession('t1', 'checking failed applies');
    expect([calls[4].method, path(4), calls[4].body]).toEqual(['POST', '/super-admin/tenants/t1/support-access', { reason: 'checking failed applies', source: 'ai_scheduling_oversight' }]);
  });
});
