// BUILD_PLAN Phase 12 (#17): the appointments routes' body validation, route by route on the real controller — the bodies
// pos-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the field,
// an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { TechAppointmentsController as C } from './tech-appointments/tech-appointments.controller';

const T = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/tech-appointments/appointments', ctl: C, handler: 'create', today: [{ technicianId: T, customerName: 'Mai', customerPhone: '6095551234', serviceIds: [T], date: '2026-10-08', startTime: '10:30', source: 'phone', isVip: false }], bad: [{ technicianId: T, serviceIds: T }, 'serviceIds'] },
  { route: 'POST /pos/tech-appointments/conflicts/check', ctl: C, handler: 'conflict', today: [{ technicianId: T, startTime: '10:00', endTime: '11:00', date: '2026-10-08' }], bad: [{ technicianId: { id: T } }, 'technicianId'] },
  { route: 'PATCH /pos/tech-appointments/appointments/:appointmentId', ctl: C, handler: 'update', today: [{ customerName: 'Mai', notes: 'gel', isVip: true }], bad: [{ isVip: 'yes' }, 'isVip'] },
  { route: 'POST /pos/tech-appointments/appointments/:appointmentId/reschedule', ctl: C, handler: 'reschedule', today: [{ startTime: '2026-10-08T17:30:00.000Z', date: '2026-10-08' }, { startTime: '2026-10-08T17:30:00.000Z', date: '2026-10-08', technicianId: T }], bad: [{ startTime: 1030 }, 'startTime'] },
  { route: 'POST /pos/tech-appointments/appointments/:appointmentId/cancel', ctl: C, handler: 'cancel', today: [{ reason: 'customer called' }], bad: [{ reason: 'x'.repeat(1001) }, 'reason'] },
  { route: 'POST /pos/tech-appointments/appointments/:appointmentId/assign-technician', ctl: C, handler: 'assign', today: [{ technicianId: T }], bad: [{ technicianId: [T] }, 'technicianId'] },
];

describe('appointments — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
