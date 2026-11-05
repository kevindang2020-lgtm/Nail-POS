// go-check-in-telemetry.vitest.spec.ts — Dual-Screen mandate §108: check-ins and check-in failures are counted at the
// public door (appointment "I'm Here" and walk-in), whatever the screen (a display or a kiosk).
import { describe, it, expect } from 'vitest';
import { customerDisplayEvents } from '@aipowersalon/observability';
import { GoCheckInPublicController } from './go-check-in.public.controller';
import { GoCheckInError } from './go-check-in.service';

const val = (event: string) => customerDisplayEvents.snapshot().find((e) => e.labels.event === event)?.value ?? 0;

describe('check-in counters (§108)', () => {
  it('a check-in counts once; a refused one counts as a failure and still answers its status', async () => {
    let fail = false;
    const svc: any = {
      checkInAppointment: async () => { if (fail) throw new GoCheckInError('We could not find that appointment for this salon.', 404, 'CHECKIN_APPOINTMENT_NOT_FOUND'); return { status: 'checked_in' }; },
      checkInWalkIn: async () => ({ status: 'checked_in' }),
    };
    const c = new GoCheckInPublicController(svc);
    const ok0 = val('check_in'); const f0 = val('check_in_failed');
    await c.apptCheckIn('s', { appointmentId: 'a' }, 't');
    await c.walkIn('s', { customerName: 'Ana' }, 't');
    fail = true;
    await expect(c.apptCheckIn('s', { appointmentId: 'a' }, 't')).rejects.toMatchObject({ status: 404 });
    expect(val('check_in') - ok0).toBe(2);
    expect(val('check_in_failed') - f0).toBe(1);
  });
});
