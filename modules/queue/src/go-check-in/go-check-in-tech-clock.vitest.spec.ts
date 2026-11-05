// End-to-end (service-level) tests for the PIN-driven technician time clock on the Go Check-In device.
// tenant/branch come only from the device session; the PIN decides who; the attendance write reuses TimeClockService.
import { TechnicianClockPinService, InMemoryClockPinRepository, TimeClockService, InMemoryTimeClockRepository } from '@aipowersalon/workforce';
import { describe, it, expect, vi } from 'vitest';
import { GoCheckInService } from './go-check-in.service';
import { sha256Hex } from './go-check-in.dto';

const TOKEN = 'kiosk-token-xyz';
const TENANT = 'tenant-A', BRANCH = 'branch-1', DEVICE = 'dev-1', TECH = 'tech-1';
const PIN = '7391';

function sessionRepo(tenantId = TENANT, activeService = false) {
  return {
    sessionById: async () => ({ id: 's1', sessionTokenHash: sha256Hex(TOKEN), status: 'active', lastSeenAt: new Date().toISOString(), tenantId, branchId: BRANCH, deviceId: DEVICE }),
    deviceById: async () => ({ id: DEVICE, tenantId, branchId: BRANCH, status: 'active', deviceName: 'Front Desk' }),
    getSettings: async () => ({ enabled: true }),
    touchSession: async () => {},
    insertLog: async () => {},
    hasTechnicianActiveService: async () => activeService,
  } as any;
}

async function build(sessionTenant = TENANT, activeService = false) {
  const pinRepo = new InMemoryClockPinRepository();
  const pinSvc = new TechnicianClockPinService(pinRepo);
  await pinSvc.setPin({ tenantId: TENANT, branchId: BRANCH }, TECH, PIN, 'mgr-1');   // PIN provisioned under tenant-A
  const clockRepo = new InMemoryTimeClockRepository([{ technicianId: TECH, technicianName: 'Ava Chen' }]);
  const clockSvc = new TimeClockService(clockRepo);
  const svc = new GoCheckInService(sessionRepo(sessionTenant, activeService), undefined, undefined, undefined, pinSvc, clockSvc);
  (svc as any).__clockRepo = clockRepo;
  return svc;
}

describe('Go Check-In — technician time clock (PIN)', () => {
  it('identifies the technician by PIN and offers Clock In when they are clocked out', async () => {
    const svc = await build();
    const r = await svc.technicianIdentify('s1', TOKEN, PIN);
    expect(r.technicianId).toBe(TECH);
    expect(r.technicianName).toBe('Ava Chen');
    expect(r.clockedIn).toBe(false);
    expect(r.action).toBe('clock_in');
    expect(typeof r.serverTime).toBe('string');   // server-derived time, not client-supplied
  });

  it('rejects a wrong PIN with a safe, non-enumerating error (no profile leaked)', async () => {
    const svc = await build();
    await expect(svc.technicianIdentify('s1', TOKEN, '0000')).rejects.toMatchObject({ code: 'pin_not_recognised' });
  });

  it('rejects a malformed PIN before scanning anything', async () => {
    const svc = await build();
    await expect(svc.technicianIdentify('s1', TOKEN, '12')).rejects.toMatchObject({ code: 'invalid_pin' });
  });

  it('clocks in with the PIN, then identify flips to Clock Out', async () => {
    const svc = await build();
    const ci = await svc.technicianClockIn('s1', TOKEN, PIN);
    expect(ci.ok).toBe(true);
    expect(ci.action).toBe('clock_out');
    expect(typeof ci.clockedInAt).toBe('string');   // authoritative server timestamp
    const after = await svc.technicianIdentify('s1', TOKEN, PIN);
    expect(after.clockedIn).toBe(true);
    expect(after.action).toBe('clock_out');
  });

  // Re-pinned (merge Oct 12 2026 — WF's time clock, the other chat's workforce audit P1 #17): a second clock-in was a 400
  // "already clocked in" (and under a race a 500 from the day-unique index). Now ONE transition: the open punch is returned
  // — no overlapping session, no error screen on a double-tap.
  it('a second clock-in without a clock-out is idempotent — exactly ONE open punch, no overlapping session', async () => {
    const svc = await build();
    const a = await svc.technicianClockIn('s1', TOKEN, PIN);
    const b = await svc.technicianClockIn('s1', TOKEN, PIN);
    expect(b.ok).toBe(true);
    expect(b.clockedInAt).toBe(a.clockedInAt);                       // the SAME punch, not a new one
    expect((svc as any).__clockRepo.allPunches()).toHaveLength(1);
  });

  it('is idempotent on a same-key double-tap: returns the first result, no error, no duplicate write', async () => {
    const svc = await build();
    const first = await svc.technicianClockIn('s1', TOKEN, PIN, 'key-1');
    expect(first.ok).toBe(true);
    const second = await svc.technicianClockIn('s1', TOKEN, PIN, 'key-1');   // replay
    expect(second).toEqual(first);   // same result, NOT an "already clocked in" error
  });

  it('idempotency is scoped to the key: a genuinely new attempt is a fresh call that still yields ONE open punch', async () => {
    const svc = await build();
    const a = await svc.technicianClockIn('s1', TOKEN, PIN, 'key-a');
    const b = await svc.technicianClockIn('s1', TOKEN, PIN, 'key-b');
    expect(b.clockedInAt).toBe(a.clockedInAt);
    expect((svc as any).__clockRepo.allPunches()).toHaveLength(1);
  });

  // merge Oct 12 2026: WF's per-kiosk PIN lockout (KioskPinLockedError) surfaces at the kiosk as 429 rate_limited — never a 500
  it('a locked kiosk (too many failed PINs) answers 429 rate_limited without touching the clock', async () => {
    const lockedLimiter = { count: async () => ({ count: 10, oldestMs: Date.now() }), record: async () => undefined };
    const pinSvc = new TechnicianClockPinService(new InMemoryClockPinRepository(), lockedLimiter as any);
    const clockRepo = new InMemoryTimeClockRepository([{ technicianId: TECH, technicianName: 'Ava Chen' }]);
    const svc = new GoCheckInService(sessionRepo(), undefined, undefined, undefined, pinSvc, new TimeClockService(clockRepo));
    await expect(svc.technicianClockIn('s1', TOKEN, PIN)).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    expect(clockRepo.allPunches()).toHaveLength(0);
  });

  it('clocks out after a clock-in', async () => {
    const svc = await build();
    await svc.technicianClockIn('s1', TOKEN, PIN);
    const co = await svc.technicianClockOut('s1', TOKEN, PIN);
    expect(co.ok).toBe(true);
    expect(co.action).toBe('clock_in');
  });

  it('refuses a clock-out when not clocked in', async () => {
    const svc = await build();
    await expect(svc.technicianClockOut('s1', TOKEN, PIN)).rejects.toThrow(/not clocked in/i);
  });

  it('blocks clock-out while the technician is on an active service, with a clear reason', async () => {
    const svc = await build(TENANT, true);   // device reports the tech is mid-service
    await svc.technicianClockIn('s1', TOKEN, PIN);
    await expect(svc.technicianClockOut('s1', TOKEN, PIN)).rejects.toMatchObject({ code: 'active_service' });
  });

  it('allows clock-out once no active service remains', async () => {
    const svc = await build(TENANT, false);
    await svc.technicianClockIn('s1', TOKEN, PIN);
    const co = await svc.technicianClockOut('s1', TOKEN, PIN);
    expect(co.ok).toBe(true);
  });

  it('is tenant-isolated: a PIN from tenant-A is not recognised on a tenant-B device', async () => {
    const svc = await build('tenant-B');   // session resolves to a different tenant than where the PIN lives
    await expect(svc.technicianIdentify('s1', TOKEN, PIN)).rejects.toMatchObject({ code: 'pin_not_recognised' });
  });

  it('includes the real profile avatar on identify when the roster is available', async () => {
    const pinRepo = new InMemoryClockPinRepository();
    const pinSvc = new TechnicianClockPinService(pinRepo);
    await pinSvc.setPin({ tenantId: TENANT, branchId: BRANCH }, TECH, PIN, 'mgr-1');
    const clockSvc = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: TECH, technicianName: 'Ava Chen' }]));
    const checkIn = { technicians: async () => [{ technicianId: TECH, displayName: 'Ava Chen', avatarUrl: 'https://cdn.example.com/ava.jpg' }] } as any;
    const svc = new GoCheckInService(sessionRepo(), checkIn, undefined, undefined, pinSvc, clockSvc);
    const r = await svc.technicianIdentify('s1', TOKEN, PIN);
    expect(r.avatarUrl).toBe('https://cdn.example.com/ava.jpg');
    expect(r.technicianName).toBe('Ava Chen');
  });

  it('rejects a bad device-session token before any PIN work', async () => {
    const svc = await build();
    await expect(svc.technicianIdentify('s1', 'wrong-token', PIN)).rejects.toMatchObject({ code: 'bad_session_token' });
  });

  it('emits a time-clock update on clock-in so Staff on Duty refreshes live', async () => {
    const rt = { toTenant: vi.fn() };
    const pinSvc = new TechnicianClockPinService(new InMemoryClockPinRepository());
    await pinSvc.setPin({ tenantId: TENANT, branchId: BRANCH }, TECH, PIN, 'mgr-1');
    const clockSvc = new TimeClockService(new InMemoryTimeClockRepository([{ technicianId: TECH, technicianName: 'Ava Chen' }]), rt as any);
    const svc = new GoCheckInService(sessionRepo(), undefined, undefined, undefined, pinSvc, clockSvc);
    await svc.technicianClockIn('s1', TOKEN, PIN);
    expect(rt.toTenant).toHaveBeenCalled();
    const [, event] = rt.toTenant.mock.calls[0];
    expect(event).toBe('time_clock_updated');
  });
});
