import { describe, it, expect } from 'vitest';
import { deriveWorkforceState, deriveQueue, applyTransition, legacyStatusFor, factsFromLegacy, normalizeEmployment, isAssignableState, WorkforceStateError, type WorkforceFacts } from './workforce-status-core';

const base: WorkforceFacts = { employment: 'active', clock: 'CLOCKED_IN', service: 'IDLE', currentTicketId: null, manualUnavailable: false };

describe('workforce-status-core — derivation table', () => {
  const T: Array<[string, Partial<WorkforceFacts>, string]> = [
    ['active + clocked in + idle → AVAILABLE', {}, 'AVAILABLE'],
    ['clocked out → OFF_SHIFT', { clock: 'CLOCKED_OUT' }, 'OFF_SHIFT'],
    ['on break → BREAK', { clock: 'ON_BREAK' }, 'BREAK'],
    ['serving → SERVING', { service: 'SERVING', currentTicketId: 'tk1' }, 'SERVING'],
    ['serving beats break', { clock: 'ON_BREAK', service: 'SERVING' }, 'SERVING'],
    ['paused → ASSIGNED', { service: 'PAUSED', currentTicketId: 'tk1' }, 'ASSIGNED'],
    ['holding a ticket, idle → ASSIGNED', { currentTicketId: 'tk1' }, 'ASSIGNED'],
    ['suspended → UNAVAILABLE even when clocked in', { employment: 'suspended' }, 'UNAVAILABLE'],
    ['archived → UNAVAILABLE', { employment: 'archived' }, 'UNAVAILABLE'],
    ['inactive → UNAVAILABLE', { employment: 'inactive' }, 'UNAVAILABLE'],
    ['suspended beats clocked out (employment first)', { employment: 'suspended', clock: 'CLOCKED_OUT' }, 'UNAVAILABLE'],
    ['clocked out beats serving (stale service state cannot make an off-shift tech assignable)', { clock: 'CLOCKED_OUT', service: 'SERVING' }, 'OFF_SHIFT'],
    ['manually unavailable → UNAVAILABLE', { manualUnavailable: true }, 'UNAVAILABLE'],
    ['manually unavailable but serving → SERVING', { manualUnavailable: true, service: 'SERVING' }, 'SERVING'],
    ['manually unavailable on break → BREAK', { manualUnavailable: true, clock: 'ON_BREAK' }, 'BREAK'],
  ];
  for (const [name, patch, expected] of T) it(name, () => expect(deriveQueue({ ...base, ...patch })).toBe(expected));

  it('AVAILABLE is the ONLY assignable state', () => {
    expect(isAssignableState(base)).toBe(true);
    for (const patch of [{ clock: 'ON_BREAK' }, { clock: 'CLOCKED_OUT' }, { employment: 'suspended' }, { service: 'SERVING' }, { currentTicketId: 'x' }, { manualUnavailable: true }] as Partial<WorkforceFacts>[]) {
      expect(isAssignableState({ ...base, ...patch })).toBe(false);
    }
  });

  it('shift + presence derive from the clock', () => {
    expect(deriveWorkforceState(base)).toMatchObject({ shift: 'ON_SHIFT', presence: 'online', queue: 'AVAILABLE' });
    expect(deriveWorkforceState({ ...base, clock: 'CLOCKED_OUT' })).toMatchObject({ shift: 'OFF_SHIFT', presence: 'offline', queue: 'OFF_SHIFT' });
    expect(deriveWorkforceState({ ...base, clock: 'ON_BREAK' })).toMatchObject({ shift: 'ON_SHIFT', presence: 'online', queue: 'BREAK' });
  });
});

describe('workforce-status-core — transitions', () => {
  const out: WorkforceFacts = { ...base, clock: 'CLOCKED_OUT' };
  it('clockIn only from CLOCKED_OUT', () => {
    expect(applyTransition(out, 'clockIn').clock).toBe('CLOCKED_IN');
    expect(() => applyTransition(base, 'clockIn')).toThrow(WorkforceStateError);
    expect(() => applyTransition({ ...base, clock: 'ON_BREAK' }, 'clockIn')).toThrow(/already clocked in/);
  });
  it('clockOut from CLOCKED_IN or ON_BREAK, never while serving, never when already out', () => {
    expect(applyTransition(base, 'clockOut')).toMatchObject({ clock: 'CLOCKED_OUT', service: 'IDLE', currentTicketId: null });
    expect(applyTransition({ ...base, clock: 'ON_BREAK' }, 'clockOut').clock).toBe('CLOCKED_OUT');
    expect(() => applyTransition(out, 'clockOut')).toThrow(/not clocked in/);
    expect(() => applyTransition({ ...base, service: 'SERVING' }, 'clockOut')).toThrow(/active service/);
  });
  it('breakStart needs CLOCKED_IN (not out, not already on break, not serving); breakEnd needs ON_BREAK', () => {
    expect(applyTransition(base, 'breakStart').clock).toBe('ON_BREAK');
    expect(() => applyTransition(out, 'breakStart')).toThrow(WorkforceStateError);
    expect(() => applyTransition({ ...base, clock: 'ON_BREAK' }, 'breakStart')).toThrow(/already on break/);
    expect(() => applyTransition({ ...base, service: 'SERVING' }, 'breakStart')).toThrow(/active service/);
    expect(applyTransition({ ...base, clock: 'ON_BREAK' }, 'breakEnd').clock).toBe('CLOCKED_IN');
    expect(() => applyTransition(base, 'breakEnd')).toThrow(/not on break/);
  });
  it('service lifecycle: assigned → serviceStarted → servicePaused → serviceResumed → serviceCompleted', () => {
    let s = applyTransition(base, 'assigned', { ticketId: 'tk1' });
    expect(deriveQueue(s)).toBe('ASSIGNED');
    s = applyTransition(s, 'serviceStarted', { ticketId: 'tk1' });
    expect(s).toMatchObject({ service: 'SERVING', currentTicketId: 'tk1' });
    expect(() => applyTransition(s, 'serviceStarted', { ticketId: 'tk2' })).toThrow(/another ticket/);
    s = applyTransition(s, 'servicePaused'); expect(s.service).toBe('PAUSED');
    expect(() => applyTransition(s, 'servicePaused')).toThrow(WorkforceStateError);
    s = applyTransition(s, 'serviceResumed'); expect(s.service).toBe('SERVING');
    s = applyTransition(s, 'serviceCompleted'); expect(s).toMatchObject({ service: 'IDLE', currentTicketId: null });
    expect(deriveQueue(s)).toBe('AVAILABLE');
    expect(() => applyTransition(s, 'serviceCompleted')).toThrow(/No service/);
  });
  it('serviceStarted while on break ends the break; assignment while clocked out is refused', () => {
    expect(applyTransition({ ...base, clock: 'ON_BREAK' }, 'serviceStarted', { ticketId: 'tk' }).clock).toBe('CLOCKED_IN');
    expect(() => applyTransition(out, 'assigned', { ticketId: 'tk' })).toThrow(/not clocked in/);
    expect(() => applyTransition(out, 'serviceStarted', { ticketId: 'tk' })).toThrow(/not clocked in/);
  });
  it('unassigned clears a held ticket but refuses to drop an active service', () => {
    expect(applyTransition({ ...base, currentTicketId: 'tk' }, 'unassigned').currentTicketId).toBeNull();
    expect(() => applyTransition({ ...base, service: 'SERVING', currentTicketId: 'tk' }, 'unassigned')).toThrow(/active service/);
  });
  it('never mutates the input', () => {
    const frozen = Object.freeze({ ...base });
    expect(() => applyTransition(frozen, 'breakStart')).not.toThrow();
    expect(frozen.clock).toBe('CLOCKED_IN');
  });
});

describe('workforce-status-core — legacy compatibility', () => {
  it('legacyStatusFor maps the derived queue to the technician_statuses vocabulary', () => {
    expect(legacyStatusFor(base)).toBe('available');
    expect(legacyStatusFor({ ...base, clock: 'ON_BREAK' })).toBe('on_break');
    expect(legacyStatusFor({ ...base, service: 'SERVING' })).toBe('in_service');
    expect(legacyStatusFor({ ...base, clock: 'CLOCKED_OUT' })).toBe('off_shift');
    expect(legacyStatusFor({ ...base, employment: 'suspended' })).toBe('inactive');
    expect(legacyStatusFor({ ...base, manualUnavailable: true })).toBe('unavailable');
    expect(legacyStatusFor({ ...base, currentTicketId: 'tk' })).toBe('assigned');
  });
  it('factsFromLegacy: no open punch → CLOCKED_OUT whatever the legacy flag said', () => {
    expect(factsFromLegacy('active', 'available', false).clock).toBe('CLOCKED_OUT');
    expect(factsFromLegacy('active', 'on_break', true)).toMatchObject({ clock: 'ON_BREAK', service: 'IDLE' });
    expect(factsFromLegacy('active', 'in_service', true)).toMatchObject({ clock: 'CLOCKED_IN', service: 'SERVING' });
    expect(factsFromLegacy('suspended', 'available', true).employment).toBe('suspended');
  });
  it('normalizeEmployment tolerates the legacy technicians.status default off_shift', () => {
    expect(normalizeEmployment('off_shift', true, null)).toBe('active');
    expect(normalizeEmployment('off_shift', false, null)).toBe('inactive');
    expect(normalizeEmployment('garbage', true, new Date())).toBe('archived');
    expect(normalizeEmployment('suspended')).toBe('suspended');
  });
});
