// posAiSchedulingOptimizerApi.test.ts — BUILD_PLAN Phase 7 (ai_scheduling_optimizer → complete). Goes through the REAL
// shared client with a recording fetch, so a wrong path, verb, query or body fails here. Audit bug: the recommendations
// filter used to be sent as `{ query: filters }` — the shared client's second argument IS the query, so the server got
// `?query=[object Object]` and the status / type filter never reached it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { posAiSchedulingOptimizerApi as api } from './posAiSchedulingOptimizerApi';

type Call = { url: string; method: string; body?: any };
let calls: Call[];
let reply: { status: number; body: any };
beforeEach(() => {
  calls = []; reply = { status: 200, body: {} };
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    calls.push({ url: String(input), method: (init?.method || 'GET').toUpperCase(), body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body, text: async () => JSON.stringify(reply.body), headers: { get: () => null } } as any;
  }) as any;
});
const last = () => calls[calls.length - 1];
const path = (c: Call) => c.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1(?=\/)/, '')   /* BUILD_PLAN Phase 12: the client calls /api/v1/<path> */.split('?')[0];
const query = (c: Call) => Object.fromEntries(new URL(c.url, 'http://x').searchParams.entries());

describe('posAiSchedulingOptimizerApi — recommendations filters (audit bug)', () => {
  it('sends status / type / date as real query params, never ?query=', async () => {
    reply.body = { items: [], total: 0 };
    await api.recommendations({ status: 'review_required', type: 'fill_gap', date: '2026-10-08' });
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/recommendations');
    expect(query(last())).toEqual({ status: 'review_required', type: 'fill_gap', date: '2026-10-08' });
    expect(last().url).not.toContain('query=');
  });
  it('drops empty filters', async () => {
    reply.body = { items: [], total: 0 };
    await api.recommendations({ status: null, type: undefined, runId: '' as any });
    expect(query(last())).toEqual({});
  });
});

describe('posAiSchedulingOptimizerApi — every route the screens use (contract §2–§3)', () => {
  it('decisions / apply / retry / rollback carry expectedVersion; generate sends SchedGenerateRequest', async () => {
    reply.body = { recommendation: { id: 'r1' } };
    await api.accept('r/1', { expectedVersion: 3, reason: 'ok' });
    expect([last().method, path(last()), last().body]).toEqual(['POST', '/pos/ai-scheduling-optimizer/recommendations/r%2F1/accept', { expectedVersion: 3, reason: 'ok' }]);
    await api.reject('r1', { expectedVersion: 4, reason: 'no' });
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/recommendations/r1/reject');
    await api.returnForRevision('r1', { expectedVersion: 4, reason: 'later' });
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/recommendations/r1/return');
    reply.body = { recommendation: { id: 'r1' }, application: { status: 'applied' } };
    await api.apply('r1', 5);
    expect([path(last()), last().body]).toEqual(['/pos/ai-scheduling-optimizer/recommendations/r1/apply', { expectedVersion: 5 }]);
    await api.retry('r1', 6);
    expect([path(last()), last().body]).toEqual(['/pos/ai-scheduling-optimizer/recommendations/r1/retry', { expectedVersion: 6 }]);
    await api.rollback('r1', 7);
    expect([path(last()), last().body]).toEqual(['/pos/ai-scheduling-optimizer/recommendations/r1/rollback', { expectedVersion: 7 }]);
    reply.body = { recommendation: { id: 'r2' } };
    const g = await api.generate({ appointmentId: 'a1', target: { startTime: '11:00' } });
    expect([last().method, path(last()), last().body]).toEqual(['POST', '/pos/ai-scheduling-optimizer/recommendations/generate', { appointmentId: 'a1', target: { startTime: '11:00' } }]);
    expect(g.recommendation.id).toBe('r2');
  });

  it('one recommendation: GET accepts both { recommendation } and a bare row', async () => {
    reply.body = { recommendation: { id: 'r1', version: 2 } };
    expect((await api.recommendation('r1')).id).toBe('r1');
    reply.body = { id: 'r9', version: 2 };
    expect((await api.recommendation('r9')).id).toBe('r9');
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/recommendations/r9');
  });

  it('explain / proposal resend / customer decision', async () => {
    reply.body = { recommendation: { id: 'r1' } };
    await api.explain('r1');
    expect([last().method, path(last())]).toEqual(['POST', '/pos/ai-scheduling-optimizer/recommendations/r1/explain']);
    await api.resendProposal('r1');
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/recommendations/r1/proposal/resend');
    await api.customerDecision('r1', true, 8);
    expect([path(last()), last().body]).toEqual(['/pos/ai-scheduling-optimizer/recommendations/r1/customer-decision', { approved: true, expectedVersion: 8 }]);
  });

  it('options + hold release, runs, calendar', async () => {
    reply.body = { options: [], forecastAvailable: false, hold: null };
    await api.options({ date: '2026-10-08', serviceIds: ['s1'], hold: { channel: 'pos' } });
    expect([last().method, path(last()), last().body.hold]).toEqual(['POST', '/pos/ai-scheduling-optimizer/options', { channel: 'pos' }]);
    await api.releaseHold('h 1');
    expect([last().method, path(last())]).toEqual(['POST', '/pos/ai-scheduling-optimizer/holds/h%201/release']);
    await api.runDay({ scope: 'branch_day', date: '2026-10-08', idempotencyKey: 'k1' });
    expect([last().method, path(last()), last().body]).toEqual(['POST', '/pos/ai-scheduling-optimizer/runs', { scope: 'branch_day', date: '2026-10-08', idempotencyKey: 'k1' }]);
    reply.body = { items: [{ id: 'run1' }] };
    expect((await api.runs({ limit: 10 })).map((r) => r.id)).toEqual(['run1']);
    expect(query(last())).toEqual({ limit: '10' });
    reply.body = [{ id: 'run2' }];
    expect((await api.runs()).map((r) => r.id)).toEqual(['run2']);
    reply.body = { run: { id: 'run1' }, gaps: [], conflicts: [], recommendations: [] };
    await api.run('run1');
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/runs/run1');
    reply.body = { date: '2026-10-08', gaps: [], conflicts: [], appointments: {}, utilizationPct: null };
    await api.calendar('2026-10-08');
    expect([path(last()), query(last())]).toEqual(['/pos/ai-scheduling-optimizer/calendar', { date: '2026-10-08' }]);
  });

  it('settings: GET, PUT (SchedSettingsUpdate), versions', async () => {
    await api.settings();
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/settings');
    await api.saveSettings({ level: 'branch', expectedVersion: 0, enabled: true });
    expect([last().method, last().body]).toEqual(['PUT', { level: 'branch', expectedVersion: 0, enabled: true }]);
    reply.body = { items: [{ version: 2 }] };
    expect((await api.settingsVersions()).length).toBe(1);
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/settings/versions');
  });

  it('time off, locks, service profiles', async () => {
    reply.body = [];
    await api.timeOff();
    expect([last().method, path(last())]).toEqual(['GET', '/pos/ai-scheduling-optimizer/time-off']);
    await api.addTimeOff({ technicianId: 't1', startsAt: '2026-10-09T13:00:00.000Z', endsAt: '2026-10-09T17:00:00.000Z', reason: 'dentist' });
    expect([last().method, last().body.technicianId]).toEqual(['POST', 't1']);
    await api.removeTimeOff('to1');
    expect([last().method, path(last())]).toEqual(['DELETE', '/pos/ai-scheduling-optimizer/time-off/to1']);
    reply.body = [{ appointmentId: 'a1', reason: 'x', lockedByUserId: 'u1', createdAt: 'y' }];
    expect((await api.locks()).map((l) => l.appointmentId)).toEqual(['a1']);
    expect([last().method, path(last())]).toEqual(['GET', '/pos/ai-scheduling-optimizer/locks']);
    await api.lock('a1', 'VIP asked');
    expect([last().method, path(last()), last().body]).toEqual(['PUT', '/pos/ai-scheduling-optimizer/locks/a1', { reason: 'VIP asked' }]);
    await api.unlock('a1');
    expect([last().method, path(last())]).toEqual(['DELETE', '/pos/ai-scheduling-optimizer/locks/a1']);
    await api.serviceProfiles();
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/service-profiles');
    await api.saveServiceProfile('s1', { setupMin: 5, cleanupMin: 10, maxGroupSize: null });
    expect([last().method, path(last()), last().body]).toEqual(['PUT', '/pos/ai-scheduling-optimizer/service-profiles/s1', { setupMin: 5, cleanupMin: 10, maxGroupSize: null }]);
  });

  it('insights, usage', async () => {
    reply.body = { items: [], total: 0 };
    await api.insights({ kind: 'duration', status: 'review_required' });
    expect([path(last()), query(last())]).toEqual(['/pos/ai-scheduling-optimizer/insights', { kind: 'duration', status: 'review_required' }]);
    await api.decideInsight('staffing', 'i1', 'approve', { expectedVersion: 2 });
    expect([last().method, path(last()), last().body]).toEqual(['POST', '/pos/ai-scheduling-optimizer/insights/staffing/i1/approve', { expectedVersion: 2 }]);
    await api.decideInsight('duration', 'i2', 'reject', { expectedVersion: 1, reason: 'seasonal' });
    expect(path(last())).toBe('/pos/ai-scheduling-optimizer/insights/duration/i2/reject');
    await api.refreshInsights();
    expect([last().method, path(last())]).toEqual(['POST', '/pos/ai-scheduling-optimizer/insights/refresh']);
    reply.body = { from: 'a', to: 'b', runs: 1, recommendations: 2, applied: 1, explanations: 1, llmCostMicroUsd: 0 };
    await api.usage('2026-10-01', '2026-10-08');
    expect([path(last()), query(last())]).toEqual(['/pos/ai-scheduling-optimizer/usage', { from: '2026-10-01', to: '2026-10-08' }]);
  });

  it('export reads the CSV body as text with the session cookie', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'id,status\nr1,applied\n', headers: { get: () => 'text/csv' } }));
    globalThis.fetch = f as any;
    const csv = await api.exportCsv('runs', '2026-10-01', '2026-10-08');
    expect(csv).toContain('r1,applied');
    const [url, init] = (f.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe('/api/v1/pos/ai-scheduling-optimizer/export?kind=runs&from=2026-10-01&to=2026-10-08');   // BUILD_PLAN Phase 12
    expect(init.credentials).toBe('include');
  });

  it('a 409 keeps its code so the screen can refetch (VERSION_CONFLICT / STALE_SCHEDULE)', async () => {
    reply = { status: 409, body: { code: 'STALE_SCHEDULE', message: 'The appointment moved.' } };
    await expect(api.apply('r1', 2)).rejects.toMatchObject({ status: 409, code: 'STALE_SCHEDULE' });
  });
});
