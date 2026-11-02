// w4 sweep SW-06 (Oct 13 2026): the AI booking link and the AI receptionist refused their OWN sealed booking session.
// sealBookingSession() returns `bs~<payload>~<signature>` — a session uuid bound to a tenant (and customer) and signed —
// which is well over 200 characters, but AIB_PUBLIC_* capped bookingSessionId at 200. Every guest who had to prove their
// phone got "bookingSessionId must be at most 200 characters" on send / check / create (live-phase4-booking-verification:
// 11 failed checks). The customer app's schemas allow 512; the public link's must accept the same token.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validateBody } from '@aipowersalon/permissions';
import { sealBookingSession } from '@aipowersalon/booking';
import { AIB_PUBLIC_CREATE_BODY, AIB_PUBLIC_VERIFY_CHECK_BODY, AIB_PUBLIC_VERIFY_SEND_BODY } from './request-schemas';

describe('the AI booking public schemas accept the sealed booking session the server itself issues', () => {
  const env = { ...process.env, BOOKING_SESSION_SECRET: 'w4-sweep-booking-session-secret-0123456789' } as NodeJS.ProcessEnv;
  const token = sealBookingSession(randomUUID(), { tenantId: randomUUID(), customerId: randomUUID() }, { env, now: Date.UTC(2026, 9, 13, 15) });
  it('a real token is longer than the old 200-character cap', () => { expect(token.length).toBeGreaterThan(200); });
  for (const [name, schema, extra] of [
    ['verification/send', AIB_PUBLIC_VERIFY_SEND_BODY, {}],
    ['verification/check', AIB_PUBLIC_VERIFY_CHECK_BODY, { code: '123456' }],
    ['appointments', AIB_PUBLIC_CREATE_BODY, {}],
  ] as const) {
    it(`${name}: bookingSessionId = the sealed token passes validation`, () => {
      const r = validateBody(schema, { bookingSessionId: token, ...extra }) as any;
      expect(r.ok, JSON.stringify(r.errors ?? r)).toBe(true);
    });
  }
});
