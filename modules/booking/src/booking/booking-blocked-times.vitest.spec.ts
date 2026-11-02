import { describe, it, expect } from 'vitest';
import { InMemoryBookingRepository, type BookingContext } from './booking.repository';
import { BookingService, ForbiddenError, ValidationError, ConflictError } from './booking.service';

// §9 blocked-time write path: permission-gated, validated, overlap-checked (manager override allowed), audited,
// and immediately reflected in dayGrid windows/openRanges. Runs against the in-memory repo (same decision surface
// as Postgres; the SQL adapter is exercised by the live-arc probes).
// Merge Oct 12 2026 (R1): managerOverride is honoured only with pos.booking.override_conflict — the owner fixture holds it explicitly.
const owner: BookingContext = { tenantId: 'luxe001', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['pos.booking.view', 'pos.booking.edit', 'pos.booking.override_conflict'] };
const viewer: BookingContext = { tenantId: 'luxe001', branchId: '', userId: 'u2', role: 'TECHNICIAN', permissions: ['pos.booking.view'] };

const svc = () => new BookingService(new InMemoryBookingRepository());

describe('addBlockedTime', () => {
  it('creates a block and it appears in dayGrid blocked + carves the windows/openRanges', async () => {
    const s = svc();
    const techId = (await s.dayGrid(owner)).columns[0].technicianId;
    const before = (await s.dayGrid(owner)).columns.find((c: any) => c.technicianId === techId)!;
    const res = await s.addBlockedTime(owner, { technicianId: techId, startTime: '14:00', endTime: '15:00', reason: 'training' });
    expect(res.blockId).toBeTruthy();
    const after = (await s.dayGrid(owner)).columns.find((c: any) => c.technicianId === techId)!;
    expect(after.blocked.some((b: any) => b.startTime === '14:00' && b.endTime === '15:00' && b.blockId === res.blockId)).toBe(true);
    expect(after.openMinutes).toBeLessThan(before.openMinutes);
    // the 14:00–15:00 hour is no longer inside any window
    expect(after.windows.some((w: any) => w.start <= 14 * 60 && w.end >= 15 * 60)).toBe(false);
  });

  it('rejects a window that overlaps a blocking appointment; managerOverride allows it (audited)', async () => {
    const s = svc();
    const grid = await s.dayGrid(owner);
    const appt = grid.appointments.find((a: any) => a.technicianId && ['booked', 'confirmed', 'checked_in', 'in_service', 'waiting'].includes(a.status));
    expect(appt).toBeTruthy();
    const body = { technicianId: appt!.technicianId!, startTime: appt!.startTime.slice(0, 5), endTime: appt!.endTime.slice(0, 5) };
    await expect(s.addBlockedTime(owner, body)).rejects.toBeInstanceOf(ConflictError);
    const ok = await s.addBlockedTime(owner, { ...body, managerOverride: true, reason: 'left early' });
    expect(ok.blockId).toBeTruthy();
    const audit = s.auditLog().find((e) => e.actionType === 'pos_booking_block_time_added' && e.entityId === ok.blockId);
    expect(audit?.metadata?.managerOverride).toBe(true);
    // R1 (merge Oct 12 2026): without pos.booking.override_conflict the override request is refused — not silently downgraded
    const noRight: BookingContext = { ...owner, permissions: ['pos.booking.view', 'pos.booking.edit'] };
    await expect(svc().addBlockedTime(noRight, { ...body, managerOverride: true, reason: 'left early' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('validates inputs: bad time format, inverted range, unknown technician', async () => {
    const s = svc();
    const techId = (await s.dayGrid(owner)).columns[0].technicianId;
    await expect(s.addBlockedTime(owner, { technicianId: techId, startTime: '9am', endTime: '10:00' })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.addBlockedTime(owner, { technicianId: techId, startTime: '15:00', endTime: '14:00' })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.addBlockedTime(owner, { technicianId: 'nope', startTime: '14:00', endTime: '15:00' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires pos.booking.edit — a view-only role is refused', async () => {
    const s = svc();
    const techId = (await s.dayGrid(owner)).columns[0].technicianId;
    await expect(s.addBlockedTime(viewer, { technicianId: techId, startTime: '14:00', endTime: '15:00' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('removeBlockedTime', () => {
  it('removes an existing block (audited) and restores the window', async () => {
    const s = svc();
    const techId = (await s.dayGrid(owner)).columns[0].technicianId;
    const open0 = (await s.dayGrid(owner)).columns.find((c: any) => c.technicianId === techId)!.openMinutes;
    const { blockId } = await s.addBlockedTime(owner, { technicianId: techId, startTime: '14:00', endTime: '15:00' });
    await s.removeBlockedTime(owner, blockId);
    const grid = await s.dayGrid(owner);
    const col = grid.columns.find((c: any) => c.technicianId === techId)!;
    expect(col.blocked.some((b: any) => b.blockId === blockId)).toBe(false);
    expect(col.openMinutes).toBe(open0);
    expect(s.auditLog().some((e) => e.actionType === 'pos_booking_block_time_removed' && e.entityId === blockId)).toBe(true);
  });

  it('unknown id → ValidationError; cross-tenant id is invisible (tenant-scoped delete)', async () => {
    const s = svc();
    await expect(s.removeBlockedTime(owner, 'blk_missing')).rejects.toBeInstanceOf(ValidationError);
    const techId = (await s.dayGrid(owner)).columns[0].technicianId;
    const { blockId } = await s.addBlockedTime(owner, { technicianId: techId, startTime: '14:00', endTime: '15:00' });
    const otherTenant: BookingContext = { ...owner, tenantId: 'other01' };
    await expect(s.removeBlockedTime(otherTenant, blockId)).rejects.toBeInstanceOf(ValidationError);
    // still present for the owning tenant
    const col = (await s.dayGrid(owner)).columns.find((c: any) => c.technicianId === techId)!;
    expect(col.blocked.some((b: any) => b.blockId === blockId)).toBe(true);
  });
});
