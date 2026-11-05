import { describe, it, expect, beforeEach } from 'vitest';
import { MaintenanceService, MaintError } from './maintenance.service';
import { InMemoryMaintenanceRepo } from './maintenance.repository';

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io', role: 'SUPER_ADMIN' };
const soon = () => new Date(Date.now() + 86400000).toISOString();
const later = () => new Date(Date.now() + 90000000).toISOString();

describe('MaintenanceService', () => {
  let svc: MaintenanceService; let repo: InMemoryMaintenanceRepo;
  beforeEach(() => { repo = new InMemoryMaintenanceRepo(); svc = new MaintenanceService(repo); });

  it('requires a reason to enable, then activates + records an in-progress event', async () => {
    await expect(svc.enable(CTX, {})).rejects.toThrow(/reason is required/i);
    const st = await svc.enable(CTX, { reason: 'Security patch', mode: 'read_only', message: 'Back at 2am' });
    expect(st.active).toBe(true);
    expect(st.mode).toBe('read_only');
    expect((await svc.cachedState()).active).toBe(true);
    expect((await svc.history()).some((h) => h.status === 'in_progress')).toBe(true);
  });

  it('disable turns it off and completes the active event (SUPER_ADMIN can always reach this)', async () => {
    await svc.enable(CTX, { reason: 'x' });
    const st = await svc.disable(CTX);
    expect(st.active).toBe(false);
    expect((await svc.cachedState()).active).toBe(false);
    expect((await svc.history())[0].status).toBe('completed');
  });

  it('schedules a window, rejecting missing reason, invalid window, and overlaps', async () => {
    await expect(svc.schedule(CTX, { startsAt: soon(), endsAt: later() })).rejects.toThrow(/reason/i);
    await expect(svc.schedule(CTX, { reason: 'r', startsAt: later(), endsAt: soon() })).rejects.toThrow(/after start/i);
    const ev = await svc.schedule(CTX, { reason: 'Upgrade', startsAt: soon(), endsAt: later() });
    expect(ev.status).toBe('scheduled');
    expect(ev.durationMinutes).toBeGreaterThan(0);
    // an overlapping window is rejected (no duplicate jobs)
    await expect(svc.schedule(CTX, { reason: 'again', startsAt: soon(), endsAt: later() })).rejects.toThrow(/overlap/i);
  });

  it('cancels a scheduled event but not a completed one', async () => {
    const ev = await svc.schedule(CTX, { reason: 'Upgrade', startsAt: soon(), endsAt: later() });
    const c = await svc.cancel(CTX, ev.id);
    expect(c.status).toBe('cancelled');
    await expect(svc.cancel(CTX, ev.id)).rejects.toThrow(/cannot cancel/i);
    await expect(svc.cancel(CTX, 'nope')).rejects.toThrow(MaintError);
  });

  it('sets the announcement banner', async () => {
    const st = await svc.setBanner(CTX, 'Scheduled maintenance this weekend');
    expect(st.announcementBanner).toBe('Scheduled maintenance this weekend');
  });

  it('history formats duration', async () => {
    await svc.schedule(CTX, { reason: 'r', startsAt: '2099-06-01T00:00:00Z', endsAt: '2099-06-01T02:00:00Z' });
    const h = await svc.history();
    expect(h[0].duration).toBe('2h');
  });
});
