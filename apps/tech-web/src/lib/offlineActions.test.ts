// offlineActions.test.ts — BUILD_PLAN Phase 13: the journaled spec and the live call are the SAME request (a replay after a
// reconnect must hit exactly the route the first attempt did), each carries the key, and neither is a money action.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/client', () => ({ api: { post: vi.fn(async () => ({})) } }));
import { api } from '../api/client';
import { isFinancialPath } from '@aipowersalon/mobile-sdk';
import { startServiceAction, serviceDoneAction, START_SERVICE_TTL_MS, SERVICE_DONE_TTL_MS } from './offlineActions';

beforeEach(() => vi.clearAllMocks());

describe('tech offline actions', () => {
  it.each([
    ['start', startServiceAction('a b'), {}],
    ['done', serviceDoneAction('a b', 'nice'), { notes: 'nice' }],
  ] as const)('%s: the live call hits the journaled path with the key', async (_n, a, body) => {
    await a.exec('key-12345678');
    expect(api.post).toHaveBeenCalledWith(expect.any(String), body, { idempotencyKey: 'key-12345678' });
    const [path] = (api.post as any).mock.calls[0];
    expect(`${path}`).toBe(a.spec.path);
    expect(a.spec.body).toEqual(body);
    expect(a.spec.offline).toBe('queue');
    expect(isFinancialPath(a.spec.path)).toBe(false);
  });
  it('operation-specific expiry (§257) and HIGH priority', () => {
    expect(startServiceAction('t').spec).toMatchObject({ ttlMs: START_SERVICE_TTL_MS, priority: 'HIGH', operation: 'tech.start_service' });
    expect(serviceDoneAction('t').spec).toMatchObject({ ttlMs: SERVICE_DONE_TTL_MS, priority: 'HIGH', operation: 'tech.service_done' });
    expect(START_SERVICE_TTL_MS).toBeLessThan(SERVICE_DONE_TTL_MS);
  });
});
