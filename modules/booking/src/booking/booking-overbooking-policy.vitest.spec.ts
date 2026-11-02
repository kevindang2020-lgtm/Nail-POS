// booking-overbooking-policy.vitest.spec.ts — Smooth Refresh / Booking Concurrency spec §11 (overbookingPolicy BLOCK /
// WARN_REQUIRE_CONFIRMATION / ALLOW_AUTHORIZED_ROLE, default BLOCK; intentional double booking = permission +
// confirmation + reason + audit), §12/§14 (stable 409 codes), §69 (an add-on that lengthens a visit is re-validated).
// Service-level rules on the in-memory twin; true concurrency is proven on real Postgres in
// booking-concurrency.postgres-race.vitest.spec.ts.
import { describe, expect, it } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import { DEFAULT_BOOKING_SETTINGS, type OverbookingPolicy } from './booking.dto';
import { BookingService, ConflictError } from './booking.service';

class PolicyRepo extends InMemoryBookingRepository {
  constructor(private readonly policy: OverbookingPolicy) { super(); }
  async settings() { return { ...DEFAULT_BOOKING_SETTINGS, overbookingPolicy: this.policy, bufferMinutes: 0, openTime: '08:00', closeTime: '21:00' }; }
}

const PERMS = ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule', 'pos.booking.assign_technician'];
const frontDesk = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_fd', role: 'FRONT_DESK', permissions: PERMS } as any;
const manager = { ...frontDesk, userId: 'u_mgr', role: 'MANAGER', permissions: [...PERMS, 'booking.override'] } as any;
const DATE = '2026-06-08';
const at = (startTime: string, name = 'Ava') => ({ customerName: name, serviceIds: ['svc_mani'], date: DATE, startTime, technicianId: 'tech_mia', source: 'manual' as const });

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof ConflictError ? e.code : `other:${(e as Error).message}`; }
}

describe('§11 overbookingPolicy', () => {
  it('default is BLOCK — even a manager with a reason cannot double-book', async () => {
    expect(DEFAULT_BOOKING_SETTINGS.overbookingPolicy).toBe('BLOCK');
    const svc = new BookingService(new PolicyRepo('BLOCK'));
    await svc.create(manager, at('10:00'));
    expect(await codeOf(svc.create(manager, { ...at('10:00', 'Bea'), overbookConfirmed: true, overbookReason: 'VIP' } as any))).toBe('APPOINTMENT_CONFLICT');
  });

  it('WARN_REQUIRE_CONFIRMATION: refused until the booker confirms WITH a reason; then created, flagged and audited', async () => {
    const svc = new BookingService(new PolicyRepo('WARN_REQUIRE_CONFIRMATION'));
    await svc.create(frontDesk, at('10:00'));
    expect(await codeOf(svc.create(frontDesk, at('10:00', 'Bea')))).toBe('OVERBOOK_CONFIRMATION_REQUIRED');
    expect(await codeOf(svc.create(frontDesk, { ...at('10:00', 'Bea'), overbookConfirmed: true } as any))).toBe('OVERBOOK_CONFIRMATION_REQUIRED');   // no reason
    const row = await svc.create(frontDesk, { ...at('10:00', 'Bea'), overbookConfirmed: true, overbookReason: 'Regular asked to squeeze in' } as any);
    expect(row.appointmentId).toBeTruthy();
    const audit = (svc as any).audit as { actionType: string; metadata?: any }[];
    expect(audit.some((a) => a.actionType === 'pos_booking_conflict_override' && a.metadata?.reason === 'Regular asked to squeeze in')).toBe(true);
  });

  it('ALLOW_AUTHORIZED_ROLE: front desk is refused outright; a manager (booking.override) may, with confirmation + reason', async () => {
    const svc = new BookingService(new PolicyRepo('ALLOW_AUTHORIZED_ROLE'));
    await svc.create(frontDesk, at('10:00'));
    expect(await codeOf(svc.create(frontDesk, { ...at('10:00', 'Bea'), overbookConfirmed: true, overbookReason: 'please' } as any))).toBe('APPOINTMENT_CONFLICT');
    expect(await codeOf(svc.create(manager, at('10:00', 'Bea')))).toBe('OVERBOOK_CONFIRMATION_REQUIRED');
    const ok = await svc.create(manager, { ...at('10:00', 'Bea'), overbookConfirmed: true, overbookReason: 'Owner approved' } as any);
    expect(ok.appointmentId).toBeTruthy();
  });

  it('the same policy governs ASSIGN onto a busy technician (merge Oct 12 2026): BLOCK refuses; WARN needs confirmation + reason and writes the row FLAGGED', async () => {
    const block = new BookingService(new PolicyRepo('BLOCK'));
    await block.create(frontDesk, at('10:00'));
    const other = await block.create(frontDesk, { ...at('10:00', 'Bea'), technicianId: 'tech_ava' });
    expect(await codeOf(block.assignTechnician(manager, other.appointmentId, { technicianId: 'tech_mia', managerOverride: true, overbookReason: 'x' }))).toBe('APPOINTMENT_CONFLICT');
    expect((await block.detail(frontDesk, other.appointmentId)).technicianId).toBe('tech_ava');   // nothing moved
    const warn = new BookingService(new PolicyRepo('WARN_REQUIRE_CONFIRMATION'));
    await warn.create(frontDesk, at('10:00'));
    const b = await warn.create(frontDesk, { ...at('10:00', 'Bea'), technicianId: 'tech_ava' });
    expect(await codeOf(warn.assignTechnician(frontDesk, b.appointmentId, { technicianId: 'tech_mia' }))).toBe('OVERBOOK_CONFIRMATION_REQUIRED');
    const flagged = await warn.assignTechnician(frontDesk, b.appointmentId, { technicianId: 'tech_mia', overbookConfirmed: true, overbookReason: 'VIP asked for Mia' });
    expect(flagged.technicianId).toBe('tech_mia'); expect(flagged.overbooked).toBe(true);
    expect(warn.auditLog().some((l) => l.actionType === 'pos_booking_conflict_override' && l.metadata?.reason === 'VIP asked for Mia')).toBe(true);
  });
  it('the same policy governs RESCHEDULE onto an occupied slot', async () => {
    const svc = new BookingService(new PolicyRepo('BLOCK'));
    await svc.create(frontDesk, at('10:00'));
    const b = await svc.create(frontDesk, at('14:00', 'Bea'));
    expect(await codeOf(svc.reschedule(frontDesk, b.appointmentId, { startTime: '10:00', notifyCustomer: false }))).toBe('APPOINTMENT_CONFLICT');
    expect((await svc.detail(frontDesk, b.appointmentId)).startTime).toBe('14:00');   // nothing moved
  });
});

describe('§14–§16 version on the service path', () => {
  it('a stale expectedVersion → VERSION_CONFLICT carrying the current version; the newer change survives', async () => {
    const svc = new BookingService(new PolicyRepo('BLOCK'));
    const a = await svc.create(frontDesk, at('10:00'));
    expect(a.version).toBe(1);
    const moved = await svc.reschedule(frontDesk, a.appointmentId, { startTime: '11:00', expectedVersion: 1, notifyCustomer: false });
    expect(moved.version).toBe(2);
    let err: unknown = null;
    try { await svc.reschedule(frontDesk, a.appointmentId, { startTime: '12:00', expectedVersion: 1, notifyCustomer: false }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe('VERSION_CONFLICT');
    expect((err as ConflictError).currentVersion).toBe(2);
    expect((await svc.detail(frontDesk, a.appointmentId)).startTime).toBe('11:00');
  });

  it('an edit with a stale version is refused the same way (no blind last-write-wins on notes/customer fields)', async () => {
    const svc = new BookingService(new PolicyRepo('BLOCK'));
    const a = await svc.create(frontDesk, at('10:00'));
    await svc.update(frontDesk, a.appointmentId, { notes: 'first', expectedVersion: 1 });
    expect(await codeOf(svc.update(frontDesk, a.appointmentId, { notes: 'stale copy', expectedVersion: 1 }))).toBe('VERSION_CONFLICT');
    expect((await svc.detail(frontDesk, a.appointmentId)).notes).toBe('first');
  });
});

describe('§69 add-on duration re-validation', () => {
  it('adding a service that runs into the next appointment is refused before anything is saved', async () => {
    const svc = new BookingService(new PolicyRepo('BLOCK'));
    const a = await svc.create(frontDesk, at('10:00'));                 // 10:00–10:45 (Signature Manicure 45 min)
    await svc.create(frontDesk, at('10:45', 'Bea'));                     // back-to-back, fine
    const before = await svc.detail(frontDesk, a.appointmentId);
    expect(await codeOf(svc.update(frontDesk, a.appointmentId, { serviceIds: ['svc_mani', 'svc_mani'] }))).toBe('APPOINTMENT_CONFLICT');
    const after = await svc.detail(frontDesk, a.appointmentId);
    expect(after.endTime).toBe(before.endTime);
    expect(after.services.length).toBe(before.services.length);
  });
});
