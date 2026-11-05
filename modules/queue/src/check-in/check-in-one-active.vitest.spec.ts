// check-in-one-active.vitest.spec.ts — the sequential half of "one active check-in" (spec §21, §106): the in-memory
// repository has no database index, so it is the service's own pre-check that answers a second check-in. The
// concurrent half (ten kiosks at once) is check-in-concurrency.postgres-race on real Postgres.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckInRepository, type CheckInContext } from './check-in.repository';
import { CheckInService, ValidationError } from './check-in.service';

const owner = (): CheckInContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER',
  permissions: ['pos.check_in.walk_in', 'pos.check_in.appointment', 'pos.check_in.create_customer', 'pos.check_in.view'] } as any);

describe('one active check-in per customer / appointment', () => {
  it('a customer who is already in the queue cannot walk in again — a clear message, no second entry', async () => {
    const svc = new CheckInService(new InMemoryCheckInRepository());
    const first = await svc.walkIn(owner(), { customerName: 'Nova Pham', customerPhone: '+18565559901', isNewCustomer: true, serviceIds: ['svc_mani'] } as any);
    await expect(svc.walkIn(owner(), { customerId: first.customerId, customerName: 'Nova Pham', customerPhone: '+18565559901', serviceIds: ['svc_mani'] } as any))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(svc.walkIn(owner(), { customerId: first.customerId, customerName: 'Nova Pham', serviceIds: ['svc_mani'] } as any))
      .rejects.toThrow(/already checked in/i);
    // Dual-Screen §104: the refusal carries the standard code (the controller answers 409 CHECKIN_ALREADY_EXISTS)
    await expect(svc.walkIn(owner(), { customerId: first.customerId, customerName: 'Nova Pham', serviceIds: ['svc_mani'] } as any))
      .rejects.toMatchObject({ code: 'CHECKIN_ALREADY_EXISTS', status: 409 });
  });

  it('an appointment checked in on a SECOND kiosk (fresh service instance, empty in-process index) is idempotent', async () => {
    const repo = new InMemoryCheckInRepository();
    const kioskA = new CheckInService(repo), kioskB = new CheckInService(repo);
    const a = await kioskA.appointmentCheckIn(owner(), 'appt_5001');
    const b = await kioskB.appointmentCheckIn(owner(), 'appt_5001');   // B has never seen appt_5001 — the repository has
    expect(b.checkInId).toBe(a.checkInId);
    expect(await repo.activeCheckIn(owner(), { appointmentId: 'appt_5001' })).toEqual({ checkInId: a.checkInId });
  });
});
