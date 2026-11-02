import { describe, it, expect, vi } from 'vitest';
import { SuperAdminStaffService } from './super-admin-staff.service';

// Service contract for technician-app connectivity (§21): classifies each technician's latest heartbeat against a live
// clock and reconciles a summary; `configured` is false (→ honest gap in the UI) only when no technician has any token.
const isoAgo = (min: number) => new Date(Date.now() - min * 60000).toISOString();
function harness(raw: Array<{ userId: string; lastSeen: string | null; hasToken: boolean }>) {
  const repo = { technicianConnectivity: vi.fn(async () => raw) };
  return { svc: new SuperAdminStaffService(repo as any), repo };
}
const ctx = { userId: 'admin-1' };

describe('SuperAdminStaffService.getTechnicianConnectivity', () => {
  it('classifies recent vs stale heartbeats and reconciles the summary', async () => {
    const { svc } = harness([
      { userId: 'u1', lastSeen: isoAgo(2), hasToken: true },   // connected
      { userId: 'u2', lastSeen: isoAgo(60), hasToken: true },  // disconnected (stale)
      { userId: 'u3', lastSeen: null, hasToken: false },       // unknown (no token)
      { userId: 'u4', lastSeen: isoAgo(1), hasToken: true },   // connected
    ]);
    const { summary } = await svc.getTechnicianConnectivity(ctx);
    expect(summary).toMatchObject({ total: 4, connected: 2, disconnected: 1, unknown: 1, connectedRate: 50, configured: true });
  });

  it('reports not configured when no technician has a token (honest gap)', async () => {
    const { svc } = harness([{ userId: 'u1', lastSeen: null, hasToken: false }, { userId: 'u2', lastSeen: null, hasToken: false }]);
    const { summary } = await svc.getTechnicianConnectivity(ctx);
    expect(summary.configured).toBe(false);
    expect(summary.unknown).toBe(2);
  });

  it('handles an empty technician set', async () => {
    const { svc } = harness([]);
    const { summary } = await svc.getTechnicianConnectivity(ctx);
    expect(summary).toMatchObject({ total: 0, connectedRate: null, configured: false });
  });
});
