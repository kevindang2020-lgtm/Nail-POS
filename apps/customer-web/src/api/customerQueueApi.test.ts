// BUILD_PLAN Phase 6 (ai_queue_assignment) — accept another technician: the exact route and body agent A serves
// (POST customer/queue/:queueItemId/accept-alternate { technicianId }), the id URL-encoded, never a tenant id.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { customerQueueApi } from './customerQueueApi';

describe('customerQueueApi.acceptAlternate', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, queueItemId: 'q 1/2', requestedTechnicianId: 'tB', requestedTechnicianName: 'Kim', technicianName: 'Kim', version: 2 }) })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs { technicianId } to the guest\'s own queue item', async () => {
    expect(await customerQueueApi.acceptAlternate('q 1/2', 'tB')).toMatchObject({ ok: true, technicianName: 'Kim' });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(String(url).split('?')[0]).toMatch(/\/customer\/queue\/q%201%2F2\/accept-alternate$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ technicianId: 'tB' });
  });

  it('a refusal reaches the screen with its status (409 = that technician was just taken)', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'QUEUE_ASSIGNMENT_CONFLICT', message: 'Taken' }) });
    await expect(customerQueueApi.acceptAlternate('q1', 'tB')).rejects.toMatchObject({ status: 409 });
  });
});
