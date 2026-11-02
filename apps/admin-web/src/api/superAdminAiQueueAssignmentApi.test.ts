// BUILD_PLAN Phase 6 (ai_queue_assignment) — the Super Admin AI-queue client against the REAL fetch client: the right
// routes, the salon kill switch body ({ killed, reason }), the step-up retry (Constitution 7 §8), and a tenants list
// that tolerates either a bare array or an { items } / { tenants } envelope.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { superAdminAiQueueAssignmentApi as aq } from './superAdminAiQueueAssignmentApi';
import { setStepUpHandler } from './step-up';

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as any;
// BUILD_PLAN Phase 12: every call is /api/v1/<path> — asserted once per call here, then compared on <path>
const path = (call: any[]) => { const u = String(call[0]); expect(u.startsWith('/api/v1/')).toBe(true); return u.slice('/api/v1'.length).split('?')[0]; };

describe('superAdminAiQueueAssignmentApi', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); setStepUpHandler(null); });

  it('reads the overview, the salons ({ rows }) and one salon from /super-admin/ai-queue-assignment', async () => {
    (fetch as any).mockResolvedValueOnce(res(200, { ok: true })).mockResolvedValueOnce(res(200, { rows: [{ tenantId: 't1' }] })).mockResolvedValueOnce(res(200, { tenant: { tenantId: 't1' } }));
    await aq.overview();
    expect(await aq.tenants()).toEqual([{ tenantId: 't1' }]);
    await aq.tenant('t1/x');
    const calls = (fetch as any).mock.calls;
    expect(path(calls[0])).toBe('/super-admin/ai-queue-assignment/overview');
    expect(String(calls[1][0])).toBe('/api/v1/super-admin/ai-queue-assignment/tenants');   // no empty ?search=
    expect(path(calls[2])).toBe('/super-admin/ai-queue-assignment/tenants/t1%2Fx');
  });

  it('sends a trimmed search, and an unexpected body becomes an empty list', async () => {
    (fetch as any).mockResolvedValueOnce(res(200, { rows: [] })).mockResolvedValueOnce(res(200, { nothing: true }));
    expect(await aq.tenants('  glow ')).toEqual([]);
    expect(new URL(String((fetch as any).mock.calls[0][0]), 'http://x').searchParams.get('search')).toBe('glow');
    expect(await aq.tenants()).toEqual([]);
  });

  it('the salon kill switch POSTs { killed, reason } and is retried once after a completed step-up', async () => {
    (fetch as any).mockResolvedValueOnce(res(403, { code: 'STEP_UP_REQUIRED', message: 'confirm' })).mockResolvedValueOnce(res(200, { tenantId: 't1', killed: true, reason: 'Front desk reports wrong technicians', version: 4 }));
    const handler = vi.fn().mockResolvedValue(true); setStepUpHandler(handler);
    expect(await aq.setAutoKill('t1', true, 'Front desk reports wrong technicians')).toMatchObject({ killed: true, version: 4 });
    const calls = (fetch as any).mock.calls;
    expect(calls).toHaveLength(2);
    expect(path(calls[0])).toBe('/super-admin/ai-queue-assignment/tenants/t1/auto-kill');
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(calls[1][1].body)).toEqual({ killed: true, reason: 'Front desk reports wrong technicians' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a cancelled step-up rejects with code STEP_UP_REQUIRED (the screen words it plainly)', async () => {
    (fetch as any).mockResolvedValueOnce(res(403, { code: 'STEP_UP_REQUIRED', message: 'confirm' }));
    setStepUpHandler(vi.fn().mockResolvedValue(false));
    await expect(aq.setAutoKill('t1', false, 'Rotation fixed by the owner')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});
