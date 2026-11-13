/**
 * Realtime contract (spec §25). After merge the host wraps its existing
 * SSE/WebSocket infrastructure in a `RealtimeClient`; the board only ever
 * sees these typed events and recalculates the affected technician slices.
 */
import type { Appointment, ID, ISODate, ScheduleSegment, Unsubscribe } from '../domain/scheduleTypes';

export type ScheduleEvent =
  | { type: 'appointment.created'; appointment: Appointment }
  | { type: 'appointment.moved'; appointment: Appointment; previousTechnicianId: ID; previousStartAt: string }
  | { type: 'appointment.cancelled'; appointmentId: ID; technicianId: ID }
  | { type: 'appointment.reassigned'; appointment: Appointment; previousTechnicianId: ID }
  | { type: 'walkin.created'; appointment: Appointment }
  | { type: 'appointment.checked_in'; appointment: Appointment }
  | { type: 'service.started'; appointment: Appointment }
  | { type: 'service.completed'; appointment: Appointment }
  | { type: 'blocked_time.created'; segment: ScheduleSegment }
  | { type: 'blocked_time.changed'; segment: ScheduleSegment }
  | { type: 'blocked_time.removed'; segmentId: ID; technicianId: ID }
  | { type: 'technician.schedule_changed'; technicianId: ID; segments: ScheduleSegment[] }
  /** Host-side "silent safety synchronization" fallback: reload the whole range. */
  | { type: 'schedule.resync' };

export interface ScheduleEventEnvelope {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  /** Monotonic per-branch sequence from the authoritative backend. */
  serverVersion: number;
  at: string;
  event: ScheduleEvent;
}

export interface ScheduleSubscription {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
}

export interface RealtimeClient {
  subscribe(sub: ScheduleSubscription, handler: (e: ScheduleEventEnvelope) => void): Unsubscribe;
}

/** Technicians whose slices an event touches (spec §25 "recalculate only affected"). */
export function affectedTechnicians(e: ScheduleEvent): ID[] | 'all' {
  switch (e.type) {
    case 'appointment.created':
    case 'walkin.created':
    case 'appointment.checked_in':
    case 'service.started':
    case 'service.completed':
      return [e.appointment.technicianId];
    case 'appointment.moved':
    case 'appointment.reassigned':
      return [...new Set([e.appointment.technicianId, e.previousTechnicianId])];
    case 'appointment.cancelled':
    case 'blocked_time.removed':
    case 'technician.schedule_changed':
      return [e.technicianId];
    case 'blocked_time.created':
    case 'blocked_time.changed':
      return [e.segment.technicianId];
    case 'schedule.resync':
      return 'all';
  }
}

/** Simple in-process event bus used by the mock adapter and the demo host. */
export class LocalRealtimeBus implements RealtimeClient {
  private handlers = new Set<{ sub: ScheduleSubscription; fn: (e: ScheduleEventEnvelope) => void }>();

  subscribe(sub: ScheduleSubscription, fn: (e: ScheduleEventEnvelope) => void): Unsubscribe {
    const entry = { sub, fn };
    this.handlers.add(entry);
    return () => this.handlers.delete(entry);
  }

  publish(envelope: ScheduleEventEnvelope): void {
    for (const h of this.handlers) {
      if (h.sub.tenantId !== envelope.tenantId || h.sub.branchId !== envelope.branchId) continue;
      if (h.sub.date !== envelope.date) continue;
      h.fn(envelope);
    }
  }

  get subscriberCount(): number {
    return this.handlers.size;
  }
}
