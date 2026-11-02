// BUILD_PLAN Phase 12 round 2: recording a dispute outcome twice (a second click, a retried request) added the recovered
// funds twice. The route is @Idempotent(); the screen sends ONE Idempotency-Key per submission.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { disputesApi } from './superAdminApi';

afterEach(() => vi.restoreAllMocks());

describe('disputesApi.recordOutcome', () => {
  it('sends the submission\'s Idempotency-Key header', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, manualOverride: false, outcome: { id: 'o', result: 'won', newStatus: 'won', fundsRecoveredCents: 500 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await disputesApi.recordOutcome('DSP-1', { result: 'won', fundsRecoveredCents: 500 }, 'key-123');
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-123');
    expect(String(f.mock.calls[0][0])).toContain('/super-admin/disputes/DSP-1/outcome');
  });
});
