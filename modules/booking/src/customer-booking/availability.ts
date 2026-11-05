// availability.ts — pure open-slot computation for customer self-booking. A slot is "available" iff at least one
// candidate technician has NO conflicting appointment for [start, start+duration), using the SAME primitive the
// booking path uses (detectTechnicianConflict over the date's existing appointments). Computing availability with the
// exact gate the booking uses guarantees the slot grid can never offer a time that then fails to book.
//
// Salon operating window comes from env (BOOKING_OPEN / BOOKING_CLOSE / BOOKING_SLOT_MINUTES) with a sensible default,
// because this schema has no business-hours/shift table yet. Technician shifts + blocked-times are NOT yet enforced by
// the booking path, so they are intentionally not applied here either (the grid mirrors what booking actually enforces).
import type { AvailabilitySlot, AvailabilityResult, AvailabilityWindow } from '@aipowersalon/api-contracts/customer';
export type { AvailabilitySlot, AvailabilityResult, AvailabilityWindow };   // owned by packages/api-contracts (Constitution 13 §13)
import { addMinutesToTime, detectTechnicianConflict, minutesOf } from '@aipowersalon/appointments';

export interface ExistingForConflict { appointmentId: string; technicianId: string; startTime: string; endTime: string; status: string }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function resolveWindow(env: Record<string, string | undefined> = process.env): AvailabilityWindow {
  const open = TIME_RE.test(env.BOOKING_OPEN || '') ? (env.BOOKING_OPEN as string) : '09:00';
  const close = TIME_RE.test(env.BOOKING_CLOSE || '') ? (env.BOOKING_CLOSE as string) : '19:00';
  const step = Number(env.BOOKING_SLOT_MINUTES) > 0 ? Number(env.BOOKING_SLOT_MINUTES) : 30;
  // Buffer between appointments — defaults to 5 to match the POS booking default (DEFAULT_BOOKING_SETTINGS.bufferMinutes),
  // so online/customer availability and voice availability offer the same gap the booking path enforces. Set
  // BOOKING_BUFFER_MINUTES=0 to restore the previous no-buffer behavior.
  const buffer = env.BOOKING_BUFFER_MINUTES != null && Number(env.BOOKING_BUFFER_MINUTES) >= 0 ? Number(env.BOOKING_BUFFER_MINUTES) : 5;
  return { open, close, stepMinutes: step, bufferMinutes: buffer };
}

/** Compute candidate slots in [open, close) at `stepMinutes`, marking each available if ≥1 technician is free for the
 *  full service duration. `technicianIds[]` on a slot are the technicians free at that start (first one is bookable). */
export function computeAvailableSlots(window: AvailabilityWindow, durationMinutes: number, technicianIds: string[], existing: ExistingForConflict[]): AvailabilitySlot[] {
  const open = minutesOf(window.open);
  const close = minutesOf(window.close);
  const step = Math.max(5, Math.floor(window.stepMinutes) || 30);
  const dur = Math.max(1, Math.floor(durationMinutes) || 0);
  const buffer = Math.max(0, Math.floor(window.bufferMinutes) || 0);
  const slots: AvailabilitySlot[] = [];
  for (let m = open; m + dur <= close; m += step) {
    const startTime = addMinutesToTime('00:00', m);
    const endTime = addMinutesToTime('00:00', m + dur);
    const free = technicianIds.filter((t) => detectTechnicianConflict(existing as any, t, startTime, endTime, buffer).status === 'none');
    slots.push({ startTime, available: free.length > 0, technicianIds: free });
  }
  return slots;
}
