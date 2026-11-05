// appointment-status.ts — the one list of appointment statuses (pos_tech_appointments.status) and the groups every
// module and app asks about. Functional Decision 38: SCHEDULED, CONFIRMED, ARRIVED, CHECKED_IN, WAITING, SERVING, DONE,
// CANCELED, NO_SHOW and LATE. Stored names: booked (= scheduled), confirmed, arrived, checked_in, waiting, in_service
// (= serving), completed (= done), cancelled, no_show.
//
// LATE is not stored. It is a fact of the clock — a booked/confirmed appointment whose start time has passed in the
// salon's time zone and whose customer has not arrived — so the server computes it on every read (pbLateness) and
// reports it as displayStatus 'late' with the minutes late. A stored LATE would need a sweeper to keep it true and
// would be wrong the moment that sweeper stopped; it would also hide the real status the next action depends on.
//
// Before Oct 1 2026 each of ~15 places kept its own copy of these lists, and 'arrived' existed only in types.
export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];
/** What a board / filter shows: the stored statuses plus the computed 'late'. */
export const APPOINTMENT_DISPLAY_STATUSES = [...APPOINTMENT_STATUSES, 'late'] as const;
export type AppointmentDisplayStatus = (typeof APPOINTMENT_DISPLAY_STATUSES)[number];

/** Booked or confirmed, customer not here yet — the only statuses that can be LATE, be confirmed or be marked arrived. */
export const AWAITING_ARRIVAL_STATUSES = ['booked', 'confirmed'] as const;
/** May be checked in (front desk, kiosk, customer app): not here yet, or here but not yet checked in. */
export const CHECK_IN_ELIGIBLE_STATUSES = ['booked', 'confirmed', 'arrived'] as const;
/** Still holds the technician's chair: blocks a double booking, counts as upcoming. */
export const CHAIR_HOLDING_STATUSES = ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service'] as const;

const has = (list: readonly string[], s: string | null | undefined) => list.includes(String(s ?? '').toLowerCase());
export const isAwaitingArrival = (s: string | null | undefined): boolean => has(AWAITING_ARRIVAL_STATUSES, s);
export const isCheckInEligible = (s: string | null | undefined): boolean => has(CHECK_IN_ELIGIBLE_STATUSES, s);
export const isChairHolding = (s: string | null | undefined): boolean => has(CHAIR_HOLDING_STATUSES, s);
