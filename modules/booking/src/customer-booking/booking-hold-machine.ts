// booking-hold-machine.ts — BUILD_PLAN Phase 12 (#27): booking_holds.status as ONE state machine. A hold is inserted 'held'
// (the other live words are the Phase 10 vocabulary's legacy values); it ends exactly once — released, converted into an
// appointment, or expired by the sweep. Every writer adds canMoveToSql(BOOKING_HOLD, to) to its existing
// released_at / converted_appointment_id guard, so an ended hold can never be moved again (a converted hold "released",
// an expired one "converted").
import { defineStateMachine } from '@aipowersalon/database';

const LIVE = ['held', 'active', 'pending', 'locked', 'sent', 'started'] as const;
const END = ['released', 'converted', 'expired'] as const;
export const BOOKING_HOLD = defineStateMachine({
  name: 'booking_hold', table: 'booking_holds', column: 'status',
  states: ['held', 'active', 'pending', 'locked', 'sent', 'started', 'released', 'converted', 'expired'],
  transitions: Object.fromEntries(LIVE.map((s) => [s, [...END]])) as any,
  initial: ['held'],
});

/** booking_verification_sessions.status — a booking's phone proof. pending → sent (a code went out; re-sending stays sent)
 *  → verified by the code, or locked (too many wrong codes), failed (the provider refused), expired (the clock). A staff
 *  override may verify a pending, sent or LOCKED session (never the code path). The same booking attempt re-opens a
 *  failed / expired / canceled session (back to pending for a new number, unchanged for the same number); a verified or
 *  locked one is never re-opened. Every writer carries canMoveToSql(BOOKING_VERIFICATION_SESSION, to) — or asserts the
 *  move on the row it locked — on top of its own narrower guard. */
export const BOOKING_VERIFICATION_SESSION = defineStateMachine({
  name: 'booking_verification_session', table: 'booking_verification_sessions', column: 'status',
  states: ['pending', 'sent', 'verified', 'locked', 'failed', 'expired', 'canceled'],
  transitions: {
    pending: ['pending', 'sent', 'verified', 'locked', 'failed', 'expired'],
    sent: ['pending', 'sent', 'verified', 'locked', 'failed', 'expired'],
    locked: ['verified'],
    failed: ['pending', 'failed'], expired: ['pending', 'expired'], canceled: ['pending', 'canceled'],
  },
  initial: ['pending'],
});
