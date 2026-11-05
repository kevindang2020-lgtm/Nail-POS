// voice-manage.vitest.spec.ts — the safety-critical verified management path. These tests encode the rules Kevin
// authorized: the AI reschedules/cancels ONLY the verified caller's OWN appointments (never another customer's),
// requires confirmation before any change, and creates a customer only with explicit consent.
import { describe, it, expect, vi } from 'vitest';
import { verifyCaller, ownsAppointment, normalizePhone, verificationMode } from './voice-caller-verify-core';
import { VoiceManageService } from './voice-manage.service';

const V = { tenantId: 'ten_1', branchId: 'br_1' };

describe('caller verification core', () => {
  it('normalizes phones to the last 10 digits', () => {
    expect(normalizePhone('+1 (856) 555-2020')).toBe('8565552020');
    expect(normalizePhone('856.555.2020')).toBe('8565552020');
  });
  it('phone mode: requires a full phone that matches on file', () => {
    const cust = { customerId: 'c1', phone: '8565552020', firstName: 'Kevin', lastName: 'Dang' };
    expect(verifyCaller('phone', { phone: '856-555-2020' }, cust)).toBe(true);
    expect(verifyCaller('phone', { phone: '999-000-1111' }, cust)).toBe(false);
    expect(verifyCaller('phone', { phone: '555' }, cust)).toBe(false);
  });
  it('phone_name mode: also requires the name to match', () => {
    const cust = { customerId: 'c1', phone: '8565552020', firstName: 'Kevin', lastName: 'Dang' };
    expect(verifyCaller('phone_name', { phone: '8565552020', name: 'Kevin Dang' }, cust)).toBe(true);
    expect(verifyCaller('phone_name', { phone: '8565552020', name: 'Someone Else' }, cust)).toBe(false);
    expect(verifyCaller('phone_name', { phone: '8565552020' }, cust)).toBe(false); // no name given
  });
  it('ownsAppointment matches by customerId, and by phone for walk-ins', () => {
    expect(ownsAppointment('c1', { customerId: 'c1' })).toBe(true);
    expect(ownsAppointment('c1', { customerId: 'c2' })).toBe(false);
    expect(ownsAppointment('c1', { customerId: null, customerPhone: '8565552020' }, '856-555-2020')).toBe(true);
  });
  it('default mode is phone', () => { expect(verificationMode({})).toBe('phone'); expect(verificationMode({ VOICE_VERIFICATION_MODE: 'phone_name' })).toBe('phone_name'); });
});

function svc(over: any = {}) {
  const booking = {
    appointments: vi.fn(async () => ({ items: [
      { appointmentId: 'bk_own', customerId: 'c1', customerPhone: '8565552020', status: 'booked', date: '2026-05-12', startTime: '10:00', endTime: '10:45', services: [{ serviceName: 'Gel' }], technicianName: 'Lily' },
      { appointmentId: 'bk_other', customerId: 'c2', customerPhone: '2015550000', status: 'booked', date: '2026-05-12', startTime: '11:00', endTime: '11:45', services: [{ serviceName: 'Pedi' }] },
    ] })),
    detail: vi.fn(async (_ctx: any, id: string) => {
      if (id === 'bk_own') return { appointmentId: 'bk_own', customerId: 'c1', customerPhone: '8565552020', status: 'booked' };
      if (id === 'bk_other') return { appointmentId: 'bk_other', customerId: 'c2', customerPhone: '2015550000', status: 'booked' };
      throw new Error('not found');
    }),
    reschedule: vi.fn(async () => ({ appointmentId: 'bk_own', date: '2026-05-13', startTime: '14:00', endTime: '14:45' })),
    cancel: vi.fn(async () => ({ appointmentId: 'bk_own', status: 'cancelled' })),
    ...over.booking,
  };
  const customers = {
    list: vi.fn(async () => ({ items: [{ customerId: 'c1', phone: '8565552020', normalizedPhone: '+18565552020', firstName: 'Kevin', lastName: 'Dang', displayName: 'Kevin Dang' }] })),
    create: vi.fn(async () => ({ customerId: 'c_new' })),
    ...over.customers,
  };
  return { s: new VoiceManageService(booking as any, customers as any), booking, customers };
}
const CALLER = { verified: true as const, customerId: 'c1', phone: '8565552020', name: 'Kevin Dang' };

describe('VoiceManageService — verification', () => {
  it('verifies a caller whose phone matches a customer on file', async () => {
    const { s } = svc();
    const v = await s.verifyCaller(V, { phone: '856-555-2020' }, '+18565552020');   // the call comes from that number
    expect(v?.customerId).toBe('c1');
  });
  it('fails verification for an unknown phone (no leakage)', async () => {
    const { s } = svc({ customers: { list: vi.fn(async () => ({ items: [] })) } });
    expect(await s.verifyCaller(V, { phone: '999-999-9999' }, '+19999999999')).toBeNull();
  });
});

describe('VoiceManageService — reschedule/cancel are OWN-appointment only', () => {
  it('reschedules the caller\'s own appointment after confirmation', async () => {
    const { s, booking } = svc();
    const res = await s.rescheduleAppointment(V, { appointmentId: 'bk_own', startTime: '14:00', caller: CALLER, confirmed: true });
    expect(res.ok).toBe(true);
    expect(booking.reschedule).toHaveBeenCalled();
  });
  it('REFUSES to reschedule another customer\'s appointment (cross-customer block)', async () => {
    const { s, booking } = svc();
    const res = await s.rescheduleAppointment(V, { appointmentId: 'bk_other', startTime: '14:00', caller: CALLER, confirmed: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/couldn.t find that appointment under your account/i);
    expect(booking.reschedule).not.toHaveBeenCalled(); // never delegated
  });
  it('refuses reschedule without confirmation', async () => {
    const { s, booking } = svc();
    const res = await s.rescheduleAppointment(V, { appointmentId: 'bk_own', startTime: '14:00', caller: CALLER, confirmed: false });
    expect(res.ok).toBe(false);
    expect(booking.reschedule).not.toHaveBeenCalled();
  });
  it('REFUSES to cancel another customer\'s appointment', async () => {
    const { s, booking } = svc();
    const res = await s.cancelAppointment(V, { appointmentId: 'bk_other', caller: CALLER, confirmed: true });
    expect(res.ok).toBe(false);
    expect(booking.cancel).not.toHaveBeenCalled();
  });
  it('cancels the caller\'s own appointment after confirmation', async () => {
    const { s, booking } = svc();
    const res = await s.cancelAppointment(V, { appointmentId: 'bk_own', caller: CALLER, confirmed: true });
    expect(res.ok).toBe(true);
    expect(booking.cancel).toHaveBeenCalled();
  });
  it('search returns only the caller\'s own active appointments', async () => {
    const { s } = svc();
    const list = await s.searchAppointments(V, CALLER);
    expect(list.map((a) => a.appointmentId)).toEqual(['bk_own']); // bk_other (c2) excluded
  });
});

describe('VoiceManageService — consent-gated customer creation', () => {
  it('returns an existing customer without creating', async () => {
    const { s, customers } = svc();
    const r = await s.lookupOrCreateCustomer(V, { phone: '8565552020', name: 'Kevin Dang' });
    expect(r).toMatchObject({ ok: true, customerId: 'c1', created: false });
    expect(customers.create).not.toHaveBeenCalled();
  });
  it('REFUSES to create a new customer without explicit consent', async () => {
    const { s, customers } = svc({ customers: { list: vi.fn(async () => ({ items: [] })), create: vi.fn(async () => ({ customerId: 'c_new' })) } });
    const r = await s.lookupOrCreateCustomer(V, { phone: '2025550000', name: 'New Caller' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/consent|permission/i);
    expect(customers.create).not.toHaveBeenCalled();
  });
  it('creates a new customer WITH consent', async () => {
    const create = vi.fn(async () => ({ customerId: 'c_new' }));
    const { s } = svc({ customers: { list: vi.fn(async () => ({ items: [] })), create } });
    const r = await s.lookupOrCreateCustomer(V, { phone: '2025550000', name: 'New Caller', consent: true });
    expect(r).toMatchObject({ ok: true, customerId: 'c_new', created: true });
    expect(create).toHaveBeenCalled();
  });
});
