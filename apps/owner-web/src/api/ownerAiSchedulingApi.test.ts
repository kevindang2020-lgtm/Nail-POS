// ownerAiSchedulingApi.test.ts — the owner summary route (contract §3.10): GET /owner/ai-scheduling/summary?days=
import { describe, it, expect, vi } from 'vitest';
import { ownerAiSchedulingApi } from './ownerAiSchedulingApi';

describe('ownerAiSchedulingApi', () => {
  it('GET /owner/ai-scheduling/summary?days=N with the session cookie', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ days: 30, branches: [], generatedAt: 'x' }), headers: { get: () => null } }));
    globalThis.fetch = f as any;
    const r = await ownerAiSchedulingApi.summary(30);
    expect(r.days).toBe(30);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/owner/ai-scheduling/summary?days=30');
    expect(init.credentials).toBe('include');
  });
});
