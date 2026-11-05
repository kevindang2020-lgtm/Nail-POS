// display-mode.test.ts — Dual-Screen mandate §11–§12: ONE authoritative display state model and its priority —
// active checkout, then payment, then a customer at the check-in, then system (offline / maintenance), then advertising.
import { describe, it, expect } from 'vitest';
import { customerDisplayMode, reportedModeFor, CUSTOMER_DISPLAY_MODES, type DisplayModeFacts } from './display-mode';

const f = (over: Partial<DisplayModeFacts> = {}): DisplayModeFacts => ({ checkoutState: null, checkInStep: 'none', phoneCode: false, maintenance: false, online: true, ...over });

describe('customerDisplayMode (§11)', () => {
  it('every checkout state maps to its mode', () => {
    expect(customerDisplayMode(f({ checkoutState: 'ticket_review' }))).toBe('CHECKOUT');
    expect(customerDisplayMode(f({ checkoutState: 'tip_selected' }))).toBe('CHECKOUT');
    expect(customerDisplayMode(f({ checkoutState: 'payment_failed' }))).toBe('CHECKOUT');
    expect(customerDisplayMode(f({ checkoutState: 'expired' }))).toBe('CHECKOUT');
    expect(customerDisplayMode(f({ checkoutState: 'payment_processing' }))).toBe('PAYMENT_PROCESSING');
    expect(customerDisplayMode(f({ checkoutState: 'payment_verifying' }))).toBe('PAYMENT_VERIFYING');
    expect(customerDisplayMode(f({ checkoutState: 'payment_success' }))).toBe('PAYMENT_COMPLETE');
    expect(customerDisplayMode(f({ checkoutState: 'idle' }))).toBe('ADVERTISEMENT');
    expect(customerDisplayMode(f({ checkoutState: 'disconnected' }))).toBe('ADVERTISEMENT');
  });
  it('every check-in step maps to its mode', () => {
    expect(customerDisplayMode(f({ checkInStep: 'phone' }))).toBe('CHECK_IN');
    expect(customerDisplayMode(f({ checkInStep: 'lookup' }))).toBe('CHECK_IN_LOOKUP');
    expect(customerDisplayMode(f({ checkInStep: 'appointment' }))).toBe('APPOINTMENT_FOUND');
    expect(customerDisplayMode(f({ checkInStep: 'walk_in' }))).toBe('WALK_IN');
    expect(customerDisplayMode(f({ checkInStep: 'success' }))).toBe('CHECK_IN_SUCCESS');
    expect(customerDisplayMode(f({ phoneCode: true }))).toBe('PHONE_VERIFICATION');
  });
});

describe('priority (§12): checkout > payment > check-in > system > advertising', () => {
  it('an active checkout outranks a guest at the check-in, maintenance and the network', () => {
    for (const checkoutState of ['ticket_review', 'payment_processing', 'payment_verifying', 'payment_success']) {
      const m = customerDisplayMode(f({ checkoutState, checkInStep: 'walk_in', maintenance: true, online: false }));
      expect(['CHECKOUT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFYING', 'PAYMENT_COMPLETE']).toContain(m);
    }
  });
  it('the checkout customer\'s own phone-change code may sit on the checkout — never on a payment, never offline', () => {
    expect(customerDisplayMode(f({ checkoutState: 'ticket_review', phoneCode: true }))).toBe('PHONE_VERIFICATION');
    expect(customerDisplayMode(f({ checkoutState: 'ticket_review', phoneCode: true, online: false }))).toBe('CHECKOUT');
    for (const checkoutState of ['payment_processing', 'payment_verifying', 'payment_success']) {
      expect(customerDisplayMode(f({ checkoutState, phoneCode: true }))).not.toBe('PHONE_VERIFICATION');
    }
  });
  it('a customer at the check-in outranks advertising; a staff-requested phone code outranks maintenance', () => {
    expect(customerDisplayMode(f({ checkInStep: 'appointment' }))).toBe('APPOINTMENT_FOUND');
    expect(customerDisplayMode(f({ phoneCode: true, maintenance: true }))).toBe('PHONE_VERIFICATION');
  });
  it('maintenance ends the display\'s check-in session on the server — the guest sees MAINTENANCE, never a refused form', () => {
    expect(customerDisplayMode(f({ checkInStep: 'appointment', maintenance: true }))).toBe('MAINTENANCE');
  });
  it('with nothing to do for a customer: maintenance, then offline, then advertising', () => {
    expect(customerDisplayMode(f({ maintenance: true, online: false }))).toBe('MAINTENANCE');
    expect(customerDisplayMode(f({ online: false }))).toBe('OFFLINE');
    expect(customerDisplayMode(f())).toBe('ADVERTISEMENT');
  });
  it('§81: no check-in without the server — a guest mid-check-in when the network drops sees OFFLINE', () => {
    expect(customerDisplayMode(f({ checkInStep: 'walk_in', online: false }))).toBe('OFFLINE');
  });
  it('an advertisement is never the answer while a checkout exists (§12, §49)', () => {
    for (const checkoutState of ['ticket_review', 'tip_selected', 'payment_processing', 'payment_verifying', 'payment_failed', 'payment_success', 'expired']) {
      for (const online of [true, false]) expect(customerDisplayMode(f({ checkoutState, online }))).not.toBe('ADVERTISEMENT');
    }
  });
});

describe('reportedModeFor — the heartbeat vocabulary (§85)', () => {
  it('maps every mode', () => {
    const want: Record<string, string> = {
      ADVERTISEMENT: 'advertisement', CHECK_IN: 'check_in', CHECK_IN_LOOKUP: 'check_in', APPOINTMENT_FOUND: 'check_in', WALK_IN: 'check_in',
      CHECK_IN_SUCCESS: 'check_in', PHONE_VERIFICATION: 'check_in', CHECKOUT: 'checkout', PAYMENT_PROCESSING: 'checkout', PAYMENT_VERIFYING: 'checkout',
      PAYMENT_COMPLETE: 'checkout', OFFLINE: 'idle', MAINTENANCE: 'idle',
    };
    expect([...CUSTOMER_DISPLAY_MODES].sort()).toEqual(Object.keys(want).sort());
    for (const m of CUSTOMER_DISPLAY_MODES) expect(reportedModeFor(m, true)).toBe(want[m]);
    expect(reportedModeFor('ADVERTISEMENT', false)).toBe('idle');   // no pictures to play: the branded welcome
  });
});
