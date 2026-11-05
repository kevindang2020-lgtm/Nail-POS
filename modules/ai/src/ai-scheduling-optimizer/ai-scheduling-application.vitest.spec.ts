// ai-scheduling-application.vitest.spec.ts — application always goes THROUGH the booking service, refuses non-applicable
// states, is idempotent, aborts as STALE if the appointment changed (never overwrites), lets the booking service's
// rejection stand, and only auto-applies safe/reversible/confident actions that pass the settings gate.
import { describe, it, expect } from 'vitest';
import { evaluateAutomation, snapshotDrift, applyKey, bookingErrorCode } from './ai-scheduling-application';
import { resolveSettings, PLATFORM_DEFAULTS } from './ai-scheduling-settings';

const snap = { appointmentId: 'ap1', date: '2026-10-09', startTime: '09:00', endTime: '09:45', technicianId: 't1', status: 'booked', version: 4, customerId: 'c1' };
describe('apply rules (orchestrated by AiSchedulingService.apply)', () => {
  it('snapshot drift: date, start, technician or version moved → stale; identical → none', () => {
    const cur = { date: '2026-10-09', startTime: '09:00', technicianId: 't1', version: 4, status: 'booked' };
    expect(snapshotDrift(snap, cur)).toEqual([]);
    expect(snapshotDrift(snap, { ...cur, startTime: '11:30' })).toEqual(['startTime']);
    expect(snapshotDrift(snap, { ...cur, technicianId: 't9' })).toEqual(['technicianId']);
    expect(snapshotDrift(snap, { ...cur, date: '2026-10-10' })).toEqual(['date']);
    expect(snapshotDrift(snap, { ...cur, version: 5 })).toEqual(['version']);
    expect(snapshotDrift(snap, null)).toEqual(['missing']);
  });
  it('the idempotency key is versioned by the apply attempt (a retry is a new key)', () => {
    expect(applyKey('T', 'r1', 1)).toBe('T:r1:apply:1');
    expect(applyKey('T', 'r1', 2)).not.toBe(applyKey('T', 'r1', 1));
  });
  it('booking errors keep their code', () => {
    expect(bookingErrorCode(Object.assign(new Error('x'), { code: 'VERSION_CONFLICT' }))).toBe('VERSION_CONFLICT');
    expect(bookingErrorCode(Object.assign(new Error('x'), { name: 'ValidationError' }))).toBe('BOOKING_VALIDATION');
    expect(bookingErrorCode(new Error('boom'))).toBe('BOOKING_REJECTED');
  });
});

describe('automation gate', () => {
  const enabled = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: true, kill_switch: null, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot'] } } });
  it('only auto-applies safe/reversible/confident/permitted actions', () => {
    expect(evaluateAutomation(enabled, { action: 'open_empty_slot', confidence: 0.9, reversible: true, touchesConfirmedAppointment: false, touchesCustomer: false }).autoApply).toBe(true);
    expect(evaluateAutomation(enabled, { action: 'open_empty_slot', confidence: 0.99, reversible: true, touchesConfirmedAppointment: true, touchesCustomer: false }).autoApply).toBe(false);
    expect(evaluateAutomation(enabled, { action: 'open_empty_slot', confidence: 0.99, reversible: true, touchesConfirmedAppointment: false, touchesCustomer: true }).autoApply).toBe(false);
    expect(evaluateAutomation(enabled, { action: 'open_empty_slot', confidence: 0.99, reversible: false, touchesConfirmedAppointment: false, touchesCustomer: false }).autoApply).toBe(false);
    expect(evaluateAutomation(enabled, { action: 'open_empty_slot', confidence: 0.4, reversible: true, touchesConfirmedAppointment: false, touchesCustomer: false }).autoApply).toBe(false);
    const killed = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: true, kill_switch: true, config: { automationEnabled: true, allowedAutoActions: ['open_empty_slot'] } } });
    expect(evaluateAutomation(killed, { action: 'open_empty_slot', confidence: 0.99, reversible: true, touchesConfirmedAppointment: false, touchesCustomer: false }).autoApply).toBe(false);
  });
});
