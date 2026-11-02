// ai-queue-assignment-appointment.ts — PURE appointment protection. Two concerns, both non-destructive:
//  1) Reservation: if assigning this walk-in to a tech would run into that tech's imminent CONFIRMED appointment,
//     the tech is reserved (a hard eligibility fail) so a walk-in can never bump a confirmed booking.
//  2) Late-arrival grace: classify an appointment customer's arrival vs. the tenant grace window. This only informs
//     staff — it NEVER auto-cancels a late customer (the spec is explicit about this).
export type ArrivalStatus = 'early' | 'on_time' | 'late_within_grace' | 'late_beyond_grace';

export const DEFAULT_RESERVATION_BUFFER_MIN = Number(process.env.QA_RESERVATION_BUFFER_MIN) || 10;

// Minutes from `now` until an ISO time (negative if already past). Null-safe.
export function minutesUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!isFinite(t)) return null;
  return Math.round((t - now) / 60000);
}

// Reserve the tech when the requested service would overlap their next confirmed appointment (start within
// serviceDuration + buffer). Unknown next appointment → never reserved.
export function reservationDecision(
  nextAppointmentInMinutes: number | null,
  serviceDurationMinutes: number,
  bufferMinutes: number = DEFAULT_RESERVATION_BUFFER_MIN,
): { reserved: boolean; reason: string | null } {
  if (nextAppointmentInMinutes == null || nextAppointmentInMinutes < 0) return { reserved: false, reason: null };
  if (nextAppointmentInMinutes < serviceDurationMinutes + bufferMinutes) {
    return { reserved: true, reason: `Reserved for a confirmed appointment in ~${nextAppointmentInMinutes} min` };
  }
  return { reserved: false, reason: null };
}

// Classify an appointment customer's arrival. Never cancels — staff decide. graceMinutes is tenant-configured.
export function arrivalStatus(scheduledInMinutes: number | null, graceMinutes: number): ArrivalStatus {
  if (scheduledInMinutes == null) return 'on_time';
  // scheduledInMinutes > 0 → appointment is still in the future (customer is early)
  if (scheduledInMinutes > 5) return 'early';
  if (scheduledInMinutes >= 0) return 'on_time';   // exactly on time, or still (barely) in the future
  const lateBy = -scheduledInMinutes;
  return lateBy <= graceMinutes ? 'late_within_grace' : 'late_beyond_grace';
}
