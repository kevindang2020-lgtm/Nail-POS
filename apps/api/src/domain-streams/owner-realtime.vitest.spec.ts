import { OwnerService, InMemoryOwnerRepository, type OwnerContext } from '@aipowersalon/analytics';
import { describe, it, expect } from 'vitest';
import { InProcessEmitter } from '../realtime/realtime.gateway';
import { rooms, screensToRefetch } from '@aipowersalon/realtime-contracts';
import { permissionsFor } from '@aipowersalon/permissions';
import { hashPassword } from '@aipowersalon/auth';

// A repo whose alert transitions succeed (so the service reaches the emit/audit step), reusing the empty in-memory port
// for everything else.
class AlertRepo extends InMemoryOwnerRepository {
  async updateAlertStatus(_ctx: OwnerContext, alertId: string, status: string) {
    return { id: alertId, branchId: null, category: 'general', severity: 'warning' as const, status: status as 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed', title: 'T', body: null, createdAt: new Date().toISOString(), resolvedAt: status === 'resolved' ? new Date().toISOString() : null };
  }
}

describe('owner realtime', () => {
  const T = 'tenant-1';
  const ctx: OwnerContext = { tenantId: T, userId: 'u1', role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  it('alert transitions emit owner_alert_updated to the tenant owner room', async () => {
    const bus = new InProcessEmitter();
    const svc = new OwnerService(new AlertRepo(), bus);
    const got: string[] = [];
    bus.subscribe(rooms.ownerTenant(T), (e) => got.push(e.event));
    await svc.resolveAlert(ctx, 'a1');
    await svc.acknowledgeAlert(ctx, 'a2');
    await svc.dismissAlert(ctx, 'a3');
    expect(got).toEqual(['owner_alert_updated', 'owner_alert_updated', 'owner_alert_updated']);
  });

  it('the owner event does not leak into another tenant\'s room', async () => {
    const bus = new InProcessEmitter();
    const svc = new OwnerService(new AlertRepo(), bus);
    const other: string[] = [];
    bus.subscribe(rooms.ownerTenant('tenant-2'), (e) => other.push(e.event));
    await svc.resolveAlert(ctx, 'a1');
    expect(other).toEqual([]);
  });

  it('owner_alert_updated routes the dashboard + alerts screens to refetch', () => {
    expect(screensToRefetch('owner_alert_updated')).toEqual(expect.arrayContaining(['dashboard', 'alerts']));
  });

  it('works with no emitter wired (DB-less / test mode) — no throw, no emit', async () => {
    const svc = new OwnerService(new AlertRepo()); // emitter omitted
    await expect(svc.resolveAlert(ctx, 'a1')).resolves.toBeTruthy();
  });
});

// A repo where any branch exists in the tenant and exposes a configurable switch-PIN hash, so we can exercise the
// multi-salon PIN gate on recordSelection (the POST /owner/context/select switch point).
class PinRepo extends InMemoryOwnerRepository {
  constructor(private readonly hash: string | null) { super(); }
  async validateBranch() { return true; }
  async branchSwitchPinHash() { return this.hash; }
}

describe('owner branch switch PIN gate', () => {
  const ctx: OwnerContext = { tenantId: 't', userId: 'u', role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };

  it('a salon with NO PIN configured switches without a PIN (back-compat)', async () => {
    const svc = new OwnerService(new PinRepo(null));
    await expect(svc.recordSelection({ ...ctx }, 'single', 'br1')).resolves.toEqual({ ok: true, mode: 'single', branchId: 'br1' });
  });

  it('a salon WITH a PIN rejects a switch with a missing or wrong PIN, and accepts the correct one', async () => {
    const hash = await hashPassword('430271');
    const svc = new OwnerService(new PinRepo(hash));
    await expect(svc.recordSelection({ ...ctx }, 'single', 'br1')).rejects.toThrow();
    await expect(svc.recordSelection({ ...ctx }, 'single', 'br1', '000000')).rejects.toThrow();
    await expect(svc.recordSelection({ ...ctx }, 'single', 'br1', '430271')).resolves.toEqual({ ok: true, mode: 'single', branchId: 'br1' });
  });

  it('the all-salons view is never PIN-gated', async () => {
    const hash = await hashPassword('430271');
    const svc = new OwnerService(new PinRepo(hash));
    await expect(svc.recordSelection({ ...ctx }, 'all')).resolves.toEqual({ ok: true, mode: 'all', branchId: null });
  });
});
