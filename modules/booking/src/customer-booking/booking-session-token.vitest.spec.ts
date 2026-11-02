// booking-session-token.vitest.spec.ts — Constitution 3 Step 10c: the booking session is a token we signed, bound to the
// salon and the signed-in customer; a raw, forged, expired or someone-else's id never opens it.
import { describe, it, expect } from 'vitest';
import { sealBookingSession, openBookingSession, BOOKING_SESSION_TTL_SECONDS } from './booking-session-token';

const env = { AUTH_SESSION_SECRET: 'booking-session-test-secret-0123456789abcdef' } as any;
const NOW = Date.parse('2026-10-04T10:00:00Z');
const me = { tenantId: 't1', customerId: 'c1' };
describe('booking session token', () => {
  it('round-trips for the same salon and customer', () => {
    const t = sealBookingSession('sid-123', me, { now: NOW, env });
    expect(t.startsWith('bs~')).toBe(true);
    expect(openBookingSession(t, me, { now: NOW + 1000, env })).toBe('sid-123');
  });
  it('another customer, another salon, a raw id, a tampered body, another key, or an expired token → nothing', () => {
    const t = sealBookingSession('sid-123', me, { now: NOW, env });
    expect(openBookingSession(t, { tenantId: 't1', customerId: 'c2' }, { now: NOW, env })).toBeNull();
    expect(openBookingSession(t, { tenantId: 't2', customerId: 'c1' }, { now: NOW, env })).toBeNull();
    expect(openBookingSession('sid-123', me, { now: NOW, env })).toBeNull();
    expect(openBookingSession('8b6f0c1e-1111-4222-8333-944455556666', me, { now: NOW, env })).toBeNull();
    const [, body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ sid: 'victim-sid', t: 't1', c: 'c1', exp: 9e9 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(openBookingSession(`bs.${forged}.${sig}`, me, { now: NOW, env })).toBeNull();
    expect(openBookingSession(`bs.${body}.${sig}`, me, { now: NOW, env: { AUTH_SESSION_SECRET: 'another-secret-another-secret-01234567' } as any })).toBeNull();
    expect(openBookingSession(t, me, { now: NOW + (BOOKING_SESSION_TTL_SECONDS + 1) * 1000, env })).toBeNull();
    expect(openBookingSession(undefined, me, { env })).toBeNull();
  });
  it('a guest-less binding (no customer) is its own binding', () => {
    const t = sealBookingSession('sid-9', { tenantId: 't1', customerId: null }, { now: NOW, env });
    expect(openBookingSession(t, { tenantId: 't1', customerId: null }, { now: NOW, env })).toBe('sid-9');
    expect(openBookingSession(t, me, { now: NOW, env })).toBeNull();
  });
});

describe('Phase 4: the token survives the error envelope (it rides on a 428)', () => {
  it('is not mistaken for a JWT by the leak filter — the 428 body still carries it', async () => {
    const { toErrorEnvelope } = await import('@aipowersalon/observability');
    const t = sealBookingSession('11111111-2222-4333-8444-555555555555', { tenantId: 't1', customerId: 'u1' });
    const env = toErrorEnvelope({ status: 428, unexpected: false, body: { code: 'phone_verification_required', message: 'Verify', bookingSessionId: t, maskedPhone: '••••0101' } });
    expect(env.bookingSessionId).toBe(t);
  });
  it('a token issued in the old dotted form still opens (in-flight sessions survive the deploy)', () => {
    const t = sealBookingSession('11111111-2222-4333-8444-555555555555', { tenantId: 't1', customerId: 'u1' });
    expect(openBookingSession(t.replace(/~/g, '.'), { tenantId: 't1', customerId: 'u1' })).toBe('11111111-2222-4333-8444-555555555555');
  });
});

