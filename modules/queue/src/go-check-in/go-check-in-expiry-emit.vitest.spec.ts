// go-check-in-expiry-emit.vitest.spec.ts — proves the emitter: when a kiosk session is idle past the timeout, the
// service records a real failed check-in event (for the Booking & Check-In Monitor) and still raises session_expired.
// Also proves the recorder is an OPTIONAL dependency — absence must not break the existing flow.
import { describe, it, expect, vi } from 'vitest';
import { GoCheckInService } from './go-check-in.service';
import { sha256Hex, SESSION_IDLE_MS } from './go-check-in.dto';

const staleSession = (token: string) => ({
  id: 's1', tenantId: 't1', branchId: 'b1', deviceId: 'd1', status: 'active',
  sessionTokenHash: sha256Hex(token),
  startedAt: new Date().toISOString(),
  lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS - 1000).toISOString(),
  completedAt: null, expiredAt: null,
});

describe('GoCheckIn idle-expiry → failed-event emit', () => {
  it('records a failed check-in event and throws session_expired', async () => {
    const token = 'tok-123';
    const repo: any = { sessionById: vi.fn().mockResolvedValue(staleSession(token)), setSessionStatus: vi.fn().mockResolvedValue(undefined), insertLog: vi.fn().mockResolvedValue(undefined) };
    const recorder = { recordFailedEvent: vi.fn().mockResolvedValue(undefined), recordHandoff: vi.fn(), recordUnmatched: vi.fn(), recordDuplicateCandidate: vi.fn() };
    const svc = new GoCheckInService(repo, undefined, undefined, recorder as any);

    await expect(svc.heartbeat('s1', token)).rejects.toMatchObject({ code: 'session_expired' });
    expect(repo.setSessionStatus).toHaveBeenCalledWith('s1', 'expired');
    expect(recorder.recordFailedEvent).toHaveBeenCalledTimes(1);
    expect(recorder.recordFailedEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', branchId: 'b1', checkinId: 's1', deviceId: 'd1', category: 'check_in', failureType: 'session_timeout' }));
  });

  it('still works when no recorder is wired (optional dependency)', async () => {
    const token = 'tok-9';
    const repo: any = { sessionById: vi.fn().mockResolvedValue(staleSession(token)), setSessionStatus: vi.fn().mockResolvedValue(undefined), insertLog: vi.fn().mockResolvedValue(undefined) };
    const svc = new GoCheckInService(repo, undefined, undefined, undefined);
    await expect(svc.heartbeat('s1', token)).rejects.toMatchObject({ code: 'session_expired' });
  });
});
