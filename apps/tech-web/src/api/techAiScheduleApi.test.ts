// techAiScheduleApi.test.ts — the tech changes route (contract §3.10): GET /tech/ai-schedule/changes?date=
import { describe, it, expect, vi } from 'vitest';
// BUILD_PLAN Phase 13: no mobile-sdk mock — the real transport runs (web: no bearer), against the stubbed fetch below
import { techAiScheduleApi } from './techAiScheduleApi';

describe('techAiScheduleApi', () => {
  it('GET /tech/ai-schedule/changes?date= and unwraps { items }', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ recommendationId: 'r1' }] }), headers: { get: () => null } }));
    globalThis.fetch = f as any;
    const r = await techAiScheduleApi.changes('2026-10-08');
    expect(r.map((c) => c.recommendationId)).toEqual(['r1']);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/v1/tech/ai-schedule/changes?date=2026-10-08');   // BUILD_PLAN Phase 12: /api/v1
  });
  it('a body without items reads as no changes', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } })) as any;
    expect(await techAiScheduleApi.changes('2026-10-08')).toEqual([]);
  });
});
