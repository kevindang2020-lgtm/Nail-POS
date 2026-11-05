// front-desk-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the three front-desk lifecycles as state machines — the
// appointment, the queue item and the technician-queue ticket. They live here (appointments) because every module that
// writes them (appointments, booking, queue) already depends on this one; ONE transition table per lifecycle.
//
// How they were derived (Phase 12 round 2): from every code path that writes the column today (the Booking board, the
// Technician Appointments screen, Check-In, the Queue, the Tech Queue, Serving, Service Done, the Technician app, the
// sweeps) and the Phase 10 CHECK vocabularies. The rule each table keeps: the ACTIVE states move freely between each other
// (the cascades between the three screens re-derive one status from another, in both directions, as they always have);
// a FINISHED row (completed / service done) only re-opens into service (the reopen-service flow) or repeats itself; a
// CANCELLED / NO-SHOW / REMOVED / DECLINED / EXPIRED row is never revived into the flow — except the two revivals the
// product has always had on purpose: a cancelled or no-show appointment rescheduled back to booked, and an expired offer
// re-assigned or started by the desk.
//
// The dangerous moves today's unconditional writes allowed, now refused (a set-based cascade simply skips the row; a
// direct action answers 409 INVALID_STATE_TRANSITION):
//   • cancelling or no-showing a COMPLETED appointment / queue item (the cascade also cancelled the paid ticket);
//   • a check-in / queue / serving cascade flipping a cancelled or no-show appointment back to checked_in / in_service;
//   • completing (service done) a cancelled / declined / expired / no-show technician ticket;
//   • reporting a delay on, or declining, a ticket that is no longer pending / in the flow.
import { defineStateMachine } from '@aipowersalon/database';

/** pos_tech_appointments.status */
export const APPOINTMENT = defineStateMachine({
  name: 'appointment', table: 'pos_tech_appointments', column: 'status',
  states: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
  transitions: {
    booked: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    confirmed: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    arrived: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    checked_in: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    waiting: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    in_service: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
    completed: ['completed', 'in_service'],
    cancelled: ['cancelled', 'booked'],
    no_show: ['no_show', 'booked', 'cancelled'],
  },
  initial: ['booked', 'confirmed', 'checked_in', 'in_service', 'waiting'],
});

const Q_ACTIVE = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service'] as const;
const Q_FROM_ACTIVE = [...Q_ACTIVE, 'completed', 'done', 'cancelled', 'removed'] as const;
/** pos_queue_items.status */
export const QUEUE_ITEM = defineStateMachine({
  name: 'queue_item', table: 'pos_queue_items', column: 'status',
  states: ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service', 'completed', 'done', 'cancelled', 'removed'],
  transitions: {
    waiting: Q_FROM_ACTIVE, called: Q_FROM_ACTIVE, assigned: Q_FROM_ACTIVE, ready_for_tech: Q_FROM_ACTIVE,
    moved_to_tech_queue: Q_FROM_ACTIVE, in_service: Q_FROM_ACTIVE,
    completed: ['completed', 'done', 'in_service', 'removed'],
    done: ['done', 'completed', 'in_service', 'removed'],
    cancelled: ['cancelled', 'removed'],
    removed: ['removed', 'cancelled'],
  },
  initial: ['waiting', 'assigned', 'in_service', 'moved_to_tech_queue'],
});

/** pos_tech_queue_tickets.status */
export const TECH_QUEUE_TICKET = defineStateMachine({
  name: 'tech_queue_ticket', table: 'pos_tech_queue_tickets', column: 'status',
  states: ['waiting_for_acceptance', 'assigned', 'accepted', 'ready_to_start', 'delayed', 'paused', 'in_service', 'service_done', 'declined', 'expired', 'cancelled', 'no_show'],
  transitions: {
    // a pending offer: accepted / declined / expired by the sweep / re-assigned / started by the desk / delayed
    waiting_for_acceptance: ['waiting_for_acceptance', 'assigned', 'accepted', 'ready_to_start', 'delayed', 'in_service', 'service_done', 'declined', 'expired', 'cancelled', 'no_show'],
    assigned: ['waiting_for_acceptance', 'assigned', 'accepted', 'ready_to_start', 'delayed', 'in_service', 'service_done', 'declined', 'expired', 'cancelled', 'no_show'],
    // accepted, not started
    accepted: ['assigned', 'accepted', 'ready_to_start', 'delayed', 'in_service', 'service_done', 'declined', 'cancelled', 'no_show'],
    ready_to_start: ['assigned', 'accepted', 'ready_to_start', 'delayed', 'in_service', 'service_done', 'declined', 'cancelled', 'no_show'],
    delayed: ['assigned', 'accepted', 'delayed', 'in_service', 'service_done', 'declined', 'cancelled', 'no_show'],
    // in the chair
    in_service: ['assigned', 'in_service', 'paused', 'delayed', 'service_done', 'cancelled', 'no_show'],
    paused: ['assigned', 'paused', 'in_service', 'delayed', 'service_done', 'cancelled', 'no_show'],
    // finished: repeats itself, or re-opens into service
    service_done: ['service_done', 'in_service'],
    // the desk re-assigns or starts an expired offer; a declined one is cancelled (re-assigning keeps it declined)
    expired: ['expired', 'assigned', 'in_service', 'cancelled'],
    declined: ['declined', 'cancelled'],
    cancelled: ['cancelled'],
    no_show: ['no_show', 'cancelled'],
  },
  initial: ['waiting_for_acceptance', 'assigned', 'accepted', 'in_service'],
});
