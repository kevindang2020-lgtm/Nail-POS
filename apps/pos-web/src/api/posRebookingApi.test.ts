// posRebookingApi — the Rebooking → Booking Assistant prefill is one-use, short-lived and carries only the permitted context.
import { describe, it, expect, beforeEach } from 'vitest';
import { storeBookingHandoff, takeBookingHandoff, BOOKING_HANDOFF_KEY, type BookingHandoff } from './posRebookingApi';

const H: BookingHandoff = { source: 'rebooking', customerId: 'c1', customerName: 'Dee Due', customerPhone: null, serviceId: 's1', technicianId: null, technicianName: null, date: '2026-11-02', preparedAt: '2026-11-02T15:00:00Z' };
beforeEach(() => sessionStorage.clear());

describe('booking handoff', () => {
  it('is read once', () => {
    storeBookingHandoff(H);
    expect(takeBookingHandoff(Date.parse('2026-11-02T15:01:00Z'))).toEqual(H);
    expect(takeBookingHandoff(Date.parse('2026-11-02T15:01:00Z'))).toBeNull();
  });
  it('expires after 10 minutes, and is removed even then', () => {
    storeBookingHandoff(H);
    expect(takeBookingHandoff(Date.parse('2026-11-02T15:11:00Z'))).toBeNull();
    expect(sessionStorage.getItem(BOOKING_HANDOFF_KEY)).toBeNull();
  });
  it('ignores anything that did not come from Rebooking or is malformed', () => {
    sessionStorage.setItem(BOOKING_HANDOFF_KEY, JSON.stringify({ ...H, source: 'other' }));
    expect(takeBookingHandoff(Date.parse('2026-11-02T15:01:00Z'))).toBeNull();
    sessionStorage.setItem(BOOKING_HANDOFF_KEY, '{oops');
    expect(takeBookingHandoff()).toBeNull();
  });
});
