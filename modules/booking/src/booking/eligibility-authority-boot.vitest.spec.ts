// Remaining Production §23 (Oct 28 2026 audit): "one authority" at boot. Booking, customer booking, check-in, Go check-in and
// the Tech Queue took the exact-service authority as optional and silently fell back to the category rule when it was
// missing — only QueueModule refused. Every one of them now refuses to boot with a database and no authority.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertEligibilityAuthorityBound } from './technician-skills.port';

describe('assertEligibilityAuthorityBound', () => {
  it('a database without the authority refuses to boot, naming the module', () => {
    expect(() => assertEligibilityAuthorityBound('BookingModule', true, null)).toThrow(/BookingModule: the technician eligibility authority/);
  });
  it('a database with the authority, or no database (dev / unit tests on the in-memory rule), boots', () => {
    expect(() => assertEligibilityAuthorityBound('BookingModule', true, {})).not.toThrow();
    expect(() => assertEligibilityAuthorityBound('BookingModule', false, null)).not.toThrow();
  });
  it('every module that takes the authority calls the check in its factory', () => {
    const root = new URL('../../../../', import.meta.url);
    const files: Array<[string, string]> = [
      ['modules/booking/src/booking/booking.module.ts', 'BookingModule'],
      ['modules/booking/src/customer-booking/customer-booking.module.ts', 'CustomerBookingModule'],
      ['modules/queue/src/check-in/check-in.module.ts', 'CheckInModule'],
      ['modules/queue/src/go-check-in/go-check-in.module.ts', 'GoCheckInModule'],
      ['modules/queue/src/tech-queue/tech-queue.module.ts', 'TechQueueModule'],
    ];
    const missing = files.filter(([f, name]) => !readFileSync(new URL(f, root), 'utf8').includes(`assertEligibilityAuthorityBound('${name}'`));
    expect(missing).toEqual([]);
  });
});
