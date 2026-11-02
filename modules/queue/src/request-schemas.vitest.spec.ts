// BUILD_PLAN Phase 12 (#17): the queue module's body validation, route by route on the real controllers — the bodies
// pos-web / tech-web / the Go Check-In kiosk and the customer display send today pass intact, unknown fields are stripped,
// a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CheckInController as CI } from './check-in/check-in.controller';
import { QueueController as Q, CustomerQueueController as CQ } from './queue/queue.controller';
import { TechQueueController as TQ } from './tech-queue/tech-queue.controller';
import { ServingController as SV } from './serving/serving.controller';
import { ServiceDoneController as SD } from './service-done/service-done.controller';
import { TechController as T } from './tech/tech.controller';
import { TechnicianHelpController as H } from './technician-help/technician-help.controller';
import { LiveTechnicianScheduleController as LS } from './live-technician-schedule/live-technician-schedule.controller';
import { GoCheckInAdminController as GA, GoCheckInSettingsController as GS } from './go-check-in/go-check-in.admin.controller';
import { GoCheckInPublicController as GP } from './go-check-in/go-check-in.public.controller';

const I = '22222222-2222-4222-8222-222222222222';
const J = '33333333-3333-4333-8333-333333333333';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  // Check-In
  c('POST /pos/check-in/walk-in', CI, 'walkIn', [{ customerId: I, customerName: 'Mai', customerPhone: '6095551234', serviceIds: [I], technicianId: I }, { customerName: 'Guest', serviceIds: [I], source: 'walk_in', idempotencyKey: 'pos-walkin-1' }, { customerName: 'Guest', serviceIds: [I], serviceLines: [{ serviceId: I, name: 'Gel', durationMinutes: 45, priceCents: 4500 }, { serviceId: J, priceCents: 500, isAddon: true, parentServiceId: I }], priceOverrides: { [I]: { priceCents: 4000, reason: 'regular' } }, notes: 'window seat' }], [{ customerName: 'Mai', serviceIds: 'gel' }, 'serviceIds']),
  c('POST /pos/check-in/create-customer', CI, 'createCustomer', [{ fullName: 'Mai Tran', phone: '6095551234', smsOptIn: true }], [{ fullName: { first: 'Mai' } }, 'fullName']),
  c('POST /pos/check-in/:checkInId/update-services', CI, 'updateServices', [{ serviceIds: [I, J] }], [{ serviceIds: [I], serviceLines: [{ priceCents: -5 }] }, 'serviceLines[0].priceCents']),
  c('POST /pos/check-in/:checkInId/assign-technician', CI, 'assign', [{ technicianId: I }, { technicianId: I, managerOverride: true }], [{ technicianId: I, managerOverride: 'yes' }, 'managerOverride']),
  c('POST /pos/check-in/:checkInId/update-wait-estimate', CI, 'updateWait', [{}, { quotedWaitMinutes: 15 }], [{ quotedWaitMinutes: [15] }, 'quotedWaitMinutes']),
  c('POST /pos/check-in/:checkInId/cancel', CI, 'cancel', [{ reason: 'left', cancelAppointment: true }], [{ reason: 7 }, 'reason']),
  // Queue
  c('POST /pos/queue/reorder', Q, 'reorder', [{ order: [{ queueItemId: I, expectedVersion: 3 }, { queueItemId: J }] }], [{ order: { queueItemId: I } }, 'order']),
  c('POST /pos/queue/plans/assign', Q, 'assignPlan', [
    { items: [{ queueItemId: I, expectedVersion: 3, expectedTechnicianId: null, lines: [{ serviceId: I, technicianId: J, expectedTechnicianId: null }, { serviceId: J, technicianId: I, expectedTechnicianId: J }] }], idempotencyKey: 'k-1', source: 'staff' },
    { items: [{ queueItemId: I, expectedVersion: 1, expectedTechnicianId: J, leadTechnicianId: J, lines: [{ serviceId: I, technicianId: J, expectedTechnicianId: null }] }, { queueItemId: J, expectedVersion: 2, expectedTechnicianId: null, lines: [{ serviceId: I, technicianId: I, expectedTechnicianId: null }] }], groupId: I, idempotencyKey: 'k-2', managerOverride: true, reason: 'regulars', source: 'ai_suggestion' },
  ], [{ items: [{ queueItemId: I, expectedVersion: 1, expectedTechnicianId: null, lines: [{ serviceId: I, technicianId: 7, expectedTechnicianId: null }] }], idempotencyKey: 'k' }, 'items[0].lines[0].technicianId']),
  c('POST /pos/queue/groups', Q, 'createGroup', [{ label: 'Tran party', queueItemIds: [I, J], together: true }], [{ label: 'x', queueItemIds: I }, 'queueItemIds']),
  c('POST /pos/queue/items', Q, 'create', [{ customerName: 'Mai', customerPhone: '6095551234', serviceIds: [I], priority: 'normal', source: 'walk_in' }], [{ customerName: ['Mai'] }, 'customerName']),
  c('PATCH /pos/queue/items/:queueItemId', Q, 'update', [{ customerName: 'Mai', notes: 'gel', station: 'Chair 2' }], [{ station: { n: 2 } }, 'station']),
  c('POST /pos/queue/items/:queueItemId/call-next', Q, 'callNext', [{}, { notify: true }], [{ notify: 'yes' }, 'notify']),
  c('POST /pos/queue/items/:queueItemId/assign-technician', Q, 'assign', [{ technicianId: I, expectedTechnicianId: null, expectedVersion: 4 }, { technicianId: I }], [{ technicianId: I, expectedVersion: { v: 4 } }, 'expectedVersion']),
  c('POST /pos/queue/items/:queueItemId/unassign-technician', Q, 'unassign', [{}], [{ reason: ['x'] }, 'reason']),
  c('POST /pos/queue/auto-balance/apply', Q, 'abApply', [{ proposals: [{ queueItemId: I, technicianId: J, expectedTechnicianId: null, expectedVersion: 2 }] }], [{ proposals: [{ queueItemId: I, technicianId: 5 }] }, 'proposals[0].technicianId']),
  c('POST /pos/queue/items/:queueItemId/change-requested-technician', Q, 'changeRequestedTech', [{ technicianId: I }], [{ technicianId: [I] }, 'technicianId']),
  c('POST /pos/queue/items/:queueItemId/update-services', Q, 'updateServices', [{ serviceIds: [I] }], [{ serviceIds: [{ id: I }] }, 'serviceIds[0]']),
  c('POST /pos/queue/items/:queueItemId/update-priority', Q, 'updatePriority', [{ priority: 'vip' }], [{ priority: 1 }, 'priority']),
  c('POST /pos/queue/items/:queueItemId/notify-customer', Q, 'notify', [{}, { channel: 'sms' }], [{ channel: ['sms'] }, 'channel']),
  c('POST /pos/queue/items/:queueItemId/cancel', Q, 'cancel', [{ reason: 'left' }], [{ reason: {} }, 'reason']),
  c('POST /pos/queue/items/:queueItemId/lock', Q, 'lock', [{ technicianId: null, reason: 'hold for Tina' }, { technicianId: I, reason: 'vip', expiresInMinutes: 10 }], [{ reason: 'x', expiresInMinutes: [10] }, 'expiresInMinutes']),
  c('POST /pos/queue/items/:queueItemId/unlock', Q, 'unlock', [{ reason: 'done' }], [{ reason: 1 }, 'reason']),
  c('PUT /pos/queue/items/:queueItemId/service-assignments', Q, 'serviceAssignments', [{ assignments: [{ serviceId: I, technicianId: J }, { serviceId: J, technicianId: null }] }], [{ assignments: [{ serviceId: I, technicianId: {} }] }, 'assignments[0].technicianId']),
  c('POST /pos/queue/items/:queueItemId/remove', Q, 'remove', [{}, { reason: 'duplicate' }], [{ reason: [] }, 'reason']),
  c('POST /customer/queue/:queueItemId/accept-alternate', CQ, 'acceptAlternate', [{ technicianId: I }], [{ technicianId: 5 }, 'technicianId']),
  // Tech Queue
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/accept', TQ, 'accept', [{}], [{ expectedVersion: {} }, 'expectedVersion']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/decline', TQ, 'decline', [{ reason: 'busy' }], [{ reason: ['busy'] }, 'reason']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/reassign-technician', TQ, 'reassign', [{ technicianId: I, reason: 'sick' }], [{ technicianId: { id: I } }, 'technicianId']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/update-services', TQ, 'updateServices', [{ serviceIds: [I] }], [{ serviceIds: I }, 'serviceIds']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/update-priority', TQ, 'updatePriority', [{ priority: 'vip' }], [{ priority: {} }, 'priority']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/notify-technician', TQ, 'notifyTech', [{}, { channel: 'app' }], [{ channel: 3 }, 'channel']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/notify-customer', TQ, 'notifyCust', [{}, { channel: 'sms' }], [{ channel: {} }, 'channel']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/report-delay', TQ, 'reportDelay', [{ reason: 'color mix', extraMinutes: 15 }], [{ reason: 'x', customerNotified: 'yes' }, 'customerNotified']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/clear-delay', TQ, 'clearDelay', [{ note: 'back on time' }], [{ note: ['x'] }, 'note']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/start-service', TQ, 'startService', [{}, { managerOverride: true }], [{ managerOverride: 'true' }, 'managerOverride']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/move-to-serving', TQ, 'moveServing', [{}], [{ managerOverride: 1 }, 'managerOverride']),
  c('POST /pos/tech-queue/tickets/:techQueueTicketId/cancel', TQ, 'cancel', [{ reason: 'left' }], [{ reason: true }, 'reason']),
  // Serving
  c('POST /pos/serving/change-requests/:id/decision', SV, 'decideChangeRequest', [{ decision: 'approve' }, { decision: 'reject' }], [{ decision: true }, 'decision']),
  c('POST /pos/serving/tickets/:ticketId/update-notes', SV, 'notes', [{ notes: 'short nails' }], [{ notes: { t: 1 } }, 'notes']),
  c('POST /pos/serving/tickets/:ticketId/add-service', SV, 'addService', [{ serviceId: I, technicianId: J }], [{ serviceId: I, priceOverrideCents: 12.5 }, 'priceOverrideCents']),
  c('POST /pos/serving/tickets/:ticketId/add-retail', SV, 'addRetail', [{ productId: I, quantity: 2 }], [{ productId: I, quantity: { n: 2 } }, 'quantity']),
  c('PATCH /pos/serving/tickets/:ticketId/services/:serviceLineId', SV, 'editService', [{ technicianId: I, expectedVersion: 3 }, { priceOverrideCents: 3000 }], [{ priceOverrideCents: -1 }, 'priceOverrideCents']),
  c('POST /pos/serving/tickets/:ticketId/remove-service', SV, 'removeService', [{ serviceLineId: I, reason: 'changed mind' }], [{ serviceLineId: [I] }, 'serviceLineId']),
  c('POST /pos/serving/tickets/:ticketId/assign-technician', SV, 'assignTech', [{ technicianId: I }], [{ technicianId: 1 }, 'technicianId']),
  c('POST /pos/serving/tickets/:ticketId/assign-helper', SV, 'assignHelper', [{ technicianId: I }, { technicianId: null }], [{ technicianId: {} }, 'technicianId']),
  c('POST /pos/serving/tickets/:ticketId/reopen', SV, 'reopen', [{}, { reason: 'missed a nail' }], [{ reason: ['x'] }, 'reason']),
  c('POST /pos/serving/tickets/:ticketId/report-delay', SV, 'reportDelay', [{ reason: 'color mix', extraMinutes: 15 }], [{ reason: 'x', extraMinutes: [15] }, 'extraMinutes']),
  c('POST /pos/serving/tickets/:ticketId/clear-delay', SV, 'clearDelay', [{ note: 'ok' }], [{ note: 5 }, 'note']),
  // Service Done
  c('POST /pos/service-done/tickets/:ticketId/quality-check', SD, 'quality', [{ result: 'pass' }, { result: 'fail', note: 'chip on left thumb' }], [{ result: ['pass'] }, 'result']),
  c('POST /pos/service-done/tickets/:ticketId/update-notes', SD, 'notes', [{ notes: 'loves pink' }], [{ notes: [] }, 'notes']),
  c('POST /pos/service-done/tickets/:ticketId/assign-technician', SD, 'assignTech', [{ technicianId: I }], [{ technicianId: [] }, 'technicianId']),
  c('POST /pos/service-done/tickets/:ticketId/assign-helper', SD, 'assignHelper', [{ technicianId: null }], [{ technicianId: 9 }, 'technicianId']),
  c('POST /pos/service-done/tickets/:ticketId/notify-customer', SD, 'notify', [{ channel: 'sms' }], [{ channel: [] }, 'channel']),
  c('POST /pos/service-done/tickets/:ticketId/reopen-service', SD, 'reopen', [{ reason: 'missed a nail' }], [{ reason: {} }, 'reason']),
  // Technician app
  c('POST /tech/tickets/:id/accept', T, 'accept', [{}, { expectedVersion: 2 }], [{ expectedVersion: [2] }, 'expectedVersion']),
  c('POST /tech/tickets/:id/decline', T, 'decline', [{ reason: 'on break' }], [{ reason: {} }, 'reason']),
  c('POST /tech/tickets/:id/service-done', T, 'done', [{}, { notes: 'all good' }], [{ notes: 1 }, 'notes']),
  c('POST /tech/notifications/read', T, 'markRead', [{}, { ids: [I] }], [{ ids: I }, 'ids']),
  c('POST /tech/tickets/:id/service-lines', T, 'addServiceLine', [{ serviceId: I }, { serviceId: I, notes: 'french' }], [{ serviceId: { id: I } }, 'serviceId']),
  c('PATCH /tech/tickets/:id/service-lines/:lineId', T, 'patchServiceLine', [{ notes: 'cuticles' }, { status: 'done' }], [{ notes: ['x'] }, 'notes']),
  c('DELETE /tech/tickets/:id/service-lines/:lineId', T, 'removeServiceLine', [{}, { reason: 'customer changed mind' }], [{ reason: 2 }, 'reason']),
  c('POST /tech/tickets/:id/change-requests', T, 'createChangeRequest', [{ type: 'change_service', lineId: I, newServiceId: J, reason: 'upgrade' }, { type: 'remove_line', lineId: I }], [{ type: 'remove_line', lineId: [I] }, 'lineId']),
  c('POST /tech/tickets/:id/add-addon', T, 'addAddOn', [{ serviceId: I }], [{ serviceId: 7 }, 'serviceId']),
  c('POST /tech/tickets/:id/notes', T, 'addNote', [{ note: 'sensitive skin', visibility: 'internal' }], [{ note: { x: 1 } }, 'note']),
  c('POST /tech/tickets/:id/request-cancel', T, 'reqCancel', [{ reason: 'feeling ill' }], [{ reason: [] }, 'reason']),
  c('POST /tech/skills/change-request', T, 'requestSkillChange', [{ serviceId: I, note: 'certified', proficiencyLevel: 'advanced', experienceYears: 3, supportingPhotos: ['https://x/y.jpg'], status: 'submitted' }], [{ serviceId: I, supportingPhotos: 'x' }, 'supportingPhotos']),
  c('POST /tech/skills/change-request/:id', T, 'updateSkillChange', [{ serviceId: I, status: 'draft' }], [{ serviceId: I, experienceYears: {} }, 'experienceYears']),
  c('POST /tech/skills/change-requests/:id/decision', T, 'decideSkillRequest', [{ decision: 'approved', reviewNotes: 'ok' }], [{ decision: ['approved'] }, 'decision']),
  // POST /tech/status/start-break and /tech/status/break take NO body since the Oct 12 2026 merge (workforce audit P0 #7: the
  // `managerOverride` flag a technician could send to approve their own break is gone) — asserted below, not schema-tested.
  c('POST /tech/help/message', T, 'sendMessageToManager', [{ topic: 'Supplies', message: 'out of acetone' }], [{ topic: 'x', message: { m: 1 } }, 'message']),
  c('POST /tech/help-requests', H, 'create', [{ ticketId: I, serviceLineId: J, helperTechnicianId: I, reason: 'two hands' }, { ticketId: I, serviceLineId: J, helperTechnicianId: I, reason: 'x', note: 'pedi' }], [{ ticketId: [I] }, 'ticketId']),
  c('POST /tech/help-requests/:id/decline', H, 'decline', [{}, { reason: 'busy' }], [{ reason: 3 }, 'reason']),
  // Live schedule
  c('POST /pos/technicians/live-schedule/open-slots/:slotId/book', LS, 'book', [{}, { customerName: 'Mai', serviceIds: [I], durationMinutes: 45, serviceSummary: 'Gel' }], [{ serviceIds: 'gel' }, 'serviceIds']),
  c('POST /pos/technicians/:technicianId/block-time', LS, 'block', [{ date: '2026-10-08', startTime: '13:00', endTime: '14:00', reason: 'lunch' }], [{ startTime: 1300 }, 'startTime']),
  c('POST /pos/technicians/:technicianId/start-break', LS, 'startBreak', [{}, { reason: 'lunch', managerOverride: true }], [{ managerOverride: 'y' }, 'managerOverride']),
  // Go Check-In
  c('POST /super-admin/tenants/:tenantId/go-check-in', GA, 'create', [{ deviceName: 'Front iPad', branchId: I, deviceType: 'kiosk', baseUrl: 'https://checkin.example.com', allowedBranchIds: [J], welcomeMessage: 'Welcome!' }], [{ deviceName: 'x', allowedBranchIds: J }, 'allowedBranchIds']),
  c('PATCH /super-admin/tenants/:tenantId/go-check-in/settings', GA, 'patchSettings', [{ enabled: true, walkinCheckinEnabled: false, confirmationTimeoutSeconds: 20 }], [{ enabled: 'yes' }, 'enabled']),
  c('PATCH /super-admin/tenants/:tenantId/go-check-in/:deviceId', GA, 'update', [{ status: 'disabled' }, { branchId: I, allowedBranchIds: [J], welcomeMessage: 'Hi' }], [{ status: ['disabled'] }, 'status']),
  c('PATCH /pos/settings/go-check-in', GS, 'patch', [{ walkinCheckinEnabled: true, showWaitEstimate: false }], [{ showWaitEstimate: 'no' }, 'showWaitEstimate']),
  c('POST /go-check-in/:slug/start-session', GP, 'start', [{}, { branchId: I }], [{ branchId: { id: I } }, 'branchId']),
  c('POST /go-check-in/session/:sessionId/lookup-phone', GP, 'lookup', [{ phone: '6095551234' }], [{ phone: ['6095551234'] }, 'phone']),
  c('POST /go-check-in/session/:sessionId/confirm-customer', GP, 'confirm', [{ customerId: I }], [{ customerId: 12 }, 'customerId']),
  c('POST /go-check-in/session/:sessionId/create-customer', GP, 'create', [{ firstName: 'Mai', phone: '6095551234' }, { firstName: 'Mai', lastName: 'Tran', email: 'm@x.co', phone: '6095551234', smsConsent: true }, { fullName: 'Mai Tran', phone: '6095551234' }], [{ firstName: 'Mai', smsConsent: 'yes' }, 'smsConsent']),
  c('POST /go-check-in/session/:sessionId/check-in-appointment', GP, 'apptCheckIn', [{ appointmentId: I }], [{ appointmentId: [I] }, 'appointmentId']),
  c('POST /go-check-in/session/:sessionId/accept-alternate', GP, 'acceptAlternate', [{ queueItemId: I, technicianId: J }], [{ queueItemId: I, technicianId: {} }, 'technicianId']),
  c('POST /go-check-in/session/:sessionId/check-in-walk-in', GP, 'walkIn', [{ customerId: I, customerName: 'Mai', phone: '6095551234', serviceIds: [I], addOnIds: [J], technicianId: I }, { customerName: 'Guest', serviceIds: [I] }], [{ customerName: 'Mai', serviceIds: I }, 'serviceIds']),
  c('POST /go-check-in/session/:sessionId/technician/identify', GP, 'techIdentify', [{ pin: '1234' }], [{ pin: { p: 1 } }, 'pin']),
  c('POST /go-check-in/session/:sessionId/technician/clock-in', GP, 'techClockIn', [{ pin: '1234' }, { pin: '1234', idempotencyKey: 'k-1' }], [{ pin: '1234', idempotencyKey: ['k'] }, 'idempotencyKey']),
  c('POST /go-check-in/session/:sessionId/technician/clock-out', GP, 'techClockOut', [{ pin: '1234', idempotencyKey: 'k-2' }], [{ pin: [] }, 'pin']),
];

describe('queue — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
  it('covers every route this module validates (88 — the two technician break routes read no body since Oct 12 2026)', () => expect(CASES.length).toBe(88));
});

describe('technician break routes read no body (a technician cannot approve their own break)', () => {
  it('startBreak / brk declare no @Body parameter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./tech/tech.controller.ts', import.meta.url), 'utf8');
    for (const name of ['startBreak', 'brk']) {
      const line = src.split('\n').find((l) => new RegExp(`\\b${name}\\(@Req\\(\\)`).test(l)) ?? '';
      expect(line, name).not.toBe('');
      expect(line, name).not.toMatch(/@Body/);
    }
  });
});
