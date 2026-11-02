// voice-slot-conflict.vitest.spec.ts — a lost slot race is recognised by the booking error's TYPE/CODE, never its wording
// (Sep 30 2026: the §12 conflict sentence changed and the AI receptionist started calling a lost race a validation error).
import { describe, it, expect } from 'vitest';
import { isSlotConflict } from './voice-booking-write.service';

describe('isSlotConflict', () => {
  it('recognises booking conflicts by type or stable code, whatever the message says', () => {
    expect(isSlotConflict(Object.assign(new Error('Any wording at all'), { name: 'ConflictError' }))).toBe(true);
    expect(isSlotConflict({ code: 'APPOINTMENT_CONFLICT', message: 'x' })).toBe(true);
    expect(isSlotConflict({ code: 'VERSION_CONFLICT', message: 'x' })).toBe(true);
    expect(isSlotConflict({ code: 'OVERBOOK_CONFIRMATION_REQUIRED', message: 'x' })).toBe(true);   // a caller cannot authorise a double booking
    expect(isSlotConflict(new Error('This time was just booked or changed on another device. The schedule has been refreshed.'))).toBe(true);
  });
  it('does not mistake ordinary validation errors for a taken slot', () => {
    expect(isSlotConflict(new Error('A new start time is required'))).toBe(false);
    expect(isSlotConflict({ name: 'ValidationError', message: 'Phone is not valid' })).toBe(false);
    expect(isSlotConflict(undefined)).toBe(false);
  });
});
