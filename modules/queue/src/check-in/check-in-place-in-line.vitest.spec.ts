import { describe, it, expect } from 'vitest';
import { InMemoryCheckInRepository } from './check-in.repository';

// placeInLine ranks the branch's waiting guests (longest wait first, VIP ahead when enabled) and returns the
// checked-in guest's 1-based position — the real number behind the kiosk's "View My Place in Line".
const ctx = { tenantId: 'tenant-A', branchId: 'branch-1', userId: 'kiosk:1', role: 'KIOSK', permissions: [] } as any;
const rec = (id: string, minAgo: number, vip = false, status = 'checked_in') => ({
  checkInId: id, customerName: id, isVip: vip, appointmentId: null, source: 'walk_in', services: [],
  technicianId: null, technicianName: null, checkedInAtMs: Date.now() - minAgo * 60000, status, notes: '', updatedAt: new Date().toISOString(),
}) as any;

describe('CheckIn placeInLine (kiosk place-in-line)', () => {
  it('ranks by longest wait — the earliest check-in is #1', async () => {
    const repo = new InMemoryCheckInRepository();
    await repo.createRecord(ctx, rec('a', 30));
    await repo.createRecord(ctx, rec('b', 10));
    await repo.createRecord(ctx, rec('c', 5));
    expect((await repo.placeInLine(ctx, 'a'))?.position).toBe(1);
    expect((await repo.placeInLine(ctx, 'b'))?.position).toBe(2);
    expect(await repo.placeInLine(ctx, 'c')).toEqual({ position: 3, waitingAhead: 2 });
  });

  it('a VIP jumps ahead of longer-waiting normal guests', async () => {
    const repo = new InMemoryCheckInRepository();
    await repo.createRecord(ctx, rec('a', 30));
    await repo.createRecord(ctx, rec('vip', 2, true));
    expect((await repo.placeInLine(ctx, 'vip'))?.position).toBe(1);
    expect((await repo.placeInLine(ctx, 'a'))?.position).toBe(2);
  });

  it('returns null once the guest is no longer waiting, or is unknown', async () => {
    const repo = new InMemoryCheckInRepository();
    await repo.createRecord(ctx, rec('served', 5, false, 'serving'));
    expect(await repo.placeInLine(ctx, 'served')).toBeNull();
    expect(await repo.placeInLine(ctx, 'nope')).toBeNull();
  });

  it('is tenant-scoped — another tenant’s waiting guests never count', async () => {
    const repo = new InMemoryCheckInRepository();
    await repo.createRecord(ctx, rec('a', 30));
    await repo.createRecord({ ...ctx, tenantId: 'tenant-B' }, rec('older', 90));
    expect((await repo.placeInLine(ctx, 'a'))?.position).toBe(1);
  });
});
