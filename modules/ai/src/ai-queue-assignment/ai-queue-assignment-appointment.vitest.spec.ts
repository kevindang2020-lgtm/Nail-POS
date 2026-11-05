// ai-queue-assignment-appointment.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { reservationDecision, arrivalStatus, minutesUntil } from './ai-queue-assignment-appointment';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { InMemoryQueueDataAdapter, InMemoryAppointmentAdapter } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const ctx = (t = 'A'): QueueAssignmentContext => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai_queue_assignment.view', 'ai_queue_assignment.recommend'] });

describe('reservationDecision', () => {
  it('reserves when the service would run into the next appointment (start < duration + buffer)', () => {
    expect(reservationDecision(20, 30, 10).reserved).toBe(true);   // 20 < 30+10
    expect(reservationDecision(45, 30, 10).reserved).toBe(false);  // 45 >= 40
  });
  it('never reserves on unknown/past appointment', () => {
    expect(reservationDecision(null, 30, 10).reserved).toBe(false);
    expect(reservationDecision(-5, 30, 10).reserved).toBe(false);
  });
});

describe('arrivalStatus — never cancels, only classifies', () => {
  it('classifies early / on_time / within grace / beyond grace', () => {
    expect(arrivalStatus(15, 10)).toBe('early');
    expect(arrivalStatus(0, 10)).toBe('on_time');
    expect(arrivalStatus(-8, 10)).toBe('late_within_grace');
    expect(arrivalStatus(-20, 10)).toBe('late_beyond_grace');
  });
});

describe('minutesUntil', () => {
  it('computes forward minutes and is null-safe', () => {
    const now = Date.parse('2026-07-08T12:00:00Z');
    expect(minutesUntil('2026-07-08T12:30:00Z', now)).toBe(30);
    expect(minutesUntil(null, now)).toBeNull();
  });
});

describe('service — appointment protection', () => {
  function make(nextApptMin: number | null) {
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: {
      entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null },
      candidates: [
        { technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false },
        { technicianId: 't2', name: 'Lee', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false },
      ],
    } });
    const appts = new InMemoryAppointmentAdapter({ t1: { technicianId: 't1', nextAppointmentInMinutes: nextApptMin, appointmentId: 'appt1' } });
    return new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), undefined, { appointments: appts });
  }

  it('reserves t1 (hard fail) when a walk-in would run into t1\'s imminent appointment → recommends t2', async () => {
    const svc = make(20); // t1 has an appointment in 20 min; 30-min service overlaps → reserved
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.alternates.find((a) => a.technicianId === 't1')).toBeUndefined(); // t1 excluded as reserved
  });

  it('near-but-non-overlapping appointment → t1 eligible but carries a soft warning', async () => {
    const svc = make(40); // 40 >= 30+10 → not reserved; but <=45 → engine soft warning
    const env = await svc.recommend(ctx(), 'q1');
    const t1 = [env.recommended, ...env.alternates].find((c) => c?.technicianId === 't1');
    expect(t1).toBeTruthy();                            // still eligible
    expect(t1?.warnings.join(' ')).toMatch(/appointment/i); // warned
  });
});

// BUILD_PLAN Phase 6, audit bug 2: the adapter Date.parse'd the bare 'HH:MM' start → NaN → every appointment skipped, so
// appointment protection never fired in production. The appointments domain now resolves each start in the BRANCH zone
// (`startAt`, Agent A); the adapter reads it.
import { upcomingFromAppointments } from './ai-queue-assignment.adapters';

describe('appointment start time — the appointments domain\'s startAt (bug 2)', () => {
  it('the adapter finds the next confirmed appointment from startAt; past, cancelled and startAt-less items are no signal', () => {
    const now = Date.parse('2026-10-07T18:00:00.000Z');
    const items = [
      { appointmentId: 'a1', technicianId: 't1', startTime: '14:20', startAt: '2026-10-07T18:20:00.000Z', status: 'confirmed' },   // in 20 min
      { appointmentId: 'a2', technicianId: 't1', startTime: '16:00', startAt: '2026-10-07T20:00:00.000Z', status: 'confirmed' },   // later
      { appointmentId: 'a3', technicianId: 't2', startTime: '13:00', startAt: '2026-10-07T17:00:00.000Z', status: 'confirmed' },   // past
      { appointmentId: 'a4', technicianId: 't3', startTime: '14:10', startAt: '2026-10-07T18:10:00.000Z', status: 'cancelled' },   // not confirmed
      { appointmentId: 'a5', technicianId: 't4', date: '2026-10-07', startTime: '14:30', status: 'confirmed' },                    // no startAt
    ];
    const up = upcomingFromAppointments(items, now);
    expect(up.t1).toEqual({ technicianId: 't1', nextAppointmentInMinutes: 20, appointmentId: 'a1' });
    expect(up.t2).toBeUndefined();
    expect(up.t3).toBeUndefined();
    expect(up.t4).toBeUndefined();
  });
  it('end to end: a 30-min walk-in never takes the technician whose appointment starts in 20 min', async () => {
    const now = Date.now();
    const up = upcomingFromAppointments([{ appointmentId: 'a1', technicianId: 't1', startTime: '00:00', startAt: new Date(now + 20 * 60_000).toISOString(), status: 'confirmed' }], now);
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: {
      entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null },
      candidates: [
        { technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false },
        { technicianId: 't2', name: 'Lee', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false },
      ],
    } });
    const svc = new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), undefined, { appointments: new InMemoryAppointmentAdapter(up) });
    const env = await svc.recommend(ctx(), 'q1');
    expect(env.recommended?.technicianId).toBe('t2');
    expect(env.ineligible?.find((i) => i.technicianId === 't1')?.reasons).toContain('reserved for an appointment');
  });
  it('an appointment guest is not kept from their OWN booked technician', async () => {
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: {
      entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: 't1', isAppointment: true },
      candidates: [{ technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false, nextAppointmentInMinutes: 5 }],
    } });
    const svc = new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true));
    expect((await svc.recommend(ctx(), 'q1')).recommended?.technicianId).toBe('t1');
  });
});
