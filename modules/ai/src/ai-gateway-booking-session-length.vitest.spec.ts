// w4 sweep SW-06b (Oct 13 2026): the AI receptionist gateway (and the scheduling options hold) capped bookingSessionId at
// 200 characters — but the server's own sealed booking session (`bs~payload~signature`) is longer, so the voice flow's
// "book with the proven phone" retry was refused 400 (live-phase4-booking-verification: AI RECEPTIONIST checks failed).
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { validateBody } from '@aipowersalon/permissions';
import { sealBookingSession } from '@aipowersalon/booking';
import { GW_BOOK_BODY, GW_VERIFICATION_SEND_BODY, SCHED_OPTIONS_BODY } from './request-schemas';

const env = { ...process.env, BOOKING_SESSION_SECRET: 'w4-sweep-booking-session-secret-0123456789' } as NodeJS.ProcessEnv;
const token = sealBookingSession(randomUUID(), { tenantId: randomUUID(), customerId: randomUUID() }, { env, now: Date.UTC(2026, 9, 13, 15) });

describe('the AI gateway accepts the sealed booking session the server issues', () => {
  it('a real token is longer than 200 characters', () => { expect(token.length).toBeGreaterThan(200); });
  for (const [name, schema, body] of [
    ['gateway book', GW_BOOK_BODY, { bookingSessionId: token }],
    ['gateway verification send', GW_VERIFICATION_SEND_BODY, { bookingSessionId: token }],
    ['scheduling options hold', SCHED_OPTIONS_BODY, { hold: { bookingSessionId: token } }],
  ] as const) {
    it(name, () => { const r = validateBody(schema, body) as any; expect(r.ok, JSON.stringify(r.errors ?? r)).toBe(true); });
  }
});
